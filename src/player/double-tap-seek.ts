/**
 * Double tap on the video surface. The zoom rule comes first: while zoomed, a double tap only returns the picture
 * to fitted. Otherwise the surface is split in thirds (physical left/right — never mirrored for RTL):
 * left third −10 s, middle third play/pause, right third +10 s.
 */

import { SEEK_STEP_SECONDS } from './types';

export type DoubleTapSeekSide = 'left' | 'right';

export type DoubleTapAction = 'resetZoom' | 'seekBack' | 'togglePlay' | 'seekForward';

/**
 * `x` is relative to the surface's left edge, `width` the surface width. The middle third includes both of its
 * edges (exactly 1/3 and 2/3 are play/pause). Null when the geometry is unknown and nothing is zoomed.
 */
export function resolveDoubleTapAction(
  x: number,
  width: number,
  zoomed: boolean,
): DoubleTapAction | null {
  'worklet';
  if (zoomed) {
    return 'resetZoom';
  }
  if (!Number.isFinite(x) || !Number.isFinite(width) || width <= 0) {
    return null;
  }
  if (x < width / 3) {
    return 'seekBack';
  }
  if (x > (width * 2) / 3) {
    return 'seekForward';
  }
  return 'togglePlay';
}

export function doubleTapSeekDelta(side: DoubleTapSeekSide): number {
  return side === 'left' ? -SEEK_STEP_SECONDS : SEEK_STEP_SECONDS;
}

export const SEEK_FEEDBACK_MS = 700;
