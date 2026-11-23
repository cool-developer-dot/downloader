/**
 * P9 #711 — the background backfill of video lengths: which Library videos still need their length measured, a few at a
 * time. Pure (unit-tested); `library-stats-store.ts` runs it with the native `probeLibraryLengths`
 * (`library/LengthProbe.kt`, the existing MediaInfo probe) and keeps the results in P9's `media_play_stats`.
 *
 * - Only library videos: `device:` (gallery) ids are never sent — their files aren't the app's own.
 * - A video whose length is known (measured before, from the native library, or from a playback record) is skipped.
 * - A video looked at before without a readable length is tried again only after `LENGTH_RECHECK_MS` (a file can be
 *   unreadable for a while, e.g. still being copied), never in a loop.
 * - `LENGTH_BACKFILL_BATCH` videos per call, with `LENGTH_BACKFILL_PAUSE_MS` between calls, so it never competes with
 *   the Player or the Library for the disk.
 */

/** Videos measured per native call (the native side caps it at 10). */
export const LENGTH_BACKFILL_BATCH = 5;

/** The pause between two calls. */
export const LENGTH_BACKFILL_PAUSE_MS = 1500;

/** How long an unreadable video is left alone before it is tried again. */
export const LENGTH_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;

export type CheckedLength = {
  /** Null: looked at, no length read. */
  durationMs: number | null;
  checkedAt: string;
};

export type LengthBackfillInput = {
  /** The Library's videos, in the order to measure them (the list as shown). */
  ids: readonly string[];
  /** Lengths already known, in seconds, from any source. */
  known: Readonly<Record<string, number>>;
  /** What the backfill found before (from `media_play_stats`). */
  checked: Readonly<Record<string, CheckedLength>>;
  /** Ids already handed out in this run (in flight or done). */
  asked: ReadonlySet<string>;
  nowMs: number;
};

/** Whether this id is one the backfill may measure (a library video, not a gallery video or an empty id). */
export function isBackfillCandidate(id: string): boolean {
  return id.trim().length > 0 && !id.startsWith('device:');
}

/** The videos still to measure, in order (no repeats). */
export function lengthBackfillQueue(input: LengthBackfillInput): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input.ids) {
    const id = raw.trim();
    if (!isBackfillCandidate(id) || seen.has(id) || input.asked.has(id)) {
      continue;
    }
    seen.add(id);
    const known = input.known[id];
    if (known != null && Number.isFinite(known) && known > 0) {
      continue;
    }
    const before = input.checked[id];
    if (before) {
      if (before.durationMs != null && before.durationMs > 0) {
        continue;
      }
      const at = Date.parse(before.checkedAt);
      if (Number.isFinite(at) && input.nowMs - at < LENGTH_RECHECK_MS) {
        continue;
      }
    }
    out.push(id);
  }
  return out;
}

/** The queue cut into calls of `size`. */
export function lengthBackfillBatches(queue: readonly string[], size: number = LENGTH_BACKFILL_BATCH): string[][] {
  const step = Math.max(1, Math.floor(size));
  const out: string[][] = [];
  for (let start = 0; start < queue.length; start += step) {
    out.push(queue.slice(start, start + step));
  }
  return out;
}

/** Stored lengths as the Library's seconds (only the readable ones). */
export function knownSecondsFromChecked(checked: Readonly<Record<string, CheckedLength>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, entry] of Object.entries(checked)) {
    if (entry.durationMs != null && entry.durationMs > 0) {
      out[id] = entry.durationMs / 1000;
    }
  }
  return out;
}
