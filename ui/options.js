import {
  DEFAULT_SETTINGS,
  WARMUP_PROFILES,
} from "../shared/constants.js";
import {
  getSettings,
  resetSettings,
  saveSettings,
} from "../shared/settings.js";

const $ = (id) => document.getElementById(id);

const PROFILE_HINTS = {
  eco: "节能：几乎无后台，不暖壳。最省内存。",
  balanced:
    "均衡（默认）：有推特链接时暖 1 壳，TTL 20 分钟。不悬停预热。",
  fast: "快速：暖壳 + 悬停意图检测，TTL 30 分钟。比均衡更积极。",
  turbo: "极速：暖壳 + 悬停预热，TTL 45 分钟。最快也最占资源。",
};

function fillForm(settings) {
  $("openMode").value = settings.openMode;
  $("preferReuseXTab").checked = settings.preferReuseXTab;
  $("singleXTabMode").checked = settings.singleXTabMode;
  $("normalizeToXCom").checked = settings.normalizeToXCom;
  $("respectModifierClicks").checked = settings.respectModifierClicks;

  $("warmupProfile").value = settings.warmupProfile;
  $("turboTtlMinutes").value = String(settings.turboTtlMinutes);
  $("warmEntryUrl").value = settings.warmEntryUrl;
  $("allowBackgroundWarmTab").checked = settings.allowBackgroundWarmTab;
  $("autoWarmOnLinks").checked = settings.autoWarmOnLinks;
  $("autoWarmOnHover").checked = settings.autoWarmOnHover;
  $("enableL1Preconnect").checked = settings.enableL1Preconnect;
  $("enableL2Hover").checked = settings.enableL2Hover;
  $("hoverThresholdMs").value = String(settings.hoverThresholdMs);
  $("autoDowngradeOnPowerSave").checked = settings.autoDowngradeOnPowerSave;
  $("debugLogging").checked = settings.debugLogging;

  $("excludedHostSuffixes").value = (settings.excludedHostSuffixes || []).join(
    ", ",
  );
  $("profileHint").textContent = PROFILE_HINTS[settings.warmupProfile] || "";
}

function readForm() {
  const excluded = $("excludedHostSuffixes")
    .value.split(/[,，\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    openMode: $("openMode").value,
    preferReuseXTab: $("preferReuseXTab").checked,
    singleXTabMode: $("singleXTabMode").checked,
    normalizeToXCom: $("normalizeToXCom").checked,
    respectModifierClicks: $("respectModifierClicks").checked,

    warmupProfile: $("warmupProfile").value,
    turboTtlMinutes: Number($("turboTtlMinutes").value),
    warmEntryUrl:
      $("warmEntryUrl").value.trim() || DEFAULT_SETTINGS.warmEntryUrl,
    allowBackgroundWarmTab: $("allowBackgroundWarmTab").checked,
    autoWarmOnLinks: $("autoWarmOnLinks").checked,
    autoWarmOnHover: $("autoWarmOnHover").checked,
    enableL1Preconnect: $("enableL1Preconnect").checked,
    enableL2Hover: $("enableL2Hover").checked,
    hoverThresholdMs: Number($("hoverThresholdMs").value),
    autoDowngradeOnPowerSave: $("autoDowngradeOnPowerSave").checked,
    debugLogging: $("debugLogging").checked,
    excludedHostSuffixes: excluded,
  };
}

$("warmupProfile").addEventListener("change", () => {
  const profileId = $("warmupProfile").value;
  const profile = WARMUP_PROFILES[profileId];
  if (!profile) return;
  $("enableL1Preconnect").checked = profile.enableL1Preconnect;
  $("enableL2Hover").checked = profile.enableL2Hover;
  $("allowBackgroundWarmTab").checked = profile.allowBackgroundWarmTab;
  $("autoWarmOnLinks").checked = profile.autoWarmOnLinks;
  $("autoWarmOnHover").checked = profile.autoWarmOnHover;
  $("profileHint").textContent = PROFILE_HINTS[profileId] || "";
});

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await saveSettings(readForm());
  const msg = $("saveMsg");
  msg.hidden = false;
  msg.textContent = "已保存";
  window.setTimeout(() => {
    msg.hidden = true;
  }, 1600);
});

$("btnReset").addEventListener("click", async () => {
  const fresh = await resetSettings();
  fillForm(fresh);
  const msg = $("saveMsg");
  msg.hidden = false;
  msg.textContent = "已恢复默认（均衡折中）";
  window.setTimeout(() => {
    msg.hidden = true;
    msg.textContent = "已保存";
  }, 1600);
});

getSettings().then(fillForm);
