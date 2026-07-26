/**
 * 内容脚本 v0.5.7 — 识别「真链接」+「伪链接」
 *
 * 旧版只认 a[href]，漏掉：
 * - data-href / data-url / data-link 等
 * - div/span 卡片 + JS 跳转
 * - 文本里是 x.com URL，外壳不是 <a>
 * - role=link 的自定义组件
 */
(() => {
  // 避免授权后重复 executeScript 叠多层监听
  if (window.__xfasterLinkObserverV2) return;
  window.__xfasterLinkObserverV2 = true;

  const MSG = {
    OPEN_X: "OPEN_X",
    INTENT_HOVER: "INTENT_HOVER",
    PAGE_HAS_X_LINKS: "PAGE_HAS_X_LINKS",
  };

  const PRECONNECT_ORIGINS = [
    "https://x.com",
    "https://abs.twimg.com",
    "https://api.x.com",
  ];

  const X_HOSTS = new Set([
    "x.com",
    "www.x.com",
    "mobile.x.com",
    "twitter.com",
    "www.twitter.com",
    "mobile.twitter.com",
    "t.co",
  ]);

  /** 常见「藏 URL」的属性 */
  const DATA_URL_ATTRS = [
    "href",
    "data-href",
    "data-url",
    "data-link",
    "data-permalink",
    "data-target-url",
    "data-uri",
    "data-original-url",
    "data-clipboard-text",
  ];

  /**
   * 文本/属性中的 X URL 正则
   * 支持 https://x.com/...  x.com/...  twitter.com/...  t.co/...
   */
  const X_URL_RE =
    /(?:https?:\/\/)?(?:(?:www|mobile)\.)?(?:x\.com|twitter\.com)\/[^\s<>"'`)\]]+/i;
  const TCO_RE = /(?:https?:\/\/)?t\.co\/[A-Za-z0-9]+/i;

  /** @type {any} */
  let settings = {
    enableL1Preconnect: true,
    enableL2Hover: false,
    hoverThresholdMs: 100,
    respectModifierClicks: true,
    excludedHostSuffixes: [],
    autoWarmOnLinks: true,
    autoWarmOnHover: false,
    allowBackgroundWarmTab: true,
  };

  let preconnected = false;
  let foundXLink = false;
  let scanScheduled = false;
  /** @type {MutationObserver|null} */
  let mo = null;
  /** @type {WeakMap<Element, number>} */
  const hoverTimers = new WeakMap();

  function cleanCandidate(raw) {
    if (!raw || typeof raw !== "string") return null;
    let s = raw.trim();
    // 去掉包裹引号 / 尾部标点
    s = s.replace(/^['"`]+|['"`]+$/g, "");
    s = s.replace(/[),.;]+$/g, "");
    // 协议相对 //x.com
    if (s.startsWith("//")) s = `https:${s}`;
    // 裸域名补协议
    if (/^(?:(?:www|mobile)\.)?(?:x\.com|twitter\.com|t\.co)\//i.test(s)) {
      s = `https://${s}`;
    }
    return s;
  }

  function parseUrl(href) {
    const cleaned = cleanCandidate(href);
    if (!cleaned) return null;
    try {
      const u = new URL(cleaned, location.href);
      if (!/^https?:$/i.test(u.protocol)) return null;
      return u;
    } catch {
      return null;
    }
  }

  function isXLink(href) {
    const u = parseUrl(href);
    if (!u) return false;
    return X_HOSTS.has(u.hostname.toLowerCase());
  }

  /**
   * 从任意字符串抽出第一条 X/Twitter/t.co URL
   * @param {string} text
   * @returns {string|null}
   */
  function extractXUrlFromText(text) {
    if (!text || typeof text !== "string") return null;
    const m1 = text.match(X_URL_RE);
    if (m1) {
      const u = parseUrl(m1[0]);
      if (u && isXLink(u.href)) return u.href;
    }
    const m2 = text.match(TCO_RE);
    if (m2) {
      const u = parseUrl(m2[0]);
      if (u && isXLink(u.href)) return u.href;
    }
    return null;
  }

  /**
   * 从单个元素属性提取
   * @param {Element} el
   * @returns {string|null}
   */
  function extractFromAttrs(el) {
    for (const attr of DATA_URL_ATTRS) {
      const v = el.getAttribute?.(attr);
      if (!v) continue;
      if (isXLink(v)) {
        const u = parseUrl(v);
        return u ? u.href : null;
      }
      const fromText = extractXUrlFromText(v);
      if (fromText) return fromText;
    }
    // 任意 data-* 里夹 URL（限长度，防扫太大）
    if (el.attributes) {
      for (const attr of el.attributes) {
        if (!attr.name.startsWith("data-")) continue;
        if (attr.value.length > 500) continue;
        if (!/x\.com|twitter\.com|t\.co/i.test(attr.value)) continue;
        if (isXLink(attr.value)) {
          const u = parseUrl(attr.value);
          if (u) return u.href;
        }
        const hit = extractXUrlFromText(attr.value);
        if (hit) return hit;
      }
    }
    return null;
  }

  /**
   * 从元素及其祖先解析「要点开的 X URL」
   * @param {Element|null} start
   * @param {number} [maxDepth]
   * @returns {{ url: string, el: Element }|null}
   */
  function resolveXTarget(start, maxDepth = 8) {
    if (!(start instanceof Element)) return null;
    let el = start;
    for (let i = 0; i < maxDepth && el; i++) {
      // 1) 真 <a href>
      if (el.tagName === "A") {
        const a = /** @type {HTMLAnchorElement} */ (el);
        if (a.hasAttribute("download")) return null;
        if (a.href && isXLink(a.href)) {
          return { url: a.href, el };
        }
        // href 可能是 javascript: 但 data-url 有真链
        const fromA = extractFromAttrs(el);
        if (fromA) return { url: fromA, el };
      }

      // 2) role=link / 卡片容器上的 data-*
      const role = el.getAttribute?.("role");
      const fromAttrs = extractFromAttrs(el);
      if (fromAttrs) return { url: fromAttrs, el };

      // 3) 自身可见文本就是 URL（短文本才查，避免扫整段文章）
      if (role === "link" || el.tagName === "A" || el.tagName === "BUTTON") {
        const t = (el.textContent || "").trim();
        if (t.length > 0 && t.length < 300) {
          const fromText = extractXUrlFromText(t);
          if (fromText) return { url: fromText, el };
        }
      }

      // 4) 子节点里只有一个很像链接的文本（卡片标题）
      if (i === 0) {
        const t = (el.textContent || "").trim();
        if (t.length > 10 && t.length < 200) {
          const fromText = extractXUrlFromText(t);
          // 仅当几乎整段都是 URL 时才认，减少误伤
          if (fromText && t.replace(/\s/g, "").length < fromText.length + 8) {
            return { url: fromText, el };
          }
        }
      }

      el = el.parentElement;
    }
    return null;
  }

  function isExcluded() {
    const host = location.hostname.toLowerCase();
    const list = settings.excludedHostSuffixes || [];
    return list.some((suffix) => {
      const s = String(suffix || "")
        .toLowerCase()
        .replace(/^\./, "");
      if (!s) return false;
      return host === s || host.endsWith(`.${s}`);
    });
  }

  function isOnXSite() {
    const h = location.hostname.toLowerCase();
    return X_HOSTS.has(h) && h !== "t.co";
  }

  function injectPreconnect() {
    if (preconnected || !settings.enableL1Preconnect) return;
    preconnected = true;
    const head = document.head || document.documentElement;
    for (const origin of PRECONNECT_ORIGINS) {
      if (document.querySelector(`link[data-xfaster][href="${origin}"]`)) {
        continue;
      }
      const link = document.createElement("link");
      link.rel = "preconnect";
      link.href = origin;
      link.crossOrigin = "anonymous";
      link.setAttribute("data-xfaster", "1");
      head.appendChild(link);

      const dns = document.createElement("link");
      dns.rel = "dns-prefetch";
      dns.href = origin;
      dns.setAttribute("data-xfaster", "1");
      head.appendChild(dns);
    }
  }

  /**
   * @param {ParentNode} [root]
   */
  function hasXLinkIn(root) {
    const scope = root || document;
    const candidates = scope.querySelectorAll(
      [
        'a[href*="x.com"]',
        'a[href*="twitter.com"]',
        'a[href*="t.co"]',
        '[data-href*="x.com"]',
        '[data-href*="twitter.com"]',
        '[data-url*="x.com"]',
        '[data-url*="twitter.com"]',
        '[data-link*="x.com"]',
        '[data-permalink*="x.com"]',
        '[data-permalink*="twitter.com"]',
      ].join(","),
    );
    for (const el of candidates) {
      if (extractFromAttrs(el) || (el.href && isXLink(el.href))) return true;
    }
    return false;
  }

  /**
   * 扩展热重载后，旧 content script 会变成「僵尸」：
   * chrome.runtime.id 为空，sendMessage 同步抛 Extension context invalidated。
   * .catch() 拦不住同步 throw，必须 try/catch。
   * @param {object} message
   * @returns {Promise<any>|null}
   */
  function safeSendMessage(message) {
    try {
      if (!chrome?.runtime?.id) return Promise.resolve(null);
      return chrome.runtime.sendMessage(message).catch(() => null);
    } catch {
      // Extension context invalidated 等
      return Promise.resolve(null);
    }
  }

  function isExtensionAlive() {
    try {
      return Boolean(chrome?.runtime?.id);
    } catch {
      return false;
    }
  }

  function onFoundXLink() {
    if (foundXLink) return;
    foundXLink = true;
    injectPreconnect();
    if (settings.autoWarmOnLinks) {
      safeSendMessage({ type: MSG.PAGE_HAS_X_LINKS });
    }
    if (mo) {
      mo.disconnect();
      mo = null;
    }
  }

  function scanOnce() {
    if (foundXLink || isExcluded() || isOnXSite()) return;
    if (hasXLinkIn(document)) onFoundXLink();
  }

  /**
   * @param {MutationRecord[]} mutations
   */
  function onMutations(mutations) {
    if (foundXLink || isExcluded() || isOnXSite()) return;
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        const el = /** @type {Element} */ (node);
        if (extractFromAttrs(el) || (el.tagName === "A" && el.href && isXLink(el.href))) {
          onFoundXLink();
          return;
        }
        if (el.querySelector && hasXLinkIn(el)) {
          onFoundXLink();
          return;
        }
      }
    }
  }

  function onPointerOver(ev) {
    if (!settings.enableL2Hover || isExcluded() || isOnXSite()) return;
    if (!(ev.target instanceof Element)) return;
    const hit = resolveXTarget(ev.target, 6);
    if (!hit) return;

    injectPreconnect();
    if (!settings.autoWarmOnHover) return;

    const threshold = Number(settings.hoverThresholdMs) || 120;
    if (hoverTimers.has(hit.el)) return;
    const timer = window.setTimeout(() => {
      hoverTimers.delete(hit.el);
      safeSendMessage({
        type: MSG.INTENT_HOVER,
        url: hit.url,
        promote: true,
      });
    }, threshold);
    hoverTimers.set(hit.el, timer);
  }

  function onPointerOut(ev) {
    if (!(ev.target instanceof Element)) return;
    const hit = resolveXTarget(ev.target, 4);
    if (!hit) return;
    const timer = hoverTimers.get(hit.el);
    if (timer != null) {
      clearTimeout(timer);
      hoverTimers.delete(hit.el);
    }
  }

  /**
   * 在 pointerdown 就拦截 X 链接，阻止浏览器排队打开冷标签
   * （click 太晚时，部分站已在 mousedown 里 window.open）
   */
  function tryInterceptOpen(ev, fromPointerDown) {
    if (isExcluded() || isOnXSite()) return false;
    if (ev.button !== 0) return false;
    if (!(ev.target instanceof Element)) return false;
    if (!isExtensionAlive()) return false;

    const hit = resolveXTarget(ev.target, 10);
    if (!hit) return false;

    const modified = ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey;
    if (modified && settings.respectModifierClicks) return false;
    if (hit.el.tagName === "A" && hit.el.hasAttribute("download")) return false;

    // 尽早打断默认导航 / 站内 open
    ev.preventDefault();
    ev.stopPropagation();
    if (typeof ev.stopImmediatePropagation === "function") {
      ev.stopImmediatePropagation();
    }

    injectPreconnect();

    if (fromPointerDown) {
      // 仅预热意图时不重复 OPEN；真正打开放在 click
      // 但很多站只在 mousedown 里 open，所以 pointerdown 也要 OPEN_X
      safeSendMessage({
        type: MSG.OPEN_X,
        url: hit.url,
        forceNew: false,
      });
      // 标记已处理，避免 click 再发一次
      hit.el.setAttribute("data-xfaster-handled", String(Date.now()));
      return true;
    }

    safeSendMessage({
      type: MSG.OPEN_X,
      url: hit.url,
      forceNew: false,
    });
    return true;
  }

  function onPointerDown(ev) {
    if (isExcluded() || isOnXSite()) return;
    if (ev.button !== 0) return;
    if (!(ev.target instanceof Element)) return;

    const hit = resolveXTarget(ev.target, 8);
    if (!hit) return;

    const modified = ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey;
    if (modified && settings.respectModifierClicks) return;

    // 能解析出 X URL：pointerdown 直接接管，避免浏览器先开冷标签
    if (isExtensionAlive() && hit.url) {
      tryInterceptOpen(ev, true);
      return;
    }

    injectPreconnect();
    if (settings.allowBackgroundWarmTab) {
      safeSendMessage({
        type: MSG.INTENT_HOVER,
        url: hit.url,
        promote: true,
        fromPointerDown: true,
      });
    }
  }

  function onClick(ev) {
    if (isExcluded() || isOnXSite()) return;
    if (ev.button !== 0) return;
    if (!(ev.target instanceof Element)) return;

    // pointerdown 已处理则跳过，防双开
    const hit = resolveXTarget(ev.target, 10);
    if (hit?.el?.getAttribute) {
      const ts = Number(hit.el.getAttribute("data-xfaster-handled") || 0);
      if (ts && Date.now() - ts < 1500) {
        ev.preventDefault();
        ev.stopPropagation();
        if (typeof ev.stopImmediatePropagation === "function") {
          ev.stopImmediatePropagation();
        }
        return;
      }
    }

    if (ev.defaultPrevented) return;
    tryInterceptOpen(ev, false);
  }

  async function loadSettings() {
    try {
      if (!isExtensionAlive()) return;
      const data = await chrome.storage.sync.get("settings");
      if (data.settings && typeof data.settings === "object") {
        settings = { ...settings, ...data.settings };
      }
    } catch {
      // Extension context invalidated 等
    }
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync" || !changes.settings) return;
      const v = changes.settings.newValue;
      if (v && typeof v === "object") {
        settings = { ...settings, ...v };
      }
    });
  } catch {
    // 僵尸上下文忽略
  }

  /**
   * MAIN 世界 window.open 钩子由 content/window-open-hook-main.js 在 document_start 注入。
   * 这里只收 postMessage，转给 background —— 不创建冷标签，故无抖动。
   */
  function installOpenHookBridge() {
    if (isOnXSite() || isExcluded()) return;

    window.addEventListener("message", (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== "xfaster" || data.type !== "WINDOW_OPEN_X") {
        return;
      }
      if (!data.url || !isXLink(data.url)) return;
      injectPreconnect();
      // 僵尸上下文 / 发送失败时不二次 window.open（防抖动）；webNavigation 仍可兜底
      safeSendMessage({
        type: MSG.OPEN_X,
        url: data.url,
        forceNew: false,
      });
    });
  }

  function init() {
    // ★ 在 X/Twitter 站内完全不工作，避免侧栏/站内导航被误拦
    if (isOnXSite()) {
      return;
    }

    loadSettings().then(() => {
      if (isExcluded() || isOnXSite()) return;

      installOpenHookBridge();

      scanOnce();
      if (!foundXLink) {
        window.setTimeout(scanOnce, 2000);
      }

      if (!foundXLink) {
        mo = new MutationObserver((mutations) => {
          if (foundXLink) return;
          if (scanScheduled) return;
          scanScheduled = true;
          requestAnimationFrame(() => {
            scanScheduled = false;
            onMutations(mutations);
          });
        });
        mo.observe(document.documentElement, {
          childList: true,
          subtree: true,
        });
      }
    });

    document.addEventListener("pointerover", onPointerOver, true);
    document.addEventListener("pointerout", onPointerOut, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("click", onClick, true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
