/**
 * 弹窗：初始化绝不卡死；授权按钮始终可点
 */
import { MSG, WARMUP_PROFILES, PROFILE_ORDER } from "../shared/constants.js";
import {
  hasOptionalAllHosts,
  hasOrigin,
  injectContentScriptsIntoOpenTabs,
  requestOptionalAllHosts,
  requestOrigin,
} from "../shared/permissions.js";

const profileLabel = {
  eco: "节能",
  balanced: "均衡",
  fast: "快速",
  turbo: "极速",
};

const openModeLabel = {
  new_tab: "无壳时新标签",
  current_tab: "当前标签",
};

const $ = (id) => document.getElementById(id);

let currentProfile = "balanced";
let grantBusy = false;
let imageSearchEnabled = false;
let imageSearchBusy = false;

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

function setProfileButtons(activeId) {
  currentProfile = activeId || "balanced";
  for (const id of PROFILE_ORDER) {
    const btn = document.querySelector(`[data-profile="${id}"]`);
    if (btn) btn.classList.toggle("active", id === currentProfile);
  }
  const p = WARMUP_PROFILES[currentProfile];
  const desc = $("profileDesc");
  const badge = $("profileBadge");
  const sub = $("subTitle");
  if (desc) {
    desc.textContent = p
      ? `${p.desc} · TTL ${p.ttlMinutes} 分钟`
      : "—";
  }
  if (badge) badge.textContent = profileLabel[currentProfile] || currentProfile;
  if (sub) {
    sub.textContent = `${profileLabel[currentProfile] || currentProfile} · Tech Melon`;
  }
}

function formatRemaining(sec) {
  const n = Number(sec) || 0;
  if (n <= 0) return "已到期";
  if (n < 60) return `${n} 秒`;
  const m = Math.floor(n / 60);
  const s = n % 60;
  return s ? `${m} 分 ${s} 秒` : `${m} 分钟`;
}

function describeLastOpen(last) {
  if (!last) return "尚未通过扩展打开过";
  const mode = last.mode || "?";
  if (mode === "spa_soft" || mode === "spa_soft_existing") {
    return `真 SPA (${last.spaMethod || "ok"})`;
  }
  if (mode === "activate_same" || mode === "reuse_existing_same") {
    return "同页激活";
  }
  if (mode === "full_document_navigation") return "整页重载";
  if (mode === "full_reload_fallback") return "整页回退";
  if (mode === "new_tab_cold") return "冷开新标签";
  if (mode === "force_reload_same_url" || mode === "stale_same_url_reload") {
    return "强制刷新";
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
    const tab = (tabs || []).find(
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
      ? `当前站：${origin}`
      : "当前站：请先打开普通 https 网页";
  }

  if (allGranted) {
    block.classList.add("granted");
    if (badge) {
      badge.textContent = "全站已授权";
      badge.classList.add("ok");
    }
    if (text) {
      text.textContent =
        "已授权全部网站，外站点击 X 将页面内拦截。若仍闪标签，请刷新该外站一次。";
    }
    if (btnAll && !grantBusy) {
      btnAll.disabled = true;
      btnAll.textContent = "全站权限已开启";
    }
    if (btnCur && !grantBusy) {
      btnCur.disabled = true;
      btnCur.textContent = "已包含当前站";
    }
    return;
  }

  block.classList.remove("granted");
  if (badge) {
    badge.textContent = "未授权全站";
    badge.classList.remove("ok");
  }
  if (text) {
    text.textContent =
      "未授权时外站可能先开冷 X 再合并热壳。点「一键授权所有网站」后，现在与未来未知站均可页面内拦截。";
  }
  // 未授权：全站按钮必须可点
  if (btnAll && !grantBusy) {
    btnAll.disabled = false;
    btnAll.textContent = "一键授权所有网站";
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
      btnCur.textContent = "授权当前网站";
    } else {
      btnCur.disabled = !!curOk;
      btnCur.textContent = curOk ? "当前站已授权" : "授权当前网站";
      if (curOk && badge) badge.textContent = "仅当前站";
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
      if (hint) {
        hint.textContent =
          "后台暂无响应。授权按钮仍可点。也可到 chrome://extensions 重新加载扩展。";
      }
      return;
    }

    const { settings, warm, debug } = res;
    setProfileButtons(settings.warmupProfile || "balanced");
    paintImageSearchToggle(settings);
    if ($("openModeText")) {
      $("openModeText").textContent =
        openModeLabel[settings.openMode] || settings.openMode || "—";
    }
    if ($("urlText")) {
      $("urlText").textContent = describeLastOpen(warm?.lastOpen);
    }

    const debugPanel = document.querySelector(".debug-panel");
    if (settings.debugLogging && debugPanel) {
      debugPanel.hidden = false;
      if ($("debugLog")) {
        $("debugLog").textContent = (debug || [])
          .slice()
          .reverse()
          .slice(0, 20)
          .map((l) => `[${l.tag}] ${l.message}`)
          .join("\n") || "无日志";
      }
    } else if (debugPanel) {
      debugPanel.hidden = true;
    }

    const warmEl = $("warmStatus");
    const ttlRow = $("ttlRow");
    if (warm?.phase === "shell_ready" || warm?.shellReady) {
      if (warmEl) {
        warmEl.textContent = "壳已热";
        warmEl.className = "value ok";
      }
      if (ttlRow) ttlRow.hidden = false;
      if ($("ttlText")) {
        $("ttlText").textContent = formatRemaining(warm.remainingSec || 0);
      }
      if (hint) {
        hint.textContent =
          "当前有热壳。请先完成上方全站授权，外站点击才不会闪冷标签。";
      }
    } else if (warm?.phase === "shell_loading") {
      if (warmEl) {
        warmEl.textContent = "壳加载中…";
        warmEl.className = "value warn";
      }
      if (ttlRow) ttlRow.hidden = false;
      if ($("ttlText")) {
        $("ttlText").textContent = formatRemaining(warm.remainingSec || 0);
      }
      if (hint) hint.textContent = "暖壳中…";
    } else {
      if (warmEl) {
        warmEl.textContent = settings.allowBackgroundWarmTab
          ? "无热壳 / 等待暖壳"
          : "节能·不暖壳";
        warmEl.className = "value";
      }
      if (ttlRow) ttlRow.hidden = true;
      if (hint) {
        hint.textContent = "可点「立即预热」。外站无闪体验需上方「全站已授权」。";
      }
    }
  } catch {
    if (hint) {
      hint.textContent =
        "状态读取失败。请重新加载扩展。授权按钮仍可使用。";
    }
  }
}

async function refreshAll() {
  // 并行，互不阻塞按钮
  await Promise.all([paintPermUi(), paintStatus()]);
}

// —— 事件：先绑再刷 ——
for (const id of PROFILE_ORDER) {
  const btn = document.querySelector(`[data-profile="${id}"]`);
  if (btn) {
    btn.addEventListener("click", async () => {
      if (id === currentProfile) {
        showToast(`已是「${profileLabel[id]}」`);
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
          showToast(`已切换：${profileLabel[id]}`);
          await refreshAll();
        } else showToast("切换失败");
      } catch {
        showToast("切换失败");
      }
    });
  }
}

$("btnOpen")?.addEventListener("click", async () => {
  try {
    const res = await withTimeout(
      chrome.runtime.sendMessage({ type: MSG.OPEN_HOME }),
      5000,
      null,
    );
    showToast(res?.ok ? res.mode || "已打开" : "打开失败");
    await refreshAll();
  } catch {
    showToast("打开失败");
  }
});

$("btnWarm")?.addEventListener("click", async () => {
  try {
    const res = await withTimeout(
      chrome.runtime.sendMessage({ type: MSG.WARM_NOW }),
      5000,
      null,
    );
    if (res?.ok) showToast(res.created ? "正在暖壳…" : "壳已在");
    else showToast(res?.reason === "disabled" ? "请先切均衡/快速/极速" : "预热失败");
    await refreshAll();
  } catch {
    showToast("预热失败");
  }
});

$("btnRelease")?.addEventListener("click", async () => {
  try {
    const res = await withTimeout(
      chrome.runtime.sendMessage({ type: MSG.RELEASE_WARM }),
      3000,
      null,
    );
    showToast(res?.released ? "已释放热壳" : "无热壳");
    await refreshAll();
  } catch {
    showToast("操作失败");
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
      desc.textContent = "已关闭 · 开启后可在外站对图片识图";
      return;
    }
    const trigger = settings.imageSearchTrigger || "badge";
    const openMode = settings.imageSearchOpenMode || "popup";
    const triggerLabel =
      trigger === "badge"
        ? "点「搜图」按钮"
        : trigger === "alt_right"
          ? "Alt+右键"
          : trigger === "both"
            ? "左/右键"
            : trigger === "left"
              ? "左键"
              : "右键";
    const modeLabel = openMode === "tab" ? "新标签" : "小窗";
    desc.textContent = `已开启 · 静止后${triggerLabel} · ${modeLabel}`;
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
      showToast(imageSearchEnabled ? "谷歌识图已开启" : "谷歌识图已关闭");
      // 再刷一次完整状态（含 trigger 描述）
      await paintStatus();
    } else {
      showToast("开关失败");
    }
  } catch {
    showToast("开关失败");
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
    btn.textContent = "请求权限中…";
  }
  try {
    const ok = await requestOptionalAllHosts();
    if (!ok) {
      showToast("未授权或已取消");
      return;
    }
    showToast("已授权，正在注入已开标签…");
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
        ? `全站已就绪（注入 ${n} 个标签）`
        : "全站已授权。请刷新外站网页后再点 X 链接",
    );
  } catch (err) {
    showToast(
      `授权异常：${err instanceof Error ? err.message : "请重载扩展"}`,
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
    showToast("请先打开普通 https 网页，再点授权当前网站");
    return;
  }
  grantBusy = true;
  const btn = $("btnGrantCurrent");
  if (btn) btn.disabled = true;
  try {
    const ok = await requestOrigin(info.origin);
    if (!ok) {
      showToast("未授权或已取消");
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
        showToast(`已授权并注入：${info.origin}`);
      } catch {
        showToast(`已授权 ${info.origin}，请刷新该网页`);
      }
    } else {
      showToast(`已授权 ${info.origin}`);
    }
  } catch (err) {
    showToast(`授权失败：${err instanceof Error ? err.message : "unknown"}`);
  } finally {
    grantBusy = false;
    await paintPermUi();
  }
});

// 立即显示默认可点状态，再异步刷新
setProfileButtons("balanced");
if ($("hint")) {
  $("hint").textContent = "正在读取状态…授权按钮可直接点击。";
}
if ($("permBadge")) $("permBadge").textContent = "未授权全站";
if ($("btnGrantHosts")) {
  $("btnGrantHosts").disabled = false;
  $("btnGrantHosts").textContent = "一键授权所有网站";
}

paintPermUi();
paintStatus();
setInterval(() => {
  if (!grantBusy) refreshAll();
}, 4000);
