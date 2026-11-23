/**
 * P3: what is remembered per video — the chosen subtitle track, the subtitle files added to it, and the sync offset —
 * as one record per video in the key-value store (no SQLite). Pure.
 *
 * The reader keeps what it understands and drops the rest, and ignores fields it does not know, so a later package
 * (P4's second track) adds fields to the same record without a new storage key.
 */

import { normalizeSubtitleOffset } from './cues';
import { SUBTITLE_FORMATS, type SubtitleFormat } from './parse-subtitles';
import { isSubtitleEncoding, type SubtitleEncoding } from './subtitle-encoding';

/** A track to show: none, one inside the video (drawn by the player itself), or a subtitle file (drawn by VidoraX). */
export type SubtitleSource =
  | { kind: 'off' }
  | { kind: 'embedded'; id: string; language: string | null; label: string | null }
  | { kind: 'file'; fileId: string };

export type SubtitleFileRef = {
  /** `picked:<n>` for a loaded file, `detected:<name>` for one found next to the video. */
  id: string;
  /** The file's own name, as shown in the track list. */
  name: string;
  /** Where the bytes are: VidoraX's copy of a loaded file, or the file next to the video. */
  uri: string;
  format: SubtitleFormat;
  language: string | null;
  /** 'auto' until the user chooses one (#601). */
  encoding: SubtitleEncoding;
  origin: 'picked' | 'detected';
};

export type VideoSubtitleRecord = {
  /** null: never chosen for this video (the Player picks: a track the video turns on itself, or a detected file). */
  primary: SubtitleSource | null;
  files: SubtitleFileRef[];
  offsetMs: number;
};

export const EMPTY_SUBTITLE_RECORD: VideoSubtitleRecord = { primary: null, files: [], offsetMs: 0 };

/** How many videos are remembered (the least recently changed is forgotten first, and its copies deleted). */
export const MAX_SUBTITLE_RECORDS = 300;
/** Subtitle files per video; adding one more forgets the oldest loaded one. */
export const MAX_SUBTITLE_FILES = 8;

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function readSubtitleSource(raw: unknown): SubtitleSource | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const value = raw as Record<string, unknown>;
  if (value.kind === 'off') {
    return { kind: 'off' };
  }
  if (value.kind === 'embedded' && str(value.id)) {
    return { kind: 'embedded', id: value.id as string, language: str(value.language), label: str(value.label) };
  }
  if (value.kind === 'file' && str(value.fileId)) {
    return { kind: 'file', fileId: value.fileId as string };
  }
  return null;
}

function readFileRef(raw: unknown): SubtitleFileRef | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const value = raw as Record<string, unknown>;
  const id = str(value.id);
  const name = str(value.name);
  const uri = str(value.uri);
  const format = (SUBTITLE_FORMATS as readonly unknown[]).includes(value.format) ? (value.format as SubtitleFormat) : null;
  if (!id || !name || !uri || !format) {
    return null;
  }
  return {
    id,
    name,
    uri,
    format,
    language: str(value.language),
    encoding: isSubtitleEncoding(value.encoding) ? value.encoding : 'auto',
    origin: value.origin === 'detected' ? 'detected' : 'picked',
  };
}

/** One stored record, tolerant of missing, extra or damaged fields. */
export function readSubtitleRecord(raw: unknown): VideoSubtitleRecord {
  if (!raw || typeof raw !== 'object') {
    return EMPTY_SUBTITLE_RECORD;
  }
  const value = raw as Record<string, unknown>;
  const files: SubtitleFileRef[] = [];
  if (Array.isArray(value.files)) {
    for (const entry of value.files) {
      const ref = readFileRef(entry);
      if (ref && !files.some((file) => file.id === ref.id)) {
        files.push(ref);
      }
    }
  }
  let primary = readSubtitleSource(value.primary);
  if (primary?.kind === 'file' && !files.some((file) => file.id === (primary as { fileId: string }).fileId)) {
    primary = null;
  }
  return { primary, files: files.slice(-MAX_SUBTITLE_FILES), offsetMs: normalizeSubtitleOffset(value.offsetMs) };
}

/** Nothing chosen, no files, no offset: no need to keep it. */
export function isEmptySubtitleRecord(record: VideoSubtitleRecord): boolean {
  return record.primary == null && record.files.length === 0 && record.offsetMs === 0;
}

export type SubtitleRecords = readonly (readonly [string, VideoSubtitleRecord])[];

/** The stored list (`[mediaId, record]`, least recently changed first), dropping junk and repeats (the latest wins). */
export function readSubtitleRecords(raw: unknown, max = MAX_SUBTITLE_RECORDS): SubtitleRecords {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<string>();
  const out: (readonly [string, VideoSubtitleRecord])[] = [];
  for (let i = raw.length - 1; i >= 0 && out.length < max; i -= 1) {
    const entry: unknown = raw[i];
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !entry[0] || seen.has(entry[0])) {
      continue;
    }
    const record = readSubtitleRecord(entry[1]);
    if (isEmptySubtitleRecord(record)) {
      continue;
    }
    seen.add(entry[0]);
    out.push([entry[0], record]);
  }
  return out.reverse();
}

export function subtitleRecordFor(list: SubtitleRecords, mediaId: string | null | undefined): VideoSubtitleRecord {
  if (!mediaId) {
    return EMPTY_SUBTITLE_RECORD;
  }
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i]![0] === mediaId) {
      return list[i]![1];
    }
  }
  return EMPTY_SUBTITLE_RECORD;
}

/**
 * The list after saving `record` for `mediaId`: moved to the newest end (or removed when empty). `evicted` holds the
 * records pushed out by the limit, so their loaded copies can be deleted.
 */
export function rememberSubtitleRecord(
  list: SubtitleRecords,
  mediaId: string,
  record: VideoSubtitleRecord,
  max = MAX_SUBTITLE_RECORDS,
): { list: SubtitleRecords; evicted: VideoSubtitleRecord[] } {
  const rest = list.filter(([id]) => id !== mediaId);
  if (isEmptySubtitleRecord(record)) {
    return { list: rest, evicted: [] };
  }
  const next = [...rest, [mediaId, record] as const];
  const over = Math.max(0, next.length - max);
  return { list: next.slice(over), evicted: next.slice(0, over).map(([, evicted]) => evicted) };
}

/**
 * The record with `file` added (or updated, same id). Over the limit, the oldest loaded file goes; `dropped` lists
 * the files no longer kept, so a loaded copy can be deleted.
 */
export function addSubtitleFile(
  record: VideoSubtitleRecord,
  file: SubtitleFileRef,
  max = MAX_SUBTITLE_FILES,
): { record: VideoSubtitleRecord; dropped: SubtitleFileRef[] } {
  const files = [...record.files.filter((existing) => existing.id !== file.id), file];
  const dropped: SubtitleFileRef[] = [];
  while (files.length > max) {
    const oldest = files.findIndex((existing) => existing.id !== file.id);
    dropped.push(...files.splice(oldest, 1));
  }
  const primary =
    record.primary?.kind === 'file' && dropped.some((gone) => gone.id === (record.primary as { fileId: string }).fileId)
      ? null
      : record.primary;
  return { record: { ...record, primary, files }, dropped };
}

/** Loaded copies a record owns (a detected file belongs to the library and is never deleted from here). */
export function pickedCopies(record: VideoSubtitleRecord): SubtitleFileRef[] {
  return record.files.filter((file) => file.origin === 'picked');
}
