/**
 * 弹窗：初始化绝不卡死；授权按钮始终可点；中英切换
 */
import { MSG, WARMUP_PROFILES, PROFILE_ORDER } from "../shared/constants.js";
import {
  hasOptionalAllHosts,
  hasOrigin,
  injectContentScriptsIntoOpenTabs,
  requestOptionalAllHosts,
  requestOrigin,
} from "../shared/permissions.js";
import {
  applyDomI18n,
  langToggleLabel,
  langToggleTitle,
  normalizeLang,
  otherLang,
  profileName,
  t,
} from "../shared/i18n.js";
import { getSettings, saveSettings } from "../shared/settings.js";

const $ = (id) => document.getElementById(id);

/** @type {import("../shared/i18n.js").UiLang} */
let uiLang = "zh";
let currentProfile = "balanced";
let grantBusy = false;
let imageSearchEnabled = false;
let imageSearchBusy = false;
let langBusy = false;

function tr(key, vars) {
  return t(uiLang, key, vars);
}

function showToast(text) {
  const el = $("toast");
  if (!el) return;
  el.hidden = false;
  el.textContent = String(text || "");
  window.setTimeout(() => {
    el.hidden = true;
  }, 3000);
}

function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => {
      window.setTimeout(() => resolve(fallback), ms);
    }),
  ]);
}

function paintLangToggle() {
  const btn = $("btnLangToggle");
  if (!btn) return;
  btn.textContent = langToggleLabel(uiLang);
  btn.title = langToggleTitle(uiLang);
  btn.setAttribute("aria-label", langToggleTitle(uiLang));
}

function paintStaticI18n() {
  applyDomI18n(document, uiLang);
  paintLangToggle();
  const grid = $("profileGrid");
  if (grid) grid.setAttribute("aria-label", tr("popup.profileAria"));
  for (const id of PROFILE_ORDER) {
    const btn = document.querySelector(`[data-profile="${id}"]`);
    if (btn) btn.textContent = profileName(uiLang, id);
  }
}

function setProfileButtons(activeId) {
  currentProfile = activeId || "balanced";
  for (const id of PROFILE_ORDER) {
    const btn = document.querySelector(`[data-profile="${id}"]`);
    if (btn) {
      btn.classList.toggle("active", id === currentProfile);
      btn.textContent = profileName(uiLang, id);
    }
  }
  const p = WARMUP_PROFILES[currentProfile];
  const desc = $("profileDesc");
  const badge = $("profileBadge");
  const sub = $("subTitle");
  const profileDesc = tr(`profile.desc.${currentProfile}`);
  if (desc) {
    desc.textContent = p
      ? tr("profile.descLine", {
          desc: profileDesc,
          ttl: p.ttlMinutes,
        })
      : "—";
  }
  if (badge) badge.textContent = profileName(uiLang, currentProfile);
  if (sub) {
    sub.textContent = tr("app.brandSub", {
      profile: profileName(uiLang, currentProfile),
    });
  }
}

function formatRemaining(sec) {
  const n = Number(sec) || 0;
  if (n <= 0) return tr("ttl.expired");
  if (n < 60) return tr("ttl.sec", { n });
  const m = Math.floor(n / 60);
  const s = n % 60;
  return s ? tr("ttl.minSec", { m, s }) : tr("ttl.min", { m });
}

function describeLastOpen(last) {
  if (!last) return tr("last.none");
  const mode = last.mode || "?";
  if (mode === "spa_soft" || mode === "spa_soft_existing") {
    return tr("last.spa", { method: last.spaMethod || "ok" });
  }
  if (mode === "activate_same" || mode === "reuse_existing_same") {
    return tr("last.same");
  }
  if (mode === "full_document_navigation") return tr("last.fullNav");
  if (mode === "full_reload_fallback") return tr("last.fullFallback");
  if (mode === "new_tab_cold") return tr("last.cold");
  if (mode === "force_reload_same_url" || mode === "stale_same_url_reload") {
    return tr("last.force");
  }
  return mode;
}

async function getActiveTabInfo() {
  try {
    const tabs = await withTimeout(
      chrome.tabs.query({ active: true, lastFocusedWindow: true }),
      800,
      [],
    );
    const tab =
      (tabs || []).find(
        (t) => t?.url && !String(t.url).startsWith("chrome-extension://"),
      ) || (tabs || [])[0];
    if (!tab?.url) return { origin: "", tabId: tab?.id };
    try {
      const u = new URL(tab.url);
      if (!/^https?:$/i.test(u.protocol)) {
        return { origin: "", tabId: tab.id, url: tab.url };
      }
      return { origin: u.origin, tabId: tab.id, url: tab.url };
    } catch {
      return { origin: "", tabId: tab.id, url: tab.url };
    }
  } catch {
    return { origin: "", tabId: undefined };
  }
}

/** 权限区：失败也要显示可点的授权按钮 */
async function paintPermUi() {
  const block = $("permBlock");
  const badge = $("permBadge");
  const text = $("permText");
  const btnAll = $("btnGrantHosts");
  const btnCur = $("btnGrantCurrent");
  const siteEl = $("permSite");
  if (!block) return;

  block.hidden = false;

  let allGranted = false;
  try {
    allGranted = await withTimeout(hasOptionalAllHosts(), 800, false);
  } catch {
    allGranted = false;
  }

  const info = await getActiveTabInfo();
  const origin = info.origin || "";

  if (siteEl) {
    siteEl.textContent = origin
      ? tr("perm.site", { origin })
      : tr("perm.site.none");
  }

  if (allGranted) {
    block.classList.add("granted");
    if (badge) {
      badge.textContent = tr("perm.badge.all");
      badge.classList.add("ok");
    }
    if (text) text.textContent = tr("perm.text.granted");
    if (btnAll && !grantBusy) {
      btnAll.disabled = true;
      btnAll.textContent = tr("perm.btn.allOn");
    }
    if (btnCur && !grantBusy) {
      btnCur.disabled = true;
      btnCur.textContent = tr("perm.btn.currentIncluded");
    }
    return;
  }

  block.classList.remove("granted");
  if (badge) {
    badge.textContent = tr("perm.badge.none");
    badge.classList.remove("ok");
  }
  if (text) text.textContent = tr("perm.text.none");
  if (btnAll && !grantBusy) {
    btnAll.disabled = false;
    btnAll.textContent = tr("perm.btn.all");
  }

  let curOk = false;
  if (origin) {
    try {
      curOk = await withTimeout(hasOrigin(origin), 800, false);
    } catch {
      curOk = false;
    }
  }
  if (btnCur && !grantBusy) {
    if (!origin) {
      btnCur.disabled = true;
      btnCur.textContent = tr("perm.btn.current");
    } else {
      btnCur.disabled = !!curOk;
      btnCur.textContent = curOk
        ? tr("perm.btn.currentOn")
        : tr("perm.btn.current");
      if (curOk && badge) badge.textContent = tr("perm.badge.currentOnly");
    }
  }
}

async function paintStatus() {
  const hint = $("hint");
  try {
    const res = await withTimeout(
      chrome.runtime.sendMessage({ type: MSG.GET_STATUS }),
      2500,
      null,
    );
    if (!res || !res.ok) {
      if (hint) hint.textContent = tr("hint.bgDead");
      return;
    }

    const { settings, warm, debug } = res;
    if (settings?.uiLang) {
      const next = normalizeLang(settings.uiLang);
      if (next !== uiLang) {
        uiLang = next;
        paintStaticI18n();
      }
    }
    setProfileButtons(settings.warmupProfile || "balanced");
    paintImageSearchToggle(settings);
    if ($("openModeText")) {
      const mode = settings.openMode;
      $("openModeText").textContent =
        mode === "current_tab"
          ? tr("openMode.current_tab")
          : tr("openMode.new_tab");
    }
    if ($("urlText")) {
      $("urlText").textContent = describeLastOpen(warm?.lastOpen);
    }

    const debugPanel = document.querySelector(".debug-panel");
    if (settings.debugLogging && debugPanel) {
      debugPanel.hidden = false;
      if ($("debugLog")) {
        $("debugLog").textContent =
          (debug || [])
            .slice()
            .reverse()
            .slice(0, 20)
            .map((l) => `[${l.tag}] ${l.message}`)
            .join("\n") || tr("debug.empty");
      }
    } else if (debugPanel) {
      debugPanel.hidden = true;
    }

    const warmEl = $("warmStatus");
    const ttlRow = $("ttlRow");
    if (warm?.phase === "shell_ready" || warm?.shellReady) {
      if (warmEl) {
        warmEl.textContent = tr("warm.ready");
        warmEl.className = "value ok";
      }
      if (ttlRow) ttlRow.hidden = false;
      if ($("ttlText")) {
        $("ttlText").textContent = formatRemaining(warm.remainingSec || 0);
      }
      if (hint) hint.textContent = tr("hint.warmReady");
    } else if (warm?.phase === "shell_loading") {
      if (warmEl) {
        warmEl.textContent = tr("warm.loading");
        warmEl.className = "value warn";
      }
      if (ttlRow) ttlRow.hidden = false;
      if ($("ttlText")) {
        $("ttlText").textContent = formatRemaining(warm.remainingSec || 0);
      }
      if (hint) hint.textContent = tr("hint.warming");
    } else {
      if (warmEl) {
        warmEl.textContent = settings.allowBackgroundWarmTab
          ? tr("warm.none")
          : tr("warm.eco");
        warmEl.className = "value";
      }
      if (ttlRow) ttlRow.hidden = true;
      if (hint) hint.textContent = tr("hint.idle");
    }
  } catch {
    if (hint) hint.textContent = tr("hint.statusFail");
  }
}

async function refreshAll() {
  await Promise.all([paintPermUi(), paintStatus()]);
}

async function applyUiLang(nextLang, { toast = true } = {}) {
  uiLang = normalizeLang(nextLang);
  paintStaticI18n();
  setProfileButtons(currentProfile);
  await refreshAll();
  if (toast) showToast(tr("toast.lang"));
}

// —— 事件：先绑再刷 ——
for (const id of PROFILE_ORDER) {
  const btn = document.querySelector(`[data-profile="${id}"]`);
  if (btn) {
    btn.addEventListener("click", async () => {
      if (id === currentProfile) {
        showToast(
          tr("toast.alreadyProfile", { name: profileName(uiLang, id) }),
        );
        return;
      }
      try {
        const res = await withTimeout(
          chrome.runtime.sendMessage({ type: MSG.SET_PROFILE, profileId: id }),
          3000,
          null,
        );
        if (res?.ok) {
          setProfileButtons(id);
          showToast(tr("toast.switched", { name: profileName(uiLang, id) }));
          await refreshAll();
        } else showToast(tr("toast.switchFail"));
      } catch {
        showToast(tr("toast.switchFail"));
      }
    });
  }
}

$("btnLangToggle")?.addEventListener("click", async () => {
  if (langBusy) return;
  langBusy = true;
  const btn = $("btnLangToggle");
  if (btn) btn.disabled = true;
  try {
    const next = otherLang(uiLang);
    await saveSettings({ uiLang: next });
    await applyUiLang(next, { toast: true });
  } catch {
    showToast(tr("toast.opFail"));
  } finally {
    langBusy = false;
    if (btn) btn.disabled = false;
  }
});

$("btnOpen")?.addEventListener("click", async () => {
  try {
    const res = await withTimeout(
      chrome.runtime.sendMessage({ type: MSG.OPEN_HOME }),
      5000,
      null,
    );
    showToast(res?.ok ? res.mode || tr("toast.openOk") : tr("toast.openFail"));
    await refreshAll();
  } catch {
    showToast(tr("toast.openFail"));
  }
});

$("btnWarm")?.addEventListener("click", async () => {
  try {
    const res = await withTimeout(
      chrome.runtime.sendMessage({ type: MSG.WARM_NOW }),
      5000,
      null,
    );
    if (res?.ok) showToast(res.created ? tr("toast.warming") : tr("toast.shellThere"));
    else {
      showToast(
        res?.reason === "disabled"
          ? tr("toast.warmNeedProfile")
          : tr("toast.warmFail"),
      );
    }
    await refreshAll();
  } catch {
    showToast(tr("toast.warmFail"));
  }
});

$("btnRelease")?.addEventListener("click", async () => {
  try {
    const res = await withTimeout(
      chrome.runtime.sendMessage({ type: MSG.RELEASE_WARM }),
      3000,
      null,
    );
    showToast(res?.released ? tr("toast.released") : tr("toast.noShell"));
    await refreshAll();
  } catch {
    showToast(tr("toast.opFail"));
  }
});

$("btnOptions")?.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

$("btnImageSearchOptions")?.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

/**
 * @param {any} settings
 */
function paintImageSearchToggle(settings) {
  imageSearchEnabled = Boolean(settings?.enableImageSearch);
  const btn = $("btnImageSearch");
  const desc = $("imageSearchDesc");
  if (btn) {
    btn.setAttribute("aria-checked", imageSearchEnabled ? "true" : "false");
    btn.classList.toggle("on", imageSearchEnabled);
  }
  if (desc) {
    if (!imageSearchEnabled) {
      desc.textContent = tr("img.desc.off");
      return;
    }
    const trigger = settings.imageSearchTrigger || "badge";
    const openMode = settings.imageSearchOpenMode || "popup";
    const triggerKey = [
      "badge",
      "alt_right",
      "both",
      "left",
      "right",
    ].includes(trigger)
      ? `img.trigger.${trigger}`
      : "img.trigger.badge";
    const modeKey =
      openMode === "tab" ? "img.mode.tab" : "img.mode.popup";
    desc.textContent = tr("img.desc.on", {
      trigger: tr(triggerKey),
      mode: tr(modeKey),
    });
  }
}

$("btnImageSearch")?.addEventListener("click", async () => {
  if (imageSearchBusy) return;
  imageSearchBusy = true;
  const btn = $("btnImageSearch");
  if (btn) btn.disabled = true;
  const next = !imageSearchEnabled;
  try {
    const res = await withTimeout(
      chrome.runtime.sendMessage({
        type: MSG.SET_IMAGE_SEARCH_ENABLED,
        enabled: next,
      }),
      3000,
      null,
    );
    if (res?.ok) {
      imageSearchEnabled = Boolean(res.enableImageSearch);
      paintImageSearchToggle({
        enableImageSearch: imageSearchEnabled,
      });
      showToast(imageSearchEnabled ? tr("toast.imgOn") : tr("toast.imgOff"));
      await paintStatus();
    } else {
      showToast(tr("toast.toggleFail"));
    }
  } catch {
    showToast(tr("toast.toggleFail"));
  } finally {
    imageSearchBusy = false;
    if (btn) btn.disabled = false;
  }
});

$("btnClearDebug")?.addEventListener("click", async () => {
  try {
    await chrome.runtime.sendMessage({ type: MSG.CLEAR_DEBUG_LOG });
  } catch {
    // ignore
  }
  await refreshAll();
});

$("btnGrantHosts")?.addEventListener("click", async (e) => {
  e.preventDefault();
  if (grantBusy) return;
  grantBusy = true;
  const btn = $("btnGrantHosts");
  if (btn) {
    btn.disabled = true;
    btn.textContent = tr("perm.btn.requesting");
  }
  try {
    const ok = await requestOptionalAllHosts();
    if (!ok) {
      showToast(tr("toast.grantCancel"));
      return;
    }
    showToast(tr("toast.grantInjecting"));
    let n = 0;
    try {
      const inject = await withTimeout(
        injectContentScriptsIntoOpenTabs(),
        8000,
        { ok: 0 },
      );
      n = inject?.ok || 0;
      chrome.runtime.sendMessage({ type: MSG.INJECT_AFTER_GRANT }).catch(() => {});
    } catch {
      // ignore
    }
    showToast(
      n > 0
        ? tr("toast.grantReady", { n })
        : tr("toast.grantRefresh"),
    );
  } catch (err) {
    showToast(
      tr("toast.grantErr", {
        msg: err instanceof Error ? err.message : tr("toast.grantErrReload"),
      }),
    );
  } finally {
    grantBusy = false;
    await paintPermUi();
  }
});

$("btnGrantCurrent")?.addEventListener("click", async (e) => {
  e.preventDefault();
  if (grantBusy) return;
  const info = await getActiveTabInfo();
  if (!info.origin) {
    showToast(tr("toast.needHttps"));
    return;
  }
  grantBusy = true;
  const btn = $("btnGrantCurrent");
  if (btn) btn.disabled = true;
  try {
    const ok = await requestOrigin(info.origin);
    if (!ok) {
      showToast(tr("toast.grantCancel"));
      return;
    }
    if (info.tabId != null) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: info.tabId },
          files: ["content/window-open-hook-main.js"],
          world: "MAIN",
          injectImmediately: true,
        });
        await chrome.scripting.executeScript({
          target: { tabId: info.tabId },
          files: ["content/link-observer.js"],
        });
        await chrome.scripting.executeScript({
          target: { tabId: info.tabId },
          files: ["content/image-search-hover.js"],
        });
        showToast(tr("toast.grantedInject", { origin: info.origin }));
      } catch {
        showToast(tr("toast.grantedRefresh", { origin: info.origin }));
      }
    } else {
      showToast(tr("toast.grantedOrigin", { origin: info.origin }));
    }
  } catch (err) {
    showToast(
      tr("toast.grantFail", {
        msg: err instanceof Error ? err.message : "unknown",
      }),
    );
  } finally {
    grantBusy = false;
    await paintPermUi();
  }
});

// 立即显示默认可点状态，再异步刷新
paintStaticI18n();
setProfileButtons("balanced");
if ($("hint")) $("hint").textContent = tr("hint.loading");
if ($("permBadge")) $("permBadge").textContent = tr("perm.badge.none");
if ($("btnGrantHosts")) {
  $("btnGrantHosts").disabled = false;
  $("btnGrantHosts").textContent = tr("perm.btn.all");
}

(async () => {
  try {
    const s = await withTimeout(getSettings(), 1200, null);
    if (s?.uiLang) {
      uiLang = normalizeLang(s.uiLang);
      paintStaticI18n();
      setProfileButtons(s.warmupProfile || currentProfile);
    }
  } catch {
    // ignore
  }
  paintPermUi();
  paintStatus();
})();

setInterval(() => {
  if (!grantBusy && !langBusy) refreshAll();
}, 4000);
