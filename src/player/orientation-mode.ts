/** Manual player orientation preference — separate from fullscreen chrome. */

export type OrientationMode = 'auto' | 'portrait' | 'landscape';

export const ORIENTATION_MODES = ['auto', 'portrait', 'landscape'] as const;

export const DEFAULT_ORIENTATION_MODE: OrientationMode = 'auto';

export function isValidOrientationMode(value: unknown): value is OrientationMode {
  return (
    typeof value === 'string' &&
    (ORIENTATION_MODES as readonly string[]).includes(value)
  );
}

/** Fullscreen prefers landscape unless the user locked portrait. */
export function orientationForFullscreen(mode: OrientationMode): OrientationMode {
  return mode === 'portrait' ? 'portrait' : 'landscape';
}
