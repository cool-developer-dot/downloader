/**
 * Which native view tag each tab's WebView has right now (the RNCWebViewWrapper tag VidoraWeb's calls take). Kept by
 * BrowserWebView when it binds its native scope; read by features that call VidoraWeb for one tab (B1's tab preview,
 * later page-display setters). A tab without a mounted WebView has no entry.
 */

const tagsByTab = new Map<string, number>();

export function setTabWebViewTag(tabId: string, viewTag: number): void {
  tagsByTab.set(tabId, viewTag);
}

/** Forgets the tag only when it is still the one this WebView registered (a remount may have replaced it). */
export function clearTabWebViewTag(tabId: string, viewTag: number | null): void {
  if (viewTag == null || tagsByTab.get(tabId) === viewTag) {
    tagsByTab.delete(tabId);
  }
}

export function getTabWebViewTag(tabId: string): number | null {
  return tagsByTab.get(tabId) ?? null;
}
