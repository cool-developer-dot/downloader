/**
 * Cross-screen browser navigation intent.
 * History (and other surfaces) set a URL here, then navigate to the Browser tab.
 * BrowserScreen consumes the pending URL once the target tab's controller is ready.
 *
 * Pending intents are bound to a targetTabId so a tab switch cannot load
 * Tab A's URL into Tab B's WebView.
 */
import { navigationService } from '@/browser/services/navigation.service';
import { isBrowserHomeUrl } from '@/browser/utils';

export type PendingNavigation = {
  url: string;
  /** Tab that must receive this load — captured at set() time. */
  targetTabId: string;
  /** Monotonic id so a superseded intent cannot be double-consumed. */
  requestId: number;
};

let pending: PendingNavigation | null = null;
let nextRequestId = 1;

export const pendingNavigationService = {
  set(url: string, options?: { targetTabId?: string }): void {
    const trimmed = url.trim();
    if (!trimmed) {
      pending = null;
      return;
    }

    // Only queue URLs the in-app WebView is allowed to open.
    if (!isBrowserHomeUrl(trimmed) && !navigationService.shouldHandleInBrowser(trimmed)) {
      return;
    }

    const targetTabId = options?.targetTabId?.trim();
    if (!targetTabId) {
      // Caller must bind a tab — refuse unbound "any controller" intents.
      return;
    }

    pending = {
      url: trimmed,
      targetTabId,
      requestId: nextRequestId++,
    };
  },

  peek(): PendingNavigation | null {
    return pending;
  },

  /**
   * Consume only if the peeked requestId still matches (one-shot, no races).
   * Returns null if already consumed or superseded.
   */
  consume(requestId?: number): PendingNavigation | null {
    if (!pending) {
      return null;
    }
    if (requestId != null && pending.requestId !== requestId) {
      return null;
    }
    const value = pending;
    pending = null;
    return value;
  },

  /** @deprecated Prefer peek() + consume(requestId). */
  take(): string | null {
    const value = pending?.url ?? null;
    pending = null;
    return value;
  },

  clear(): void {
    pending = null;
  },
} as const;
