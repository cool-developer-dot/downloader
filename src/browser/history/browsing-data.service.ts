import { BackHandler } from 'react-native';

import { scrollPositionService } from '@/browser/scroll';
import { resetHistoryRecordingGuards } from '@/browser/services/history-recording.service';
import { clearPersistedBrowserSession } from '@/browser/session';
import { useBrowserStore } from '@/browser/stores';
import { closedTabsService } from '@/browser/tabs/closed-tabs.service';
import { tabSnapshots } from '@/browser/tabs/tab-snapshots';
import { tabUndo } from '@/browser/tabs/tab-undo';
import { browsingDataRepository, type BrowsingDataCleared } from '@/storage/repositories';
import { useHistoryStore } from '@/store/history';
import { useRecentSearchesStore } from '@/store/recent-searches';
import { useSettingsStore } from '@/store/settings';

import { rangeStartMs, type BrowsingDataRange } from './browsing-data-range';

/**
 * B10 #98 / #99 — Clear browsing data, for the browser profile in use: history (with the recent URLs the address bar
 * suggests), recent searches, recently closed tabs and tab previews. Faran's site data joins through
 * `bindSiteDataClearer`.
 */

/**
 * The one hook for cookies, cache and site data (B12). Nothing is bound today, so those stay. B12's
 * `clearAllSiteData()` (`src/browser/privacy/privacy.service.ts`) clears every site's cookies and storage of the
 * active profile; bind it (or a ranged version) here and Clear browsing data, Clear on exit and Exit all use it.
 * `sinceMs` is the range's start, null for "All time".
 */
export type SiteDataClearer = (sinceMs: number | null) => Promise<void>;

let siteDataClearer: SiteDataClearer | null = null;

export function bindSiteDataClearer(clearer: SiteDataClearer | null): void {
  siteDataClearer = clearer;
}

/** Whether Clear browsing data also clears cookies, cache and site data (shown in the sheet). */
export function clearsSiteData(): boolean {
  return siteDataClearer != null;
}

export type BrowsingDataClearOutcome = BrowsingDataCleared & { closedTabsCleared: boolean; siteDataCleared: boolean };

export async function clearBrowsingData(
  range: BrowsingDataRange,
  nowMs: number = Date.now(),
): Promise<BrowsingDataClearOutcome> {
  const since = rangeStartMs(range, nowMs);
  const cleared = await browsingDataRepository.deleteSince(since == null ? null : new Date(since).toISOString());

  if (since == null) closedTabsService.clear();
  else closedTabsService.clearSince(since);
  // Previews are a cache of what tabs showed: all go, whatever the range (a tab's next preview is taken when it is left).
  tabSnapshots.clearAll();
  // The saved session (last page, last successful page, per-page scroll positions) is browsing data too, and a start
  // page in front would otherwise reload the last page at the next start (after Exit, say).
  clearPersistedBrowserSession();
  scrollPositionService.clear();

  let siteDataCleared = false;
  if (siteDataClearer) {
    try {
      await siteDataClearer(since);
      siteDataCleared = true;
    } catch {
      // The rest is cleared; site data stays.
    }
  }

  resetHistoryRecordingGuards();
  refreshAfterClear();
  return { ...cleared, closedTabsCleared: true, siteDataCleared };
}

function refreshAfterClear(): void {
  try {
    const history = useHistoryStore.getState();
    if (history.initialized) void history.load(1);
    else history.reset();
  } catch {
    // ignore
  }
  try {
    const searches = useRecentSearchesStore.getState();
    void searches.refresh();
  } catch {
    // ignore
  }
  void import('@/browser/suggestions')
    .then(({ suggestionService }) => suggestionService.invalidate())
    .catch(() => undefined);
}

let startupClearRan = false;

/**
 * #99: with "Clear history on exit" on, the data of the last session is cleared at the next cold start (the app can be
 * closed in ways that run no code: swiped away, force-stopped). Runs once per process, from app start.
 */
export async function runStartupBrowsingDataClear(): Promise<boolean> {
  if (startupClearRan) return false;
  startupClearRan = true;
  if (useSettingsStore.getState().clearHistoryOnExit !== true) return false;
  await clearBrowsingData('all');
  return true;
}

/**
 * #99 Menu → Exit (shown while "Clear history on exit" is on): closes every tab (pinned too, no Undo), clears all
 * browsing data and leaves the app.
 */
export async function exitBrowser(): Promise<void> {
  try {
    useBrowserStore.getState().closeAllTabs({ includePinned: true });
    tabUndo.dismiss();
  } catch {
    // Still clear and leave.
  }
  try {
    await clearBrowsingData('all');
  } finally {
    BackHandler.exitApp();
  }
}
