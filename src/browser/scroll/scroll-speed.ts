/**
 * B6 #53 Scroll speed. Android sets the speed of a touch fling itself (the WebView's own scroller), so this setting
 * controls what the app scrolls: the starting speed of Auto scroll and how far one Volume-key / button step goes.
 * Pure.
 */

export type ScrollSpeed = 'slow' | 'normal' | 'fast';

export const SCROLL_SPEEDS: readonly ScrollSpeed[] = ['slow', 'normal', 'fast'];
export const DEFAULT_SCROLL_SPEED: ScrollSpeed = 'normal';

export function normalizeScrollSpeed(value: unknown): ScrollSpeed {
  return value === 'slow' || value === 'fast' ? value : DEFAULT_SCROLL_SPEED;
}

/**
 * One step (a Volume key press) as a share of the page's visible height: a screen with some overlap, so the line at
 * the bottom is still on screen after the step. Slow moves half a screen.
 */
export function scrollStepFraction(speed: ScrollSpeed): number {
  switch (speed) {
    case 'slow':
      return 0.5;
    case 'fast':
      return 0.95;
    default:
      return 0.85;
  }
}
