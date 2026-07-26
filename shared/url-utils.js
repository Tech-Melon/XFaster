/**
 * X / Twitter / t.co 链接识别与规范化（v0.5.2）
 */

const X_HOSTS = new Set([
  "x.com",
  "www.x.com",
  "mobile.x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
  "t.co",
]);

/** 打开/比较时丢弃的查询参数 */
const STRIP_QUERY_KEYS = new Set([
  "s",
  "t",
  "ref_src",
  "ref_url",
  "src",
  "via",
  "cxt",
  "cn",
  "ref",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "twclid",
]);

/**
 * @param {string} href
 * @returns {URL|null}
 */
export function parseUrl(href) {
  if (!href || typeof href !== "string") return null;
  try {
    const u = new URL(href, "https://x.com");
    if (!/^https?:$/i.test(u.protocol)) return null;
    return u;
  } catch {
    return null;
  }
}

/**
 * @param {string} hostname
 */
export function isXHost(hostname) {
  if (!hostname) return false;
  const h = hostname.toLowerCase().replace(/\.$/, "");
  return X_HOSTS.has(h);
}

/**
 * @param {string} href
 */
export function isXLink(href) {
  const u = parseUrl(href);
  if (!u) return false;
  return isXHost(u.hostname);
}

/**
 * 剥离 /photo/1 /video/1 /analytics 等深链后缀，便于 SPA
 * @param {string} pathname
 */
export function stripMediaAndAnalyticsSuffix(pathname) {
  let p = pathname || "/";
  // /user/status/ID/photo/1 → /user/status/ID
  // /i/status/ID/video/1 → /i/status/ID
  p = p.replace(
    /\/(status|statuses)\/(\d+)\/(photo|video|analytics|likes|retweets|quotes)(\/\d+)?\/?$/i,
    "/$1/$2",
  );
  // 尾部单独 /photo/1（无 status 时极少见）
  p = p.replace(/\/(photo|video)\/\d+\/?$/i, "");
  // 去掉末尾多余斜杠（根除外）
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p || "/";
}

/**
 * 清理 tracking query
 * @param {URL} u
 */
export function stripTrackingParams(u) {
  const toDelete = [];
  u.searchParams.forEach((_v, k) => {
    if (STRIP_QUERY_KEYS.has(k.toLowerCase())) toDelete.push(k);
  });
  for (const k of toDelete) u.searchParams.delete(k);
  return u;
}

/**
 * 规范化打开目标（SPA / 整页共用）
 * @param {string} href
 * @param {{ normalizeToXCom?: boolean, forSpa?: boolean }} opts
 * @returns {string|null}
 */
export function normalizeXUrl(href, opts = {}) {
  const u = parseUrl(href);
  if (!u) return null;

  const host = u.hostname.toLowerCase();
  if (host === "t.co") {
    return u.href;
  }

  if (opts.normalizeToXCom !== false) {
    if (
      host === "twitter.com" ||
      host === "www.twitter.com" ||
      host === "mobile.twitter.com"
    ) {
      u.hostname = "x.com";
    } else if (host === "www.x.com" || host === "mobile.x.com") {
      u.hostname = "x.com";
    }
  }

  // 路径：去媒体/分析后缀
  u.pathname = stripMediaAndAnalyticsSuffix(u.pathname);

  // hash 一般无用
  u.hash = "";

  stripTrackingParams(u);

  // 空 search 清理成无 ?
  if ([...u.searchParams.keys()].length === 0) {
    u.search = "";
  }

  return u.href;
}

/**
 * 用于比较的「路由指纹」：status id 优先，否则 path+有意义 query
 * @param {string|null|undefined} href
 * @returns {string|null}
 */
export function routeKey(href) {
  const u = parseUrl(href);
  if (!u || !isXHost(u.hostname)) return null;

  const path = stripMediaAndAnalyticsSuffix(u.pathname);
  // /i/status/123 或 /user/status/123
  const m = path.match(/\/(?:i\/)?status(?:es)?\/(\d+)/i);
  if (m) return `status:${m[1]}`;

  // 用户主页 /handle
  const user = path.match(/^\/([A-Za-z0-9_]{1,15})\/?$/);
  if (user && !["i", "home", "explore", "search", "settings", "compose"].includes(user[1].toLowerCase())) {
    return `user:${user[1].toLowerCase()}`;
  }

  stripTrackingParams(u);
  const q = u.searchParams.toString();
  return `path:${path}${q ? `?${q}` : ""}`;
}

/**
 * @param {string|undefined} tabUrl
 */
export function isXTabUrl(tabUrl) {
  if (!tabUrl) return false;
  const u = parseUrl(tabUrl);
  if (!u) return false;
  const h = u.hostname.toLowerCase();
  return (
    h === "x.com" ||
    h === "www.x.com" ||
    h === "mobile.x.com" ||
    h === "twitter.com" ||
    h === "www.twitter.com" ||
    h === "mobile.twitter.com"
  );
}

/**
 * @param {string} pageHost
 * @param {string[]} excludedHostSuffixes
 */
export function isExcludedHost(pageHost, excludedHostSuffixes = []) {
  if (!pageHost) return false;
  const host = pageHost.toLowerCase();
  return excludedHostSuffixes.some((suffix) => {
    const s = String(suffix || "")
      .toLowerCase()
      .replace(/^\./, "");
    if (!s) return false;
    return host === s || host.endsWith(`.${s}`);
  });
}

/**
 * 宽松比较：status id 相同即相等；否则规范化 path + 去追踪参数
 * @param {string|null|undefined} a
 * @param {string|null|undefined} b
 */
export function urlsLooselyEqual(a, b) {
  if (!a || !b) return false;
  const ka = routeKey(a);
  const kb = routeKey(b);
  if (ka && kb && ka === kb) return true;

  try {
    const na = normalizeXUrl(a);
    const nb = normalizeXUrl(b);
    if (!na || !nb) return a === b;
    const ua = new URL(na);
    const ub = new URL(nb);
    const pathA = ua.pathname.replace(/\/$/, "") || "/";
    const pathB = ub.pathname.replace(/\/$/, "") || "/";
    return (
      ua.hostname.replace(/^www\./, "") === ub.hostname.replace(/^www\./, "") &&
      pathA === pathB &&
      ua.search === ub.search
    );
  } catch {
    return a === b;
  }
}

/**
 * @param {string|null|undefined} a
 * @param {string|null|undefined} b
 */
export function bothAreXAppUrls(a, b) {
  return isXTabUrl(a) && isXTabUrl(b);
}
