/**
 * P5 #722 Save Loop: A-B loops saved with a name, per video, kept in the key-value store (MMKV,
 * `src/player/saved-loops-preference.ts`). Pure, so the record rules are unit-tested.
 *
 * The record is `[mediaId, loops][]`, oldest video first: saving or changing a video's loops moves it to the end, and
 * past `MAX_SAVED_LOOP_VIDEOS` the oldest video's loops go. A video keeps up to `MAX_SAVED_LOOPS_PER_VIDEO` loops; one
 * more is refused (never a silent loss).
 */

import { MIN_AB_LOOP_SECONDS } from './ab-repeat';

export type SavedLoop = {
  id: string;
  name: string;
  /** Milliseconds on the video's timeline; `startMs < endMs`. */
  startMs: number;
  endMs: number;
  createdAt: number;
};

export type SavedLoopRecords = readonly (readonly [string, readonly SavedLoop[]])[];

export const MAX_SAVED_LOOP_VIDEOS = 300;
export const MAX_SAVED_LOOPS_PER_VIDEO = 50;
export const MAX_LOOP_NAME_LENGTH = 80;

/** A name as kept: trimmed, inner runs of spaces and line breaks made one space, at most 80 characters; null if empty. */
export function normalizeLoopName(name: string): string | null {
  const clean = name.replace(/\s+/g, ' ').trim();
  if (!clean) {
    return null;
  }
  return Array.from(clean).slice(0, MAX_LOOP_NAME_LENGTH).join('').trim();
}

function isSavedLoop(value: unknown): value is SavedLoop {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const loop = value as Record<string, unknown>;
  return (
    typeof loop.id === 'string' &&
    loop.id.length > 0 &&
    typeof loop.name === 'string' &&
    normalizeLoopName(loop.name) != null &&
    typeof loop.startMs === 'number' &&
    typeof loop.endMs === 'number' &&
    Number.isFinite(loop.startMs) &&
    Number.isFinite(loop.endMs) &&
    loop.startMs >= 0 &&
    loop.endMs - loop.startMs >= MIN_AB_LOOP_SECONDS * 1000 &&
    typeof loop.createdAt === 'number'
  );
}

/** The stored record, read tolerantly: anything damaged is left out, never thrown. */
export function readSavedLoopRecords(raw: unknown): SavedLoopRecords {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: (readonly [string, readonly SavedLoop[]])[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length < 2 || typeof entry[0] !== 'string' || !Array.isArray(entry[1])) {
      continue;
    }
    const mediaId = entry[0];
    if (!mediaId || seen.has(mediaId)) {
      continue;
    }
    const loops = (entry[1] as unknown[]).filter(isSavedLoop).slice(0, MAX_SAVED_LOOPS_PER_VIDEO);
    if (loops.length > 0) {
      seen.add(mediaId);
      out.push([mediaId, loops.map((loop) => ({ ...loop, name: normalizeLoopName(loop.name)! }))]);
    }
  }
  return out.slice(-MAX_SAVED_LOOP_VIDEOS);
}

/** A video's saved loops, in timeline order (then by when they were saved). */
export function savedLoopsFor(records: SavedLoopRecords, mediaId: string | null): SavedLoop[] {
  if (!mediaId) {
    return [];
  }
  const loops = records.find(([id]) => id === mediaId)?.[1] ?? [];
  return [...loops].sort((a, b) => a.startMs - b.startMs || a.createdAt - b.createdAt);
}

/** "Loop 3": the first number not already taken by a loop of this video named that way. */
export function nextLoopName(loops: readonly SavedLoop[], base: string): string {
  const taken = new Set(loops.map((loop) => loop.name));
  for (let n = loops.length + 1; ; n += 1) {
    const name = `${base} ${n}`;
    if (!taken.has(name)) {
      return name;
    }
  }
}

function withVideoLoops(records: SavedLoopRecords, mediaId: string, loops: readonly SavedLoop[]): SavedLoopRecords {
  const rest = records.filter(([id]) => id !== mediaId);
  return loops.length > 0 ? [...rest, [mediaId, loops] as const].slice(-MAX_SAVED_LOOP_VIDEOS) : rest;
}

export type AddSavedLoopResult =
  | { ok: true; records: SavedLoopRecords; loop: SavedLoop }
  | { ok: false; reason: 'full' | 'invalid' };

/** Saves a loop for a video (its name normalised). */
export function addSavedLoop(
  records: SavedLoopRecords,
  mediaId: string,
  input: { id: string; name: string; startMs: number; endMs: number; createdAt: number },
): AddSavedLoopResult {
  const name = normalizeLoopName(input.name);
  const loop: SavedLoop = {
    id: input.id,
    name: name ?? '',
    startMs: Math.round(Math.min(input.startMs, input.endMs)),
    endMs: Math.round(Math.max(input.startMs, input.endMs)),
    createdAt: input.createdAt,
  };
  if (!mediaId || !isSavedLoop(loop)) {
    return { ok: false, reason: 'invalid' };
  }
  const current = records.find(([id]) => id === mediaId)?.[1] ?? [];
  if (current.length >= MAX_SAVED_LOOPS_PER_VIDEO) {
    return { ok: false, reason: 'full' };
  }
  return { ok: true, loop, records: withVideoLoops(records, mediaId, [...current, loop]) };
}

/** Renames a saved loop; an empty name leaves it as it was. */
export function renameSavedLoop(
  records: SavedLoopRecords,
  mediaId: string,
  loopId: string,
  name: string,
): SavedLoopRecords {
  const clean = normalizeLoopName(name);
  const current = records.find(([id]) => id === mediaId)?.[1];
  if (!clean || !current || !current.some((loop) => loop.id === loopId)) {
    return records;
  }
  return withVideoLoops(
    records,
    mediaId,
    current.map((loop) => (loop.id === loopId ? { ...loop, name: clean } : loop)),
  );
}

/** Deletes a saved loop (a video left with none drops out of the record). */
export function deleteSavedLoop(records: SavedLoopRecords, mediaId: string, loopId: string): SavedLoopRecords {
  const current = records.find(([id]) => id === mediaId)?.[1];
  if (!current || !current.some((loop) => loop.id === loopId)) {
    return records;
  }
  return withVideoLoops(
    records,
    mediaId,
    current.filter((loop) => loop.id !== loopId),
  );
}
