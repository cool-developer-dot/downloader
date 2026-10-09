import type { BrowserHistoryEntry } from '@/storage/types';

import type { HistoryState } from './types';

function mergeVisitIntoItems(items: BrowserHistoryEntry[], entry: BrowserHistoryEntry): BrowserHistoryEntry[] {
  const withoutSame = items.filter((item) => item.id !== entry.id && item.url !== entry.url);
  return [entry, ...withoutSame];
}

/**
 * A visit recorded while browsing goes to the top of the list. It is not a loaded history: `initialized` stays for
 * `load` to set, or the History screen would show only this session's visits and never read the stored ones.
 */
export function reducePrependVisit(
  state: Pick<HistoryState, 'items' | 'total'>,
  entry: BrowserHistoryEntry,
): Pick<HistoryState, 'items' | 'total' | 'error'> {
  const existed = state.items.some((item) => item.id === entry.id || item.url === entry.url);
  return {
    items: mergeVisitIntoItems(state.items, entry),
    total: existed ? state.total : state.total + 1,
    error: null,
  };
}
