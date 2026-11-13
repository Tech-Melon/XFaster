/**
 * 捕获外站打开的 X 冷标签 → 合并到热壳
 *
 * 闪屏根因（未授权增强权限时最明显）：
 * 页面 content 脚本未注入 → 点链接原生新开 X 标签
 * → 捕获层关掉冷标签 → 焦点曾回到原页 → 再切热壳
 *
 * 正确顺序：立刻 openHandler 激活热壳（焦点直接去 X）
 *         → 再删冷标签
 *
 * 0.5.35：
 * - Chromium 的 tabs.update({active:false}) 是空操作（源码 UpdateActiveTab：
 *   !active 直接 return），旧版的「取消激活冷标签」从未生效，只白耗一次 API 往返，已删除
 * - tabs.onUpdated 只接管「刚新建」的标签；用户在已有标签里点 X 链接 / 手输网址不再被关掉
 */
import { debugLog } from "../shared/debug.js";
import { getSettings } from "../shared/settings.js";
import { isXTabUrl, normalizeXUrl } from "../shared/url-utils.js";
import {
  isOwnedTab,
  markOwnedTab,
  unmarkOwnedTab,
} from "./owned-tabs.js";

/** @type {null | ((opts: any) => Promise<any>)} */
let openHandler = null;

const recentKeys = new Map();
const inflightTabs = new Set();
/** 刚创建、怀疑会跳到 X 的标签（opener 非 X）；只有它们会被 tabs.onUpdated 接管 */
const suspectNewTabs = new Map(); // tabId -> { openerTabId, at }
const DEDUPE_MS = 1500;
const SUSPECT_TTL_MS = 8000;
let installed = false;

/**
 * @param {(opts: any) => Promise<any>} fn
 */
export function setOpenHandler(fn) {
  openHandler = fn;
}

function dedupeKey(openerId, url) {
  return `${openerId ?? "x"}|${url}`;
}

function shouldDedupe(key) {
  const now = Date.now();
  const prev = recentKeys.get(key);
  if (prev && now - prev < DEDUPE_MS) return true;
  recentKeys.set(key, now);
  if (recentKeys.size > 100) {
    for (const [k, t] of recentKeys) {
      if (now - t > DEDUPE_MS * 4) recentKeys.delete(k);
    }
  }
  return false;
}

/**
 * @param {string} url
 */
function isCapturableXUrl(url) {
  if (!url || typeof url !== "string") return false;
  if (url === "about:blank" || url.startsWith("chrome://")) return false;
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    return (
      h === "x.com" ||
      h === "www.x.com" ||
      h === "mobile.x.com" ||
      h === "twitter.com" ||
      h === "www.twitter.com" ||
      h === "mobile.twitter.com" ||
      h === "t.co"
    );
  } catch {
    return false;
  }
}

/**
 * @param {object} opts
 * @param {number} opts.tabId
 * @param {string} opts.url
 * @param {number} [opts.openerTabId]
 * @param {string} [opts.source]
 */
export async function tryCaptureExternalXOpen(opts) {
  const { tabId, url, openerTabId, source } = opts;
  if (!isCapturableXUrl(url)) return { ok: false, reason: "not_x" };
  if (isOwnedTab(tabId)) return { ok: false, reason: "owned" };
  if (inflightTabs.has(tabId)) return { ok: false, reason: "inflight" };
  if (!openHandler) return { ok: false, reason: "no_handler" };

  const settings = await getSettings();
  if (!settings.preferReuseXTab && !settings.allowBackgroundWarmTab) {
    return { ok: false, reason: "capture_disabled_by_settings" };
  }

  if (openerTabId != null) {
    try {
      const opener = await chrome.tabs.get(openerTabId);
      if (isXTabUrl(opener.url)) {
        return { ok: false, reason: "opener_is_x" };
      }
    } catch {
      // ignore
    }
  }

  const target =
    normalizeXUrl(url, { normalizeToXCom: settings.normalizeToXCom }) || url;
  const key = dedupeKey(openerTabId, target);

  if (shouldDedupe(key)) {
    try {
      if (!isOwnedTab(tabId)) {
        await chrome.tabs.remove(tabId);
      }
    } catch {
      // ignore
    }
    return { ok: false, reason: "deduped" };
  }

  inflightTabs.add(tabId);
  suspectNewTabs.delete(tabId);

  try {
    await debugLog("capture", "hijack external x open", {
      tabId,
      target,
      openerTabId,
      source,
    });

    // ① 先切到热壳 / 打开逻辑（焦点直接去 X，跳过原页）
    const opened = await openHandler({
      url: target,
      settings,
      openerTabId,
      forceNew: false,
    });

    if (opened?.tabId != null) {
      markOwnedTab(opened.tabId);
      try {
        await chrome.tabs.update(opened.tabId, { active: true });
        const t = await chrome.tabs.get(opened.tabId);
        if (t.windowId != null) {
          await chrome.windows.update(t.windowId, { focused: true });
        }
      } catch {
        // ignore
      }
    }

    // ② 再删冷标签
    try {
      if (!isOwnedTab(tabId)) {
        await chrome.tabs.remove(tabId);
      }
    } catch {
      // ignore
    }

    return { ok: true, opened, source };
  } finally {
    inflightTabs.delete(tabId);
  }
}

export function installNavCapture() {
  if (installed) return;
  installed = true;

  if (chrome.webNavigation?.onCreatedNavigationTarget) {
    chrome.webNavigation.onCreatedNavigationTarget.addListener(
      async (details) => {
        try {
          const url = details.url;
          if (!isCapturableXUrl(url)) {
            if (!url || url === "about:blank") {
              suspectNewTabs.set(details.tabId, {
                openerTabId: details.sourceTabId,
                at: Date.now(),
              });
            }
            return;
          }
          await tryCaptureExternalXOpen({
            tabId: details.tabId,
            url,
            openerTabId: details.sourceTabId,
            source: "onCreatedNavigationTarget",
          });
        } catch (e) {
          await debugLog(
            "capture",
            "onCreatedNavigationTarget error",
            e instanceof Error ? e.message : String(e),
          );
        }
      },
    );
  }

  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (!changeInfo.url) return;
    // 只接管刚新建的标签：已有标签（哪怕带 opener）里的站内跳转 / 手输网址一律放行
    const suspect = suspectNewTabs.get(tabId);
    if (!suspect) return;
    if (Date.now() - suspect.at > SUSPECT_TTL_MS) {
      suspectNewTabs.delete(tabId);
      return;
    }
    if (!isCapturableXUrl(changeInfo.url)) {
      // 已落到普通网页：不再是「冷开 X」嫌疑
      if (changeInfo.url !== "about:blank") suspectNewTabs.delete(tabId);
      return;
    }
    if (isOwnedTab(tabId)) return;

    const openerTabId = suspect.openerTabId ?? tab.openerTabId;
    if (openerTabId == null) return;

    try {
      await tryCaptureExternalXOpen({
        tabId,
        url: changeInfo.url,
        openerTabId,
        source: "tabs.onUpdated",
      });
    } catch {
      // ignore
    }
  });

  chrome.tabs.onCreated.addListener((tab) => {
    if (tab.id == null || isOwnedTab(tab.id)) return;
    if (tab.openerTabId == null) return;
    const pending = tab.pendingUrl || tab.url || "";
    // 新开的标签（目标是 X 或还是空白）：同步标记嫌疑，避免 onUpdated 先到时漏判。
    // opener 是不是 X 由 tryCaptureExternalXOpen 统一检查。
    const maybeX =
      !pending || pending === "about:blank" || isCapturableXUrl(pending);
    if (maybeX) {
      suspectNewTabs.set(tab.id, {
        openerTabId: tab.openerTabId,
        at: Date.now(),
      });
    }
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    unmarkOwnedTab(tabId);
    inflightTabs.delete(tabId);
    suspectNewTabs.delete(tabId);
  });

  // 清理过期嫌疑
  setInterval(() => {
    const now = Date.now();
    for (const [id, info] of suspectNewTabs) {
      if (now - info.at > SUSPECT_TTL_MS) suspectNewTabs.delete(id);
    }
  }, 5000);
}

export { markOwnedTab, unmarkOwnedTab, isOwnedTab };
