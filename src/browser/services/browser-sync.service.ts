import { BROWSER_HOMEPAGE } from '@/browser/constants';
import { suggestionService } from '@/browser/suggestions';
import {
  flushBrowserSessionPersistence,
  getCachedBrowserSession,
  isRestorableBrowserUrl,
  persistBrowserSession,
} from '@/browser/session';
import { scrollPositionService } from '@/browser/scroll';
import { isBrowserHomeUrl } from '@/browser/utils';
import { useBookmarksStore } from '@/store/bookmarks';
import { useHistoryStore } from '@/store/history';

/**
 * Central browser domain synchronization.
 * Keeps session persistence + sibling stores coherent without duplicating state.
 * Future Download Manager plugs in here as another observer.
 */
export const browserSyncService = {
  /** Successful document commit — persist session continuity. */
  onSuccessfulPage(url: string, title: string): void {
    if (isBrowserHomeUrl(url)) {
      persistBrowserSession({ url, title: '', successful: false, scrollY: 0 });
      return;
    }

    persistBrowserSession({
      url,
      title,
      scrollY: scrollPositionService.get(url),
      successful: true,
    });
  },

  onNavigate(url: string, title?: string): void {
    if (isBrowserHomeUrl(url)) {
      persistBrowserSession({ url, successful: false, scrollY: 0 });
      scrollPositionService.resetRestoreGuard();
      return;
    }

    persistBrowserSession({
      url,
      title,
      scrollY: scrollPositionService.get(url),
      successful: false,
    });
    scrollPositionService.resetRestoreGuard();
  },

  onScroll(url: string, scrollY: number): void {
    scrollPositionService.remember(url, scrollY);
  },

  onError(): void {
    // Failed navigations must not become restore targets — revert session URL
    // to the last successful page (or home) before flushing.
    const session = getCachedBrowserSession();
    const fallbackUrl = session?.lastSuccessfulUrl;

    if (fallbackUrl && isRestorableBrowserUrl(fallbackUrl)) {
      persistBrowserSession({
        url: fallbackUrl,
        title: session?.lastSuccessfulTitle ?? '',
        scrollY:
          session?.scrollPositions[fallbackUrl] ?? session?.scrollY ?? 0,
        successful: false,
      });
    } else {
      persistBrowserSession({
        url: BROWSER_HOMEPAGE,
        title: '',
        scrollY: 0,
        successful: false,
      });
    }

    flushBrowserSessionPersistence();
  },

  onGoHome(): void {
    persistBrowserSession({
      url: BROWSER_HOMEPAGE,
      title: '',
      scrollY: 0,
      successful: false,
    });
    scrollPositionService.resetRestoreGuard();
  },

  /** Flush durable state when app backgrounds. */
  onAppBackground(): void {
    flushBrowserSessionPersistence();
  },

  /**
   * Lightweight coherence check after history writes.
   * Bookmarks / history remain source of truth in their own stores.
   */
  invalidateSuggestionIntelligence(): void {
    suggestionService.invalidate();
  },

  /** Expose store handles for future download/tab observers — no duplication. */
  getHistoryStore: () => useHistoryStore.getState(),
  getBookmarksStore: () => useBookmarksStore.getState(),
} as const;
