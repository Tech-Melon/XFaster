/**
 * x.com ISOLATED bridge — v0.5.2
 */
(() => {
  if (window.__xfasterBridgeInstalled) return;
  window.__xfasterBridgeInstalled = true;

  const pending = new Map();

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "xfaster" || data.type !== "SPA_NAV_RESULT") {
      return;
    }
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    clearTimeout(entry.timer);
    entry.resolve(data.result || { ok: false, reason: "empty_result" });
  });

  function requestMain(type, href, timeoutMs = 6000) {
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
        {
          source: "xfaster",
          type,
          id,
          href,
        },
        "*",
      );
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return false;

    if (message.type === "SPA_PING") {
      requestMain("SPA_PING", null, 2000)
        .then(sendResponse)
        .catch((e) =>
          sendResponse({
            ok: false,
            reason: e instanceof Error ? e.message : String(e),
          }),
        );
      return true;
    }

    if (message.type !== "SPA_NAV") return false;

    console.log("[XFaster][bridge] SPA_NAV", message.href, location.href);

    requestMain("SPA_NAV", message.href, 6500)
      .then((result) => {
        console.log("[XFaster][bridge] result", result);
        sendResponse(result);
      })
      .catch((e) => {
        const result = {
          ok: false,
          reason: e instanceof Error ? e.message : String(e),
        };
        console.warn("[XFaster][bridge] error", result);
        sendResponse(result);
      });

    return true;
  });

  console.log("[XFaster][bridge] v0.5.2 installed", location.href);
})();
