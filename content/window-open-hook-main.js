/**
 * MAIN world · document_start
 * 仅在「外站」拦截打开 X 的行为。
 * ★ 禁止在 x.com / twitter.com 站内拦截，否则侧栏主页/通知等全部点不动。
 */
(() => {
  if (window.__xfasterOpenHookV4) return;
  window.__xfasterOpenHookV4 = true;

  function isOnXHost() {
    try {
      const h = location.hostname.replace(/^www\./, "").toLowerCase();
      return (
        h === "x.com" ||
        h === "mobile.x.com" ||
        h === "twitter.com" ||
        h === "mobile.twitter.com" ||
        h.endsWith(".x.com") ||
        h.endsWith(".twitter.com")
      );
    } catch {
      return false;
    }
  }

  // 已在 X 站内：不 hook 任何东西，保持官方 UI 完整可点
  if (isOnXHost()) {
    return;
  }

  const nativeOpen = window.open.bind(window);

  function isXUrl(url) {
    try {
      const s = url == null ? "" : String(url);
      if (!s) return false;
      if (s.startsWith("/") && !s.startsWith("//")) return false;
      if (s.startsWith("javascript:") || s.startsWith("#")) return false;
      const u = new URL(s, location.href);
      const h = u.hostname.replace(/^www\./, "").toLowerCase();
      return (
        h === "x.com" ||
        h === "mobile.x.com" ||
        h === "twitter.com" ||
        h === "mobile.twitter.com" ||
        h === "t.co"
      );
    } catch {
      // 主机边界：禁止 //somethingx.com 或 //x.com.evil 被当成 x.com
      return /(?:^|\/\/)(?:(?:www|mobile)\.)?(?:x\.com|twitter\.com)(?![a-zA-Z0-9.-])|(?:^|\/\/)t\.co(?![a-zA-Z0-9.-])\//i.test(
        String(url || ""),
      );
    }
  }

  function absUrl(url) {
    try {
      return new URL(String(url), location.href).href;
    } catch {
      return String(url || "");
    }
  }

  /**
   * 链接内部嵌套控件 / 编辑态。
   * 命中后：只 preventDefault（拦 <a> 跳转），不 stopPropagation（页面编辑逻辑要跑）。
   */
  function isNestedInteractive(target, boundary) {
    if (!(target instanceof Element) || !boundary) return false;
    try {
      if (
        boundary.querySelector &&
        boundary.querySelector(
          'input, textarea, select, [contenteditable=""], [contenteditable="true"]',
        )
      ) {
        return true;
      }
    } catch {
      // ignore
    }

    let el = target;
    while (el && el !== boundary) {
      const tag = el.tagName;
      if (
        tag === "BUTTON" ||
        tag === "INPUT" ||
        tag === "SELECT" ||
        tag === "TEXTAREA" ||
        tag === "LABEL" ||
        tag === "SUMMARY"
      ) {
        return true;
      }
      const role = (el.getAttribute("role") || "").toLowerCase();
      if (
        role === "button" ||
        role === "menuitem" ||
        role === "switch" ||
        role === "checkbox" ||
        role === "tab" ||
        role === "option"
      ) {
        return true;
      }
      if (el.isContentEditable) return true;

      const icon = el.getAttribute("data-icon") || "";
      if (
        /Icon(?:Edit|Delete|Close|Remove|Trash|Pencil|Setting|Settings|Copy|Menu|More|Rename|Check|Confirm|Tick|Success|Cancel|Clear|Save|Ok|Done|Cross|Plus|Minus|Add|Fail|Error|Warning)/i.test(
          icon,
        )
      ) {
        return true;
      }

      const hint = [
        el.getAttribute("aria-label") || "",
        el.getAttribute("title") || "",
        el.getAttribute("data-tooltip") || "",
      ].join(" ");
      if (
        /编辑|刪除|删除|修改|重命名|关闭|取消|确认|保存|設定|设置|edit|delete|remove|close|cancel|confirm|save|rename|settings?/i.test(
          hint,
        )
      ) {
        return true;
      }

      const cls =
        typeof el.className === "string"
          ? el.className
          : el.getAttribute("class") || "";
      if (/\bcursor-pointer\b/.test(cls)) {
        if (tag === "SVG" || tag === "PATH" || tag === "I" || tag === "IMG" || icon) {
          return true;
        }
        try {
          const r = el.getBoundingClientRect();
          if (r && r.width > 0 && r.width <= 44 && r.height > 0 && r.height <= 44) {
            return true;
          }
        } catch {
          // ignore
        }
      }

      el = el.parentElement;
    }
    return false;
  }

  function notifyOpenX(url) {
    try {
      window.postMessage(
        {
          source: "xfaster",
          type: "WINDOW_OPEN_X",
          url: absUrl(url),
        },
        "*",
      );
    } catch {
      // ignore
    }
  }

  // 1) window.open → X
  window.open = function xfasterOpen(url, target, features) {
    try {
      if (isXUrl(url)) {
        notifyOpenX(url);
        return null;
      }
    } catch {
      // fall through
    }
    return nativeOpen(url, target, features);
  };

  // 2) a.click() 指向 X
  try {
    const proto = HTMLAnchorElement.prototype;
    const nativeClick = proto.click;
    if (typeof nativeClick === "function") {
      proto.click = function xfasterAnchorClick() {
        try {
          const href = this.href || this.getAttribute("href");
          if (href && isXUrl(href)) {
            notifyOpenX(href);
            return;
          }
        } catch {
          // fall through
        }
        return nativeClick.apply(this, arguments);
      };
    }
  } catch {
    // ignore
  }

  // 3) 用户点击指向 X 的链接（含 target=_blank）
  function onClickCapture(ev) {
    try {
      if (ev.button !== 0) return;
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      const t = ev.target;
      if (!(t instanceof Element)) return;
      const a = t.closest && t.closest("a[href]");
      if (!a) return;
      const href = a.href || a.getAttribute("href");
      if (!href || !isXUrl(href)) return;
      // 嵌套控件 / 编辑态：只拦默认跳转，不 stop*、不代开 X
      if (isNestedInteractive(t, a)) {
        ev.preventDefault();
        return;
      }
      ev.preventDefault();
      ev.stopPropagation();
      if (typeof ev.stopImmediatePropagation === "function") {
        ev.stopImmediatePropagation();
      }
      notifyOpenX(href);
    } catch {
      // ignore
    }
  }

  document.addEventListener("click", onClickCapture, true);
  document.addEventListener(
    "auxclick",
    (ev) => {
      try {
        if (ev.button !== 1) return;
        const t = ev.target;
        if (!(t instanceof Element)) return;
        const a = t.closest && t.closest("a[href]");
        if (!a) return;
        const href = a.href || a.getAttribute("href");
        if (!href || !isXUrl(href)) return;
        if (isNestedInteractive(t, a)) {
          ev.preventDefault();
          return;
        }
        ev.preventDefault();
        ev.stopPropagation();
        notifyOpenX(href);
      } catch {
        // ignore
      }
    },
    true,
  );
})();
