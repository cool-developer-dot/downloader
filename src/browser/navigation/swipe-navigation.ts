/**
 * B6 #45 Swipe navigation. With Android's gesture navigation both screen edges belong to the system (its Back
 * gesture already goes back a page), so the swipe lives on the browser's bottom toolbar: a horizontal swipe there is
 * Back or Forward, with an arrow that fills as the swipe passes the trigger. With 2- or 3-button navigation the page
 * edges are free, so a swipe that starts at a page edge works too. Right-to-left mirrors the direction: the finger
 * moving toward the reading start (right in English, left in Urdu) goes back. Pure.
 */

export type SwipeOutcome = 'back' | 'forward';

/** Distance that triggers (dp); a fast fling triggers after half of it. */
export const SWIPE_TRIGGER_DP = 80;
export const SWIPE_FLING_DP_PER_S = 900;
/** Width of the page-edge zones (button navigation only). */
export const SWIPE_EDGE_DP = 24;

/** Which way a horizontal movement `dx` (positive = finger moved right) goes. */
export function swipeDirection(dx: number, rtl: boolean): SwipeOutcome | null {
  if (!Number.isFinite(dx) || dx === 0) return null;
  const towardStart = rtl ? dx < 0 : dx > 0;
  return towardStart ? 'back' : 'forward';
}

/** 0…1 progress toward the trigger, for the arrow. */
export function swipeProgress(dx: number): number {
  if (!Number.isFinite(dx)) return 0;
  return Math.min(1, Math.abs(dx) / SWIPE_TRIGGER_DP);
}

/** What a finished swipe does; null when it was too short or there is nowhere to go. */
export function swipeOutcome(input: {
  dx: number;
  vx: number;
  rtl: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}): SwipeOutcome | null {
  const direction = swipeDirection(input.dx, input.rtl);
  if (!direction) return null;
  const distance = Math.abs(input.dx);
  const flingSameWay = Number.isFinite(input.vx) && Math.sign(input.vx) === Math.sign(input.dx);
  const fast = flingSameWay && Math.abs(input.vx) >= SWIPE_FLING_DP_PER_S && distance >= SWIPE_TRIGGER_DP / 2;
  if (distance < SWIPE_TRIGGER_DP && !fast) return null;
  if (direction === 'back' && !input.canGoBack) return null;
  if (direction === 'forward' && !input.canGoForward) return null;
  return direction;
}

/** Page-edge swipes only where the edges are not the system's. */
export function pageEdgeSwipesAvailable(mode: string | null | undefined): boolean {
  return mode === 'threeButton' || mode === 'twoButton';
}
