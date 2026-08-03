/**
 * 谷歌识图 content — 鼠标静止 dwell 后瞄准图片
 *
 * 搜图按钮交互：
 * - 在图片上静止 → 按钮出现在光标旁（偏右下，大按钮）
 * - 光标在同一张图上移动：按钮位置不变（无需跟手挪）
 * - 只有切换到另一张图并静止后，按钮才重新定位
 * - 滚轮 / 页面滚动：立刻隐藏按钮（避免跟滚「飘」），静止后再重新瞄准
 * - 移到按钮上：保持显示；离开图片稍后再消失
 *
 * 触发：badge / alt_right / right / left / both
 */
(() => {
  if (window.__xfasterImageSearchV1) return;
  window.__xfasterImageSearchV1 = true;

  const MSG_IMAGE_SEARCH = "IMAGE_SEARCH";
  const MOVE_TOLERANCE_PX = 4;
  /** 瞄准后无操作最长保留 */
  const ARMED_HOLD_MS = 14000;
  /** 光标离开图片后，再等多久才收起按钮 */
  const LEAVE_GRACE_MS = 900;
  /** 按钮尺寸（逻辑 CSS 像素） */
  const BADGE_W = 96;
  const BADGE_H = 44;
  /** 相对光标偏移，避免正压在热点上 */
  const BADGE_OFFSET_X = 16;
  const BADGE_OFFSET_Y = 18;
  const OUTLINE_ATTR = "data-xfaster-img-armed";
  const BADGE_ID = "xfaster-img-search-badge";

  /** @type {any} */
  let settings = {
    enableImageSearch: false,
    imageSearchDwellMs: 350,
    imageSearchMinSize: 80,
    imageSearchTrigger: "badge",
    excludedHostSuffixes: [],
    uiLang: "zh",
  };

  let lastX = 0;
  let lastY = 0;
  let stillTimer = 0;
  let armedClearTimer = 0;
  let leaveTimer = 0;
  /** @type {{ el: Element, url: string }|null} */
  let armed = null;
  let listenersOn = false;
  /** @type {HTMLButtonElement|null} */
  let badgeEl = null;

  function badgeCopy() {
    const en = settings.uiLang === "en";
    return {
      text: en ? "🔍 Search" : "🔍 搜图",
      title: en
        ? "Google reverse image (system context menu still works)"
        : "用 Google 识图（系统右键菜单仍可用）",
      aria: en ? "Google reverse image" : "谷歌识图",
    };
  }

  function applyBadgeLang() {
    if (!badgeEl) return;
    const c = badgeCopy();
    badgeEl.textContent = c.text;
    badgeEl.title = c.title;
    badgeEl.setAttribute("aria-label", c.aria);
  }

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
      if (badgeEl && (start === badgeEl || badgeEl.contains(start))) {
        return armed;
      }
      let el = start;
      for (let i = 0; i < 8 && el; i++) {
        if (el instanceof HTMLImageElement && sizeOk(el, minSize)) {
          const url = extractImageUrl(el);
          if (url) return { el, url };
        }
        if (el.tagName === "PICTURE" && sizeOk(el, minSize)) {
          const url = extractImageUrl(el);
          if (url) return { el, url };
        }
        if (sizeOk(el, minSize)) {
          const url = extractImageUrl(el);
          if (
            url &&
            (el instanceof HTMLImageElement ||
              /url\(/i.test(getComputedStyle(el).backgroundImage || ""))
          ) {
            return { el, url };
          }
        }
        el = el.parentElement;
      }
    }
    return null;
  }

  function ensureBadge() {
    if (badgeEl && badgeEl.isConnected) {
      applyBadgeLang();
      return badgeEl;
    }
    const btn = document.createElement("button");
    btn.id = BADGE_ID;
    btn.type = "button";
    const copy = badgeCopy();
    btn.textContent = copy.text;
    btn.title = copy.title;
    btn.setAttribute("aria-label", copy.aria);
    Object.assign(btn.style, {
      position: "fixed",
      zIndex: "2147483646",
      display: "none",
      boxSizing: "border-box",
      minWidth: `${BADGE_W}px`,
      minHeight: `${BADGE_H}px`,
      border: "none",
      borderRadius: "12px",
      padding: "10px 18px",
      fontSize: "15px",
      fontWeight: "700",
      letterSpacing: "0.02em",
      lineHeight: "1.2",
      color: "#fff",
      background: "linear-gradient(135deg, #1d9bf0, #0a7bb8)",
      boxShadow: "0 6px 20px rgba(0,0,0,.32)",
      cursor: "pointer",
      userSelect: "none",
      fontFamily: "system-ui,Segoe UI,sans-serif",
      touchAction: "manipulation",
    });
    btn.addEventListener(
      "click",
      (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (typeof ev.stopImmediatePropagation === "function") {
          ev.stopImmediatePropagation();
        }
        if (!armed?.url) return;
        fireSearch(armed.url, ev.screenX, ev.screenY);
      },
      true,
    );
    btn.addEventListener(
      "mousedown",
      (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
      },
      true,
    );
    btn.addEventListener("mouseenter", () => {
      clearLeaveTimer();
      bumpArmedHold();
    });
    btn.addEventListener("mouseleave", () => {
      // 从按钮离开：给一点时间回到图上或再点
      scheduleLeaveIfNeeded();
    });
    (document.documentElement || document.body).appendChild(btn);
    badgeEl = btn;
    return btn;
  }

  /**
   * 按钮跟光标：停在光标右下方，方便点到且不挡中心
   * @param {number} cx
   * @param {number} cy
   */
  function placeBadgeAtCursor(cx, cy) {
    const btn = ensureBadge();
    try {
      let left = cx + BADGE_OFFSET_X;
      let top = cy + BADGE_OFFSET_Y;
      // 贴边翻转
      if (left + BADGE_W > window.innerWidth - 8) {
        left = Math.max(8, cx - BADGE_W - 8);
      }
      if (top + BADGE_H > window.innerHeight - 8) {
        top = Math.max(8, cy - BADGE_H - 8);
      }
      left = Math.max(8, Math.min(left, window.innerWidth - BADGE_W - 8));
      top = Math.max(8, Math.min(top, window.innerHeight - BADGE_H - 8));
      btn.style.left = `${Math.round(left)}px`;
      btn.style.top = `${Math.round(top)}px`;
      btn.style.display = "block";
    } catch {
      btn.style.display = "none";
    }
  }

  function hideBadge() {
    if (badgeEl) badgeEl.style.display = "none";
  }

  function clearLeaveTimer() {
    if (leaveTimer) {
      clearTimeout(leaveTimer);
      leaveTimer = 0;
    }
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

  function bumpArmedHold() {
    if (!armed) return;
    if (armedClearTimer) clearTimeout(armedClearTimer);
    armedClearTimer = window.setTimeout(() => {
      disarm();
    }, ARMED_HOLD_MS);
  }

  function disarm() {
    clearLeaveTimer();
    clearArmedVisual();
    hideBadge();
    armed = null;
    if (armedClearTimer) {
      clearTimeout(armedClearTimer);
      armedClearTimer = 0;
    }
  }

  function scheduleLeaveIfNeeded() {
    clearLeaveTimer();
    leaveTimer = window.setTimeout(() => {
      // 宽限期结束时再确认：若不在图上且不在按钮上 → 收起
      try {
        if (badgeEl && badgeEl.matches(":hover")) {
          bumpArmedHold();
          return;
        }
      } catch {
        // ignore
      }
      const hit = hitImageAt(lastX, lastY);
      if (hit) {
        arm(hit, lastX, lastY, false);
        return;
      }
      disarm();
    }, LEAVE_GRACE_MS);
  }

  /**
   * 是否同一张图：DOM 节点相同，或 URL 相同（节点被替换时）
   * @param {{ el: Element, url: string }|null|undefined} a
   * @param {{ el: Element, url: string }|null|undefined} b
   */
  function isSameImage(a, b) {
    if (!a || !b) return false;
    if (a.el === b.el) return true;
    if (a.url && b.url && a.url === b.url) return true;
    return false;
  }

  /**
   * @param {{ el: Element, url: string }} hit
   * @param {number} cx
   * @param {number} cy
   * @param {boolean} [forceMoveBadge] 强制挪按钮（一般仅新图）
   */
  function arm(hit, cx, cy, forceMoveBadge = false) {
    clearLeaveTimer();
    const same = isSameImage(armed, hit);
    const badgeHidden = !badgeEl || badgeEl.style.display === "none";

    if (!same) {
      clearArmedVisual();
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
      // 换图：按钮移到当前光标旁
      placeBadgeAtCursor(cx, cy);
    } else {
      // 同一张图：只续命，不挪按钮
      armed = hit;
      if (badgeHidden || forceMoveBadge) {
        placeBadgeAtCursor(cx, cy);
      }
    }
    bumpArmedHold();
  }

  function onStill() {
    if (!settings.enableImageSearch || isExcluded()) return;
    const hit = hitImageAt(lastX, lastY);
    if (hit) {
      // 同图：不变动按钮位置；换图：才重新定位
      arm(hit, lastX, lastY, false);
      return;
    }
    // 光标下没有图
    if (armed) {
      scheduleLeaveIfNeeded();
    } else {
      disarm();
    }
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
    // 已在某图上瞄准时：用较短间隔只做「是否还在图上 / 是否换图」检测，不必跟手挪位
    const base = settings.imageSearchDwellMs || 350;
    const dwell = armed
      ? Math.min(280, Math.max(150, Math.round(base * 0.65)))
      : base;
    stillTimer = window.setTimeout(onStill, dwell);
  }

  /**
   * @param {EventTarget|null} t
   */
  function isOnBadge(t) {
    return Boolean(
      badgeEl && t instanceof Node && (t === badgeEl || badgeEl.contains(t)),
    );
  }

  /**
   * @param {MouseEvent} ev
   */
  function onMouseMove(ev) {
    if (isOnBadge(ev.target)) {
      clearLeaveTimer();
      bumpArmedHold();
      lastX = ev.clientX;
      lastY = ev.clientY;
      return;
    }

    const dx = Math.abs(ev.clientX - lastX);
    const dy = Math.abs(ev.clientY - lastY);
    lastX = ev.clientX;
    lastY = ev.clientY;

    if (dx > MOVE_TOLERANCE_PX || dy > MOVE_TOLERANCE_PX) {
      // ★ 移动时不要立刻 disarm（否则点不到按钮）
      // 同图内移动：按钮保持不动；静止后若仍是同图则只续命
      // 换到另一张图并静止后：才重新定位按钮
      clearLeaveTimer();
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
   * @param {string} imageUrl
   * @param {number} [screenX]
   * @param {number} [screenY]
   */
  function fireSearch(imageUrl, screenX, screenY) {
    safeSend({
      type: MSG_IMAGE_SEARCH,
      imageUrl,
      screenX,
      screenY,
    });
  }

  /**
   * @param {"left"|"right"} which
   * @param {MouseEvent} ev
   */
  function shouldInterceptKey(which, ev) {
    const trigger = settings.imageSearchTrigger || "badge";
    if (trigger === "badge") return false;
    if (trigger === "alt_right") {
      return which === "right" && Boolean(ev.altKey);
    }
    if (trigger === "right") return which === "right";
    if (trigger === "left") return which === "left";
    if (trigger === "both") return which === "left" || which === "right";
    return false;
  }

  /**
   * @param {MouseEvent} ev
   * @param {"left"|"right"} which
   */
  function tryTrigger(ev, which) {
    if (!settings.enableImageSearch || isExcluded()) return false;
    if (!shouldInterceptKey(which, ev)) return false;

    const trigger = settings.imageSearchTrigger || "badge";
    if (trigger !== "alt_right") {
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return false;
    }

    let target = armed;
    if (!target || !target.url) {
      target = hitImageAt(ev.clientX, ev.clientY);
    }
    if (!target?.url) return false;

    ev.preventDefault();
    ev.stopPropagation();
    if (typeof ev.stopImmediatePropagation === "function") {
      ev.stopImmediatePropagation();
    }

    fireSearch(target.url, ev.screenX, ev.screenY);
    if (!armed) arm(target, ev.clientX, ev.clientY, true);
    return true;
  }

  /**
   * @param {MouseEvent} ev
   */
  function onClick(ev) {
    if (ev.button !== 0) return;
    if (isOnBadge(ev.target)) return;
    tryTrigger(ev, "left");
  }

  /**
   * @param {MouseEvent} ev
   */
  function onContextMenu(ev) {
    if (isOnBadge(ev.target)) {
      ev.preventDefault();
      return;
    }
    tryTrigger(ev, "right");
  }

  /**
   * 滚轮/滚动/缩放：收起按钮，不跟页面「飘」
   * 滚动结束后若光标仍停在图上，会经 dwell 再出现
   */
  function onScrollOrWheel() {
    if (stillTimer) {
      clearTimeout(stillTimer);
      stillTimer = 0;
    }
    clearLeaveTimer();
    if (armed || (badgeEl && badgeEl.style.display !== "none")) {
      disarm();
    }
    // 滚完后重新计静止，避免必须再抖一下鼠标才出现
    if (settings.enableImageSearch && !isExcluded()) {
      resetStillTimer();
    }
  }

  function onResize() {
    onScrollOrWheel();
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
    // capture + passive：任意滚动容器都能收到；滚轮比 scroll 更早，体感更跟手消失
    window.addEventListener("scroll", onScrollOrWheel, {
      capture: true,
      passive: true,
    });
    window.addEventListener("wheel", onScrollOrWheel, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", onResize, { passive: true });
  }

  function detachListeners() {
    if (!listenersOn) return;
    listenersOn = false;
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("contextmenu", onContextMenu, true);
    window.removeEventListener("scroll", onScrollOrWheel, true);
    window.removeEventListener("wheel", onScrollOrWheel, true);
    window.removeEventListener("resize", onResize);
    if (stillTimer) clearTimeout(stillTimer);
    stillTimer = 0;
    clearLeaveTimer();
    disarm();
    if (badgeEl) {
      try {
        badgeEl.remove();
      } catch {
        // ignore
      }
      badgeEl = null;
    }
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
        let trigger = s.imageSearchTrigger || "badge";
        if (!["badge", "alt_right", "right", "left", "both"].includes(trigger)) {
          trigger = "badge";
        }
        settings = {
          enableImageSearch: Boolean(s.enableImageSearch),
          imageSearchDwellMs: Number(s.imageSearchDwellMs) || 350,
          imageSearchMinSize: Number(s.imageSearchMinSize) || 80,
          imageSearchTrigger: trigger,
          excludedHostSuffixes: Array.isArray(s.excludedHostSuffixes)
            ? s.excludedHostSuffixes
            : [],
          uiLang: s.uiLang === "en" ? "en" : "zh",
        };
        applyBadgeLang();
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

  loadSettingsFromStorage();
})();
