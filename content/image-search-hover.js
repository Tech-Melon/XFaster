/**
 * 谷歌识图 content — 鼠标静止 dwell 后瞄准图片，键鼠触发识图
 * 与 link-observer / window-open-hook 隔离；开关关闭时尽早退出监听。
 */
(() => {
  if (window.__xfasterImageSearchV1) return;
  window.__xfasterImageSearchV1 = true;

  const MSG_IMAGE_SEARCH = "IMAGE_SEARCH";
  const MOVE_TOLERANCE_PX = 3;
  const ARMED_HOLD_MS = 4000;
  const OUTLINE_ATTR = "data-xfaster-img-armed";

  /** @type {any} */
  let settings = {
    enableImageSearch: false,
    imageSearchDwellMs: 350,
    imageSearchMinSize: 80,
    imageSearchTrigger: "right",
    excludedHostSuffixes: [],
  };

  let lastX = 0;
  let lastY = 0;
  let stillTimer = 0;
  let armedClearTimer = 0;
  /** @type {{ el: Element, url: string }|null} */
  let armed = null;
  let listenersOn = false;

  function isExcluded() {
    try {
      const host = location.hostname.toLowerCase();
      const list = settings.excludedHostSuffixes || [];
      return list.some((suffix) => {
        const s = String(suffix || "")
          .toLowerCase()
          .replace(/^\./, "");
        if (!s) return false;
        return host === s || host.endsWith(`.${s}`);
      });
    } catch {
      return false;
    }
  }

  function absUrl(raw) {
    if (!raw || typeof raw !== "string") return null;
    const s = raw.trim().replace(/^url\(["']?|["']?\)$/gi, "");
    if (!s || s.startsWith("blob:") || s.startsWith("data:")) return null;
    try {
      const u = new URL(s, location.href);
      if (!/^https?:$/i.test(u.protocol)) return null;
      return u.href;
    } catch {
      return null;
    }
  }

  /**
   * @param {string} srcset
   */
  function pickFromSrcset(srcset) {
    if (!srcset) return null;
    let best = null;
    let bestW = -1;
    for (const part of srcset.split(",")) {
      const bits = part.trim().split(/\s+/);
      const url = bits[0];
      if (!url) continue;
      let w = 0;
      const desc = bits[1] || "";
      const m = desc.match(/^(\d+)w$/i);
      if (m) w = Number(m[1]);
      else if (/^\d+(\.\d+)?x$/i.test(desc)) w = parseFloat(desc) * 1000;
      if (w >= bestW) {
        bestW = w;
        best = url;
      } else if (best == null) {
        best = url;
      }
    }
    return absUrl(best);
  }

  /**
   * @param {Element} el
   */
  function extractImageUrl(el) {
    if (!(el instanceof Element)) return null;

    if (el instanceof HTMLImageElement) {
      const fromSrc =
        absUrl(el.currentSrc) ||
        absUrl(el.src) ||
        absUrl(el.getAttribute("data-src")) ||
        absUrl(el.getAttribute("data-original")) ||
        pickFromSrcset(el.getAttribute("srcset") || el.srcset || "");
      if (fromSrc) return fromSrc;
    }

    if (el instanceof HTMLSourceElement) {
      return (
        absUrl(el.src) ||
        pickFromSrcset(el.getAttribute("srcset") || el.srcset || "")
      );
    }

    if (el.tagName === "PICTURE") {
      const img = el.querySelector("img");
      if (img) return extractImageUrl(img);
    }

    // 常见懒加载 / 卡片属性
    for (const attr of [
      "data-src",
      "data-original",
      "data-url",
      "data-image",
      "data-img",
      "data-lazy-src",
    ]) {
      const v = el.getAttribute?.(attr);
      const u = absUrl(v || "");
      if (u) return u;
    }

    try {
      const st = getComputedStyle(el);
      const bg = st.backgroundImage || "";
      const m = bg.match(/url\((['"]?)(https?:\/\/[^'")]+)\1\)/i);
      if (m) return absUrl(m[2]);
    } catch {
      // ignore
    }

    return null;
  }

  /**
   * @param {Element} el
   * @param {number} minSize
   */
  function sizeOk(el, minSize) {
    try {
      const r = el.getBoundingClientRect();
      return r.width >= minSize && r.height >= minSize;
    } catch {
      return false;
    }
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {{ el: Element, url: string }|null}
   */
  function hitImageAt(x, y) {
    const minSize = settings.imageSearchMinSize || 80;
    let stack = [];
    try {
      if (document.elementsFromPoint) {
        stack = document.elementsFromPoint(x, y) || [];
      } else {
        const one = document.elementFromPoint(x, y);
        if (one) stack = [one];
      }
    } catch {
      return null;
    }

    for (const start of stack) {
      if (!(start instanceof Element)) continue;
      let el = start;
      for (let i = 0; i < 8 && el; i++) {
        // 优先 img
        if (el instanceof HTMLImageElement && sizeOk(el, minSize)) {
          const url = extractImageUrl(el);
          if (url) return { el, url };
        }
        if (el.tagName === "PICTURE" && sizeOk(el, minSize)) {
          const url = extractImageUrl(el);
          if (url) return { el, url };
        }
        // 带背景图的块
        if (sizeOk(el, minSize)) {
          const url = extractImageUrl(el);
          if (url && (el instanceof HTMLImageElement || /url\(/i.test(getComputedStyle(el).backgroundImage || ""))) {
            return { el, url };
          }
        }
        el = el.parentElement;
      }
    }
    return null;
  }

  function clearArmedVisual() {
    if (!armed?.el) return;
    try {
      armed.el.removeAttribute(OUTLINE_ATTR);
      if (armed.el instanceof HTMLElement) {
        armed.el.style.outline = "";
        armed.el.style.outlineOffset = "";
      }
    } catch {
      // ignore
    }
  }

  function disarm() {
    clearArmedVisual();
    armed = null;
    if (armedClearTimer) {
      clearTimeout(armedClearTimer);
      armedClearTimer = 0;
    }
  }

  /**
   * @param {{ el: Element, url: string }} hit
   */
  function arm(hit) {
    disarm();
    armed = hit;
    try {
      hit.el.setAttribute(OUTLINE_ATTR, "1");
      if (hit.el instanceof HTMLElement) {
        hit.el.style.outline = "2px solid #1d9bf0";
        hit.el.style.outlineOffset = "2px";
      }
    } catch {
      // ignore
    }
    armedClearTimer = window.setTimeout(() => {
      disarm();
    }, ARMED_HOLD_MS);
  }

  function onStill() {
    if (!settings.enableImageSearch || isExcluded()) return;
    const hit = hitImageAt(lastX, lastY);
    if (hit) arm(hit);
    else disarm();
  }

  function resetStillTimer() {
    if (stillTimer) {
      clearTimeout(stillTimer);
      stillTimer = 0;
    }
    if (!settings.enableImageSearch || isExcluded()) {
      disarm();
      return;
    }
    const dwell = settings.imageSearchDwellMs || 350;
    stillTimer = window.setTimeout(onStill, dwell);
  }

  /**
   * @param {MouseEvent} ev
   */
  function onMouseMove(ev) {
    const dx = Math.abs(ev.clientX - lastX);
    const dy = Math.abs(ev.clientY - lastY);
    lastX = ev.clientX;
    lastY = ev.clientY;
    if (dx > MOVE_TOLERANCE_PX || dy > MOVE_TOLERANCE_PX) {
      if (armed) disarm();
      resetStillTimer();
    }
  }

  function safeSend(message) {
    try {
      if (!chrome?.runtime?.id) return Promise.resolve(null);
      return chrome.runtime.sendMessage(message).catch(() => null);
    } catch {
      return Promise.resolve(null);
    }
  }

  /**
   * @param {MouseEvent} ev
   * @param {"left"|"right"} which
   */
  function tryTrigger(ev, which) {
    if (!settings.enableImageSearch || isExcluded()) return false;
    const trigger = settings.imageSearchTrigger || "right";
    if (trigger === "right" && which !== "right") return false;
    if (trigger === "left" && which !== "left") return false;
    // both: 都允许

    // 未武装时，点击当下再 hit 一次（减少必须先停够 dwell 的挫败）
    let target = armed;
    if (!target || !target.url) {
      target = hitImageAt(ev.clientX, ev.clientY);
    }
    if (!target?.url) return false;

    // 修饰键留给浏览器
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return false;

    ev.preventDefault();
    ev.stopPropagation();
    if (typeof ev.stopImmediatePropagation === "function") {
      ev.stopImmediatePropagation();
    }

    safeSend({
      type: MSG_IMAGE_SEARCH,
      imageUrl: target.url,
      screenX: ev.screenX,
      screenY: ev.screenY,
    });
    // 触发后短暂保留描边
    if (!armed) arm(target);
    return true;
  }

  /**
   * @param {MouseEvent} ev
   */
  function onClick(ev) {
    if (ev.button !== 0) return;
    tryTrigger(ev, "left");
  }

  /**
   * @param {MouseEvent} ev
   */
  function onContextMenu(ev) {
    tryTrigger(ev, "right");
  }

  function attachListeners() {
    if (listenersOn) return;
    listenersOn = true;
    document.addEventListener("mousemove", onMouseMove, {
      capture: true,
      passive: true,
    });
    document.addEventListener("click", onClick, true);
    document.addEventListener("contextmenu", onContextMenu, true);
  }

  function detachListeners() {
    if (!listenersOn) return;
    listenersOn = false;
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("contextmenu", onContextMenu, true);
    if (stillTimer) clearTimeout(stillTimer);
    stillTimer = 0;
    disarm();
  }

  function applyEnabledState() {
    if (settings.enableImageSearch && !isExcluded()) {
      attachListeners();
      resetStillTimer();
    } else {
      detachListeners();
    }
  }

  function loadSettingsFromStorage() {
    try {
      chrome.storage.sync.get("settings", (data) => {
        const s = data?.settings || {};
        settings = {
          enableImageSearch: Boolean(s.enableImageSearch),
          imageSearchDwellMs: Number(s.imageSearchDwellMs) || 350,
          imageSearchMinSize: Number(s.imageSearchMinSize) || 80,
          imageSearchTrigger: s.imageSearchTrigger || "right",
          excludedHostSuffixes: Array.isArray(s.excludedHostSuffixes)
            ? s.excludedHostSuffixes
            : [],
        };
        applyEnabledState();
      });
    } catch {
      // ignore
    }
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync" || !changes.settings) return;
      loadSettingsFromStorage();
    });
  } catch {
    // ignore
  }

  // 也可用 GET_STATUS 对齐，storage 足够
  loadSettingsFromStorage();
})();
