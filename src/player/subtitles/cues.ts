/**
 * P3: subtitle cues, finding the ones showing at a moment, and the sync offset (#597). Pure.
 */

export type SubtitleCue = {
  startMs: number;
  endMs: number;
  /** The text, lines separated by `\n`, with no markup left. */
  text: string;
};

export type CueIndex = {
  /** Sorted by start (ties keep the file's order). */
  cues: readonly SubtitleCue[];
  /** `maxEnd[i]`: the latest end among `cues[0..i]` — lets a lookup stop as soon as nothing earlier can still show. */
  maxEnd: readonly number[];
};

export function createCueIndex(cues: readonly SubtitleCue[]): CueIndex {
  const sorted = cues
    .map((cue, order) => ({ cue, order }))
    .sort((a, b) => a.cue.startMs - b.cue.startMs || a.order - b.order)
    .map((entry) => entry.cue);
  const maxEnd: number[] = [];
  let latest = Number.NEGATIVE_INFINITY;
  for (const cue of sorted) {
    latest = Math.max(latest, cue.endMs);
    maxEnd.push(latest);
  }
  return { cues: sorted, maxEnd };
}

/** The cues showing at `timeMs` (start ≤ t < end), in start order. Overlapping cues all show. */
export function activeCuesAt(index: CueIndex, timeMs: number): SubtitleCue[] {
  const { cues, maxEnd } = index;
  if (!Number.isFinite(timeMs) || cues.length === 0) {
    return [];
  }
  // The last cue that has started.
  let lo = 0;
  let hi = cues.length - 1;
  let last = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid]!.startMs <= timeMs) {
      last = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const out: SubtitleCue[] = [];
  for (let j = last; j >= 0 && maxEnd[j]! > timeMs; j -= 1) {
    if (cues[j]!.endMs > timeMs) {
      out.push(cues[j]!);
    }
  }
  return out.reverse();
}

// ── Sync offset (#597) ───────────────────────────────────────────────────────────────────────────────────────────

/** One press of − / + moves the subtitles by this much. */
export const SUBTITLE_OFFSET_STEP_MS = 100;
/** Five minutes either way: enough for a subtitle made for another cut of the video. */
export const MAX_SUBTITLE_OFFSET_MS = 300_000;

/** A stored or typed offset, rounded to the 100 ms step and kept within ±5 minutes. */
export function normalizeSubtitleOffset(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  const stepped = Math.round(value / SUBTITLE_OFFSET_STEP_MS) * SUBTITLE_OFFSET_STEP_MS;
  return Math.max(-MAX_SUBTITLE_OFFSET_MS, Math.min(MAX_SUBTITLE_OFFSET_MS, stepped)) || 0;
}

/** The offset after `steps` presses (negative: earlier). */
export function stepSubtitleOffset(offsetMs: number, steps: number): number {
  return normalizeSubtitleOffset(normalizeSubtitleOffset(offsetMs) + steps * SUBTITLE_OFFSET_STEP_MS);
}

/**
 * The subtitle file's time for the player's position. A positive offset shows the subtitles later (they were early),
 * a negative one earlier.
 */
export function subtitleTimeMs(playerSeconds: number, offsetMs: number): number {
  return playerSeconds * 1000 - offsetMs;
}

/** "+0.5 s", "−1.2 s", "0.0 s" (a real minus sign; Western digits, as the timeline uses). */
export function formatSubtitleOffset(offsetMs: number): string {
  const value = normalizeSubtitleOffset(offsetMs);
  const seconds = (Math.abs(value) / 1000).toFixed(1);
  if (value === 0) {
    return `${seconds} s`;
  }
  return `${value > 0 ? '+' : String.fromCharCode(0x2212)}${seconds} s`;
}
