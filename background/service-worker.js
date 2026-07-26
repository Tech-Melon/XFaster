/**
 * XFaster service worker
 */
import { ALARM_NAMES, MSG } from "../shared/constants.js";
import {
  clearDebugLog,
  debugLog,
  getDebugLog,
  invalidateDebugCache,
} from "../shared/debug.js";
import {
  applyWarmupProfile,
  getSettings,
  migrateSettingsIfNeeded,
  saveSettings,
} from "../shared/settings.js";
import { openXHome, openXUrl } from "./open-router.js";
import {
  clearWarmState,
  ensureWarmTab,
  getWarmState,
  getWarmStatus,
  onWarmExpireAlarm,
  onWarmTabUpdated,
  releaseWarmTab,
} from "./warm-manager.js";
import { installNavCapture, setOpenHandler } from "./nav-capture.js";
import {
  hasOptionalAllHosts,
  injectContentScriptsIntoOpenTabs,
  installPermissionListeners,
  requestOptionalAllHosts,
} from "../shared/permissions.js";

let lastAutoWarmAt = 0;
const AUTO_WARM_DEBOUNCE_MS = 8000;

// 捕获外站 window.open / 非 <a> 打开的 X 标签
setOpenHandler((opts) => openXUrl(opts));
installNavCapture();
// 用户授权全站/单站后，自动给已开标签补注入 content 脚本
installPermissionListeners();

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    await saveSettings({});
  } else {
    await migrateSettingsIfNeeded();
  }
  // 若升级时已有全站权限，补注一次
  try {
    if (await hasOptionalAllHosts()) {
      await injectContentScriptsIntoOpenTabs();
    }
  } catch {
    // ignore
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await migrateSettingsIfNeeded();
  try {
    if (await hasOptionalAllHosts()) {
      await injectContentScriptsIntoOpenTabs();
    }
  } catch {
    // ignore
  }
});

migrateSettingsIfNeeded().catch(() => {});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAMES.WARM_EXPIRE) {
    await onWarmExpireAlarm();
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading" || changeInfo.status === "complete") {
    onWarmTabUpdated(tabId, changeInfo, tab).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((err) => {
      sendResponse({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  return true;
});

/**
 * @param {any} message
 * @param {chrome.runtime.MessageSender} sender
 */
async function handleMessage(message, sender) {
  if (!message || typeof message.type !== "string") {
    return { ok: false, reason: "bad_message" };
  }

  const settings = await getSettings();

  switch (message.type) {
    case MSG.OPEN_X: {
      await debugLog("open", "OPEN_X", {
        url: message.url,
        fromTab: sender.tab?.id,
      });
      const opened = await openXUrl({
        url: message.url,
        settings,
        openerTabId: sender.tab?.id,
        forceNew: Boolean(message.forceNew),
      });
      await debugLog("open", "OPEN_X result", opened);
      return opened;
    }

    case MSG.OPEN_HOME: {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      return openXHome(settings, tab?.id);
    }

    case MSG.INTENT_HOVER: {
      // 悬停只暖壳（home），不打开推文；与 OPEN_X 共用创建锁防双开
      if (!settings.enableL2Hover && !message.fromPointerDown) {
        return { ok: true, warmed: false, reason: "l2_off" };
      }
      if (settings.allowBackgroundWarmTab && settings.autoWarmOnHover) {
        return ensureWarmTab(settings, {
          preferShellOnly: true,
          force: Boolean(message.fromPointerDown),
        });
      }
      return { ok: true, warmed: false, level: "l2_shell_only" };
    }

    case MSG.PAGE_HAS_X_LINKS: {
      if (!settings.allowBackgroundWarmTab || !settings.autoWarmOnLinks) {
        return { ok: true, level: "l1", warmed: false };
      }
      const now = Date.now();
      if (now - lastAutoWarmAt < AUTO_WARM_DEBOUNCE_MS) {
        return { ok: true, level: "l3", warmed: false, debounced: true };
      }
      lastAutoWarmAt = now;
      // 后台暖 home 仅一扇；用户点推文时 openXUrl 会复用它并导航到目标
      const result = await ensureWarmTab(settings, { preferShellOnly: true });
      return { ok: true, level: "l3_shell", ...result };
    }

    case MSG.GET_STATUS: {
      const warm = await getWarmStatus();
      // 调试关时不读 log，减少 session IO
      const debug = settings.debugLogging ? await getDebugLog() : [];
      return {
        ok: true,
        settings: {
          openMode: settings.openMode,
          warmupProfile: settings.warmupProfile,
          turboTtlMinutes: settings.turboTtlMinutes,
          allowBackgroundWarmTab: settings.allowBackgroundWarmTab,
          autoWarmOnLinks: settings.autoWarmOnLinks,
          autoWarmOnHover: settings.autoWarmOnHover,
          enableL1Preconnect: settings.enableL1Preconnect,
          enableL2Hover: settings.enableL2Hover,
          debugLogging: settings.debugLogging,
        },
        warm,
        debug,
      };
    }

    case MSG.GET_DEBUG_LOG: {
      return { ok: true, debug: await getDebugLog() };
    }

    case MSG.CLEAR_DEBUG_LOG: {
      await clearDebugLog();
      invalidateDebugCache();
      return { ok: true };
    }

    case MSG.SET_PROFILE: {
      const id = message.profileId;
      if (!["eco", "balanced", "fast", "turbo"].includes(id)) {
        return { ok: false, reason: "bad_profile" };
      }
      const current = await getSettings();
      const next = applyWarmupProfile(current, id);
      await saveSettings(next);
      invalidateDebugCache();
      // 切到省电时释放热壳
      if (id === "eco") {
        await releaseWarmTab();
      }
      await debugLog("sys", "SET_PROFILE", { id, ttl: next.turboTtlMinutes });
      return { ok: true, settings: next };
    }

    case MSG.GET_PERMISSIONS: {
      const optionalAllHosts = await hasOptionalAllHosts();
      return { ok: true, optionalAllHosts };
    }

    case MSG.REQUEST_OPTIONAL_HOSTS: {
      // popup 应直接 request；此处备用
      const granted = await requestOptionalAllHosts();
      let inject = { ok: 0, fail: 0 };
      if (granted) {
        inject = await injectContentScriptsIntoOpenTabs();
      }
      return { ok: true, granted, inject };
    }

    case MSG.INJECT_AFTER_GRANT: {
      const inject = await injectContentScriptsIntoOpenTabs();
      await debugLog("perm", "inject after grant", inject);
      return { ok: true, inject };
    }

    case MSG.WARM_NOW: {
      return ensureWarmTab(settings, { force: true, preferShellOnly: true });
    }

    case MSG.RELEASE_WARM: {
      return releaseWarmTab({ remove: true });
    }

    default:
      return { ok: false, reason: "unknown_type" };
  }
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const state = await getWarmState();
  if (state.warmTabId === tabId) {
    await clearWarmState();
    await chrome.alarms.clear(ALARM_NAMES.WARM_EXPIRE);
  }
});
