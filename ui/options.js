import {
  DEFAULT_SETTINGS,
  WARMUP_PROFILES,
} from "../shared/constants.js";
import {
  getSettings,
  resetSettings,
  saveSettings,
} from "../shared/settings.js";
import {
  applyDomI18n,
  langToggleLabel,
  langToggleTitle,
  normalizeLang,
  otherLang,
  t,
} from "../shared/i18n.js";

const $ = (id) => document.getElementById(id);

/** @type {import("../shared/i18n.js").UiLang} */
let uiLang = "zh";
let langBusy = false;

function tr(key, vars) {
  return t(uiLang, key, vars);
}

function paintLangToggle() {
  const btn = $("btnLangToggle");
  if (!btn) return;
  btn.textContent = langToggleLabel(uiLang);
  btn.title = langToggleTitle(uiLang);
  btn.setAttribute("aria-label", langToggleTitle(uiLang));
}

function paintTtlOptions() {
  const sel = $("turboTtlMinutes");
  if (!sel) return;
  const cur = sel.value;
  const specs = [
    { v: "1", key: "opt.ttl.opt", n: 1 },
    { v: "3", key: "opt.ttl.opt", n: 3 },
    { v: "5", key: "opt.ttl.opt", n: 5 },
    { v: "10", key: "opt.ttl.opt", n: 10 },
    { v: "20", key: "opt.ttl.20" },
    { v: "30", key: "opt.ttl.30" },
    { v: "45", key: "opt.ttl.45" },
    { v: "60", key: "opt.ttl.60" },
  ];
  for (const opt of sel.options) {
    const spec = specs.find((s) => s.v === opt.value);
    if (!spec) continue;
    opt.textContent =
      spec.n != null ? tr(spec.key, { n: spec.n }) : tr(spec.key);
  }
  sel.value = cur;
}

function applyPageI18n() {
  applyDomI18n(document, uiLang);
  paintLangToggle();
  paintTtlOptions();
  document.title = tr("opt.title");
  const profileId = $("warmupProfile")?.value || "balanced";
  if ($("profileHint")) {
    $("profileHint").textContent = tr(`opt.hint.${profileId}`);
  }
}

function fillForm(settings) {
  if (settings?.uiLang) {
    uiLang = normalizeLang(settings.uiLang);
  }
  applyPageI18n();

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

  $("enableImageSearch").checked = settings.enableImageSearch;
  $("imageSearchDwellMs").value = String(settings.imageSearchDwellMs);
  $("imageSearchMinSize").value = String(settings.imageSearchMinSize);
  $("imageSearchTrigger").value = settings.imageSearchTrigger;
  $("imageSearchOpenMode").value = settings.imageSearchOpenMode;
  $("imageSearchEngine").value = settings.imageSearchEngine;

  $("excludedHostSuffixes").value = (settings.excludedHostSuffixes || []).join(
    ", ",
  );
  $("profileHint").textContent = tr(`opt.hint.${settings.warmupProfile}`);
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
    enableImageSearch: $("enableImageSearch").checked,
    imageSearchDwellMs: Number($("imageSearchDwellMs").value),
    imageSearchMinSize: Number($("imageSearchMinSize").value),
    imageSearchTrigger: $("imageSearchTrigger").value,
    imageSearchOpenMode: $("imageSearchOpenMode").value,
    imageSearchEngine: $("imageSearchEngine").value,
    excludedHostSuffixes: excluded,
    uiLang,
  };
}

$("btnLangToggle")?.addEventListener("click", async () => {
  if (langBusy) return;
  langBusy = true;
  const btn = $("btnLangToggle");
  if (btn) btn.disabled = true;
  try {
    const next = otherLang(uiLang);
    // 保留表单其它未保存改动，只切语言
    const patch = { ...readForm(), uiLang: next };
    uiLang = next;
    await saveSettings(patch);
    applyPageI18n();
    // 重新应用 option 文案后恢复 select 当前值
    fillForm(await getSettings());
  } catch {
    // ignore
  } finally {
    langBusy = false;
    if (btn) btn.disabled = false;
  }
});

$("warmupProfile").addEventListener("change", () => {
  const profileId = $("warmupProfile").value;
  const profile = WARMUP_PROFILES[profileId];
  if (!profile) return;
  $("enableL1Preconnect").checked = profile.enableL1Preconnect;
  $("enableL2Hover").checked = profile.enableL2Hover;
  $("allowBackgroundWarmTab").checked = profile.allowBackgroundWarmTab;
  $("autoWarmOnLinks").checked = profile.autoWarmOnLinks;
  $("autoWarmOnHover").checked = profile.autoWarmOnHover;
  $("profileHint").textContent = tr(`opt.hint.${profileId}`);
});

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await saveSettings(readForm());
  const msg = $("saveMsg");
  msg.hidden = false;
  msg.textContent = tr("opt.saved");
  window.setTimeout(() => {
    msg.hidden = true;
  }, 1600);
});

$("btnReset").addEventListener("click", async () => {
  // 恢复功能默认，但保留当前 UI 语言
  const fresh = await resetSettings();
  const kept = await saveSettings({ ...fresh, uiLang });
  fillForm(kept);
  const msg = $("saveMsg");
  msg.hidden = false;
  msg.textContent = tr("opt.resetOk");
  window.setTimeout(() => {
    msg.hidden = true;
    msg.textContent = tr("opt.saved");
  }, 1600);
});

applyPageI18n();
getSettings().then(fillForm);
