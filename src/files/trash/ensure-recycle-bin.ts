/**
 * F13: installs the recycle bin at startup (src/bootstrap/app-initializer.ts):
 * - the library leaves trashed items out (`setLibraryExclusion`);
 * - the Downloads list's order drops them whenever it changes (the items themselves stay in the store, so a purge
 *   still finds everything the normal delete needs);
 * - items whose keep time is up are purged now and every 6 hours while the app runs.
 * Kept on `globalThis`, so a Fast Refresh replaces the hooks instead of adding second ones.
 */
import { setLibraryExclusion } from '@/library/assemble';
import { useDownloadsStore } from '@/store/downloads';

import { withoutTrashed } from './bin-model';
import { isTrashed, useBinStore } from './bin-store';
import { purgeExpiredBin } from './trash-api';

const SLOT = '__vidoraxRecycleBin';
const PURGE_EVERY_MS = 6 * 60 * 60 * 1000;

function hideTrashedFromDownloads(): void {
  const state = useDownloadsStore.getState();
  const next = withoutTrashed(state.orderedIds, useBinStore.getState().entries);
  if (next !== state.orderedIds) {
    useDownloadsStore.setState({
      orderedIds: [...next],
      total: Math.max(0, state.total - (state.orderedIds.length - next.length)),
    });
  }
}

export function ensureRecycleBin(): void {
  const slot = globalThis as unknown as Record<string, (() => void) | undefined>;
  slot[SLOT]?.();
  setLibraryExclusion(isTrashed);
  const unsubscribeDownloads = useDownloadsStore.subscribe(hideTrashedFromDownloads);
  const unsubscribeBin = useBinStore.subscribe(hideTrashedFromDownloads);
  hideTrashedFromDownloads();
  const timer = setInterval(() => {
    void purgeExpiredBin().catch(() => undefined);
  }, PURGE_EVERY_MS);
  void purgeExpiredBin().catch(() => undefined);
  slot[SLOT] = () => {
    unsubscribeDownloads();
    unsubscribeBin();
    clearInterval(timer);
  };
}
