/**
 * x.com MAIN world — v0.5.35
 * 同文档 SPA；等待 hydrate；路径按 status id 比较
 * 0.5.34：热路径对齐 0.5.31（地址对上即可软跳）；URL 回退才判失败
 * 0.5.35：适配新版 x-web（TanStack Router + Tailwind，无 #react-root / data-testid）
 *   - 经 React fiber 找到 router 实例，优先 router.navigate（真 SPA，无需猜 DOM）
 *   - hydrate / 推文检测不再依赖 data-testid，旧版选择器保留兼容
 */
(() => {
  // 必须与 manifest.json version、x-shell-bridge.js 一致（tools_pack_check.py 会校验）
  const XF_BUILD = "0.5.35";
  // 按 build 去重：扩展更新后重注入可装上新版；旧版残留只响应旧 build 的消息
  const installed = (window.__xfasterMainBuilds ||= {});
  if (installed[XF_BUILD]) return;
  installed[XF_BUILD] = true;
  // 同一文档只生成一次，用来识别整页导航
  window.__xfasterDocId ||= `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

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

  /**
   * 新版 x-web 的 TanStack Router 实例（经 React fiber 向上找 Context Provider）。
   * 找不到返回 null（旧版 X / 尚未 hydrate），调用方回退旧策略。
   */
  const isRouter = (v) =>
    Boolean(
      v &&
        typeof v.navigate === "function" &&
        v.history &&
        typeof v.history.push === "function" &&
        v.state &&
        v.state.location,
    );

  function routerFromElement(el) {
    if (!el) return null;
    const fk = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
    if (!fk) return null;
    let f = el[fk];
    for (let d = 0; f && d < 600; d++) {
      const p = f.memoizedProps;
      if (p) {
        if (isRouter(p.value)) return p.value;
        if (isRouter(p.router)) return p.router;
      }
      f = f.return;
    }
    return null;
  }

  function findRouter() {
    const cached = window.__xfasterRouter;
    if (isRouter(cached)) return cached;
    try {
      const candidates = [
        document.body?.firstElementChild,
        document.querySelector("main"),
        document.querySelector("a[href]"),
      ];
      for (const el of candidates) {
        const r = routerFromElement(el);
        if (r) {
          window.__xfasterRouter = r;
          return r;
        }
      }
    } catch {
      // ignore
    }
    return null;
  }

  /** 页内是否已经画出目标推文（不能拿上一帖的 article 充数） */
  function domHasStatus(statusId) {
    if (!statusId) return false;
    const want = `status:${statusId}`;
    try {
      // 新版 x-web 的 article 无 data-testid，统一按 article 扫
      const articles = document.querySelectorAll("article");
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
      // 新版 x-web：router 已挂载即视为 hydrate 完成
      if (findRouter()) return true;
      // 旧版选择器
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

  /**
   * 新版 x-web：router.navigate 软跳。
   * 成功 = router 位置与地址栏都对上目标，且加载结束；加载慢时地址对上即接受（X 自己会画 pending）。
   * @returns {Promise<object|null>} null = 本策略不可用，交给 pushState 回退
   */
  async function routerNavigate(router, dest, wantKey, docIdBefore, log) {
    log("try router_navigate", { dest });
    let navError = null;
    try {
      const p = router.navigate({ href: dest });
      if (p && typeof p.catch === "function") {
        p.catch((e) => {
          navError = String(e);
        });
      }
    } catch (e) {
      log("router_navigate throw", String(e));
      return null;
    }

    const routerKey = () => pathKey(router.state?.location?.href || "");
    let committed = false;
    const end = Date.now() + 1500;
    while (Date.now() < end) {
      await sleep(30);
      if (window.__xfasterDocId !== docIdBefore) {
        return { ok: false, reason: "full_document_navigation", hardNav: true };
      }
      if (navError) {
        log("router_navigate rejected", navError);
        return null;
      }
      if (routerKey() !== wantKey || currentKey() !== wantKey) continue;
      committed = true;
      const st = router.state;
      if (st.status === "error") {
        log("router_navigate route error");
        return {
          ok: false,
          reason: "spa_route_error",
          path: currentKey(),
          want: wantKey,
        };
      }
      if (st.status !== "pending" && !st.isLoading) {
        log("success router_navigate");
        return {
          ok: true,
          method: "router_navigate",
          path: currentKey(),
          sameDocument: true,
        };
      }
    }
    if (committed && currentKey() === wantKey) {
      log("router_navigate committed, still loading → accept");
      return {
        ok: true,
        method: "router_navigate",
        loading: true,
        path: currentKey(),
        sameDocument: true,
      };
    }
    log("router_navigate key mismatch", { cur: currentKey(), want: wantKey });
    return null;
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
        // 新版：router 已在该路由且没出错，即视为已在目标
        const r = findRouter();
        const routerThere =
          r &&
          pathKey(r.state.location?.href || "") === wantKey &&
          r.state.status !== "error";
        if (sid && !routerThere && !domHasStatus(sid)) {
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

      // 0) 新版 x-web：直接调 router.navigate（同文档、由 X 自己加载数据）
      const router = findRouter();
      if (router) {
        const viaRouter = await routerNavigate(
          router,
          destForHistory || destPath,
          wantKey,
          docIdBefore,
          log,
        );
        if (viaRouter) return { ...viaRouter, logs };
        log("router_navigate failed, fallback pushState");
      }

      // 1) 旧版：DOM 内已有链接（按 status id / pathKey 匹配）
      //    新版 TanStack Link 会因 capture 阶段的 preventDefault 放弃导航，故有 router 时跳过
      try {
        log("try existing_link_safe_click", { skip: Boolean(router) });
        let link = null;
        const anchors = router ? [] : document.querySelectorAll("a[href]");
        for (const a of anchors) {
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
          if (currentKey() === wantKey) {
            await sleep(200);
            if (currentKey() !== wantKey) {
              log("url reverted after existing_link");
              return {
                ok: false,
                reason: "spa_url_reverted",
                path: currentKey(),
                want: wantKey,
                logs,
              };
            }
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

        // 等内容变化。目标推文出现最理想；否则对齐 0.5.31：地址对 + 内容变/有 tweet 节点。
        // 成功后再核对 URL，回退才失败（0.5.32 优点）。
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
          if (currentKey() === wantKey) {
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
            if (document.querySelector('article[data-testid="tweet"]')) {
              matched = true;
              break;
            }
            if (!sid && hasAppContent()) {
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
          await sleep(200);
          if (currentKey() !== wantKey) {
            log("url reverted after url-only wait");
            return {
              ok: false,
              reason: "spa_url_reverted",
              path: currentKey(),
              want: wantKey,
              logs,
            };
          }
          log("url settled, accept spa");
          return {
            ok: true,
            method: "history_pushstate_rerender",
            path: currentKey(),
            sameDocument: true,
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
    if (
      !data ||
      data.source !== "xfaster" ||
      data.type !== "XF_NAV" ||
      data.build !== XF_BUILD
    ) {
      return;
    }

    const reply = (result) =>
      window.postMessage(
        { source: "xfaster", type: "XF_RESULT", build: XF_BUILD, id: data.id, result },
        "*",
      );

    softNavigate(data.href)
      .then(reply)
      .catch((e) =>
        reply({ ok: false, reason: e instanceof Error ? e.message : String(e) }),
      );
  });

  try {
    console.log(
      `[XFaster][MAIN] v${XF_BUILD} installed`,
      location.href,
      window.__xfasterDocId,
    );
  } catch {
    // ignore
  }
})();
