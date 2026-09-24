import { isSameDocumentUrl } from '../utils/url';

export type DetectionNavigationMark = {
  url: string | null;
  epoch: number | null;
  /** Owning browser tab — epochs are per-tab counters and collide across tabs. */
  tabId?: string | null;
};

/**
 * Detection (re)starts for a new document, for a new navigation epoch on the same document (reload, loading
 * the same URL again), and whenever the owning tab changes. Native request scopes are bound to the tab AND to
 * that tab's epoch, so an engine left on the previous mark rejects every network observation as STALE_TAB /
 * STALE_GENERATION. Because each tab counts its own epochs from zero, two tabs showing the same page routinely
 * share an epoch number — without the tab id a switch between them silently kept the previous tab's detection
 * session alive. Same tab, same document and same epoch (hash, tracking-query or trailing-slash changes) keep
 * the running detection.
 */
export function needsDetectionNavigationStart(
  previous: DetectionNavigationMark,
  next: { url: string; epoch: number; tabId?: string | null },
): boolean {
  const previousTabId = previous.tabId ?? null;
  const nextTabId = next.tabId ?? null;
  if (previousTabId !== nextTabId) {
    return true;
  }
  return previous.epoch !== next.epoch || !isSameDocumentUrl(previous.url, next.url);
}
