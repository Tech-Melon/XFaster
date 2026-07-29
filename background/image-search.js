/**
 * 谷歌识图 — 单例小弹窗 / 新标签
 * 与暖壳、OPEN_X 路径完全隔离
 */

/** @type {number|null} */
let popupWindowId = null;
/** @type {number|null} */
let popupTabId = null;

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
      } else if (/^(small|thumb|medium|360x360|900x900)$/i.test(u.searchParams.get("name") || "")) {
        u.searchParams.set("name", "orig");
      }
    }
    return u.href;
  } catch {
    return null;
  }
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
    const tab = await chrome.tabs.create({ url: targetUrl, active: true });
    return { ok: true, mode: "tab", tabId: tab.id, url: targetUrl };
  }

  // 复用已有识图小窗
  if (popupWindowId != null) {
    try {
      await chrome.windows.get(popupWindowId);
      if (popupTabId != null) {
        await chrome.tabs.update(popupTabId, { url: targetUrl, active: true });
        await chrome.windows.update(popupWindowId, { focused: true });
        return {
          ok: true,
          mode: "popup_reuse",
          windowId: popupWindowId,
          tabId: popupTabId,
          url: targetUrl,
        };
      }
    } catch {
      popupWindowId = null;
      popupTabId = null;
    }
  }

  const width = 520;
  const height = 780;
  let left;
  let top;
  if (Number.isFinite(opts.screenX) && Number.isFinite(opts.screenY)) {
    left = Math.max(0, Math.round(opts.screenX - width * 0.25));
    top = Math.max(0, Math.round(opts.screenY - 40));
  }

  /** @type {chrome.windows.CreateData} */
  const createData = {
    url: targetUrl,
    type: "popup",
    width,
    height,
    focused: true,
  };
  if (left != null) createData.left = left;
  if (top != null) createData.top = top;

  const win = await chrome.windows.create(createData);
  popupWindowId = win?.id ?? null;
  popupTabId = win?.tabs?.[0]?.id ?? null;

  return {
    ok: true,
    mode: "popup_new",
    windowId: popupWindowId,
    tabId: popupTabId,
    url: targetUrl,
  };
}

/** 小窗被关掉时清状态，下次重新创建 */
export function installImageSearchWindowListener() {
  if (!chrome.windows?.onRemoved) return;
  chrome.windows.onRemoved.addListener((windowId) => {
    if (windowId === popupWindowId) {
      popupWindowId = null;
      popupTabId = null;
    }
  });
  chrome.tabs?.onRemoved?.addListener((tabId) => {
    if (tabId === popupTabId) {
      popupTabId = null;
    }
  });
}
