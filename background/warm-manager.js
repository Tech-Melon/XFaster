/**
 * L3 热壳 + 打开路径
 *
 * 打开优先级（0.5.34：热路径对齐 0.5.31，假成功用 URL 回退纠正）：
 * 1) 同 URL 且页内对得上 → 只激活
 * 2) 壳还活着 → 一律先 SPA（不因闲置/跳数/TTL 预判整页）
 * 3) URL 被 X 改回旧帖 / 冻结丢弃 / SPA 没跳上 → 同标签整页（不关标签）
 */
import {
  ALARM_NAMES,
  DEFAULT_SETTINGS,
  SPA_TRUST,
  STORAGE_KEYS,
} from "../shared/constants.js";
import {
  isXTabUrl,
  urlsLooselyEqual,
} from "../shared/url-utils.js";
import { debugLog } from "../shared/debug.js";
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
 * @property {number} spaHops  距上次整页加载后的连续 SPA 次数
 * @property {number|null} lastNavAt  上次经扩展打开的时间
 * @property {number|null} lastFullLoadAt  上次整页加载时间
 * @property {boolean} shellUntrusted  TTL 到期或健康检查失败，下次整页
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
    spaHops: Number.isFinite(s.spaHops) ? Number(s.spaHops) : 0,
    lastNavAt: typeof s.lastNavAt === "number" ? s.lastNavAt : null,
    lastFullLoadAt: typeof s.lastFullLoadAt === "number" ? s.lastFullLoadAt : null,
    shellUntrusted: Boolean(s.shellUntrusted),
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
    spaHops: 0,
    lastNavAt: null,
    lastFullLoadAt: null,
    shellUntrusted: false,
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 仅冻结/丢弃的壳不能 SPA。闲置与 TTL 不再预判整页——先软跳，回退再纠正。
 * @param {chrome.tabs.Tab} tab
 * @returns {string|null} 不可信原因；null 表示可 SPA
 */
function spaTrustFailReason(tab) {
  if (!tab) return "no_tab";
  if (tab.discarded) return "discarded";
  if (tab.frozen) return "frozen";
  if (tab.status === "unloaded") return "unloaded";
  return null;
}

/**
 * 同标签整页打开目标。不关标签，只换 document。
 * @param {chrome.tabs.Tab} tab
 * @param {string} target
 * @param {object} settings
 * @param {string} mode
 * @param {object} [extra]
 */
async function hardNavigateTo(tab, target, settings, mode, extra = {}) {
  try {
    await chrome.tabs.update(tab.id, { url: target, active: true });
  } catch (e) {
    await debugLog(
      "spa",
      "hardNavigateTo update fail",
      e instanceof Error ? e.message : String(e),
    );
    return null;
  }
  await focusWindow(tab.windowId);
  const lastOpen = {
    at: Date.now(),
    mode,
    spa: false,
    navigated: true,
    instant: false,
    target,
    ...extra,
  };
  await touchWarmFromOpen(tab.id, settings, target, {
    loadStatus: "loading",
    pendingUrl: target,
    loadedUrl: null,
    shellReady: false,
    spaHops: 0,
    lastFullLoadAt: Date.now(),
    shellUntrusted: false,
    lastOpen,
  });
  return {
    tabId: tab.id,
    instant: false,
    navigated: true,
    spa: false,
    mode,
    lastOpen,
    spaFailReason: extra.spaFailReason,
  };
}

function ttlMs(settings) {
  const minutes =
    Number(settings?.turboTtlMinutes) || DEFAULT_SETTINGS.turboTtlMinutes;
  return minutes * 60 * 1000;
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
      spaHops: 0,
      lastFullLoadAt: Date.now(),
      lastNavAt: Date.now(),
      shellUntrusted: false,
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
 * 把已有 X 标签导航到 target。
 * 冻结/丢弃才预判整页；其余先 SPA，URL 回退再同标签整页。
 * @param {chrome.tabs.Tab} tab
 * @param {string} target
 * @param {object} settings
 */
export async function navigateReusableTab(tab, target, settings) {
  const state = await getWarmState();
  const trustFail = spaTrustFailReason(tab);
  if (trustFail) {
    await debugLog("spa", "shell untrusted, hard nav", {
      reason: trustFail,
      tabId: tab.id,
      hops: state.spaHops,
    });
    const mode =
      trustFail === "discarded" ||
      trustFail === "frozen" ||
      trustFail === "unloaded"
        ? "wake_discarded_reload"
        : "stale_shell_hard_nav";
    return hardNavigateTo(tab, target, settings, mode, {
      spaFailReason: trustFail,
    });
  }

  // 1) 已在目标：只激活（页内必须也对得上）
  if (tab.url && urlsLooselyEqual(tab.url, target)) {
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
        lastNavAt: state.lastNavAt,
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
    return hardNavigateTo(tab, target, settings, "stale_same_url_reload", {
      spaFailReason: softSame?.reason || "stale_shell",
    });
  }

  // 2) 先置前热壳
  await chrome.tabs.update(tab.id, { active: true });
  await focusWindow(tab.windowId);

  // 3) SPA 软跳（同文档）
  const soft = await softNavigateXTab(tab.id, target);

  if (soft.ok && soft.sameDocument !== false && !soft.hardNav) {
    const after = await getTabSafe(tab.id);
    if (after?.url && urlsLooselyEqual(after.url, target)) {
      const riskyPush =
        soft.method === "history_pushstate_rerender" ||
        soft.method === "history_pushstate";
      if (riskyPush) {
        await sleep(SPA_TRUST.verifyMs);
        const settled = await getTabSafe(tab.id);
        if (!settled?.url || !urlsLooselyEqual(settled.url, target)) {
          await debugLog("spa", "SPA reverted to previous url", {
            want: target,
            got: settled?.url || null,
          });
          return hardNavigateTo(tab, target, settings, "spa_reverted_hard_nav", {
            spaFailReason: "spa_url_reverted",
            spaMethod: soft.method,
          });
        }
      }
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
    // SPA 报成功但地址没变 → 下面按失败处理
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
      spaHops: 0,
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

  // 5) 地址已经在目标：不要 tabs.reload 冲掉正在绘制的 SPA
  //    只有 URL 被改回旧帖、或同 URL 却没有目标推文时才整页
  const tabNow = await getTabSafe(tab.id);
  const urlAlreadyTarget =
    tabNow?.url && urlsLooselyEqual(tabNow.url, target);
  const mustCorrect =
    soft.reason === "spa_url_reverted" ||
    soft.reason === "spa_stale_same_url";

  if (urlAlreadyTarget && !mustCorrect && !soft.hardNav) {
    await sleep(SPA_TRUST.verifyMs);
    const settled = await getTabSafe(tab.id);
    if (settled?.url && urlsLooselyEqual(settled.url, target)) {
      const lastOpen = {
        at: Date.now(),
        mode: "spa_soft",
        spa: true,
        spaMethod: soft.method || "url_settled",
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
        spaMethod: lastOpen.spaMethod,
        lastOpen,
      };
    }
    return hardNavigateTo(tab, target, settings, "spa_reverted_hard_nav", {
      spaFailReason: "spa_url_reverted",
      spaMethod: soft.method,
    });
  }

  if (urlAlreadyTarget && mustCorrect) {
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
      spaHops: 0,
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

  return hardNavigateTo(tab, target, settings, "full_reload_fallback", {
    spaFailReason: soft.reason || "fallback",
    spaDetail: soft.detail || null,
    logs: soft.logs || null,
  });
}

/**
 * @param {string} target
 * @param {object} settings
 */
export async function activateWarmOrNull(target, settings) {
  const state = await getWarmState();
  let tab = await getTabSafe(state.warmTabId);
  if (!tab) {
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
  return navigateReusableTab(tab, target, settings);
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
    // 后台壳释放；前台标签不关，下次仍先 SPA（回退再整页）
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
  if (!xTabs.length) return null;
  xTabs.sort((a, b) => {
    const asleep = (t) => (t.discarded || t.frozen ? 1 : 0);
    const ad = asleep(a);
    const bd = asleep(b);
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
  const isSpa = extra.lastOpen?.spa === true;
  const recycled = extra.lastOpen?.navigated === true && !isSpa;
  const spaHops =
    typeof extra.spaHops === "number"
      ? extra.spaHops
      : isSpa
        ? (Number(state.spaHops) || 0) + 1
        : recycled
          ? 0
          : Number(state.spaHops) || 0;
  const lastFullLoadAt =
    extra.lastFullLoadAt ??
    (isSpa || !recycled ? state.lastFullLoadAt : Date.now());
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
    spaHops,
    lastNavAt: extra.lastNavAt ?? Date.now(),
    lastFullLoadAt,
    shellUntrusted: extra.shellUntrusted ?? false,
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
