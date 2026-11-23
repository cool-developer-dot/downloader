/**
 * P9 — what the Library needs from play counts, lengths and hidden folders, in one small store (runtime only; the
 * rules are pure, in `play-count.ts`, `duration-buckets.ts` and `folder-exclusion.ts`).
 *
 * - `playCounts`: every counted play from `media_play_stats` (#708 / #626), reloaded after each new count.
 * - `durationById`: lengths the native library measured for its own videos (`LibraryItem.durationMs`), loaded only
 *   while a length filter is chosen (#711). The Library's items carry no length of their own today.
 * - `durationBucket`: the length filter (not remembered, like the other filters; Reset clears it).
 * - `excludedFolderIds`: the hidden folders (#628), remembered in MMKV.
 */

import { mmkvKeys } from '@/storage/constants';
import { mmkvGetObject, mmkvSetObject } from '@/storage/mmkv';
import { createStore } from '@/store/shared/create-store';

import { DEFAULT_DURATION_BUCKET, type DurationBucket } from './duration-buckets';
import { normalizeExcludedFolderIds, setFolderExcluded } from './folder-exclusion';
import type { LibraryPlayCount } from './types';

type LibraryStatsState = {
  playCounts: Record<string, LibraryPlayCount>;
  durationById: Record<string, number>;
  durationBucket: DurationBucket;
  excludedFolderIds: string[];
};

function readExcluded(): string[] {
  try {
    return normalizeExcludedFolderIds(mmkvGetObject<unknown>(mmkvKeys.libraryExcludedFolders));
  } catch {
    return [];
  }
}

export const useLibraryStatsStore = createStore<LibraryStatsState>()(() => ({
  playCounts: {},
  durationById: {},
  durationBucket: DEFAULT_DURATION_BUCKET,
  excludedFolderIds: readExcluded(),
}));

/** Reloads every play count (after a play was counted, or a video deleted). */
export async function refreshPlayCounts(): Promise<void> {
  try {
    const { libraryStatsRepository } = await import('@/storage/repositories/library-stats.repository');
    const rows = await libraryStatsRepository.allPlayStats();
    const playCounts: Record<string, LibraryPlayCount> = {};
    for (const row of rows) {
      playCounts[row.mediaId] = { playCount: row.playCount, lastPlayedAt: row.lastPlayedAt };
    }
    useLibraryStatsStore.setState({ playCounts });
  } catch {
    // The Library keeps the counts it has; the next count reloads them.
  }
}

export function setLibraryDurationBucket(bucket: DurationBucket): void {
  useLibraryStatsStore.setState({ durationBucket: bucket });
}

export function resetLibraryDurationBucket(): void {
  useLibraryStatsStore.setState({ durationBucket: DEFAULT_DURATION_BUCKET });
}

/** Shows or hides one folder (`unfiled` for videos in no folder). Remembered. */
export function setLibraryFolderHidden(folderKey: string, hidden: boolean): void {
  const excludedFolderIds = setFolderExcluded(useLibraryStatsStore.getState().excludedFolderIds, folderKey, hidden);
  try {
    mmkvSetObject(mmkvKeys.libraryExcludedFolders, excludedFolderIds);
  } catch {
    // Kept for this run even when it can't be saved.
  }
  useLibraryStatsStore.setState({ excludedFolderIds });
}

const LENGTH_PAGE = 200;
const lengthsAsked = new Set<string>();

/**
 * Asks the native library for the lengths of these videos (only those not asked before in this run). Videos it
 * doesn't know (older downloads, a build without the module) simply stay unknown.
 */
export async function loadLibraryDurations(ids: readonly string[]): Promise<void> {
  const wanted = ids.filter((id) => id && !lengthsAsked.has(id) && !id.startsWith('device:'));
  if (wanted.length === 0) {
    return;
  }
  for (const id of wanted) {
    lengthsAsked.add(id);
  }
  try {
    const { getV2Engine } = await import('@/downloads/v2');
    const engine = getV2Engine();
    if (!engine) {
      return;
    }
    const found: Record<string, number> = {};
    for (let start = 0; start < wanted.length; start += LENGTH_PAGE) {
      const items = await engine.getLibraryItems(wanted.slice(start, start + LENGTH_PAGE));
      for (const item of items) {
        if (typeof item.durationMs === 'number' && Number.isFinite(item.durationMs) && item.durationMs > 0) {
          found[item.id] = item.durationMs / 1000;
        }
      }
    }
    if (Object.keys(found).length > 0) {
      useLibraryStatsStore.setState((state) => ({ durationById: { ...state.durationById, ...found } }));
    }
  } catch {
    // Unknown lengths show only under Any; they are asked for again the next time.
    for (const id of wanted) {
      lengthsAsked.delete(id);
    }
  }
}
