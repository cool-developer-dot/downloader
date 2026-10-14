/**
 * The timeline's right-hand label: the video's total length, or the time left as "−mm:ss" (tap the label to switch;
 * the choice is remembered — `duration-label-preference.ts`).
 */

import { formatPlaybackTime } from './format-time';

export type DurationLabelMode = 'total' | 'remaining';

export const DEFAULT_DURATION_LABEL_MODE: DurationLabelMode = 'total';

/** U+2212 MINUS SIGN, the typographic minus (a hyphen looks like a dash next to the digits). */
const MINUS = '−';

export function isDurationLabelMode(value: unknown): value is DurationLabelMode {
  return value === 'total' || value === 'remaining';
}

export function toggleDurationLabelMode(mode: DurationLabelMode): DurationLabelMode {
  return mode === 'total' ? 'remaining' : 'total';
}

/**
 * Unknown duration shows the unknown time ("--:--") in both modes, never an invented one. Time left is the shown total
 * minus the shown position (both whole seconds, rounded down like `formatPlaybackTime`), so the two labels always add
 * up to the total the label shows in the other mode.
 */
export function formatDurationLabel(
  positionSeconds: number,
  durationSeconds: number | null | undefined,
  mode: DurationLabelMode,
): string {
  if (durationSeconds == null || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return formatPlaybackTime(null);
  }
  if (mode === 'total') {
    return formatPlaybackTime(durationSeconds);
  }
  const position = Number.isFinite(positionSeconds) ? Math.max(0, positionSeconds) : 0;
  const left = Math.max(0, Math.floor(durationSeconds) - Math.floor(position));
  return `${MINUS}${formatPlaybackTime(left)}`;
}
