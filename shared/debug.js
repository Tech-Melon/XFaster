/**
 * 调试日志：默认关闭（v0.5.3）
 * 开启 settings.debugLogging 后才写 session / console
 */
import { STORAGE_KEYS } from "./constants.js";
import { getSettings } from "./settings.js";

const DEBUG_KEY = "debugLog";
const MAX_LINES = 40;

/** 进程内缓存，避免每条日志都读 settings */
let cachedEnabled = null;
let cacheAt = 0;
const CACHE_MS = 5000;

async function isEnabled() {
  const now = Date.now();
  if (cachedEnabled != null && now - cacheAt < CACHE_MS) {
    return cachedEnabled;
  }
  try {
    const s = await getSettings();
    cachedEnabled = Boolean(s.debugLogging);
  } catch {
    cachedEnabled = false;
  }
  cacheAt = now;
  return cachedEnabled;
}

/** 设置变更时清缓存 */
export function invalidateDebugCache() {
  cachedEnabled = null;
  cacheAt = 0;
}

/**
 * @param {string} tag
 * @param {string} message
 * @param {unknown} [detail]
 */
export async function debugLog(tag, message, detail) {
  if (!(await isEnabled())) return null;

  const line = {
    t: Date.now(),
    tag,
    message,
    detail:
      detail === undefined
        ? null
        : typeof detail === "string"
          ? detail
          : safeJson(detail),
  };

  const prefix = `[XFaster][${tag}] ${message}`;
  if (detail !== undefined) {
    console.log(prefix, detail);
  } else {
    console.log(prefix);
  }

  try {
    const data = await chrome.storage.session.get(DEBUG_KEY);
    const list = Array.isArray(data[DEBUG_KEY]) ? data[DEBUG_KEY] : [];
    list.push(line);
    while (list.length > MAX_LINES) list.shift();
    await chrome.storage.session.set({ [DEBUG_KEY]: list });
  } catch {
    // ignore
  }

  return line;
}

export async function getDebugLog() {
  try {
    const data = await chrome.storage.session.get(DEBUG_KEY);
    return Array.isArray(data[DEBUG_KEY]) ? data[DEBUG_KEY] : [];
  } catch {
    return [];
  }
}

export async function clearDebugLog() {
  try {
    await chrome.storage.session.remove(DEBUG_KEY);
  } catch {
    // ignore
  }
}

function safeJson(v) {
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return String(v);
  }
}

void STORAGE_KEYS;
