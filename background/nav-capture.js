/**
 * 捕获外站打开的 X 冷标签 → 合并到热壳
 *
 * 闪屏根因（未授权增强权限时最明显）：
 * 页面 content 脚本未注入 → 点链接原生新开 X 标签
 * → 捕获层关掉冷标签 → 焦点曾回到原页 → 再切热壳
 *
 * 正确顺序：冷标签立刻 active:false（不要先激活原页）
 *         → 立刻 openHandler 激活热壳
 *         → 再删冷标签
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
/** 刚创建、怀疑会跳到 X 的标签（opener 非 X） */
const suspectBlankTabs = new Map(); // tabId -> { openerTabId, at }
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
 * 只取消冷标签激活，不要把焦点踢回原页（那会造成「先闪原页再进 X」）
 * @param {number} tabId
 */
async function deactivateColdTab(tabId) {
  try {
    await chrome.tabs.update(tabId, { active: false, autoDiscardable: true });
  } catch {
    // ignore
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
        await deactivateColdTab(tabId);
        await chrome.tabs.remove(tabId);
      }
    } catch {
      // ignore
    }
    return { ok: false, reason: "deduped" };
  }

  inflightTabs.add(tabId);
  suspectBlankTabs.delete(tabId);

  try {
    await debugLog("capture", "hijack external x open", {
      tabId,
      target,
      openerTabId,
      source,
    });

    // ① 立刻取消冷标签激活（不要 active 回原页）
    await deactivateColdTab(tabId);

    // ② 先切到热壳 / 打开逻辑（焦点直接去 X，跳过原页）
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

    // ③ 再删冷标签
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
          // 一创建就取消激活，防止闪屏
          try {
            await chrome.tabs.update(details.tabId, { active: false });
          } catch {
            // ignore
          }

          if (!isCapturableXUrl(url)) {
            if (!url || url === "about:blank") {
              suspectBlankTabs.set(details.tabId, {
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
    if (!isCapturableXUrl(changeInfo.url)) return;
    if (isOwnedTab(tabId)) return;

    const suspect = suspectBlankTabs.get(tabId);
    const openerTabId = tab.openerTabId ?? suspect?.openerTabId;
    if (openerTabId == null) return;

    try {
      // 再次确保冷标签未抢焦点
      await deactivateColdTab(tabId);
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

  chrome.tabs.onCreated.addListener(async (tab) => {
    try {
      if (tab.id == null || isOwnedTab(tab.id)) return;
      const pending = tab.pendingUrl || tab.url || "";
      if (isCapturableXUrl(pending)) {
        await chrome.tabs.update(tab.id, { active: false });
        return;
      }
      // 带 opener 的 about:blank：标记为嫌疑，等 URL 变 X
      if (tab.openerTabId != null && (!pending || pending === "about:blank")) {
        try {
          const opener = await chrome.tabs.get(tab.openerTabId);
          if (!isXTabUrl(opener.url)) {
            await chrome.tabs.update(tab.id, { active: false });
            suspectBlankTabs.set(tab.id, {
              openerTabId: tab.openerTabId,
              at: Date.now(),
            });
          }
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    unmarkOwnedTab(tabId);
    inflightTabs.delete(tabId);
    suspectBlankTabs.delete(tabId);
  });

  // 清理过期嫌疑
  setInterval(() => {
    const now = Date.now();
    for (const [id, info] of suspectBlankTabs) {
      if (now - info.at > SUSPECT_TTL_MS) suspectBlankTabs.delete(id);
    }
  }, 5000);
}

export { markOwnedTab, unmarkOwnedTab, isOwnedTab };
