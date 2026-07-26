/**
 * 打开请求串行化 / 防抖（v0.5.2）
 * 避免连续点击导致 channel 连环炸、双整页刷新
 */
import { debugLog } from "../shared/debug.js";
import { normalizeXUrl, routeKey } from "../shared/url-utils.js";

/** @type {Promise<unknown>} */
let chain = Promise.resolve();

/** @type {{ key: string, at: number, result: unknown } | null} */
let lastDone = null;

const DEDUPE_MS = 700;

/**
 * @param {string} rawUrl
 * @param {object} settings
 * @param {() => Promise<unknown>} job
 */
export function enqueueOpen(rawUrl, settings, job) {
  const target =
    normalizeXUrl(rawUrl, {
      normalizeToXCom: settings?.normalizeToXCom,
    }) || rawUrl;
  const key = routeKey(target) || target;

  const run = async () => {
    const now = Date.now();
    if (
      lastDone &&
      lastDone.key === key &&
      now - lastDone.at < DEDUPE_MS &&
      lastDone.result
    ) {
      await debugLog("open", "dedupe skip", { key, ms: now - lastDone.at });
      return {
        ...(typeof lastDone.result === "object" && lastDone.result
          ? lastDone.result
          : {}),
        ok: true,
        deduped: true,
      };
    }

    await debugLog("open", "queue run", { key });
    const result = await job();
    lastDone = { key, at: Date.now(), result };
    return result;
  };

  const next = chain.then(run, run);
  // 保持链不断
  chain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}
