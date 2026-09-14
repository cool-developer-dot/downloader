/**
 * Double-tap seek region helpers — center zone only (outer strips = brightness/volume).
 */

import { resolveSideGestureZone } from './gesture-zones';
import { SEEK_STEP_SECONDS } from './types';

export type DoubleTapSeekSide = 'left' | 'right';

export function resolveDoubleTapSide(
  x: number,
  width: number,
): DoubleTapSeekSide | null {
  if (!Number.isFinite(x) || !Number.isFinite(width) || width <= 0) {
    return null;
  }
  if (resolveSideGestureZone(x, width) !== 'center') {
    return null;
  }
  const centerStart = width * 0.25;
  const centerWidth = width * 0.5;
  return resolveCenterDoubleTapSide(x - centerStart, centerWidth);
}

/** Double-tap x relative to the center gesture zone. */
export function resolveCenterDoubleTapSide(
  localX: number,
  centerWidth: number,
): DoubleTapSeekSide | null {
  if (!Number.isFinite(localX) || !Number.isFinite(centerWidth) || centerWidth <= 0) {
    return null;
  }
  return localX < centerWidth / 2 ? 'left' : 'right';
}

export function doubleTapSeekDelta(side: DoubleTapSeekSide): number {
  return side === 'left' ? -SEEK_STEP_SECONDS : SEEK_STEP_SECONDS;
}

export const SEEK_FEEDBACK_MS = 700;
