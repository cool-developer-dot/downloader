/**
 * P3: the subtitle choices that are kept — per video (track, files, sync offset; MMKV, last 300 videos) and the
 * app-wide Auto-detect switch (#590, on by default). Key-value storage only (no SQLite schema change).
 */

import { useMemo } from 'react';

import { mmkvKeys } from '@/storage/constants';
import { mmkvGetBoolean, mmkvGetObject, mmkvSetBoolean, mmkvSetObject } from '@/storage/mmkv';
import { createStore } from '@/store/shared/create-store';

import { deleteSubtitleCopies } from './subtitle-files';
import {
  pickedCopies,
  readSubtitleRecords,
  rememberSubtitleRecord,
  subtitleRecordFor,
  type SubtitleFileRef,
  type SubtitleRecords,
  type VideoSubtitleRecord,
} from './subtitle-record';

type SubtitleStoreState = { records: SubtitleRecords; autoDetect: boolean };

function readRecords(): SubtitleRecords {
  try {
    return readSubtitleRecords(mmkvGetObject<unknown>(mmkvKeys.playerSubtitles));
  } catch {
    // Damaged or unavailable storage must not stop the Player.
    return [];
  }
}

function readAutoDetect(): boolean {
  try {
    return mmkvGetBoolean(mmkvKeys.playerSubtitleAutoDetect) ?? true;
  } catch {
    return true;
  }
}

const useSubtitleStore = createStore<SubtitleStoreState>()(() => ({
  records: readRecords(),
  autoDetect: readAutoDetect(),
}));

export function useVideoSubtitleRecord(mediaId: string | null | undefined): VideoSubtitleRecord {
  const records = useSubtitleStore((state) => state.records);
  return useMemo(() => subtitleRecordFor(records, mediaId), [mediaId, records]);
}

export function getVideoSubtitleRecord(mediaId: string | null | undefined): VideoSubtitleRecord {
  return subtitleRecordFor(useSubtitleStore.getState().records, mediaId);
}

/**
 * Saves this video's record as `update` returns it. Loaded copies no longer referenced — files dropped from the record
 * (`dropped`) or whole records pushed out by the limit — are deleted.
 */
export function updateVideoSubtitleRecord(
  mediaId: string | null | undefined,
  update: (record: VideoSubtitleRecord) => VideoSubtitleRecord,
  dropped: readonly SubtitleFileRef[] = [],
): void {
  if (!mediaId) {
    return;
  }
  const { records } = useSubtitleStore.getState();
  const next = update(subtitleRecordFor(records, mediaId));
  const result = rememberSubtitleRecord(records, mediaId, next);
  try {
    mmkvSetObject(mmkvKeys.playerSubtitles, result.list);
  } catch {
    // Kept for this run even when it can't be saved.
  }
  useSubtitleStore.setState({ records: result.list });
  const stillUsed = new Set(result.list.flatMap(([, record]) => record.files.map((file) => file.uri)));
  const gone = [...dropped, ...result.evicted.flatMap(pickedCopies)].filter((file) => !stillUsed.has(file.uri));
  if (gone.length > 0) {
    deleteSubtitleCopies(gone);
  }
}

export function useSubtitleAutoDetect(): boolean {
  return useSubtitleStore((state) => state.autoDetect);
}

export function setSubtitleAutoDetect(on: boolean): void {
  try {
    mmkvSetBoolean(mmkvKeys.playerSubtitleAutoDetect, on);
  } catch {
    // Kept for this run even when it can't be saved.
  }
  useSubtitleStore.setState({ autoDetect: on });
}
