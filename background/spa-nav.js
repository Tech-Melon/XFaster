/**
 * SPA 导航编排
 *
 * 日志已证明的假成功路径：
 *   sendMessage channel closed（整页卸载）
 *   → reinject → already_there → 误报 SPA 成功
 *   用户看到黑屏 X logo = 整页重载，不是壳复用
 *
 * 规则：
 * 1. channel closed 且 URL 已到目标 → hardNav，绝不是 SPA
 * 2. 不再用会整页跳的 a.click / navigation.api 当成功
 * 3. hardNav 后不要再 tabs.update 二次刷新
 */
import { isXTabUrl, urlsLooselyEqual } from "../shared/url-utils.js";
import { debugLog } from "../shared/debug.js";

/**
 * @param {number} tabId
 * @param {string} targetUrl
 */
export async function softNavigateXTab(tabId, targetUrl) {
  await debugLog("spa", "softNavigateXTab start", { tabId, targetUrl });

  try {
    const tab = await chrome.tabs.get(tabId);
    await debugLog("spa", "tab snapshot", {
      id: tab.id,
      url: tab.url,
      status: tab.status,
      discarded: tab.discarded,
    });

    if (!tab?.url || !isXTabUrl(tab.url)) {
      await debugLog("spa", "fail tab_not_x", tab?.url);
      return { ok: false, reason: "tab_not_x" };
    }
    if (tab.discarded) {
      await debugLog("spa", "fail discarded");
      return { ok: false, reason: "discarded" };
    }
    if (urlsLooselyEqual(tab.url, targetUrl)) {
      await debugLog("spa", "already_there (before nav)");
      return { ok: true, method: "already_there", sameDocument: true };
    }

    try {
      const u = new URL(targetUrl);
      if (u.hostname === "t.co") {
        await debugLog("spa", "fail shortlink");
        return { ok: false, reason: "shortlink" };
      }
    } catch {
      await debugLog("spa", "fail bad_url");
      return { ok: false, reason: "bad_url" };
    }

    if (tab.status !== "complete") {
      await debugLog("spa", "wait shell complete…");
      const ready = await waitTabComplete(tabId, 3000);
      await debugLog("spa", "shell complete?", ready);
      if (!ready) {
        return { ok: false, reason: "shell_not_complete" };
      }
    }

    // 轻量 ping：确认 bridge 活着 + MAIN hydrate 状态
    try {
      const ping = await chrome.tabs.sendMessage(tabId, { type: "SPA_PING" });
      await debugLog("spa", "SPA_PING", ping);
    } catch (e) {
      await debugLog(
        "spa",
        "SPA_PING fail (will reinject on SPA_NAV)",
        e instanceof Error ? e.message : String(e),
      );
    }

    const urlBefore = tab.url;
    const viaBridge = await tryBridge(tabId, targetUrl, urlBefore);
    await debugLog("spa", "bridge final", viaBridge);
    return viaBridge;
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    await debugLog("spa", "softNavigate exception", reason);
    return { ok: false, reason };
  }
}

/**
 * @param {number} tabId
 * @param {string} targetUrl
 * @param {string} urlBefore
 */
async function tryBridge(tabId, targetUrl, urlBefore) {
  try {
    const result = await chrome.tabs.sendMessage(tabId, {
      type: "SPA_NAV",
      href: targetUrl,
    });
    if (result == null) {
      await debugLog("spa", "bridge returned null");
      return { ok: false, reason: "no_bridge" };
    }
    // 真 SPA 才 ok；url_only 已在 MAIN 判失败
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await debugLog("spa", "sendMessage error", msg);

    const channelClosed =
      /message channel closed|asynchronous response/i.test(msg) ||
      /receiving end does not exist/i.test(msg);

    // 等导航落稳
    await sleep(150);
    let tabAfter = null;
    try {
      tabAfter = await chrome.tabs.get(tabId);
    } catch {
      tabAfter = null;
    }

    await debugLog("spa", "after channel error tab", {
      urlAfter: tabAfter?.url,
      status: tabAfter?.status,
      urlBefore,
      targetUrl,
      channelClosed,
    });

    // ★ 关键：channel closed + 已到目标 = 整页导航，不是 SPA
    if (
      tabAfter?.url &&
      urlsLooselyEqual(tabAfter.url, targetUrl) &&
      !urlsLooselyEqual(urlBefore, targetUrl)
    ) {
      await debugLog(
        "spa",
        "HARD NAV detected (unloaded during soft-nav, now at target)",
      );
      return {
        ok: false,
        reason: "full_document_navigation",
        hardNav: true,
        alreadyAtTarget: true,
        detail: msg,
      };
    }

    if (
      channelClosed &&
      tabAfter?.url &&
      !urlsLooselyEqual(tabAfter.url, urlBefore)
    ) {
      await debugLog("spa", "HARD NAV detected (url changed, not SPA)");
      return {
        ok: false,
        reason: "full_document_navigation",
        hardNav: true,
        alreadyAtTarget: urlsLooselyEqual(tabAfter.url, targetUrl),
        detail: msg,
      };
    }

    // 真·无 listener：动态注入后再试一次（仅 Receiving end 类）
    if (/Receiving end does not exist|Could not establish connection/i.test(msg)) {
      const reinjected = await reinjectBridges(tabId);
      await debugLog("spa", "reinject bridges", reinjected);
      if (!reinjected.ok) {
        return { ok: false, reason: "sendMessage_error", detail: msg };
      }
      try {
        const result2 = await chrome.tabs.sendMessage(tabId, {
          type: "SPA_NAV",
          href: targetUrl,
        });
        await debugLog("spa", "bridge after reinject", result2);
        // 若 reinject 后 already_there 但 before 不是目标——仍可能是硬导航后的假象
        if (
          result2?.ok &&
          result2.method === "already_there" &&
          !urlsLooselyEqual(urlBefore, targetUrl)
        ) {
          const t = await chrome.tabs.get(tabId);
          if (urlsLooselyEqual(t.url, targetUrl)) {
            await debugLog(
              "spa",
              "reject false already_there after reinject (hard nav)",
            );
            return {
              ok: false,
              reason: "full_document_navigation",
              hardNav: true,
              alreadyAtTarget: true,
            };
          }
        }
        return result2 || { ok: false, reason: "no_bridge" };
      } catch (e2) {
        const msg2 = e2 instanceof Error ? e2.message : String(e2);
        await debugLog("spa", "sendMessage still fail", msg2);
        return { ok: false, reason: "sendMessage_error", detail: msg2 };
      }
    }

    return { ok: false, reason: "sendMessage_error", detail: msg };
  }
}

/**
 * @param {number} tabId
 */
async function reinjectBridges(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      files: ["content/x-shell-main.js"],
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "ISOLATED",
      files: ["content/x-shell-bridge.js"],
    });
    await sleep(50);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {number} tabId
 * @param {number} timeoutMs
 */
async function waitTabComplete(tabId, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const t = await chrome.tabs.get(tabId);
      if (t.status === "complete" && !t.discarded) return true;
    } catch {
      return false;
    }
    await sleep(100);
  }
  try {
    const t = await chrome.tabs.get(tabId);
    return t.status === "complete";
  } catch {
    return false;
  }
}

/**
 * @param {chrome.tabs.Tab|null} tab
 */
export function hasReusableXShell(tab) {
  if (!tab || tab.discarded) return false;
  if (!tab.url || !isXTabUrl(tab.url)) return false;
  if (tab.url.startsWith("chrome://") || tab.url.startsWith("about:")) {
    return false;
  }
  return true;
}
