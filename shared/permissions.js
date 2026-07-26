/**
 * 可选主机权限 + 授权后注入
 *
 * 关键：MV3 下 content_scripts 匹配全部站点时，必须有对应 host 权限才会注入。
 * 未点「一键授权所有网站」时，外站不会注入 link-observer，
 * 点击只能走浏览器原生新标签，再被 nav-capture 合并热壳，会闪一下。
 *
 * 全站 optional 授权一次后：
 * - 未来新开的未知站点也会自动注入（manifest 静态 content_scripts）
 * - 已打开的标签需 executeScript 补注或刷新
 */

export const OPTIONAL_ALL_HOSTS = ["http://*/*", "https://*/*"];

/**
 * @returns {Promise<boolean>}
 */
export async function hasOptionalAllHosts() {
  try {
    return await chrome.permissions.contains({ origins: OPTIONAL_ALL_HOSTS });
  } catch {
    return false;
  }
}

/**
 * @returns {Promise<boolean>}
 */
export async function requestOptionalAllHosts() {
  try {
    if (await hasOptionalAllHosts()) return true;
    return await chrome.permissions.request({ origins: OPTIONAL_ALL_HOSTS });
  } catch {
    return false;
  }
}

/**
 * @param {string} origin
 */
export async function requestOrigin(origin) {
  try {
    if (!origin || !/^https?:/i.test(origin)) return false;
    if (await hasOptionalAllHosts()) return true;
    const pattern = origin.replace(/\/$/, "") + "/*";
    if (await chrome.permissions.contains({ origins: [pattern] })) return true;
    return await chrome.permissions.request({ origins: [pattern] });
  } catch {
    return false;
  }
}

/**
 * @param {string} origin
 */
export async function hasOrigin(origin) {
  try {
    if (await hasOptionalAllHosts()) return true;
    if (!origin) return false;
    const pattern = origin.replace(/\/$/, "") + "/*";
    return await chrome.permissions.contains({ origins: [pattern] });
  } catch {
    return false;
  }
}

/**
 * @returns {Promise<boolean>}
 */
export async function removeOptionalAllHosts() {
  try {
    return await chrome.permissions.remove({ origins: OPTIONAL_ALL_HOSTS });
  } catch {
    return false;
  }
}

function isSkippableUrl(url) {
  if (!url || !/^https?:/i.test(url)) return true;
  if (
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:") ||
    url.startsWith("https://chrome.google.com/webstore") ||
    url.startsWith("https://chromewebstore.google.com")
  ) {
    return true;
  }
  // 不要往 X 站内再注入外站拦截脚本
  try {
    const h = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    if (
      h === "x.com" ||
      h === "mobile.x.com" ||
      h === "twitter.com" ||
      h === "mobile.twitter.com" ||
      h.endsWith(".x.com") ||
      h.endsWith(".twitter.com")
    ) {
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

/**
 * 向单个标签注入页面拦截脚本
 * @param {number} tabId
 */
export async function injectContentScriptsIntoTab(tabId) {
  // 含 iframe：部分外站在子 frame 里打开 X
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ["content/window-open-hook-main.js"],
    world: "MAIN",
    injectImmediately: true,
  });
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ["content/link-observer.js"],
    world: "ISOLATED",
    injectImmediately: true,
  });
}

/**
 * 授权后向已打开的 http(s) 标签注入（免手动刷新）
 * @returns {Promise<{ok:number, fail:number, total:number}>}
 */
export async function injectContentScriptsIntoOpenTabs() {
  let ok = 0;
  let fail = 0;
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  } catch {
    try {
      tabs = (await chrome.tabs.query({})).filter(
        (t) => t.url && /^https?:/i.test(t.url),
      );
    } catch {
      return { ok: 0, fail: 0, total: 0 };
    }
  }

  for (const tab of tabs) {
    if (tab.id == null || !tab.url || isSkippableUrl(tab.url)) continue;
    try {
      await injectContentScriptsIntoTab(tab.id);
      ok += 1;
    } catch {
      fail += 1;
    }
  }
  return { ok, fail, total: tabs.length };
}

/**
 * 监听权限授予：自动补注已开标签
 * 全站授权后，未来新页面会靠 manifest content_scripts 自动注入
 */
export function installPermissionListeners() {
  if (!chrome.permissions?.onAdded) return;
  chrome.permissions.onAdded.addListener(async (perm) => {
    const origins = perm.origins || [];
    const broad = origins.some(
      (o) => o === "http://*/*" || o === "https://*/*" || o === "*://*/*",
    );
    const anyHttp = origins.some((o) => /^https?:\/\//i.test(o) || o.includes("*://"));
    if (!broad && !anyHttp) return;
    try {
      const r = await injectContentScriptsIntoOpenTabs();
      console.log("[XFaster] permissions.onAdded inject", r);
    } catch (e) {
      console.warn("[XFaster] permissions.onAdded inject fail", e);
    }
  });
}
