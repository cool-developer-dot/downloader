/**
 * P1 #527 Custom Seek Interval: how far the Player jumps for the "10 s" tile, the full-screen ⏪ / ⏩ buttons and a
 * double tap on either side of the picture. One of a fixed set, so every label and spoken hint stays exact.
 */

import { SEEK_STEP_SECONDS } from './types';

export const SEEK_STEP_OPTIONS = [5, 10, 15, 20, 30, 60] as const;

export type SeekStepSeconds = (typeof SEEK_STEP_OPTIONS)[number];

export const DEFAULT_SEEK_STEP_SECONDS: SeekStepSeconds = SEEK_STEP_SECONDS;

export function isSeekStepSeconds(value: unknown): value is SeekStepSeconds {
  return typeof value === 'number' && (SEEK_STEP_OPTIONS as readonly number[]).includes(value);
}

/** A stored value that is not one of the options (an older build, a damaged store) reads as the default. */
export function normalizeSeekStepSeconds(value: unknown): SeekStepSeconds {
  return isSeekStepSeconds(value) ? value : DEFAULT_SEEK_STEP_SECONDS;
}
