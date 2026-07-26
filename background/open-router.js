/**
 * 打开路由 v0.5.18
 *
 * 修复双开：
 * - 禁止「先 ensureWarmTab(home) 再开推文」
 * - 无 X 标签时只 create 目标 URL 一次（带全局锁）
 * - 已有 X 标签只 update，绝不第二张
 */
import {
  normalizeXUrl,
  isXTabUrl,
  urlsLooselyEqual,
  routeKey,
} from "../shared/url-utils.js";
import {
  activateWarmOrNull,
  findAnyXTab,
  touchWarmFromOpen,
  patchWarmState,
  getTabSafe,
  scheduleExpireFromSettings,
  withXTabCreateLock,
} from "./warm-manager.js";
import { hasReusableXShell, softNavigateXTab } from "./spa-nav.js";
import { enqueueOpen } from "./open-queue.js";
import { debugLog } from "../shared/debug.js";
import { markOwnedTab } from "./owned-tabs.js";

/**
 * @param {object} params
 * @param {string} params.url
 * @param {object} params.settings
 * @param {number} [params.openerTabId]
 * @param {boolean} [params.forceNew]
 */
export async function openXUrl({ url, settings, openerTabId, forceNew }) {
  return enqueueOpen(url, settings, () =>
    openXUrlInner({ url, settings, openerTabId, forceNew }),
  );
}

/**
 * 复用已有 X 标签导航到 target
 * @param {string} target
 * @param {object} settings
 */
async function navigateExistingXTab(target, settings) {
  const warm = await activateWarmOrNull(target, settings);
  if (warm?.tabId != null) {
    markOwnedTab(warm.tabId);
    return {
      ok: true,
      mode: warm.mode,
      tabId: warm.tabId,
      url: target,
      fast: Boolean(warm.instant || warm.spa),
      instant: warm.instant,
      spa: Boolean(warm.spa),
      navigated: warm.navigated,
      spaMethod: warm.spaMethod,
      spaFailReason: warm.spaFailReason,
      lastOpen: warm.lastOpen,
    };
  }

  const any = await findAnyXTab({ hotOnly: true });
  if (any?.id == null || !hasReusableXShell(any)) {
    return null;
  }

  markOwnedTab(any.id);
  await chrome.tabs.update(any.id, { active: true });
  await focus(any.windowId);

  if (any.url && urlsLooselyEqual(any.url, target)) {
    const lastOpen = {
      at: Date.now(),
      mode: "reuse_existing_same",
      instant: true,
      spa: false,
      target,
    };
    await touchWarmFromOpen(any.id, settings, target, {
      loadStatus: "complete",
      shellReady: true,
      loadedUrl: target,
      lastOpen,
    });
    return {
      ok: true,
      mode: "reuse_existing_same",
      tabId: any.id,
      url: target,
      fast: true,
      instant: true,
      spa: false,
      lastOpen,
    };
  }

  const soft = await softNavigateXTab(any.id, target);
  if (soft.ok && !soft.hardNav) {
    const after = await getTabSafe(any.id);
    if (after?.url && urlsLooselyEqual(after.url, target)) {
      const lastOpen = {
        at: Date.now(),
        mode: "spa_soft_existing",
        spa: true,
        spaMethod: soft.method,
        instant: true,
        target,
      };
      await touchWarmFromOpen(any.id, settings, target, {
        loadStatus: "complete",
        shellReady: true,
        pendingUrl: target,
        loadedUrl: target,
        lastOpen,
      });
      return {
        ok: true,
        mode: "spa_soft_existing",
        tabId: any.id,
        url: target,
        fast: true,
        spa: true,
        spaMethod: soft.method,
        lastOpen,
      };
    }
  }

  await chrome.tabs.update(any.id, { url: target, active: true });
  await focus(any.windowId);
  const lastOpen = {
    at: Date.now(),
    mode: "full_reload_fallback",
    spaFailReason: soft?.reason || "nav_existing",
    navigated: true,
    target,
  };
  await touchWarmFromOpen(any.id, settings, target, {
    loadStatus: "loading",
    pendingUrl: target,
    shellReady: false,
    lastOpen,
  });
  return {
    ok: true,
    mode: "full_reload_fallback",
    tabId: any.id,
    url: target,
    fast: false,
    navigated: true,
    spaFailReason: soft?.reason,
    lastOpen,
  };
}

async function openXUrlInner({ url, settings, openerTabId, forceNew }) {
  const raw = url;
  const target = normalizeXUrl(url, {
    normalizeToXCom: settings.normalizeToXCom,
  });
  if (!target) {
    return { ok: false, reason: "invalid_url" };
  }

  await debugLog("open", "normalized", {
    raw,
    target,
    routeKey: routeKey(target),
  });

  // ★ 不再调用 ensureWarmTab(home)：那会先开主页再开推文
  if (!forceNew && settings.preferReuseXTab) {
    const reused = await navigateExistingXTab(target, settings);
    if (reused) return reused;
  }

  if (settings.openMode === "current_tab" && openerTabId != null && !forceNew) {
    try {
      await chrome.tabs.update(openerTabId, { url: target, active: true });
      const lastOpen = {
        at: Date.now(),
        mode: "current_tab",
        navigated: true,
        target,
      };
      await touchWarmFromOpen(openerTabId, settings, target, {
        loadStatus: "loading",
        pendingUrl: target,
        lastOpen,
      });
      markOwnedTab(openerTabId);
      return {
        ok: true,
        mode: "current_tab",
        tabId: openerTabId,
        url: target,
        fast: false,
        lastOpen,
      };
    } catch {
      // fallthrough
    }
  }

  // 无 X 标签：全局锁内再查一次，只 create 目标 URL
  return withXTabCreateLock(async () => {
    // 锁内双检，避免与「立即预热/自动暖壳」并发双开
    if (!forceNew && settings.preferReuseXTab) {
      const again = await navigateExistingXTab(target, settings);
      if (again) return again;
    }

    const created = await chrome.tabs.create({
      url: target,
      active: true,
      openerTabId: openerTabId ?? undefined,
    });
    const lastOpen = {
      at: Date.now(),
      mode: "new_tab_cold",
      navigated: true,
      target,
    };
    if (created.id != null) {
      markOwnedTab(created.id);
      await touchWarmFromOpen(created.id, settings, target, {
        loadStatus: "loading",
        pendingUrl: target,
        loadedUrl: null,
        shellReady: false,
        lastOpen,
      });
      try {
        await scheduleExpireFromSettings(settings);
      } catch {
        // ignore
      }
    } else {
      await patchWarmState({ lastOpen });
    }

    return {
      ok: true,
      mode: "new_tab_cold",
      tabId: created.id,
      url: target,
      fast: false,
      lastOpen,
      hint: "无已有 X 标签，仅打开目标页一扇",
    };
  });
}

/**
 * @param {object} settings
 * @param {number} [openerTabId]
 */
export async function openXHome(settings, openerTabId) {
  const url = settings.warmEntryUrl || "https://x.com/home";
  return openXUrl({ url, settings, openerTabId });
}

export function tabIsX(url) {
  return isXTabUrl(url);
}

/** @param {number|undefined} windowId */
async function focus(windowId) {
  if (windowId == null) return;
  try {
    await chrome.windows.update(windowId, { focused: true });
  } catch {
    // ignore
  }
}
