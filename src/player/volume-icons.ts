import { levelToPercent } from '@/player/brightness-state';

/** Volume icon tiers for player controls and HUD. */
export function resolveVolumeIcon(level: number, isMuted = false): string {
  if (isMuted || level <= 0) {
    return 'volume-off';
  }
  const percent = levelToPercent(level);
  if (percent <= 35) {
    return 'volume-low';
  }
  if (percent <= 70) {
    return 'volume-medium';
  }
  return 'volume-high';
}

/** Orientation icon for the current lock mode. */
export function resolveOrientationIcon(mode: 'auto' | 'portrait' | 'landscape'): string {
  switch (mode) {
    case 'landscape':
      return 'phone-rotate-landscape';
    case 'portrait':
      return 'phone-rotate-portrait';
    case 'auto':
    default:
      return 'screen-rotation';
  }
}
