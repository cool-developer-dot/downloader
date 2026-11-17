/** Pure selectors for design 41 "Live & convert": the running recording and the newest finished video. */

import type { DownloadsStore } from '@/store/downloads';

type Rows = Pick<DownloadsStore, 'orderedIds' | 'itemsById' | 'transferById' | 'engineRowsById'>;

/** The live stream being recorded now (F6, `recording` on its transfer), newest first; null when none runs. */
export function findRecordingId(state: Rows): string | null {
  for (const id of state.orderedIds) {
    const item = state.itemsById[id];
    if (item?.status === 'DOWNLOADING' && state.transferById[id]?.recording === true) {
      return id;
    }
  }
  return null;
}

/** The newest finished download of the native engine — the one Convert and Trim act on; null when there is none. */
export function findLastCompletedEngineId(state: Rows): string | null {
  for (const id of state.orderedIds) {
    const item = state.itemsById[id];
    if (item?.status === 'COMPLETED' && Object.prototype.hasOwnProperty.call(state.engineRowsById, id)) {
      return id;
    }
  }
  return null;
}

/** How much of the longest allowed recording ("Maximum length", minutes) is recorded, 0…1. */
export function recordingProgress(recordedMs: number | null | undefined, maxMinutes: number): number {
  const max = maxMinutes * 60_000;
  if (!(max > 0) || typeof recordedMs !== 'number' || !(recordedMs > 0)) {
    return 0;
  }
  return Math.min(1, recordedMs / max);
}
