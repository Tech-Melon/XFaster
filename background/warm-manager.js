/**
 * L3 热壳 + 打开路径
 *
 * 打开优先级：
 * 1) 同 URL → 只激活
 * 2) SPA 软跳（校验 URL 真变了）
 * 3) 同标签整页导航（复用进程/HTTP 缓存，仍慢于 SPA 但好于新标签）
 */
import { ALARM_NAMES, STORAGE_KEYS } from "../shared/constants.js";
import {
  isXTabUrl,
  normalizeXUrl,
  urlsLooselyEqual,
} from "../shared/url-utils.js";
import { hasReusableXShell, softNavigateXTab } from "./spa-nav.js";

/**
 * @typedef {Object} WarmState
 * @property {number|null} warmTabId
 * @property {number|null} expireAt
 * @property {string|null} entryUrl
 * @property {string|null} pendingUrl
 * @property {string|null} loadedUrl
 * @property {"idle"|"loading"|"complete"} loadStatus
 * @property {boolean} shellReady
 * @property {object|null} lastOpen  上次打开诊断
 */

/** @returns {Promise<WarmState>} */
export async function getWarmState() {
  const data = await chrome.storage.session.get(STORAGE_KEYS.WARM_STATE);
  const s = data[STORAGE_KEYS.WARM_STATE] || {};
  return {
    warmTabId: typeof s.warmTabId === "number" ? s.warmTabId : null,
    expireAt: typeof s.expireAt === "number" ? s.expireAt : null,
    entryUrl: typeof s.entryUrl === "string" ? s.entryUrl : null,
    pendingUrl: typeof s.pendingUrl === "string" ? s.pendingUrl : null,
    loadedUrl: typeof s.loadedUrl === "string" ? s.loadedUrl : null,
    loadStatus: s.loadStatus || "idle",
    shellReady: Boolean(s.shellReady),
    lastOpen: s.lastOpen || null,
  };
}

/** @param {Partial<WarmState>} patch */
export async function patchWarmState(patch) {
  const cur = await getWarmState();
  const next = { ...cur, ...patch };
  await chrome.storage.session.set({ [STORAGE_KEYS.WARM_STATE]: next });
  return next;
}

export async function setWarmState(state) {
  await chrome.storage.session.set({ [STORAGE_KEYS.WARM_STATE]: state });
}

export async function clearWarmState() {
  const prev = await getWarmState();
  await setWarmState({
    warmTabId: null,
    expireAt: null,
    entryUrl: null,
    pendingUrl: null,
    loadedUrl: null,
    loadStatus: "idle",
    shellReady: false,
    lastOpen: prev.lastOpen || null,
  });
}

/** @param {number|null} tabId */
export async function getTabSafe(tabId) {
  if (tabId == null) return null;
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

function ttlMs(settings) {
  return (Number(settings.turboTtlMinutes) || 10) * 60 * 1000;
}

/** @param {number} expireAt */
async function scheduleExpireAlarm(expireAt) {
  await chrome.alarms.clear(ALARM_NAMES.WARM_EXPIRE);
  await chrome.alarms.create(ALARM_NAMES.WARM_EXPIRE, { when: expireAt });
}

/**
 * 供 open-router 在创建目标标签后续期 TTL
 * @param {object} settings
 */
export async function scheduleExpireFromSettings(settings) {
  const expireAt = Date.now() + ttlMs(settings);
  await scheduleExpireAlarm(expireAt);
  await patchWarmState({ expireAt });
  return expireAt;
}

/** 全局创建锁：防止「暖 home」与「开推文」并发双开 */
let xTabCreateChain = Promise.resolve();

/**
 * 串行创建/获取 X 标签，保证同时最多新建 1 个
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
export function withXTabCreateLock(fn) {
  const run = xTabCreateChain.then(fn, fn);
  xTabCreateChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * @param {number} tabId
 * @param {chrome.tabs.TabChangeInfo} changeInfo
 * @param {chrome.tabs.Tab} tab
 */
export async function onWarmTabUpdated(tabId, changeInfo, tab) {
  const state = await getWarmState();
  if (state.warmTabId !== tabId) return;

  if (changeInfo.status === "loading" && tab.url) {
    await patchWarmState({
      pendingUrl: tab.url,
      loadStatus: "loading",
    });
    return;
  }

  if (changeInfo.status === "complete") {
    const url = tab.url || state.pendingUrl || state.loadedUrl;
    await patchWarmState({
      loadedUrl: url || null,
      pendingUrl: url || state.pendingUrl,
      loadStatus: "complete",
      shellReady: isXTabUrl(url) ? true : state.shellReady,
    });
  }
}

/**
 * 只暖壳（后台 home），手动预热 / 自动暖壳用
 * 打开具体推文请走 openXUrl，不要先 ensureWarmTab 再开推文
 * @param {object} settings
 * @param {{ force?: boolean, preferShellOnly?: boolean }} opts
 */
export async function ensureWarmTab(settings, opts = {}) {
  if (!settings.allowBackgroundWarmTab && !opts.force) {
    return { ok: false, reason: "disabled" };
  }

  const entryUrl = settings.warmEntryUrl || "https://x.com/home";
  const expireAt = Date.now() + ttlMs(settings);

  return withXTabCreateLock(async () => {
    let state = await getWarmState();
    let tab = await getTabSafe(state.warmTabId);

    if (tab?.discarded) {
      try {
        await chrome.tabs.remove(tab.id);
      } catch {
        // ignore
      }
      await clearWarmState();
      state = await getWarmState();
      tab = null;
    }

    if (tab && hasReusableXShell(tab)) {
      const ready = state.shellReady || tab.status === "complete";
      await patchWarmState({
        warmTabId: tab.id,
        expireAt,
        entryUrl,
        pendingUrl: state.pendingUrl || tab.url || entryUrl,
        loadedUrl:
          state.loadedUrl || (tab.status === "complete" ? tab.url : null),
        loadStatus: ready ? "complete" : "loading",
        shellReady: ready,
      });
      await scheduleExpireAlarm(expireAt);
      return {
        ok: true,
        tabId: tab.id,
        renewed: true,
        navigated: false,
        shellReady: ready,
        expireAt,
      };
    }

    if (settings.preferReuseXTab) {
      const existing = await findAnyXTab({ hotOnly: true });
      if (existing?.id != null && hasReusableXShell(existing)) {
        const ready = existing.status === "complete";
        await patchWarmState({
          warmTabId: existing.id,
          expireAt,
          entryUrl,
          pendingUrl: existing.url || entryUrl,
          loadedUrl: ready ? existing.url : null,
          loadStatus: ready ? "complete" : "loading",
          shellReady: ready,
        });
        await scheduleExpireAlarm(expireAt);
        return {
          ok: true,
          tabId: existing.id,
          reusedExisting: true,
          shellReady: ready,
          expireAt,
        };
      }
    }

    // 仅后台预热入口：不 active，避免和用户点击抢焦点
    const created = await chrome.tabs.create({
      url: entryUrl,
      active: false,
      pinned: false,
    });
    try {
      const { markOwnedTab } = await import("./owned-tabs.js");
      if (created.id != null) markOwnedTab(created.id);
    } catch {
      // ignore
    }

    await patchWarmState({
      warmTabId: created.id ?? null,
      expireAt,
      entryUrl,
      pendingUrl: entryUrl,
      loadedUrl: null,
      loadStatus: "loading",
      shellReady: false,
    });
    await scheduleExpireAlarm(expireAt);

    return {
      ok: true,
      tabId: created.id,
      created: true,
      navigated: true,
      shellReady: false,
      expireAt,
      url: entryUrl,
    };
  });
}

/**
 * @param {string} target
 * @param {object} settings
 */
export async function activateWarmOrNull(target, settings) {
  const state = await getWarmState();
  let tab = await getTabSafe(state.warmTabId);
  if (!tab || tab.discarded) {
    const any = await findAnyXTab({ hotOnly: true });
    if (!any) return null;
    tab = any;
    await patchWarmState({
      warmTabId: any.id,
      shellReady: any.status === "complete",
      loadStatus: any.status === "complete" ? "complete" : "loading",
      loadedUrl: any.url || null,
    });
  }

  if (!hasReusableXShell(tab)) return null;

  // 长时间休眠后标签可能 discarded / 冻结：必须整页拉起
  if (tab.discarded || tab.status === "unloaded") {
    await chrome.tabs.update(tab.id, { url: target, active: true });
    await focusWindow(tab.windowId);
    const lastOpen = {
      at: Date.now(),
      mode: "wake_discarded_reload",
      spa: false,
      navigated: true,
      instant: false,
      target,
    };
    await touchWarmFromOpen(tab.id, settings, target, {
      loadStatus: "loading",
      pendingUrl: target,
      loadedUrl: null,
      shellReady: false,
      lastOpen,
    });
    return {
      tabId: tab.id,
      instant: false,
      navigated: true,
      spa: false,
      mode: "wake_discarded_reload",
      lastOpen,
    };
  }

  // 1) 已在目标：只激活（严格相等路径才跳过导航）
  if (tab.url && urlsLooselyEqual(tab.url, target)) {
    // 休眠后「URL 相同但页已死」：尝试 SPA ping，失败则强制 reload
    const softSame = await softNavigateXTab(tab.id, target);
    if (
      softSame?.ok ||
      softSame?.method === "already_there" ||
      softSame?.reason === "already_there"
    ) {
      await chrome.tabs.update(tab.id, { active: true });
      await focusWindow(tab.windowId);
      const lastOpen = {
        at: Date.now(),
        mode: "activate_same",
        spa: false,
        navigated: false,
        instant: true,
        target,
      };
      await touchWarmFromOpen(tab.id, settings, target, {
        loadStatus: "complete",
        loadedUrl: target,
        pendingUrl: target,
        shellReady: true,
        lastOpen,
      });
      return {
        tabId: tab.id,
        instant: true,
        navigated: false,
        spa: false,
        mode: "activate_same",
        lastOpen,
      };
    }
    // bridge 挂了 / 页冻住：强制刷新到目标
    await chrome.tabs.update(tab.id, { url: target, active: true });
    await focusWindow(tab.windowId);
    const lastOpen = {
      at: Date.now(),
      mode: "stale_same_url_reload",
      spa: false,
      navigated: true,
      instant: false,
      target,
      spaFailReason: softSame?.reason || "stale_shell",
    };
    await touchWarmFromOpen(tab.id, settings, target, {
      loadStatus: "loading",
      pendingUrl: target,
      shellReady: false,
      lastOpen,
    });
    return {
      tabId: tab.id,
      instant: false,
      navigated: true,
      spa: false,
      mode: "stale_same_url_reload",
      lastOpen,
    };
  }

  // 2) 先置前热壳
  await chrome.tabs.update(tab.id, { active: true });
  await focusWindow(tab.windowId);

  // 3) 真 SPA（同文档 + 内容有更新）
  const soft = await softNavigateXTab(tab.id, target);

  if (soft.ok && soft.sameDocument !== false && !soft.hardNav) {
    // 二次确认：URL 真的到目标了
    const after = await getTabSafe(tab.id);
    if (after?.url && urlsLooselyEqual(after.url, target)) {
      const lastOpen = {
        at: Date.now(),
        mode: "spa_soft",
        spa: true,
        spaMethod: soft.method,
        navigated: false,
        instant: true,
        target,
        logs: soft.logs || null,
      };
      await touchWarmFromOpen(tab.id, settings, target, {
        loadStatus: "complete",
        pendingUrl: target,
        loadedUrl: target,
        shellReady: true,
        lastOpen,
      });
      return {
        tabId: tab.id,
        instant: true,
        navigated: false,
        spa: true,
        mode: "spa_soft",
        spaMethod: soft.method,
        lastOpen,
      };
    }
    // SPA 报成功但地址没变 → 强制整页
  }

  // 4) 已在软跳过程中整页跳到目标（channel closed）→ 禁止再 update 二次刷新
  if (soft.hardNav && soft.alreadyAtTarget) {
    const lastOpen = {
      at: Date.now(),
      mode: "full_document_navigation",
      spa: false,
      spaFailReason: soft.reason || "full_document_navigation",
      navigated: true,
      instant: false,
      target,
      note: "整页重载（黑屏 X），勿误报 SPA",
    };
    await touchWarmFromOpen(tab.id, settings, target, {
      loadStatus: "loading",
      pendingUrl: target,
      loadedUrl: null,
      shellReady: false,
      lastOpen,
    });
    return {
      tabId: tab.id,
      instant: false,
      navigated: true,
      spa: false,
      mode: "full_document_navigation",
      spaFailReason: soft.reason,
      lastOpen,
    };
  }

  // 5) SPA 失败 / 仅改了 URL 没重绘 / 长时间冻结
  //    ★ 关键：即使当前 URL 已等于 target（pushState 假成功），也必须 reload
  const forceReloadReasons = new Set([
    "spa_url_only_no_rerender",
    "spa_not_applied",
    "shell_not_hydrated",
    "shell_not_complete",
    "main_timeout",
    "no_bridge",
    "sendMessage_error",
    "stale_shell",
  ]);
  const mustHardReload =
    !soft.ok ||
    forceReloadReasons.has(soft.reason) ||
    soft.method === "history_pushstate";

  if (mustHardReload) {
    // 用 reload 语义：先跳目标；若已在目标则 reload
    const tabNow = await getTabSafe(tab.id);
    if (tabNow?.url && urlsLooselyEqual(tabNow.url, target)) {
      try {
        await chrome.tabs.reload(tab.id);
      } catch {
        await chrome.tabs.update(tab.id, { url: target, active: true });
      }
      await chrome.tabs.update(tab.id, { active: true });
      await focusWindow(tab.windowId);
      const lastOpen = {
        at: Date.now(),
        mode: "force_reload_same_url",
        spa: false,
        spaFailReason: soft.reason || "force_reload",
        navigated: true,
        instant: false,
        target,
      };
      await touchWarmFromOpen(tab.id, settings, target, {
        loadStatus: "loading",
        pendingUrl: target,
        shellReady: false,
        lastOpen,
      });
      return {
        tabId: tab.id,
        instant: false,
        navigated: true,
        spa: false,
        mode: "force_reload_same_url",
        spaFailReason: soft.reason,
        lastOpen,
      };
    }

    await chrome.tabs.update(tab.id, { url: target, active: true });
    await focusWindow(tab.windowId);
    const lastOpen = {
      at: Date.now(),
      mode: "full_reload_fallback",
      spa: false,
      spaFailReason: soft.reason || "unknown",
      spaDetail: soft.detail || null,
      logs: soft.logs || null,
      navigated: true,
      instant: false,
      target,
    };
    await touchWarmFromOpen(tab.id, settings, target, {
      loadStatus: "loading",
      pendingUrl: target,
      loadedUrl: null,
      shellReady: false,
      lastOpen,
    });
    return {
      tabId: tab.id,
      instant: false,
      navigated: true,
      spa: false,
      mode: "full_reload_fallback",
      spaFailReason: soft.reason,
      lastOpen,
    };
  }

  // 兜底
  await chrome.tabs.update(tab.id, { url: target, active: true });
  await focusWindow(tab.windowId);
  const lastOpen = {
    at: Date.now(),
    mode: "full_reload_fallback",
    spa: false,
    spaFailReason: soft.reason || "fallback",
    navigated: true,
    instant: false,
    target,
  };
  await touchWarmFromOpen(tab.id, settings, target, {
    loadStatus: "loading",
    pendingUrl: target,
    shellReady: false,
    lastOpen,
  });
  return {
    tabId: tab.id,
    instant: false,
    navigated: true,
    spa: false,
    mode: "full_reload_fallback",
    lastOpen,
  };
}

/** @param {number|undefined} windowId */
async function focusWindow(windowId) {
  if (windowId == null) return;
  try {
    await chrome.windows.update(windowId, { focused: true });
  } catch {
    // ignore
  }
}

export async function releaseWarmTab() {
  const state = await getWarmState();
  const tabId = state.warmTabId;
  const tab = await getTabSafe(tabId);
  await clearWarmState();
  await chrome.alarms.clear(ALARM_NAMES.WARM_EXPIRE);

  if (tabId == null || !tab) {
    return { ok: true, released: false };
  }
  if (tab.active) {
    return { ok: true, released: false, reason: "tab_active" };
  }

  try {
    await chrome.tabs.remove(tabId);
    return { ok: true, released: true, mode: "remove" };
  } catch {
    return { ok: false, released: false };
  }
}

export async function onWarmExpireAlarm() {
  const state = await getWarmState();
  if (state.expireAt == null || Date.now() + 500 >= state.expireAt) {
    await releaseWarmTab();
  } else if (state.expireAt) {
    await scheduleExpireAlarm(state.expireAt);
  }
}

/**
 * @param {{ hotOnly?: boolean }} [opts]
 */
export async function findAnyXTab(opts = {}) {
  // 按 URL 过滤，避免 tabs.query({}) 扫全浏览器
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({
      url: ["*://x.com/*", "*://*.x.com/*", "*://twitter.com/*", "*://*.twitter.com/*"],
    });
  } catch {
    // 部分环境 url filter 失败时回退
    const all = await chrome.tabs.query({});
    tabs = all.filter((t) => isXTabUrl(t.url));
  }
  let xTabs = tabs.filter((t) => isXTabUrl(t.url));
  if (opts.hotOnly) {
    xTabs = xTabs.filter((t) => !t.discarded);
  }
  if (!xTabs.length) return null;
  xTabs.sort((a, b) => {
    const ad = a.discarded ? 1 : 0;
    const bd = b.discarded ? 1 : 0;
    if (ad !== bd) return ad - bd;
    return (b.lastAccessed || 0) - (a.lastAccessed || 0);
  });
  return xTabs[0];
}

/**
 * @param {number} tabId
 * @param {object} settings
 * @param {string} [targetUrl]
 * @param {Partial<WarmState>} [extra]
 */
export async function touchWarmFromOpen(tabId, settings, targetUrl, extra = {}) {
  const expireAt = Date.now() + ttlMs(settings);
  const state = await getWarmState();
  await setWarmState({
    warmTabId: tabId,
    expireAt,
    entryUrl: settings.warmEntryUrl || "https://x.com/home",
    pendingUrl: extra.pendingUrl ?? targetUrl ?? state.pendingUrl,
    loadedUrl: extra.loadedUrl ?? state.loadedUrl,
    loadStatus: extra.loadStatus || state.loadStatus || "complete",
    shellReady:
      typeof extra.shellReady === "boolean"
        ? extra.shellReady
        : state.shellReady || extra.loadStatus === "complete",
    lastOpen: extra.lastOpen ?? state.lastOpen,
  });
  if (settings.allowBackgroundWarmTab || settings.warmupProfile === "turbo") {
    await scheduleExpireAlarm(expireAt);
  }
}

export async function getWarmStatus() {
  const state = await getWarmState();
  const tab = await getTabSafe(state.warmTabId);
  const hot = tab != null && !tab.discarded;
  const now = Date.now();
  let remainingMs = 0;
  if (hot && state.expireAt) {
    remainingMs = Math.max(0, state.expireAt - now);
  }

  let phase = "none";
  if (hot) {
    if (state.shellReady || state.loadStatus === "complete") {
      phase = "shell_ready";
    } else if (state.loadStatus === "loading") {
      phase = "shell_loading";
    } else {
      phase = "warm";
    }
  }

  return {
    active: hot && remainingMs > 0,
    phase,
    shellReady: Boolean((state.shellReady || tab?.status === "complete") && hot),
    discarded: Boolean(tab?.discarded),
    warmTabId: tab ? state.warmTabId : null,
    expireAt: state.expireAt,
    remainingMs,
    remainingSec: Math.ceil(remainingMs / 1000),
    pendingUrl: state.pendingUrl,
    loadedUrl: state.loadedUrl || tab?.url || null,
    loadStatus: state.loadStatus,
    lastOpen: state.lastOpen,
  };
}
