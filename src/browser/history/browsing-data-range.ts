/**
 * B10 #98 — the time ranges of Clear browsing data. Pure.
 */

export type BrowsingDataRange = 'hour' | 'day' | 'week' | 'fourWeeks' | 'all';

export const BROWSING_DATA_RANGES: readonly BrowsingDataRange[] = ['hour', 'day', 'week', 'fourWeeks', 'all'];

const HOUR_MS = 60 * 60 * 1000;

const RANGE_MS: Record<Exclude<BrowsingDataRange, 'all'>, number> = {
  hour: HOUR_MS,
  day: 24 * HOUR_MS,
  week: 7 * 24 * HOUR_MS,
  fourWeeks: 28 * 24 * HOUR_MS,
};

export function normalizeBrowsingDataRange(value: unknown): BrowsingDataRange {
  return BROWSING_DATA_RANGES.includes(value as BrowsingDataRange) ? (value as BrowsingDataRange) : 'hour';
}

/** The first moment the range covers (ms since 1970), or null for "All time". */
export function rangeStartMs(range: BrowsingDataRange, nowMs: number): number | null {
  if (range === 'all') return null;
  return nowMs - RANGE_MS[range];
}
