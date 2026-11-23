/**
 * Playback speeds. The presets are the speed sheet's one-tap choices; Faran's P16 #537 Fine Speed Control allows any
 * speed from 0.25× to 4× on a 0.05 grid (the sheet's − / + move 0.1).
 */

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

/** Any allowed speed (P16: no longer only the presets). */
export type PlaybackRate = number;

export const DEFAULT_PLAYBACK_RATE: PlaybackRate = 1;

/** P16 #537: the slowest and fastest speeds, and the grid every speed is rounded to. */
export const MIN_PLAYBACK_RATE = 0.25;
export const MAX_PLAYBACK_RATE = 4;
export const PLAYBACK_RATE_GRID = 0.05;

/** The speed on the 0.05 grid, without float noise (1.1500000000000001 → 1.15). */
export function roundPlaybackRate(rate: number): number {
  return Math.round(Math.round(rate / PLAYBACK_RATE_GRID) * PLAYBACK_RATE_GRID * 100) / 100;
}

export function isValidPlaybackRate(rate: number): rate is PlaybackRate {
  return Number.isFinite(rate) && rate >= MIN_PLAYBACK_RATE - 1e-9 && rate <= MAX_PLAYBACK_RATE + 1e-9;
}

/**
 * A speed the player can take, on the 0.05 grid; null for anything outside 0.25×–4× or not a number (reject, do not
 * clamp: a stray value must never change the speed).
 */
export function normalizePlaybackRate(rate: unknown): PlaybackRate | null {
  if (typeof rate !== 'number' || !isValidPlaybackRate(rate)) {
    return null;
  }
  return roundPlaybackRate(rate);
}

export function formatPlaybackRateLabel(rate: number): string {
  if (rate === 1) {
    return '1x';
  }
  // Trim trailing zeros: 1.50 → 1.5
  const text = Number.isInteger(rate) ? String(rate) : String(rate);
  return `${text}x`;
}

/** The Player page's speed chip (screen 19): always one decimal at least — 1.0×, 1.5×, 0.75×, 2.0×. */
export function formatPlaybackRateChip(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) {
    return '1.0×';
  }
  const text = Number.isInteger(rate * 10) ? rate.toFixed(1) : String(Number(rate.toFixed(2)));
  return `${text}×`;
}
