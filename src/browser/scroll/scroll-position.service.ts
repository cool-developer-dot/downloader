import type WebView from 'react-native-webview';

import {
  getPersistedScrollForUrl,
  isRestorableBrowserUrl,
  updatePersistedScrollPosition,
} from '@/browser/session';

/** In-memory scroll offsets keyed by normalized URL (active session). */
const scrollByUrl = new Map<string, number>();

/** Guards against repeated restore injects for the same navigation epoch + URL. */
let restoreKey: string | null = null;

/** Pending restore inject — cancelled on navigation / unmount guard reset. */
let restoreTimer: ReturnType<typeof setTimeout> | null = null;

const RESTORE_SETTLE_MS = 48;

function normalizeKey(url: string): string {
  return url.trim();
}

function cancelRestoreTimer(): void {
  if (restoreTimer) {
    clearTimeout(restoreTimer);
    restoreTimer = null;
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

  /** Invalidate restore guard so the next successful load can restore again. */
  resetRestoreGuard(): void {
    restoreKey = null;
    cancelRestoreTimer();
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
  }): void {
    const { webView, url, epoch } = options;
    if (!webView || !isRestorableBrowserUrl(url)) {
      return;
    }

    const y = options.scrollY ?? scrollPositionService.get(url);
    if (y <= 0) {
      return;
    }

    const key = `${epoch}:${normalizeKey(url)}`;
    if (restoreKey === key) {
      return;
    }
    restoreKey = key;

    const targetY = Math.round(y);

    cancelRestoreTimer();
    restoreTimer = setTimeout(() => {
      restoreTimer = null;
      // Stale navigation superseded this restore — do not inject.
      if (restoreKey !== key) {
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
