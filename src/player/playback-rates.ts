/** Allowed Stage 2 playback rates. */

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export type PlaybackRate = (typeof PLAYBACK_RATES)[number];

export const DEFAULT_PLAYBACK_RATE: PlaybackRate = 1;

export function isValidPlaybackRate(rate: number): rate is PlaybackRate {
  return (PLAYBACK_RATES as readonly number[]).includes(rate);
}

/**
 * Accept only exact allowed rates. Invalid → null (reject, do not coerce).
 */
export function normalizePlaybackRate(rate: unknown): PlaybackRate | null {
  if (typeof rate !== 'number' || !Number.isFinite(rate)) {
    return null;
  }
  return isValidPlaybackRate(rate) ? rate : null;
}

export function formatPlaybackRateLabel(rate: number): string {
  if (rate === 1) {
    return '1x';
  }
  // Trim trailing zeros: 1.50 → 1.5
  const text = Number.isInteger(rate) ? String(rate) : String(rate);
  return `${text}x`;
}
