import type WebView from 'react-native-webview';

import {
  getPersistedScrollForUrl,
  isRestorableBrowserUrl,
  updatePersistedScrollPosition,
} from '@/browser/session';

/** In-memory scroll offsets keyed by normalized URL (active session). */
const scrollByUrl = new Map<string, number>();

/**
 * Per-tab restore state.
 *
 * A single module-level timer was shared by every mounted WebView: tab B's load
 * cancelled tab A's pending restore, and a timer could still fire an
 * injectJavaScript into a WebView that had already been evicted.
 */
type RestoreEntry = {
  key: string | null;
  timer: ReturnType<typeof setTimeout> | null;
};

const DEFAULT_TAB_SCOPE = '__active__';
const restoreByTab = new Map<string, RestoreEntry>();

const RESTORE_SETTLE_MS = 48;

function normalizeKey(url: string): string {
  return url.trim();
}

function scopeFor(tabId?: string | null): string {
  return tabId?.trim() || DEFAULT_TAB_SCOPE;
}

function entryFor(scope: string): RestoreEntry {
  let entry = restoreByTab.get(scope);
  if (!entry) {
    entry = { key: null, timer: null };
    restoreByTab.set(scope, entry);
  }
  return entry;
}

function cancelRestoreTimer(entry: RestoreEntry): void {
  if (entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
}

export const scrollPositionService = {
  remember(url: string, scrollY: number): void {
    if (!isRestorableBrowserUrl(url)) {
      return;
    }
    const y = Math.max(0, Math.round(scrollY));
    scrollByUrl.set(normalizeKey(url), y);
    updatePersistedScrollPosition(url, y);
  },

  get(url: string): number {
    if (!isRestorableBrowserUrl(url)) {
      return 0;
    }
    const key = normalizeKey(url);
    if (scrollByUrl.has(key)) {
      return scrollByUrl.get(key) ?? 0;
    }
    const persisted = getPersistedScrollForUrl(url);
    if (persisted > 0) {
      scrollByUrl.set(key, persisted);
    }
    return persisted;
  },

  seed(url: string, scrollY: number): void {
    if (!isRestorableBrowserUrl(url)) {
      return;
    }
    scrollByUrl.set(normalizeKey(url), Math.max(0, Math.round(scrollY)));
  },

  /** Hydrate in-memory map from durable scroll LRU (cold start). */
  hydrateFromPersisted(positions: Record<string, number> | undefined): void {
    if (!positions) {
      return;
    }
    for (const [url, y] of Object.entries(positions)) {
      if (isRestorableBrowserUrl(url) && typeof y === 'number' && y > 0) {
        scrollByUrl.set(normalizeKey(url), Math.round(y));
      }
    }
  },

  clear(url?: string): void {
    if (url) {
      scrollByUrl.delete(normalizeKey(url));
      return;
    }
    scrollByUrl.clear();
  },

  /**
   * Invalidate the restore guard so the next successful load can restore again.
   * Scoped to one tab when a tabId is given; otherwise every tab.
   */
  resetRestoreGuard(tabId?: string | null): void {
    if (tabId) {
      const entry = entryFor(scopeFor(tabId));
      entry.key = null;
      cancelRestoreTimer(entry);
      return;
    }
    for (const entry of restoreByTab.values()) {
      entry.key = null;
      cancelRestoreTimer(entry);
    }
  },

  /**
   * Drop a tab's pending restore entirely — its WebView is going away
   * (eviction, tab close, browser unmount), so the inject must never fire.
   */
  cancelRestore(tabId?: string | null): void {
    const scope = scopeFor(tabId);
    const entry = restoreByTab.get(scope);
    if (!entry) {
      return;
    }
    cancelRestoreTimer(entry);
    entry.key = null;
    restoreByTab.delete(scope);
  },

  /**
   * Restores scroll after the document has fully loaded.
   * Idempotent per (epoch, url) — avoids jumpy multi-restores.
   * Timer is cancelled if a newer navigation resets the guard.
   */
  scheduleRestore(options: {
    webView: WebView | null | undefined;
    url: string;
    epoch: number;
    scrollY?: number;
    /** Owning tab — keeps one tab's restore from cancelling another's. */
    tabId?: string | null;
  }): void {
    const { webView, url, epoch } = options;
    if (!webView || !isRestorableBrowserUrl(url)) {
      return;
    }

    const y = options.scrollY ?? scrollPositionService.get(url);
    if (y <= 0) {
      return;
    }

    const scope = scopeFor(options.tabId);
    const entry = entryFor(scope);
    const key = `${epoch}:${normalizeKey(url)}`;
    if (entry.key === key) {
      return;
    }
    entry.key = key;

    const targetY = Math.round(y);

    cancelRestoreTimer(entry);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      // Stale navigation superseded this restore — do not inject.
      if (entry.key !== key || restoreByTab.get(scope) !== entry) {
        return;
      }

      webView.injectJavaScript(
        `(function(){
  try {
    var y = ${targetY};
    if (!Number.isFinite(y) || y <= 0) { return true; }
    var max = Math.max(
      0,
      (document.documentElement && document.documentElement.scrollHeight) || 0,
      (document.body && document.body.scrollHeight) || 0
    ) - (window.innerHeight || 0);
    if (max > 0) { y = Math.min(y, max); }
    window.scrollTo({ top: y, left: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  } catch (e) {
    try { window.scrollTo(0, ${targetY}); } catch (e2) {}
  }
  true;
})();`,
      );
    }, RESTORE_SETTLE_MS);
  },
} as const;
