/**
 * Horizontal gesture zones on the video surface.
 * Outer 25% → brightness / volume; center 50% → playback gestures.
 */

export const SIDE_ZONE_RATIO = 0.25;

export type SideGestureZone = 'brightness' | 'center' | 'volume';

export function resolveSideGestureZone(
  x: number,
  width: number,
): SideGestureZone | null {
  if (!Number.isFinite(x) || !Number.isFinite(width) || width <= 0) {
    return null;
  }
  const ratio = x / width;
  if (ratio < SIDE_ZONE_RATIO) {
    return 'brightness';
  }
  if (ratio > 1 - SIDE_ZONE_RATIO) {
    return 'volume';
  }
  return 'center';
}

export function sideZoneStyle(
  zone: SideGestureZone,
): { left?: `${number}%`; width: `${number}%` } {
  const centerWidth = (1 - SIDE_ZONE_RATIO * 2) * 100;
  switch (zone) {
    case 'brightness':
      return { left: '0%', width: `${SIDE_ZONE_RATIO * 100}%` };
    case 'volume':
      return { left: `${(1 - SIDE_ZONE_RATIO) * 100}%`, width: `${SIDE_ZONE_RATIO * 100}%` };
    case 'center':
    default:
      return { left: `${SIDE_ZONE_RATIO * 100}%`, width: `${centerWidth}%` };
  }
}
