/** Tech Melon XFaster 共享常量 — v0.5.6 四档一键配置 */

export const STORAGE_KEYS = {
  SETTINGS: "settings",
  WARM_STATE: "warmState",
};

export const ALARM_NAMES = {
  WARM_EXPIRE: "xfaster-warm-expire",
};

export const MSG = {
  OPEN_X: "OPEN_X",
  INTENT_HOVER: "INTENT_HOVER",
  PAGE_HAS_X_LINKS: "PAGE_HAS_X_LINKS",
  GET_STATUS: "GET_STATUS",
  WARM_NOW: "WARM_NOW",
  RELEASE_WARM: "RELEASE_WARM",
  OPEN_HOME: "OPEN_HOME",
  SETTINGS_UPDATED: "SETTINGS_UPDATED",
  GET_DEBUG_LOG: "GET_DEBUG_LOG",
  CLEAR_DEBUG_LOG: "CLEAR_DEBUG_LOG",
  SET_PROFILE: "SET_PROFILE",
  GET_PERMISSIONS: "GET_PERMISSIONS",
  REQUEST_OPTIONAL_HOSTS: "REQUEST_OPTIONAL_HOSTS",
  INJECT_AFTER_GRANT: "INJECT_AFTER_GRANT",
  /** 谷歌识图：content → background */
  IMAGE_SEARCH: "IMAGE_SEARCH",
  /** 弹窗一键开关识图 */
  SET_IMAGE_SEARCH_ENABLED: "SET_IMAGE_SEARCH_ENABLED",
};

export const PRECONNECT_ORIGINS = [
  "https://x.com",
  "https://abs.twimg.com",
  "https://api.x.com",
];

/**
 * 四档一键配置（popup / 设置页共用）
 * ttlMinutes：一键切换时写入
 */
export const WARMUP_PROFILES = {
  eco: {
    id: "eco",
    label: "节能",
    shortLabel: "节能",
    enableL1Preconnect: false,
    enableL2Hover: false,
    allowBackgroundWarmTab: false,
    autoWarmOnLinks: false,
    autoWarmOnHover: false,
    ttlMinutes: 10,
    desc: "几乎无后台，最省内存",
  },
  balanced: {
    id: "balanced",
    label: "均衡",
    shortLabel: "均衡",
    enableL1Preconnect: true,
    enableL2Hover: false,
    allowBackgroundWarmTab: true,
    autoWarmOnLinks: true,
    autoWarmOnHover: false,
    ttlMinutes: 20,
    desc: "有链接暖 1 壳，速度与占用折中",
  },
  fast: {
    id: "fast",
    label: "快速",
    shortLabel: "快速",
    enableL1Preconnect: true,
    enableL2Hover: true,
    allowBackgroundWarmTab: true,
    autoWarmOnLinks: true,
    autoWarmOnHover: false,
    ttlMinutes: 30,
    desc: "暖壳 + 悬停检测；TTL 更长",
  },
  turbo: {
    id: "turbo",
    label: "极速",
    shortLabel: "极速",
    enableL1Preconnect: true,
    enableL2Hover: true,
    allowBackgroundWarmTab: true,
    autoWarmOnLinks: true,
    autoWarmOnHover: true,
    ttlMinutes: 45,
    desc: "暖壳 + 悬停预热；TTL 45 分钟",
  },
};

/** 弹窗一键顺序 */
export const PROFILE_ORDER = ["eco", "balanced", "fast", "turbo"];

export const DEFAULT_SETTINGS = {
  openMode: "new_tab",
  preferReuseXTab: true,
  singleXTabMode: false,
  normalizeToXCom: true,

  warmupProfile: "balanced",
  turboTtlMinutes: 20,
  allowBackgroundWarmTab: true,
  autoWarmOnLinks: true,
  autoWarmOnHover: false,

  enableL1Preconnect: true,
  enableL2Hover: false,
  hoverThresholdMs: 100,

  autoDowngradeOnPowerSave: true,
  warmEntryUrl: "https://x.com/home",
  respectModifierClicks: true,

  debugLogging: false,

  /** UI 语言：zh | en（弹窗右上角切换） */
  uiLang: "zh",

  excludedHostSuffixes: [],

  /**
   * 谷歌识图（旁路功能，与 X 加速隔离）
   * - enableImageSearch：总开关（弹窗一键）
   * - imageSearchDwellMs：鼠标静止多久后判定瞄图
   * - imageSearchMinSize：忽略过小的图标
   * - imageSearchTrigger：
   *   badge（默认，浮动按钮，不抢右键）|
   *   alt_right（Alt+右键）|
   *   right / left / both（拦截对应键，会挡原生菜单）
   * - imageSearchOpenMode：popup 小窗 | tab 新标签
   * - imageSearchEngine：lens | google_images
   */
  enableImageSearch: false,
  imageSearchDwellMs: 350,
  imageSearchMinSize: 80,
  imageSearchTrigger: "badge",
  imageSearchOpenMode: "popup",
  imageSearchEngine: "lens",
};

export const TTL_OPTIONS = [1, 3, 5, 10, 20, 30, 45, 60];
