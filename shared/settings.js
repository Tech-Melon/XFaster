/**
 * 设置读写 — v0.5.5 均衡折中迁移
 */
import {
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  WARMUP_PROFILES,
} from "./constants.js";

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
    turboTtlMinutes: profile.ttlMinutes ?? settings.turboTtlMinutes ?? 20,
  });
}

export async function getSettings() {
  const data = await chrome.storage.sync.get(STORAGE_KEYS.SETTINGS);
  return normalizeSettings(data[STORAGE_KEYS.SETTINGS] || {});
}

function clampTtl(v, fallback = 20) {
  let ttl = Number(v);
  if (!Number.isFinite(ttl) || ttl < 1) ttl = fallback;
  if (ttl > 60) ttl = 60;
  return Math.round(ttl);
}

/**
 * 迁移链：
 * - _balanceV5：从过保守的 perf 默认回到「有链接就暖壳」
 * - 保留用户手动改过的 eco/turbo
 */
export async function migrateSettingsIfNeeded() {
  const data = await chrome.storage.sync.get(STORAGE_KEYS.SETTINGS);
  let raw = data[STORAGE_KEYS.SETTINGS];

  if (!raw || typeof raw !== "object") {
    const fresh = {
      ...DEFAULT_SETTINGS,
      _perfV3: true,
      _ttl20: true,
      _balanceV5: true,
      _imgBadgeV1: true,
    };
    await chrome.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: fresh });
    return normalizeSettings(fresh);
  }

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
    // 已完成 balance 迁移的用户：只写回识图触发，直接返回
    if (raw._balanceV5 === true) {
      const patched = normalizeSettings(raw);
      await chrome.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: patched });
      return patched;
    }
  }

  if (raw._balanceV5 === true) {
    return normalizeSettings(raw);
  }

  const profile = raw.warmupProfile || "balanced";
  // 用户明确选省电：只抬 TTL，不强制开暖壳
  if (profile === "eco") {
    const next = normalizeSettings({
      ...raw,
      turboTtlMinutes: clampTtl(raw.turboTtlMinutes, 20),
      _perfV3: true,
      _ttl20: true,
      _balanceV5: true,
      _imgBadgeV1: true,
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
  let ttl = clampTtl(raw.turboTtlMinutes, applied.turboTtlMinutes || 20);
  if (!Number.isFinite(Number(raw.turboTtlMinutes))) {
    ttl = applied.turboTtlMinutes || 20;
  }

  const final = normalizeSettings({
    ...applied,
    turboTtlMinutes: ttl,
    imageSearchTrigger: raw.imageSearchTrigger || "badge",
    _perfV3: true,
    _ttl20: true,
    _balanceV5: true,
    _imgBadgeV1: true,
  });

  await chrome.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: final });
  return final;
}

/**
 * @param {Partial<typeof DEFAULT_SETTINGS>} patch
 * @param {{ asProfile?: "eco"|"balanced"|"turbo" }} [opts]
 */
export async function saveSettings(patch, opts = {}) {
  const current = await getSettings();
  let next = normalizeSettings({
    ...current,
    ...patch,
    _perfV3: true,
    _ttl20: true,
    _balanceV5: true,
  });
  if (opts.asProfile) {
    next = applyWarmupProfile(next, opts.asProfile);
    next = normalizeSettings({
      ...next,
      _perfV3: true,
      _ttl20: true,
      _balanceV5: true,
    });
  }
  await chrome.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: next });
  return next;
}

export async function resetSettings() {
  const fresh = {
    ...DEFAULT_SETTINGS,
    _perfV3: true,
    _ttl20: true,
    _balanceV5: true,
  };
  await chrome.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: fresh });
  return normalizeSettings(fresh);
}
