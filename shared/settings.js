/**
 * 设置读写 — v0.5.5 均衡折中迁移
 */
import {
  DEFAULT_SETTINGS,
  LEGACY_PROFILE_TTL,
  STORAGE_KEYS,
  WARMUP_PROFILES,
} from "./constants.js";
import { normalizeLang } from "./i18n.js";

/**
 * @param {Partial<typeof DEFAULT_SETTINGS>} raw
 * @returns {typeof DEFAULT_SETTINGS}
 */
export function normalizeSettings(raw = {}) {
  const merged = { ...DEFAULT_SETTINGS, ...raw };

  if (!["new_tab", "current_tab"].includes(merged.openMode)) {
    merged.openMode = DEFAULT_SETTINGS.openMode;
  }
  if (!["eco", "balanced", "fast", "turbo"].includes(merged.warmupProfile)) {
    merged.warmupProfile = DEFAULT_SETTINGS.warmupProfile;
  }

  const ttl = Number(merged.turboTtlMinutes);
  if (Number.isFinite(ttl) && ttl >= 1 && ttl <= 60) {
    merged.turboTtlMinutes = Math.round(ttl);
  } else {
    merged.turboTtlMinutes = DEFAULT_SETTINGS.turboTtlMinutes;
  }

  const hover = Number(merged.hoverThresholdMs);
  merged.hoverThresholdMs =
    Number.isFinite(hover) && hover >= 30 && hover <= 500
      ? Math.round(hover)
      : DEFAULT_SETTINGS.hoverThresholdMs;

  merged.preferReuseXTab = Boolean(merged.preferReuseXTab);
  merged.singleXTabMode = Boolean(merged.singleXTabMode);
  merged.normalizeToXCom = Boolean(merged.normalizeToXCom);
  merged.allowBackgroundWarmTab = Boolean(merged.allowBackgroundWarmTab);
  merged.autoWarmOnLinks = Boolean(merged.autoWarmOnLinks);
  merged.autoWarmOnHover = Boolean(merged.autoWarmOnHover);
  merged.enableL1Preconnect = Boolean(merged.enableL1Preconnect);
  merged.enableL2Hover = Boolean(merged.enableL2Hover);
  merged.autoDowngradeOnPowerSave = Boolean(merged.autoDowngradeOnPowerSave);
  merged.respectModifierClicks = Boolean(merged.respectModifierClicks);
  merged.debugLogging = Boolean(merged.debugLogging);
  merged.uiLang = normalizeLang(merged.uiLang);

  // —— 谷歌识图 ——
  merged.enableImageSearch = Boolean(merged.enableImageSearch);
  const dwell = Number(merged.imageSearchDwellMs);
  merged.imageSearchDwellMs =
    Number.isFinite(dwell) && dwell >= 120 && dwell <= 2000
      ? Math.round(dwell)
      : DEFAULT_SETTINGS.imageSearchDwellMs;
  const minSize = Number(merged.imageSearchMinSize);
  merged.imageSearchMinSize =
    Number.isFinite(minSize) && minSize >= 24 && minSize <= 400
      ? Math.round(minSize)
      : DEFAULT_SETTINGS.imageSearchMinSize;
  if (
    !["badge", "alt_right", "right", "left", "both"].includes(
      merged.imageSearchTrigger,
    )
  ) {
    merged.imageSearchTrigger = DEFAULT_SETTINGS.imageSearchTrigger;
  }
  if (!["popup", "tab"].includes(merged.imageSearchOpenMode)) {
    merged.imageSearchOpenMode = DEFAULT_SETTINGS.imageSearchOpenMode;
  }
  if (!["lens", "google_images"].includes(merged.imageSearchEngine)) {
    merged.imageSearchEngine = DEFAULT_SETTINGS.imageSearchEngine;
  }

  if (typeof merged.warmEntryUrl !== "string" || !merged.warmEntryUrl) {
    merged.warmEntryUrl = DEFAULT_SETTINGS.warmEntryUrl;
  }

  if (!Array.isArray(merged.excludedHostSuffixes)) {
    merged.excludedHostSuffixes = [];
  }

  return merged;
}

/**
 * 一键应用档位（含 TTL 预设）
 * @param {typeof DEFAULT_SETTINGS} settings
 * @param {"eco"|"balanced"|"fast"|"turbo"} profileId
 */
export function applyWarmupProfile(settings, profileId) {
  const profile = WARMUP_PROFILES[profileId];
  if (!profile) return normalizeSettings(settings);
  return normalizeSettings({
    ...settings,
    warmupProfile: profileId,
    enableL1Preconnect: profile.enableL1Preconnect,
    enableL2Hover: profile.enableL2Hover,
    allowBackgroundWarmTab: profile.allowBackgroundWarmTab,
    autoWarmOnLinks: profile.autoWarmOnLinks,
    autoWarmOnHover: profile.autoWarmOnHover,
    turboTtlMinutes:
      profile.ttlMinutes ??
      settings.turboTtlMinutes ??
      DEFAULT_SETTINGS.turboTtlMinutes,
  });
}

export async function getSettings() {
  const data = await chrome.storage.sync.get(STORAGE_KEYS.SETTINGS);
  return normalizeSettings(data[STORAGE_KEYS.SETTINGS] || {});
}

function clampTtl(v, fallback = DEFAULT_SETTINGS.turboTtlMinutes) {
  let ttl = Number(v);
  if (!Number.isFinite(ttl) || ttl < 1) ttl = fallback;
  if (ttl > 60) ttl = 60;
  return Math.round(ttl);
}

const PERSIST_FLAGS = {
  _perfV3: true,
  _ttl20: true,
  _ttl30: true,
  _balanceV5: true,
  _imgBadgeV1: true,
};

/**
 * 档位仍是 0.5.32 及更早的预设 TTL 时，上调一档。
 * 用户手动改过的值（与当时档位预设不同）一律保留。
 * @param {object} raw
 */
function bumpLegacyProfileTtl(raw) {
  const profile = raw.warmupProfile || "balanced";
  const oldPreset = LEGACY_PROFILE_TTL[profile];
  const nextPreset = WARMUP_PROFILES[profile]?.ttlMinutes;
  const ttl = Number(raw.turboTtlMinutes);
  if (
    Number.isFinite(ttl) &&
    oldPreset != null &&
    nextPreset != null &&
    ttl === oldPreset
  ) {
    return { ...raw, turboTtlMinutes: nextPreset };
  }
  return raw;
}

/**
 * 迁移链：
 * - _balanceV5：从过保守的 perf 默认回到「有链接就暖壳」
 * - _ttl30：档位仍是旧预设时 TTL 上调一档；手动改过的值保留
 * - 保留用户手动改过的 eco/turbo
 */
export async function migrateSettingsIfNeeded() {
  const data = await chrome.storage.sync.get(STORAGE_KEYS.SETTINGS);
  let raw = data[STORAGE_KEYS.SETTINGS];

  if (!raw || typeof raw !== "object") {
    const fresh = {
      ...DEFAULT_SETTINGS,
      ...PERSIST_FLAGS,
    };
    await chrome.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: fresh });
    return normalizeSettings(fresh);
  }

  let dirty = false;

  // 0.5.23：旧默认「拦截右键」会挡另存为，一次性改为 badge（不抢菜单）
  if (raw._imgBadgeV1 !== true) {
    raw = {
      ...raw,
      imageSearchTrigger:
        raw.imageSearchTrigger === "right" || !raw.imageSearchTrigger
          ? "badge"
          : raw.imageSearchTrigger,
      _imgBadgeV1: true,
    };
    dirty = true;
  }

  // 0.5.33：idle 与 TTL 对齐，档位预设上调一档
  if (raw._ttl30 !== true) {
    raw = { ...bumpLegacyProfileTtl(raw), _ttl30: true };
    dirty = true;
  }

  if (raw._balanceV5 === true) {
    if (dirty) {
      const patched = normalizeSettings(raw);
      await chrome.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: patched });
      return patched;
    }
    return normalizeSettings(raw);
  }

  const profile = raw.warmupProfile || "balanced";
  // 用户明确选省电：只抬 TTL，不强制开暖壳
  if (profile === "eco") {
    const next = normalizeSettings({
      ...raw,
      turboTtlMinutes: clampTtl(
        raw.turboTtlMinutes,
        DEFAULT_SETTINGS.turboTtlMinutes,
      ),
      ...PERSIST_FLAGS,
    });
    await chrome.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: next });
    return next;
  }

  // 识别已有档位，否则 balanced
  let targetProfile = "balanced";
  if (profile === "eco") targetProfile = "eco";
  else if (profile === "turbo") targetProfile = "turbo";
  else if (profile === "fast") targetProfile = "fast";
  else targetProfile = "balanced";

  const applied = applyWarmupProfile(
    {
      ...raw,
      debugLogging: Boolean(raw.debugLogging),
    },
    targetProfile,
  );

  // 若用户已有合理 TTL 则尽量保留，否则用档位默认
  let ttl = clampTtl(
    raw.turboTtlMinutes,
    applied.turboTtlMinutes || DEFAULT_SETTINGS.turboTtlMinutes,
  );
  if (!Number.isFinite(Number(raw.turboTtlMinutes))) {
    ttl = applied.turboTtlMinutes || DEFAULT_SETTINGS.turboTtlMinutes;
  }

  const final = normalizeSettings({
    ...applied,
    turboTtlMinutes: ttl,
    imageSearchTrigger: raw.imageSearchTrigger || "badge",
    ...PERSIST_FLAGS,
  });

  await chrome.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: final });
  return final;
}

/**
 * @param {Partial<typeof DEFAULT_SETTINGS>} patch
 * @param {{ asProfile?: "eco"|"balanced"|"turbo" }} [opts]
 */
export async function saveSettings(patch, opts = {}) {
  const data = await chrome.storage.sync.get(STORAGE_KEYS.SETTINGS);
  let stored = data[STORAGE_KEYS.SETTINGS] || {};
  const ttlBeforeBump = Number(stored.turboTtlMinutes);
  if (stored._ttl30 !== true) {
    stored = { ...bumpLegacyProfileTtl(stored), _ttl30: true };
  }
  const current = normalizeSettings(stored);
  let next = normalizeSettings({
    ...current,
    ...patch,
    ...PERSIST_FLAGS,
  });
  // 设置页若仍带着升级前的档位预设，不要把已上调的 TTL 写回去
  if (
    Number.isFinite(ttlBeforeBump) &&
    Number(patch.turboTtlMinutes) === ttlBeforeBump &&
    current.turboTtlMinutes !== ttlBeforeBump
  ) {
    next.turboTtlMinutes = current.turboTtlMinutes;
  }
  if (opts.asProfile) {
    next = applyWarmupProfile(next, opts.asProfile);
    next = normalizeSettings({
      ...next,
      ...PERSIST_FLAGS,
    });
  }
  await chrome.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: next });
  return next;
}

export async function resetSettings() {
  const fresh = {
    ...DEFAULT_SETTINGS,
    ...PERSIST_FLAGS,
  };
  await chrome.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: fresh });
  return normalizeSettings(fresh);
}
