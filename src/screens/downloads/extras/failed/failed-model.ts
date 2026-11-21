/** Pure selectors for design 46 "Failed": the failed downloads, newest failure first, and the retry budget. */

import { AUTOMATIC_RETRY_LIMIT, clampRetryLimit, type RetryLimitChoice } from '@/downloads/v2/network-options';
import type { DownloadsStore } from '@/store/downloads';

type Rows = Pick<DownloadsStore, 'orderedIds' | 'itemsById'>;

/** Ids of the failed downloads, the most recently updated first. */
export function failedIds(state: Rows): string[] {
  return state.orderedIds
    .filter((id) => state.itemsById[id]?.status === 'FAILED')
    .sort((a, b) => Date.parse(state.itemsById[b]?.updatedAt ?? '') - Date.parse(state.itemsById[a]?.updatedAt ?? ''));
}

/** The same list as one string, so a store selector returns a stable value (zustand compares snapshots). */
export function failedSignature(state: Rows): string {
  return failedIds(state).join('\n');
}

export function splitSignature(signature: string): string[] {
  return signature ? signature.split('\n') : [];
}

/** The retry limit in force: the chosen number, or today's 5 for "Automatic". */
export function retryLimitNumber(choice: RetryLimitChoice | undefined): number {
  return clampRetryLimit(choice) ?? AUTOMATIC_RETRY_LIMIT;
}
