/**
 * P9 — what the Library needs from play counts, lengths and hidden folders, in one small store (runtime only; the
 * rules are pure, in `play-count.ts`, `duration-buckets.ts` and `folder-exclusion.ts`).
 *
 * - `playCounts`: every counted play from `media_play_stats` (#708 / #626), reloaded after each new count.
 * - `durationById`: lengths of the Library's videos (#711), from the native library (`LibraryItem.durationMs`) and,
 *   for videos it has none for, from the background backfill (`backfillLibraryLengths`: the existing MediaInfo probe,
 *   a few at a time, kept in `media_play_stats.duration_ms`). The Library's items carry no length of their own today.
 * - `durationBucket`: the length filter (not remembered, like the other filters; Reset clears it).
 * - `excludedFolderIds`: the hidden folders (#628), remembered in MMKV.
 */

import { mmkvKeys } from '@/storage/constants';
import { mmkvGetObject, mmkvSetObject } from '@/storage/mmkv';
import { createStore } from '@/store/shared/create-store';

import { DEFAULT_DURATION_BUCKET, type DurationBucket } from './duration-buckets';
import {
  LENGTH_BACKFILL_PAUSE_MS,
  knownSecondsFromChecked,
  lengthBackfillBatches,
  lengthBackfillQueue,
  type CheckedLength,
} from './length-backfill';
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

// ── #711 background backfill ────────────────────────────────────────────────────────────────────────────────────

let storedLengths: Record<string, CheckedLength> | null = null;
const backfillAsked = new Set<string>();
let backfillPending: string[] = [];
let backfillRunning = false;

async function readStoredLengths(): Promise<Record<string, CheckedLength>> {
  if (storedLengths) {
    return storedLengths;
  }
  const { libraryStatsRepository } = await import('@/storage/repositories/library-stats.repository');
  const rows = await libraryStatsRepository.lengths();
  const out: Record<string, CheckedLength> = {};
  for (const row of rows) {
    out[row.mediaId] = { durationMs: row.durationMs, checkedAt: row.checkedAt };
  }
  storedLengths = out;
  const known = knownSecondsFromChecked(out);
  if (Object.keys(known).length > 0) {
    useLibraryStatsStore.setState((state) => ({ durationById: { ...known, ...state.durationById } }));
  }
  return out;
}

type LengthProbePort = { probeLibraryLengths?: (ids: string[]) => Promise<{ id: string; durationMs: number | null }[]> };

async function lengthProbe(): Promise<LengthProbePort['probeLibraryLengths'] | null> {
  const { getVidoraMedia, isVidoraMediaAvailable } = await import('@modules/vidorax-media');
  if (!isVidoraMediaAvailable()) {
    return null;
  }
  const media = getVidoraMedia() as unknown as LengthProbePort;
  return typeof media.probeLibraryLengths === 'function' ? media.probeLibraryLengths.bind(media) : null;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Fills in the lengths of these Library videos in the background: lengths kept from earlier runs first, then the
 * native library's own, then the rest measured from their files, `LENGTH_BACKFILL_BATCH` at a time with a pause. Safe
 * to call on every Library change: each video is handled once per run, and one run goes at a time.
 */
export async function backfillLibraryLengths(ids: readonly string[]): Promise<void> {
  try {
    const checked = await readStoredLengths();
    await loadLibraryDurations(ids);
    const queue = lengthBackfillQueue({
      ids,
      known: useLibraryStatsStore.getState().durationById,
      checked,
      asked: backfillAsked,
      nowMs: Date.now(),
    });
    for (const id of queue) {
      backfillAsked.add(id);
    }
    backfillPending = [...backfillPending, ...queue];
  } catch {
    return;
  }
  if (backfillRunning || backfillPending.length === 0) {
    return;
  }
  backfillRunning = true;
  try {
    const probe = await lengthProbe();
    if (!probe) {
      backfillPending = [];
      return;
    }
    const { libraryStatsRepository } = await import('@/storage/repositories/library-stats.repository');
    while (backfillPending.length > 0) {
      const [batch] = lengthBackfillBatches(backfillPending);
      backfillPending = backfillPending.slice(batch!.length);
      await pause(LENGTH_BACKFILL_PAUSE_MS);
      let results: { id: string; durationMs: number | null }[];
      try {
        results = await probe(batch!);
      } catch {
        // This call failed as a whole (the module is busy or gone): these stay unknown and are tried next run.
        for (const id of batch!) {
          backfillAsked.delete(id);
        }
        continue;
      }
      const found: Record<string, number> = {};
      const nowIso = new Date().toISOString();
      for (const result of results) {
        const length = result.durationMs != null && result.durationMs > 0 ? result.durationMs : null;
        await libraryStatsRepository.saveLength(result.id, length, nowIso);
        (storedLengths ??= {})[result.id] = { durationMs: length, checkedAt: nowIso };
        if (length != null) {
          found[result.id] = length / 1000;
        }
      }
      if (Object.keys(found).length > 0) {
        useLibraryStatsStore.setState((state) => ({ durationById: { ...state.durationById, ...found } }));
      }
    }
  } catch {
    // Storage unavailable: what was found so far stays; the rest is tried next run.
  } finally {
    backfillRunning = false;
  }
}

/** Tests only: forget this run's backfill state. */
export function resetLengthBackfillForTests(): void {
  storedLengths = null;
  backfillAsked.clear();
  backfillPending = [];
  backfillRunning = false;
}
