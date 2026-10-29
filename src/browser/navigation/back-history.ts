/**
 * B6 #44 Long-press Back: the earlier pages of a tab, newest first, built from the WebView's own back/forward list
 * (`VidoraWeb.getWebViewHistory`). Reading the WebView's list instead of recording navigation events keeps what is
 * listed and what Back walks the same list — a recording drifts on page-driven history (`history.back()`,
 * `replaceState`, frames) and a tap would then land on another page than the one shown. Redirects never add an entry
 * (the WebView replaces it), a reload adds none, and each `pushState` adds one, exactly as Back sees them.
 *
 * A parked tab (its WebView unmounted to save memory, B1) has no list until it is shown again: Back then goes to the
 * start page as before. Pure.
 */

export type WebViewHistoryInput = {
  currentIndex: number;
  entries: readonly { url: string; title: string }[];
};

export type BackHistoryEntry = {
  /** Steps to pass to `goBackOrForward` (always negative). */
  steps: number;
  url: string;
  title: string;
};

export const BACK_HISTORY_LIMIT = 20;

/** Entries the user can't go back to in a meaningful way: the blank page a tab starts on, the start page, data. */
function isListable(url: string): boolean {
  const lower = url.trim().toLowerCase();
  if (!lower) return false;
  if (lower === 'about:blank' || lower.startsWith('vidorax://') || lower.startsWith('about:vidorax')) return false;
  return lower.startsWith('http://') || lower.startsWith('https://');
}

export function buildBackHistory(
  history: WebViewHistoryInput | null | undefined,
  limit: number = BACK_HISTORY_LIMIT,
): BackHistoryEntry[] {
  if (!history || !Array.isArray(history.entries)) return [];
  const current = Math.min(history.currentIndex, history.entries.length - 1);
  const out: BackHistoryEntry[] = [];
  for (let index = current - 1; index >= 0 && out.length < limit; index -= 1) {
    const entry = history.entries[index];
    if (!entry || typeof entry.url !== 'string' || !isListable(entry.url)) continue;
    // The same address twice in a row (an SPA pushing its own URL again) is listed once, at the nearer step.
    const previous = out[out.length - 1];
    if (previous && previous.url === entry.url) continue;
    out.push({
      steps: index - current,
      url: entry.url,
      title: typeof entry.title === 'string' ? entry.title.trim() : '',
    });
  }
  return out;
}
