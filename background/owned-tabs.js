/** 扩展自己创建/接管的标签，避免导航捕获二次劫持 */
const ownedTabIds = new Set();

/**
 * @param {number} tabId
 */
export function markOwnedTab(tabId) {
  if (typeof tabId === "number") {
    ownedTabIds.add(tabId);
    if (ownedTabIds.size > 80) {
      const first = ownedTabIds.values().next().value;
      ownedTabIds.delete(first);
    }
  }
}

/**
 * @param {number} tabId
 */
export function unmarkOwnedTab(tabId) {
  ownedTabIds.delete(tabId);
}

/**
 * @param {number} tabId
 */
export function isOwnedTab(tabId) {
  return ownedTabIds.has(tabId);
}
