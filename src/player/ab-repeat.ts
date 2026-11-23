/**
 * P5 #541 A-B Repeat: two points on the video's timeline, and playback looping between them. Pure (no React, no
 * native) so the boundaries are unit-tested; `src/screens/player/page/use-repeat.ts` drives it.
 *
 * - A and B are seconds on the timeline. Setting B before A swaps them, so the loop always runs forwards.
 * - A point past the end is moved to the end (a B at the very end loops when the video finishes).
 * - A loop shorter than `MIN_AB_LOOP_SECONDS` is refused: it would only stutter.
 * - Playing into B (or seeking past it) goes back to A. Before A, the video plays on until it reaches the loop.
 */

/** The shortest loop allowed, in seconds. */
export const MIN_AB_LOOP_SECONDS = 0.5;

/**
 * How early, before B, the jump back to A happens. The position is read every 100 ms, so without it the video would
 * overshoot B by up to a tenth of a second.
 */
export const AB_LOOP_LEAD_SECONDS = 0.05;

export type AbPoints = {
  /** Seconds; null when not set. */
  a: number | null;
  b: number | null;
};

export type AbLoop = { startSeconds: number; endSeconds: number };

export const NO_AB_POINTS: AbPoints = { a: null, b: null };

/** Seconds kept inside the video: never below 0, never past a known duration. Not a number → 0. */
export function clampToVideo(seconds: number, durationSeconds: number | null): number {
  const value = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return durationSeconds != null && Number.isFinite(durationSeconds) && durationSeconds > 0
    ? Math.min(value, durationSeconds)
    : value;
}

/**
 * The loop A and B make, or null when either is missing or they are too close. B before A is swapped; both are kept
 * inside the video.
 */
export function abLoopOf(points: AbPoints, durationSeconds: number | null): AbLoop | null {
  if (points.a == null || points.b == null) {
    return null;
  }
  const a = clampToVideo(points.a, durationSeconds);
  const b = clampToVideo(points.b, durationSeconds);
  const startSeconds = Math.min(a, b);
  const endSeconds = Math.max(a, b);
  return endSeconds - startSeconds >= MIN_AB_LOOP_SECONDS ? { startSeconds, endSeconds } : null;
}

export type AbSetResult =
  | { ok: true; points: AbPoints }
  /** B too close to A (or the other way round): nothing changes. */
  | { ok: false; reason: 'tooShort' };

/** Sets A at a position. With B already set, A and B must still make a loop (B before A is swapped later). */
export function setAbPointA(points: AbPoints, seconds: number, durationSeconds: number | null): AbSetResult {
  const a = clampToVideo(seconds, durationSeconds);
  if (points.b != null && Math.abs(points.b - a) < MIN_AB_LOOP_SECONDS) {
    return { ok: false, reason: 'tooShort' };
  }
  return { ok: true, points: orderPoints({ a, b: points.b }) };
}

/** Sets B at a position; B before A swaps them. Without A, B alone is kept (the loop starts once A is set). */
export function setAbPointB(points: AbPoints, seconds: number, durationSeconds: number | null): AbSetResult {
  const b = clampToVideo(seconds, durationSeconds);
  if (points.a != null && Math.abs(b - points.a) < MIN_AB_LOOP_SECONDS) {
    return { ok: false, reason: 'tooShort' };
  }
  return { ok: true, points: orderPoints({ a: points.a, b }) };
}

function orderPoints(points: AbPoints): AbPoints {
  if (points.a != null && points.b != null && points.b < points.a) {
    return { a: points.b, b: points.a };
  }
  return points;
}

/** What the A-B tile does next: set A, then B, then (a loop is on) open the A-B sheet. */
export type AbTileStep = 'setA' | 'setB' | 'openSheet';

export function abTileStep(points: AbPoints): AbTileStep {
  if (points.a == null) {
    return 'setA';
  }
  return points.b == null ? 'setB' : 'openSheet';
}

/**
 * Where playback must jump now, or null to play on: back to A once the position reaches B (or has gone past it).
 * Before A nothing happens: the video plays into the loop.
 */
export function abLoopJumpTarget(loop: AbLoop | null, positionSeconds: number): number | null {
  if (!loop || !Number.isFinite(positionSeconds)) {
    return null;
  }
  return positionSeconds >= loop.endSeconds - AB_LOOP_LEAD_SECONDS ? loop.startSeconds : null;
}

/** Where A and B sit on the timeline, as fractions 0…1 (null for a point not set, or no duration yet). */
export function abMarkerFractions(
  points: AbPoints,
  durationSeconds: number | null,
): { a: number | null; b: number | null } {
  if (durationSeconds == null || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return { a: null, b: null };
  }
  const fraction = (value: number | null) =>
    value == null ? null : Math.min(1, Math.max(0, value / durationSeconds));
  return { a: fraction(points.a), b: fraction(points.b) };
}
