/**
 * 谷歌识图 — 单例小弹窗 / 新标签
 * 与暖壳、OPEN_X 路径完全隔离
 *
 * 复用策略：
 * - 内存 + session 记住 windowId/tabId
 * - 再次搜图：tabs.update 同一标签 URL（不新建窗）
 * - SW 被回收后仍尽量找回未关的小窗
 */

/** @type {number|null} */
let popupWindowId = null;
/** @type {number|null} */
let popupTabId = null;

const SESSION_KEY = "xfasterImageSearchPopup";
const POPUP_WIDTH = 700;
const POPUP_HEIGHT = 800;

/**
 * @param {string} imageUrl
 * @param {"lens"|"google_images"} engine
 */
export function buildImageSearchUrl(imageUrl, engine = "lens") {
  const enc = encodeURIComponent(imageUrl);
  if (engine === "google_images") {
    return `https://www.google.com/searchbyimage?image_url=${enc}&client=app`;
  }
  return `https://lens.google.com/uploadbyurl?url=${enc}`;
}

/**
 * @param {string} imageUrl
 * @returns {string|null}
 */
export function normalizeSearchableImageUrl(imageUrl) {
  if (!imageUrl || typeof imageUrl !== "string") return null;
  const s = imageUrl.trim();
  if (!s) return null;
  if (s.startsWith("blob:") || s.startsWith("data:")) return null;
  try {
    const u = new URL(s);
    if (!/^https?:$/i.test(u.protocol)) return null;
    // 常见推特媒体缩略参数 → 尽量用原图
    if (/(?:^|\.)twimg\.com$/i.test(u.hostname) && u.pathname.includes("/media/")) {
      if (!u.searchParams.has("name")) {
        u.searchParams.set("name", "orig");
      } else if (
        /^(small|thumb|medium|360x360|900x900)$/i.test(
          u.searchParams.get("name") || "",
        )
      ) {
        u.searchParams.set("name", "orig");
      }
    }
    return u.href;
  } catch {
    return null;
  }
}

async function persistPopupIds() {
  try {
    if (popupWindowId == null) {
      await chrome.storage.session?.remove?.(SESSION_KEY);
      return;
    }
    await chrome.storage.session?.set?.({
      [SESSION_KEY]: {
        windowId: popupWindowId,
        tabId: popupTabId,
      },
    });
  } catch {
    // session API 不可用时忽略
  }
}

async function restorePopupIdsFromSession() {
  if (popupWindowId != null) return;
  try {
    const data = await chrome.storage.session?.get?.(SESSION_KEY);
    const saved = data?.[SESSION_KEY];
    if (!saved || typeof saved !== "object") return;
    if (Number.isFinite(saved.windowId)) popupWindowId = saved.windowId;
    if (Number.isFinite(saved.tabId)) popupTabId = saved.tabId;
  } catch {
    // ignore
  }
}

function clearPopupIds() {
  popupWindowId = null;
  popupTabId = null;
  persistPopupIds().catch(() => {});
}

/**
 * 解析仍存活的识图小窗 + 标签
 * @returns {Promise<{ windowId: number, tabId: number }|null>}
 */
async function resolveLivePopup() {
  await restorePopupIdsFromSession();

  let winId = popupWindowId;
  let tabId = popupTabId;

  if (winId == null && tabId == null) return null;

  // 校验 window
  if (winId != null) {
    try {
      await chrome.windows.get(winId);
    } catch {
      winId = null;
      tabId = null;
    }
  }

  // window 在但 tab 丢了：从窗口里找第一个 http(s) 标签
  if (winId != null && tabId == null) {
    try {
      const tabs = await chrome.tabs.query({ windowId: winId });
      const t = tabs.find((x) => x.id != null) || tabs[0];
      tabId = t?.id ?? null;
    } catch {
      tabId = null;
    }
  }

  // 只有 tabId：反查 window
  if (winId == null && tabId != null) {
    try {
      const tab = await chrome.tabs.get(tabId);
      winId = tab.windowId ?? null;
    } catch {
      tabId = null;
    }
  }

  // 再验 tab
  if (tabId != null) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.windowId != null) winId = tab.windowId;
    } catch {
      tabId = null;
      // 尝试从 window 再取
      if (winId != null) {
        try {
          const tabs = await chrome.tabs.query({ windowId: winId });
          tabId = tabs[0]?.id ?? null;
        } catch {
          winId = null;
        }
      }
    }
  }

  if (winId == null || tabId == null) {
    clearPopupIds();
    return null;
  }

  popupWindowId = winId;
  popupTabId = tabId;
  await persistPopupIds();
  return { windowId: winId, tabId };
}

/**
 * 在已有单例小窗内导航（最快路径）
 * @param {string} targetUrl
 * @param {{ windowId: number, tabId: number }} live
 */
async function navigateReusablePopup(targetUrl, live) {
  await chrome.tabs.update(live.tabId, { url: targetUrl, active: true });
  try {
    await chrome.windows.update(live.windowId, {
      focused: true,
      width: POPUP_WIDTH,
      height: POPUP_HEIGHT,
    });
  } catch {
    try {
      await chrome.windows.update(live.windowId, { focused: true });
    } catch {
      // ignore
    }
  }
  popupWindowId = live.windowId;
  popupTabId = live.tabId;
  await persistPopupIds();
  return {
    ok: true,
    mode: "popup_reuse",
    windowId: live.windowId,
    tabId: live.tabId,
    url: targetUrl,
    size: { width: POPUP_WIDTH, height: POPUP_HEIGHT },
  };
}

/**
 * @param {{
 *   imageUrl: string,
 *   screenX?: number,
 *   screenY?: number,
 *   openMode?: "popup"|"tab",
 *   engine?: "lens"|"google_images",
 * }} opts
 */
export async function openImageSearch(opts) {
  const imageUrl = normalizeSearchableImageUrl(opts.imageUrl);
  if (!imageUrl) {
    return { ok: false, reason: "bad_image_url" };
  }

  const engine = opts.engine === "google_images" ? "google_images" : "lens";
  const openMode = opts.openMode === "tab" ? "tab" : "popup";
  const targetUrl = buildImageSearchUrl(imageUrl, engine);

  if (openMode === "tab") {
    // 新标签模式：也尽量复用上次标签（若仍在）
    await restorePopupIdsFromSession();
    if (popupTabId != null) {
      try {
        const tab = await chrome.tabs.get(popupTabId);
        // 仅当仍是识图相关页时复用，避免误改用户其它标签
        const u = String(tab.url || "");
        if (
          /lens\.google\.com|google\.[^/]+\/searchbyimage|google\.[^/]+\/search\?/.test(
            u,
          ) ||
          !u ||
          u === "chrome://newtab/" ||
          u.startsWith("chrome://")
        ) {
          await chrome.tabs.update(popupTabId, {
            url: targetUrl,
            active: true,
          });
          if (tab.windowId != null) {
            await chrome.windows.update(tab.windowId, { focused: true });
          }
          return {
            ok: true,
            mode: "tab_reuse",
            tabId: popupTabId,
            url: targetUrl,
          };
        }
      } catch {
        popupTabId = null;
      }
    }
    const tab = await chrome.tabs.create({ url: targetUrl, active: true });
    popupTabId = tab.id ?? null;
    popupWindowId = tab.windowId ?? null;
    await persistPopupIds();
    return { ok: true, mode: "tab", tabId: tab.id, url: targetUrl };
  }

  // —— 小弹窗单例 ——
  const live = await resolveLivePopup();
  if (live) {
    try {
      return await navigateReusablePopup(targetUrl, live);
    } catch {
      clearPopupIds();
    }
  }

  let left;
  let top;
  if (Number.isFinite(opts.screenX) && Number.isFinite(opts.screenY)) {
    left = Math.max(0, Math.round(opts.screenX - POPUP_WIDTH * 0.25));
    top = Math.max(0, Math.round(opts.screenY - 40));
  }

  /** @type {chrome.windows.CreateData} */
  const createData = {
    url: targetUrl,
    type: "popup",
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT,
    focused: true,
  };
  if (left != null) createData.left = left;
  if (top != null) createData.top = top;

  const win = await chrome.windows.create(createData);
  popupWindowId = win?.id ?? null;
  popupTabId = win?.tabs?.[0]?.id ?? null;

  if (popupWindowId != null) {
    try {
      await chrome.windows.update(popupWindowId, {
        width: POPUP_WIDTH,
        height: POPUP_HEIGHT,
        focused: true,
      });
    } catch {
      // ignore
    }
  }
  await persistPopupIds();

  return {
    ok: true,
    mode: "popup_new",
    windowId: popupWindowId,
    tabId: popupTabId,
    url: targetUrl,
    size: { width: POPUP_WIDTH, height: POPUP_HEIGHT },
  };
}

/** 小窗被关掉时清状态，下次重新创建 */
export function installImageSearchWindowListener() {
  if (!chrome.windows?.onRemoved) return;
  chrome.windows.onRemoved.addListener((windowId) => {
    if (windowId === popupWindowId) {
      clearPopupIds();
    }
  });
  chrome.tabs?.onRemoved?.addListener((tabId) => {
    if (tabId === popupTabId) {
      // 标签关了但窗口可能还在：清 tab，保留 window 让下次 resolve 再找
      popupTabId = null;
      persistPopupIds().catch(() => {});
    }
  });
}

const CONTEXT_MENU_ID = "xfaster-image-search";

/**
 * 系统右键菜单增加「谷歌识图」，不拦截「图片另存为」等原生项
 * @param {boolean} enabled
 */
export async function syncImageSearchContextMenu(enabled) {
  if (!chrome.contextMenus) return;
  try {
    await chrome.contextMenus.remove(CONTEXT_MENU_ID);
  } catch {
    // 尚不存在
  }
  if (!enabled) return;
  try {
    await chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: "谷歌识图（XFaster）",
      contexts: ["image"],
    });
  } catch {
    // ignore duplicate / unavailable
  }
}

/**
 * 安装 contextMenus 点击与设置同步
 * @param {() => Promise<{ enableImageSearch?: boolean, imageSearchOpenMode?: string, imageSearchEngine?: string }>} getSettingsFn
 */
export function installImageSearchContextMenu(getSettingsFn) {
  if (!chrome.contextMenus?.onClicked) return;

  chrome.contextMenus.onClicked.addListener(async (info) => {
    if (info.menuItemId !== CONTEXT_MENU_ID) return;
    const src = info.srcUrl;
    if (!src) return;
    try {
      const settings = await getSettingsFn();
      if (!settings?.enableImageSearch) return;
      await openImageSearch({
        imageUrl: src,
        openMode: settings.imageSearchOpenMode === "tab" ? "tab" : "popup",
        engine:
          settings.imageSearchEngine === "google_images"
            ? "google_images"
            : "lens",
      });
    } catch {
      // ignore
    }
  });
}
