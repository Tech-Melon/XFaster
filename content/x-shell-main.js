/**
 * x.com MAIN world — v0.5.2
 * 同文档 SPA；等待 hydrate；路径按 status id 比较
 */
(() => {
  if (window.__xfasterMainInstalled) return;
  window.__xfasterMainInstalled = true;
  window.__xfasterDocId = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  const X_HOSTS = new Set([
    "x.com",
    "www.x.com",
    "mobile.x.com",
    "twitter.com",
    "www.twitter.com",
    "mobile.twitter.com",
  ]);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const normHost = (h) => String(h || "").replace(/^www\./, "").toLowerCase();

  const stripMedia = (pathname) => {
    let p = pathname || "/";
    p = p.replace(
      /\/(status|statuses)\/(\d+)\/(photo|video|analytics|likes|retweets|quotes)(\/\d+)?\/?$/i,
      "/$1/$2",
    );
    p = p.replace(/\/(photo|video)\/\d+\/?$/i, "");
    if (p.length > 1) p = p.replace(/\/+$/, "");
    return p || "/";
  };

  const pathKey = (hrefOrPath) => {
    try {
      const u =
        typeof hrefOrPath === "string" && hrefOrPath.startsWith("http")
          ? new URL(hrefOrPath, location.href)
          : new URL(hrefOrPath, location.origin);
      const p = stripMedia(u.pathname);
      const m = p.match(/\/(?:i\/)?status(?:es)?\/(\d+)/i);
      if (m) return `status:${m[1]}`;
      return (p.replace(/\/$/, "") || "/") + (u.search || "");
    } catch {
      return String(hrefOrPath || "");
    }
  };

  const currentKey = () => pathKey(location.href);

  const statusIdFromKey = (key) => {
    const m = /^status:(\d+)$/.exec(String(key || ""));
    return m ? m[1] : null;
  };

  /** 页内是否已经画出目标推文（不能拿上一帖的 article 充数） */
  function domHasStatus(statusId) {
    if (!statusId) return false;
    const want = `status:${statusId}`;
    try {
      const articles = document.querySelectorAll('article[data-testid="tweet"]');
      for (const article of articles) {
        const links = article.querySelectorAll("a[href]");
        for (const a of links) {
          try {
            if (pathKey(a.href) === want) return true;
          } catch {
            // ignore
          }
        }
      }
      for (const t of document.querySelectorAll("a[href] time")) {
        const a = t.closest("a[href]");
        try {
          if (a && pathKey(a.href) === want) return true;
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
    return false;
  }

  function pageMatchesTarget(wantKey) {
    if (currentKey() !== wantKey) return false;
    const sid = statusIdFromKey(wantKey);
    if (sid) return domHasStatus(sid);
    return hasAppContent();
  }

  function hasAppContent() {
    try {
      if (document.querySelector('[data-testid="primaryColumn"]')) return true;
      if (document.querySelector('article[data-testid="tweet"]')) return true;
      if (document.querySelector('[data-testid="tweetText"]')) return true;
      if (document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]'))
        return true;
      if (document.querySelector('a[data-testid="AppTabBar_Home_Link"]')) return true;
      const root = document.getElementById("react-root");
      if (root && root.childElementCount > 0 && root.innerText.trim().length > 80) {
        return true;
      }
    } catch {
      // ignore
    }
    return false;
  }

  async function waitHydrated(maxMs) {
    if (hasAppContent()) return true;
    const end = Date.now() + maxMs;
    while (Date.now() < end) {
      await sleep(80);
      if (hasAppContent()) return true;
    }
    return hasAppContent();
  }

  async function softNavigate(targetHref) {
    const logs = [];
    const log = (m, extra) => {
      logs.push(extra !== undefined ? `${m} ${JSON.stringify(extra)}` : m);
      try {
        console.log("[XFaster][MAIN]", m, extra !== undefined ? extra : "");
      } catch {
        // ignore
      }
    };

    const docIdBefore = window.__xfasterDocId;

    try {
      log("softNavigate start", {
        targetHref,
        href: location.href,
        docId: docIdBefore,
        hasContent: hasAppContent(),
      });

      const url = new URL(targetHref, location.origin);
      if (
        !X_HOSTS.has(normHost(url.hostname)) ||
        !X_HOSTS.has(normHost(location.hostname))
      ) {
        return { ok: false, reason: "not_x_origin", logs };
      }

      // 目标 path（剥 media）
      const destPath = stripMedia(url.pathname) + (url.search || "");
      // 用于 history 的干净 path（无 tracking 已在后台 strip）
      const destForHistory =
        stripMedia(url.pathname) +
        (url.search && url.search !== "?" ? url.search : "");

      const wantKey = pathKey(url.href);
      const curKey = currentKey();

      if (wantKey === curKey) {
        const sid = statusIdFromKey(wantKey);
        if (sid && !domHasStatus(sid)) {
          log("same url but target tweet missing");
          return {
            ok: false,
            reason: "spa_stale_same_url",
            path: curKey,
            sameDocument: true,
            logs,
          };
        }
        return {
          ok: true,
          method: "already_there",
          path: curKey,
          sameDocument: true,
          logs,
        };
      }

      // 等待壳 hydrate（最多 ~2.5s）
      if (!hasAppContent()) {
        log("waiting hydrate…");
        const okHydra = await waitHydrated(2500);
        log("hydrate result", { okHydra, hasContent: hasAppContent() });
        if (!okHydra) {
          return { ok: false, reason: "shell_not_hydrated", logs };
        }
      }

      // 1) DOM 内已有链接（按 status id / pathKey 匹配）
      try {
        log("try existing_link_safe_click");
        let link = null;
        for (const a of document.querySelectorAll("a[href]")) {
          try {
            if (pathKey(a.href) === wantKey) {
              link = a;
              break;
            }
          } catch {
            // ignore
          }
        }
        if (link) {
          const blocker = (ev) => {
            if (!ev.defaultPrevented) ev.preventDefault();
          };
          link.addEventListener("click", blocker, true);
          try {
            link.click();
          } finally {
            link.removeEventListener("click", blocker, true);
          }
          await sleep(150);
          if (window.__xfasterDocId !== docIdBefore) {
            return {
              ok: false,
              reason: "full_document_navigation",
              hardNav: true,
              logs,
            };
          }
          if (pageMatchesTarget(wantKey)) {
            log("success existing_link_spa");
            return {
              ok: true,
              method: "existing_link_spa",
              path: currentKey(),
              sameDocument: true,
              logs,
            };
          }
          log("existing_link no key match", { cur: currentKey(), want: wantKey });
        } else {
          log("no existing link in DOM");
        }
      } catch (e) {
        log("existing_link throw", String(e));
      }

      // 2) history.pushState + popstate
      try {
        log("try history_pushstate", { destForHistory });
        const contentBefore = document
          .getElementById("react-root")
          ?.innerText?.slice(0, 240);
        const state = {
          ...(window.history.state && typeof window.history.state === "object"
            ? window.history.state
            : {}),
          xfaster: Date.now(),
        };
        window.history.pushState(state, "", destForHistory || destPath);
        window.dispatchEvent(new PopStateEvent("popstate", { state }));

        await sleep(120);
        if (window.__xfasterDocId !== docIdBefore) {
          return {
            ok: false,
            reason: "full_document_navigation",
            hardNav: true,
            logs,
          };
        }

        // 等内容变化（必须是目标推文，不能拿上一帖 article 充数）
        const sid = statusIdFromKey(wantKey);
        let matched = false;
        const end = Date.now() + 1200;
        while (Date.now() < end) {
          await sleep(80);
          if (window.__xfasterDocId !== docIdBefore) {
            return {
              ok: false,
              reason: "full_document_navigation",
              hardNav: true,
              logs,
            };
          }
          if (pageMatchesTarget(wantKey)) {
            matched = true;
            break;
          }
          if (!sid && currentKey() === wantKey) {
            const contentAfter = document
              .getElementById("react-root")
              ?.innerText?.slice(0, 240);
            if (
              contentBefore &&
              contentAfter &&
              contentBefore !== contentAfter
            ) {
              matched = true;
              break;
            }
          }
        }

        if (matched) {
          await sleep(200);
          if (currentKey() !== wantKey) {
            log("url reverted after spa");
            return {
              ok: false,
              reason: "spa_url_reverted",
              path: currentKey(),
              want: wantKey,
              logs,
            };
          }
          if (sid && !domHasStatus(sid)) {
            log("status node disappeared after spa");
            return {
              ok: false,
              reason: "spa_wrong_status",
              path: currentKey(),
              want: wantKey,
              logs,
            };
          }
          log("success history_pushstate_rerender");
          return {
            ok: true,
            method: "history_pushstate_rerender",
            path: currentKey(),
            sameDocument: true,
            logs,
          };
        }

        if (currentKey() === wantKey) {
          log("url only, no target tweet");
          return {
            ok: false,
            reason: sid ? "spa_wrong_status" : "spa_url_only_no_rerender",
            path: currentKey(),
            want: wantKey,
            logs,
          };
        }

        log("pushState key mismatch", { cur: currentKey(), want: wantKey });
      } catch (e) {
        log("history_pushstate throw", String(e));
      }

      log("all same-document strategies failed", {
        cur: currentKey(),
        want: wantKey,
      });
      return {
        ok: false,
        reason: "spa_not_applied",
        path: currentKey(),
        want: wantKey,
        sameDocument: true,
        logs,
      };
    } catch (e) {
      log("fatal", String(e));
      return {
        ok: false,
        reason: e instanceof Error ? e.message : String(e),
        logs,
      };
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "xfaster") return;

    if (data.type === "SPA_PING") {
      window.postMessage(
        {
          source: "xfaster",
          type: "SPA_NAV_RESULT",
          id: data.id,
          result: {
            ok: true,
            method: "ping",
            hydrated: hasAppContent(),
            docId: window.__xfasterDocId,
            href: location.href,
          },
        },
        "*",
      );
      return;
    }

    if (data.type !== "SPA_NAV") return;

    softNavigate(data.href)
      .then((result) => {
        window.postMessage(
          {
            source: "xfaster",
            type: "SPA_NAV_RESULT",
            id: data.id,
            result,
          },
          "*",
        );
      })
      .catch((e) => {
        window.postMessage(
          {
            source: "xfaster",
            type: "SPA_NAV_RESULT",
            id: data.id,
            result: {
              ok: false,
              reason: e instanceof Error ? e.message : String(e),
            },
          },
          "*",
        );
      });
  });

  try {
    console.log(
      "[XFaster][MAIN] v0.5.2 installed",
      location.href,
      window.__xfasterDocId,
    );
  } catch {
    // ignore
  }
})();
