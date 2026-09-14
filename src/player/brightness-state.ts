/** Clamp brightness level to 0–1. */

export function clampBrightness(level: number): number {
  if (!Number.isFinite(level)) {
    return 0.5;
  }
  return Math.max(0, Math.min(1, level));
}

export function brightnessFromSwipe(
  startLevel: number,
  translationY: number,
  surfaceHeight: number,
): number {
  if (!Number.isFinite(surfaceHeight) || surfaceHeight <= 0) {
    return clampBrightness(startLevel);
  }
  const delta = -translationY / surfaceHeight;
  return clampBrightness(startLevel + delta);
}

export function levelToPercent(level: number): number {
  return Math.round(clampBrightness(level) * 100);
}
