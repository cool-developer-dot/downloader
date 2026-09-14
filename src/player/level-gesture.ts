import { clampBrightness } from './brightness-state';
import { clampVolume } from './volume-state';

/** Map vertical drag delta to a 0–1 level from gesture start value. */
export function levelFromSwipeDelta(
  startLevel: number,
  translationY: number,
  trackHeight: number,
  clamp: (value: number) => number = clampBrightness,
): number {
  if (!Number.isFinite(trackHeight) || trackHeight <= 0) {
    return clamp(startLevel);
  }
  const delta = -translationY / trackHeight;
  return clamp(startLevel + delta);
}

/** Map tap position within track (top = 100%) to 0–1 level. */
export function levelFromTapY(
  tapY: number,
  trackHeight: number,
  clamp: (value: number) => number = clampBrightness,
): number {
  if (!Number.isFinite(trackHeight) || trackHeight <= 0) {
    return clamp(0.5);
  }
  const ratio = 1 - tapY / trackHeight;
  return clamp(ratio);
}

export function clampLevel(value: number): number {
  return clampVolume(value) ?? clampBrightness(value);
}
