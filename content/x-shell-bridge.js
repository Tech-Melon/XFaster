/**
 * x.com ISOLATED bridge — v0.5.35
 *
 * 0.5.35：按构建版本隔离，扩展更新后不必刷新 X 标签
 * - 旧 bridge 的扩展上下文失效（chrome.runtime.id 为空）时允许重新安装
 * - 发给 MAIN 的消息带 build；MAIN 只响应同 build，旧 MAIN 残留不会抢答
 * - XF_BUILD 必须与 manifest.json version、x-shell-main.js 一致（tools_pack_check.py 会校验）
 */
(() => {
  const XF_BUILD = "0.5.35";

  const contextAlive = () => {
    try {
      return Boolean(chrome?.runtime?.id);
    } catch {
      return false;
    }
  };
  // 同一扩展上下文已装过则跳过；上下文已失效（扩展被重载）则重新安装
  if (typeof window.__xfasterBridgeAlive === "function" && window.__xfasterBridgeAlive()) {
    return;
  }
  window.__xfasterBridgeAlive = contextAlive;

  const pending = new Map();

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (
      !data ||
      data.source !== "xfaster" ||
      data.type !== "XF_RESULT" ||
      data.build !== XF_BUILD
    ) {
      return;
    }
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    clearTimeout(entry.timer);
    entry.resolve(data.result || { ok: false, reason: "empty_result" });
  });

  function requestMain(href, timeoutMs) {
    return new Promise((resolve) => {
      const id = `xf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({
          ok: false,
          reason: "main_timeout",
          hint: "MAIN bridge 未响应",
        });
      }, timeoutMs);

      pending.set(id, { resolve, timer });
      window.postMessage(
        { source: "xfaster", type: "XF_NAV", build: XF_BUILD, id, href },
        "*",
      );
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== "SPA_NAV") return false;

    console.log("[XFaster][bridge] SPA_NAV", message.href, location.href);

    requestMain(message.href, 8000).then((result) => {
      console.log("[XFaster][bridge] result", result);
      sendResponse(result);
    });
    return true;
  });

  console.log(`[XFaster][bridge] v${XF_BUILD} installed`, location.href);
})();
