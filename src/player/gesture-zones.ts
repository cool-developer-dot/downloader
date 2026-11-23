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

/**
 * P8 #582 — which way a one-finger swipe goes (the axis lock).
 *
 * The brightness (left edge) and volume (right edge) swipes have always started once the finger moves more than
 * `SIDE_SWIPE_ACTIVE_OFFSET_Y` (10 dp) up or down, and given up once it moves more than `SIDE_SWIPE_FAIL_OFFSET_X`
 * (16 dp) sideways first. Swipe seek uses the same two numbers the other way round: it starts after 16 dp sideways
 * and gives up after 10 dp up or down. So the first clear movement decides, for one finger, everywhere on the picture:
 *
 * - 10 dp up / down before 16 dp sideways → vertical: brightness or volume at the edges (exactly as before P8), nothing
 *   in the middle (as before);
 * - 16 dp sideways before 10 dp up / down → horizontal: swipe seek;
 * - both in the same movement (a fast diagonal flick) → neither (brightness and volume already ignored it).
 *
 * Swipe seek never starts sooner than 16 dp: a lower number would turn a slightly diagonal edge swipe that changes the
 * brightness today into a seek. A finger held still for half a second (2×, #545) gives up after 12 dp, before either
 * swipe can start; once 2× has started it keeps the touch. Two fingers belong to pinch zoom (both swipes are
 * one-finger only), and taps never move far enough to start a swipe.
 */
export const SIDE_SWIPE_ACTIVE_OFFSET_Y = 10;
export const SIDE_SWIPE_FAIL_OFFSET_X = 16;
export const SWIPE_SEEK_ACTIVE_OFFSET_X = SIDE_SWIPE_FAIL_OFFSET_X;
export const SWIPE_SEEK_FAIL_OFFSET_Y = SIDE_SWIPE_ACTIVE_OFFSET_Y;

export type SwipeAxis = 'vertical' | 'horizontal';

/**
 * The axis a swipe locks to, given how far the finger has moved from where it went down (`dx`, `dy` in dp), or null
 * while it is still undecided. Follows the gesture handler's own order for every recogniser — a recogniser checks
 * "give up?" before "start?" — so a movement past both thresholds at once decides nothing. Feed it the movements in
 * order and keep the first non-null answer (`lockSwipeAxis`).
 */
export function resolveSwipeAxis(dx: number, dy: number): SwipeAxis | 'neither' | null {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
    return null;
  }
  const sideways = Math.abs(dx) > SIDE_SWIPE_FAIL_OFFSET_X;
  const upDown = Math.abs(dy) > SIDE_SWIPE_ACTIVE_OFFSET_Y;
  if (sideways && upDown) {
    return 'neither';
  }
  if (upDown) {
    return 'vertical';
  }
  if (sideways) {
    return 'horizontal';
  }
  return null;
}

/** The axis a whole movement (points relative to where the finger went down, in order) locks to; null if undecided. */
export function lockSwipeAxis(path: readonly { dx: number; dy: number }[]): SwipeAxis | 'neither' | null {
  for (const point of path) {
    const axis = resolveSwipeAxis(point.dx, point.dy);
    if (axis) {
      return axis;
    }
  }
  return null;
}
