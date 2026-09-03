/**
 * UI 多语言 — 轻量字典（popup / options / 角标）
 * 默认 zh；用户切换写入 settings.uiLang
 */

/** @typedef {"zh"|"en"} UiLang */

export const SUPPORTED_LANGS = /** @type {const} */ (["zh", "en"]);

/** @type {UiLang} */
export const DEFAULT_LANG = "zh";

/**
 * @param {unknown} raw
 * @returns {UiLang}
 */
export function normalizeLang(raw) {
  return raw === "en" ? "en" : "zh";
}

/**
 * 另一语言（切换按钮用）
 * @param {UiLang} lang
 * @returns {UiLang}
 */
export function otherLang(lang) {
  return lang === "en" ? "zh" : "en";
}

/**
 * 切换按钮上显示的文字：当前中文 → 显示 EN（点了切英文）
 * @param {UiLang} lang
 */
export function langToggleLabel(lang) {
  return lang === "en" ? "中" : "EN";
}

/**
 * 切换按钮 title
 * @param {UiLang} lang
 */
export function langToggleTitle(lang) {
  return lang === "en" ? "切换到中文 / Switch to Chinese" : "Switch to English / 切换到英文";
}

/** @type {Record<string, { zh: string, en: string }>} */
const DICT = {
  // —— 通用 ——
  "app.name": { zh: "Tech Melon XFaster", en: "Tech Melon XFaster" },
  "app.brandSub": { zh: "{profile} · Tech Melon", en: "{profile} · Tech Melon" },
  "common.minutes": { zh: "分钟", en: "min" },
  "common.seconds": { zh: "秒", en: "s" },
  "common.dash": { zh: "—", en: "—" },

  // —— 档位 ——
  "profile.eco": { zh: "节能", en: "Eco" },
  "profile.balanced": { zh: "均衡", en: "Balanced" },
  "profile.fast": { zh: "快速", en: "Fast" },
  "profile.turbo": { zh: "极速", en: "Turbo" },
  "profile.desc.eco": {
    zh: "几乎无后台，最省内存",
    en: "Almost no background; lowest memory",
  },
  "profile.desc.balanced": {
    zh: "有链接暖 1 壳，速度与占用折中",
    en: "Warm 1 shell when links found; balanced",
  },
  "profile.desc.fast": {
    zh: "暖壳 + 悬停检测；TTL 更长",
    en: "Warm shell + hover detect; longer TTL",
  },
  "profile.desc.turbo": {
    zh: "暖壳 + 悬停预热；TTL 45 分钟",
    en: "Warm shell + hover preload; 45 min TTL",
  },
  "profile.descLine": {
    zh: "{desc} · TTL {ttl} 分钟",
    en: "{desc} · TTL {ttl} min",
  },

  // —— popup 权限 ——
  "perm.title": { zh: "站点授权", en: "Site access" },
  "perm.badge.none": { zh: "未授权全站", en: "All sites off" },
  "perm.badge.all": { zh: "全站已授权", en: "All sites on" },
  "perm.badge.currentOnly": { zh: "仅当前站", en: "This site only" },
  "perm.text.none": {
    zh: "未授权时外站可能先开冷 X 再合并热壳。点「一键授权所有网站」后，现在与未来未知站均可页面内拦截。",
    en: "Without grant, external sites may open a cold X tab first then merge. Grant all sites to intercept in-page on current and future sites.",
  },
  "perm.text.granted": {
    zh: "已授权全部网站，外站点击 X 将页面内拦截。若仍闪标签，请刷新该外站一次。",
    en: "All sites granted. X clicks on external pages are intercepted in-page. If a cold tab still flashes, refresh that page once.",
  },
  "perm.btn.all": { zh: "一键授权所有网站", en: "Grant access to all sites" },
  "perm.btn.allOn": { zh: "全站权限已开启", en: "All-site access enabled" },
  "perm.btn.requesting": { zh: "请求权限中…", en: "Requesting…" },
  "perm.btn.current": { zh: "授权当前网站", en: "Grant this site" },
  "perm.btn.currentOn": { zh: "当前站已授权", en: "This site granted" },
  "perm.btn.currentIncluded": { zh: "已包含当前站", en: "This site included" },
  "perm.site": { zh: "当前站：{origin}", en: "Current site: {origin}" },
  "perm.site.none": {
    zh: "当前站：请先打开普通 https 网页",
    en: "Current site: open a normal https page first",
  },

  // —— popup 一键配置 ——
  "popup.profileTitle": { zh: "一键配置", en: "Quick profile" },
  "popup.profileAria": { zh: "预热档位", en: "Warm-up profile" },

  // —— 谷歌识图卡片 ——
  "img.title": { zh: "谷歌识图", en: "Google reverse image" },
  "img.desc.off": {
    zh: "已关闭 · 开启后可在外站对图片识图",
    en: "Off · Enable to reverse-search images on sites",
  },
  "img.desc.default": {
    zh: "鼠标在图上静止后，右键打开 Lens 小窗",
    en: "Dwell on an image, then open Lens in a popup",
  },
  "img.desc.on": {
    zh: "已开启 · 静止后{trigger} · {mode}",
    en: "On · after dwell: {trigger} · {mode}",
  },
  "img.trigger.badge": { zh: "点「搜图」按钮", en: "tap Search badge" },
  "img.trigger.alt_right": { zh: "Alt+右键", en: "Alt+right-click" },
  "img.trigger.both": { zh: "左/右键", en: "left/right click" },
  "img.trigger.left": { zh: "左键", en: "left-click" },
  "img.trigger.right": { zh: "右键", en: "right-click" },
  "img.mode.popup": { zh: "小窗", en: "popup" },
  "img.mode.tab": { zh: "新标签", en: "new tab" },
  "img.toggleAria": { zh: "开关谷歌识图", en: "Toggle Google reverse image" },
  "img.hint": {
    zh: "需全站/当前站授权；详细配置见",
    en: "Needs site grant; details in",
  },
  "img.hint.link": { zh: "设置页", en: "Settings" },
  "img.badge": { zh: "🔍 搜图", en: "🔍 Search" },
  "img.badgeTitle": {
    zh: "用 Google 识图（系统右键菜单仍可用）",
    en: "Google reverse image (system context menu still works)",
  },
  "img.badgeAria": { zh: "谷歌识图", en: "Google reverse image" },
  "img.contextMenu": {
    zh: "谷歌识图（XFaster）",
    en: "Google reverse image (XFaster)",
  },

  // —— 状态行 ——
  "status.profile": { zh: "当前档位", en: "Profile" },
  "status.openMode": { zh: "打开方式", en: "Open mode" },
  "status.warm": { zh: "热实例", en: "Warm shell" },
  "status.lastOpen": { zh: "上次打开", en: "Last open" },
  "status.ttl": { zh: "剩余 TTL", en: "TTL left" },
  "openMode.new_tab": { zh: "无壳时新标签", en: "New tab if no shell" },
  "openMode.current_tab": { zh: "当前标签", en: "Current tab" },
  "warm.ready": { zh: "壳已热", en: "Shell hot" },
  "warm.loading": { zh: "壳加载中…", en: "Shell loading…" },
  "warm.none": { zh: "无热壳 / 等待暖壳", en: "No shell / waiting" },
  "warm.eco": { zh: "节能·不暖壳", en: "Eco · no shell" },
  "warm.noneShort": { zh: "无", en: "None" },
  "ttl.expired": { zh: "已到期", en: "Expired" },
  "ttl.sec": { zh: "{n} 秒", en: "{n}s" },
  "ttl.minSec": { zh: "{m} 分 {s} 秒", en: "{m}m {s}s" },
  "ttl.min": { zh: "{m} 分钟", en: "{m} min" },

  "last.none": { zh: "尚未通过扩展打开过", en: "Not opened via extension yet" },
  "last.spa": { zh: "真 SPA ({method})", en: "SPA ({method})" },
  "last.same": { zh: "同页激活", en: "Same page focus" },
  "last.fullNav": { zh: "整页重载", en: "Full navigation" },
  "last.fullFallback": { zh: "整页回退", en: "Full reload fallback" },
  "last.cold": { zh: "冷开新标签", en: "Cold new tab" },
  "last.force": { zh: "强制刷新", en: "Force reload" },
  "last.staleHard": { zh: "闲置整页刷新", en: "Idle full reload" },
  "last.spaRevert": { zh: "SPA 回退纠正", en: "SPA revert corrected" },

  // —— 提示 / 操作 ——
  "hint.loading": {
    zh: "正在读取状态…授权按钮可直接点击。",
    en: "Loading status… grant buttons stay clickable.",
  },
  "hint.bgDead": {
    zh: "后台暂无响应。授权按钮仍可点。也可到 chrome://extensions 重新加载扩展。",
    en: "Background not responding. Grant still works. Or reload at chrome://extensions.",
  },
  "hint.warmReady": {
    zh: "当前有热壳。请先完成上方全站授权，外站点击才不会闪冷标签。",
    en: "Shell is hot. Grant all-site access above so external clicks won't flash a cold tab.",
  },
  "hint.warming": { zh: "暖壳中…", en: "Warming shell…" },
  "hint.idle": {
    zh: "可点「立即预热」。外站无闪体验需上方「全站已授权」。",
    en: 'Tap "Warm now". Flash-free external opens need all-site grant above.',
  },
  "hint.statusFail": {
    zh: "状态读取失败。请重新加载扩展。授权按钮仍可使用。",
    en: "Failed to read status. Reload the extension. Grant still works.",
  },

  "action.openX": { zh: "打开 X", en: "Open X" },
  "action.warm": { zh: "立即预热", en: "Warm now" },
  "action.release": { zh: "释放预热", en: "Release shell" },
  "action.options": { zh: "打开设置…", en: "Open settings…" },
  "debug.title": { zh: "调试日志", en: "Debug log" },
  "debug.clear": { zh: "清空", en: "Clear" },
  "debug.empty": { zh: "无日志", en: "No logs" },

  // —— toast ——
  "toast.alreadyProfile": {
    zh: "已是「{name}」",
    en: 'Already on "{name}"',
  },
  "toast.switched": { zh: "已切换：{name}", en: "Switched: {name}" },
  "toast.switchFail": { zh: "切换失败", en: "Switch failed" },
  "toast.openOk": { zh: "已打开", en: "Opened" },
  "toast.openFail": { zh: "打开失败", en: "Open failed" },
  "toast.warming": { zh: "正在暖壳…", en: "Warming…" },
  "toast.shellThere": { zh: "壳已在", en: "Shell already up" },
  "toast.warmNeedProfile": {
    zh: "请先切均衡/快速/极速",
    en: "Switch to Balanced/Fast/Turbo first",
  },
  "toast.warmFail": { zh: "预热失败", en: "Warm failed" },
  "toast.released": { zh: "已释放热壳", en: "Shell released" },
  "toast.noShell": { zh: "无热壳", en: "No warm shell" },
  "toast.opFail": { zh: "操作失败", en: "Action failed" },
  "toast.imgOn": { zh: "谷歌识图已开启", en: "Reverse image on" },
  "toast.imgOff": { zh: "谷歌识图已关闭", en: "Reverse image off" },
  "toast.toggleFail": { zh: "开关失败", en: "Toggle failed" },
  "toast.grantCancel": { zh: "未授权或已取消", en: "Denied or cancelled" },
  "toast.grantInjecting": {
    zh: "已授权，正在注入已开标签…",
    en: "Granted; injecting open tabs…",
  },
  "toast.grantReady": {
    zh: "全站已就绪（注入 {n} 个标签）",
    en: "All sites ready (injected {n} tabs)",
  },
  "toast.grantRefresh": {
    zh: "全站已授权。请刷新外站网页后再点 X 链接",
    en: "All sites granted. Refresh external pages, then click X links",
  },
  "toast.grantErr": {
    zh: "授权异常：{msg}",
    en: "Grant error: {msg}",
  },
  "toast.grantErrReload": {
    zh: "请重载扩展",
    en: "Please reload the extension",
  },
  "toast.needHttps": {
    zh: "请先打开普通 https 网页，再点授权当前网站",
    en: "Open a normal https page first, then grant this site",
  },
  "toast.grantedInject": {
    zh: "已授权并注入：{origin}",
    en: "Granted & injected: {origin}",
  },
  "toast.grantedRefresh": {
    zh: "已授权 {origin}，请刷新该网页",
    en: "Granted {origin}; please refresh the page",
  },
  "toast.grantedOrigin": {
    zh: "已授权 {origin}",
    en: "Granted {origin}",
  },
  "toast.grantFail": {
    zh: "授权失败：{msg}",
    en: "Grant failed: {msg}",
  },
  "toast.lang": {
    zh: "已切换到中文",
    en: "Switched to English",
  },

  // —— options ——
  "opt.title": { zh: "Tech Melon XFaster 设置", en: "Tech Melon XFaster Settings" },
  "opt.hero": {
    zh: "默认（均衡折中）：页面有推特链接时自动暖 1 个壳 · TTL 20 分钟（最长 1 小时）· 不悬停狂预热 · 省电/极速可在下方切换",
    en: "Default (Balanced): warm 1 shell when X links appear · TTL 20 min (max 1h) · no aggressive hover warm · switch Eco/Turbo below",
  },
  "opt.sec.open": { zh: "打开方式", en: "Open behavior" },
  "opt.openMode": { zh: "默认打开位置", en: "Default open target" },
  "opt.openMode.new_tab": { zh: "新标签（推荐）", en: "New tab (recommended)" },
  "opt.openMode.current_tab": { zh: "当前标签", en: "Current tab" },
  "opt.preferReuse": {
    zh: "优先复用已打开 / 预热的 X 标签",
    en: "Prefer reusing open / warm X tabs",
  },
  "opt.singleTab": {
    zh: "单 X 标签模式（所有链接尽量进同一个标签）",
    en: "Single X tab mode (route links into one tab)",
  },
  "opt.normalize": {
    zh: "将 twitter.com 规范化为 x.com",
    en: "Normalize twitter.com to x.com",
  },
  "opt.respectMod": {
    zh: "尊重 Ctrl/⌘/Shift 点击的浏览器默认行为",
    en: "Respect Ctrl/⌘/Shift browser defaults",
  },
  "opt.sec.perf": { zh: "预热与性能", en: "Warm-up & performance" },
  "opt.warmupProfile": { zh: "预热档位", en: "Warm-up profile" },
  "opt.profile.eco": {
    zh: "节能 — 几乎无后台开销",
    en: "Eco — almost no background cost",
  },
  "opt.profile.balanced": {
    zh: "均衡 — 有链接暖壳（默认）",
    en: "Balanced — warm when links found (default)",
  },
  "opt.profile.fast": {
    zh: "快速 — 暖壳 + 悬停检测 · TTL 30m",
    en: "Fast — warm + hover detect · TTL 30m",
  },
  "opt.profile.turbo": {
    zh: "极速 — 暖壳 + 悬停预热 · TTL 45m",
    en: "Turbo — warm + hover preload · TTL 45m",
  },
  "opt.hint.eco": {
    zh: "节能：几乎无后台，不暖壳。最省内存。",
    en: "Eco: almost no background, no warm shell. Lowest memory.",
  },
  "opt.hint.balanced": {
    zh: "均衡（默认）：有推特链接时暖 1 壳，TTL 20 分钟。不悬停预热。",
    en: "Balanced (default): warm 1 shell when X links appear, TTL 20 min. No hover preload.",
  },
  "opt.hint.fast": {
    zh: "快速：暖壳 + 悬停意图检测，TTL 30 分钟。比均衡更积极。",
    en: "Fast: warm shell + hover intent, TTL 30 min. More aggressive than Balanced.",
  },
  "opt.hint.turbo": {
    zh: "极速：暖壳 + 悬停预热，TTL 45 分钟。最快也最占资源。",
    en: "Turbo: warm shell + hover preload, TTL 45 min. Fastest, heaviest.",
  },
  "opt.ttl": { zh: "热实例最长存活 N 分钟", en: "Warm shell max lifetime (minutes)" },
  "opt.ttl.opt": { zh: "{n} 分钟", en: "{n} min" },
  "opt.ttl.20": { zh: "20 分钟（均衡默认）", en: "20 min (Balanced default)" },
  "opt.ttl.30": { zh: "30 分钟（快速）", en: "30 min (Fast)" },
  "opt.ttl.45": { zh: "45 分钟（极速）", en: "45 min (Turbo)" },
  "opt.ttl.60": { zh: "60 分钟（最大）", en: "60 min (max)" },
  "opt.warmUrl": { zh: "预热入口 URL", en: "Warm entry URL" },
  "opt.allowL3": {
    zh: "允许后台热标签（L3，全局最多 1 个）",
    en: "Allow background warm tab (L3, max 1 global)",
  },
  "opt.autoLinks": {
    zh: "页面出现推特链接时自动后台预热",
    en: "Auto warm when X links appear on the page",
  },
  "opt.autoHover": {
    zh: "悬停推特链接时后台预加载该链接",
    en: "Preload link on hover over X URLs",
  },
  "opt.l1": {
    zh: "页面存在推特链接时 Preconnect（L1）",
    en: "Preconnect when X links exist (L1)",
  },
  "opt.l2": {
    zh: "启用悬停意图检测（L2）",
    en: "Enable hover intent detection (L2)",
  },
  "opt.hoverMs": { zh: "悬停触发阈值（毫秒）", en: "Hover threshold (ms)" },
  "opt.powerSave": {
    zh: "省电/省流时自动降级（预留开关）",
    en: "Auto downgrade on power/data saver (reserved)",
  },
  "opt.debug": {
    zh: "启用调试日志（会写 storage，日常请关闭）",
    en: "Enable debug logs (writes storage; keep off daily)",
  },
  "opt.sec.img": { zh: "谷歌识图", en: "Google reverse image" },
  "opt.img.intro": {
    zh: "与打开 X 加速相互独立。弹窗可一键开关；此处为详细参数。需已授权站点权限（全站或当前站）才会注入页面脚本。",
    en: "Independent from X open acceleration. Toggle in the popup; details here. Needs site grant (all or current) for page scripts.",
  },
  "opt.img.enable": {
    zh: "启用谷歌识图（总开关，与弹窗同步）",
    en: "Enable reverse image (master switch, synced with popup)",
  },
  "opt.img.dwell": {
    zh: "鼠标静止多久后瞄准图片（毫秒）",
    en: "Mouse dwell before arming image (ms)",
  },
  "opt.img.minSize": {
    zh: "最小图片边长（像素，忽略小图标）",
    en: "Min image edge (px; ignore tiny icons)",
  },
  "opt.img.trigger": { zh: "触发方式", en: "Trigger" },
  "opt.img.trigger.badge": {
    zh: "浮动「搜图」按钮（默认，不拦截系统右键）",
    en: 'Floating "Search" badge (default; no right-click steal)',
  },
  "opt.img.trigger.alt_right": {
    zh: "Alt + 右键搜图（普通右键保留菜单）",
    en: "Alt + right-click search (normal right-click keeps menu)",
  },
  "opt.img.trigger.right": {
    zh: "拦截右键搜图（会挡住另存为等）",
    en: "Intercept right-click (blocks Save image, etc.)",
  },
  "opt.img.trigger.left": {
    zh: "拦截左键搜图",
    en: "Intercept left-click search",
  },
  "opt.img.trigger.both": {
    zh: "拦截左键 + 右键",
    en: "Intercept left + right click",
  },
  "opt.img.menuHint": {
    zh: "开启识图后，系统右键菜单会额外多一项「谷歌识图（XFaster）」，与上面触发方式并存；保存图片等原生项不受影响。",
    en: 'When enabled, the system context menu adds "Google reverse image (XFaster)" alongside triggers above; native items like Save image stay intact.',
  },
  "opt.img.openMode": { zh: "结果打开方式", en: "Result open mode" },
  "opt.img.open.popup": {
    zh: "独立小弹窗（单例复用，推荐）",
    en: "Dedicated popup (singleton reuse, recommended)",
  },
  "opt.img.open.tab": { zh: "浏览器新标签", en: "Browser new tab" },
  "opt.img.engine": { zh: "识图引擎", en: "Search engine" },
  "opt.img.engine.lens": {
    zh: "Google Lens（uploadbyurl）",
    en: "Google Lens (uploadbyurl)",
  },
  "opt.img.engine.images": {
    zh: "Google 以图搜图（经典）",
    en: "Google reverse image (classic)",
  },
  "opt.sec.exclude": { zh: "排除站点", en: "Excluded sites" },
  "opt.exclude": {
    zh: "排除域名后缀（逗号分隔，如 example.com, intranet.local）",
    en: "Excluded host suffixes (comma-separated, e.g. example.com, intranet.local)",
  },
  "opt.exclude.ph": {
    zh: "留空表示所有网站生效",
    en: "Empty = apply on all sites",
  },
  "opt.exclude.hint": {
    zh: "排除后：该站不拦截 X 链接，也不启用识图瞄准。",
    en: "Excluded: no X-link intercept and no image-search aiming on that host.",
  },
  "opt.save": { zh: "保存", en: "Save" },
  "opt.reset": { zh: "恢复默认", en: "Reset defaults" },
  "opt.saved": { zh: "已保存", en: "Saved" },
  "opt.resetOk": {
    zh: "已恢复默认（均衡折中）",
    en: "Defaults restored (Balanced)",
  },
};

/**
 * @param {UiLang} lang
 * @param {string} key
 * @param {Record<string, string|number>} [vars]
 */
export function t(lang, key, vars) {
  const entry = DICT[key];
  let s = entry ? entry[normalizeLang(lang)] || entry.zh || key : key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}

/**
 * 应用 data-i18n / data-i18n-title / data-i18n-aria / data-i18n-placeholder
 * @param {ParentNode} root
 * @param {UiLang} lang
 */
export function applyDomI18n(root, lang) {
  const L = normalizeLang(lang);
  const nodes = root.querySelectorAll("[data-i18n]");
  for (const el of nodes) {
    const key = el.getAttribute("data-i18n");
    if (!key) continue;
    const text = t(L, key);
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      // 不当正文容器
    } else {
      el.textContent = text;
    }
  }
  for (const el of root.querySelectorAll("[data-i18n-title]")) {
    const key = el.getAttribute("data-i18n-title");
    if (key) el.setAttribute("title", t(L, key));
  }
  for (const el of root.querySelectorAll("[data-i18n-aria]")) {
    const key = el.getAttribute("data-i18n-aria");
    if (key) el.setAttribute("aria-label", t(L, key));
  }
  for (const el of root.querySelectorAll("[data-i18n-placeholder]")) {
    const key = el.getAttribute("data-i18n-placeholder");
    if (key && "placeholder" in el) {
      /** @type {any} */ (el).placeholder = t(L, key);
    }
  }
  if (root instanceof Document) {
    root.documentElement.lang = L === "en" ? "en" : "zh-CN";
  } else if (root instanceof Element && root.ownerDocument) {
    root.ownerDocument.documentElement.lang = L === "en" ? "en" : "zh-CN";
  }
}

/**
 * 档位显示名
 * @param {UiLang} lang
 * @param {string} profileId
 */
export function profileName(lang, profileId) {
  const key = `profile.${profileId}`;
  return DICT[key] ? t(lang, key) : profileId;
}
