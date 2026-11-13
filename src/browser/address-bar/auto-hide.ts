/**
 * B4 #29 Auto-hide address bar. A small state machine over the page's scroll reports (the existing `scroll` bridge
 * message, ≤ 5/s): scrolling down hides the bar, scrolling up shows it, and it is always shown at the top of the
 * page, while the page loads, while the address bar is being edited and while "Video available" is offered. The
 * download bar is never hidden (it is not part of this). Pure.
 */

export const AUTO_HIDE_TOP_PX = 32;
export const AUTO_HIDE_HIDE_AFTER_PX = 72;
export const AUTO_HIDE_SHOW_AFTER_PX = 36;

export type AutoHideState = {
  hidden: boolean;
  /** Where the current scroll direction began. */
  anchorY: number;
  lastY: number;
  direction: 'down' | 'up' | 'none';
};

export const INITIAL_AUTO_HIDE: AutoHideState = { hidden: false, anchorY: 0, lastY: 0, direction: 'none' };

/** Reasons the bar must be visible right now, whatever the scroll does. */
export type AutoHideHold = {
  enabled: boolean;
  loading: boolean;
  editing: boolean;
  videoOffer: boolean;
};

export function isHeld(hold: AutoHideHold): boolean {
  return !hold.enabled || hold.loading || hold.editing || hold.videoOffer;
}

/** The state after the page reported scroll position `y`. */
export function onAutoHideScroll(state: AutoHideState, y: number, hold: AutoHideHold): AutoHideState {
  const scrollY = Math.max(0, Number.isFinite(y) ? y : 0);
  if (isHeld(hold) || scrollY <= AUTO_HIDE_TOP_PX) {
    return { hidden: false, anchorY: scrollY, lastY: scrollY, direction: 'none' };
  }
  const delta = scrollY - state.lastY;
  if (delta === 0) return state;
  const direction = delta > 0 ? 'down' : 'up';
  const anchorY = direction === state.direction ? state.anchorY : state.lastY;
  let hidden = state.hidden;
  if (direction === 'down' && !hidden && scrollY - anchorY >= AUTO_HIDE_HIDE_AFTER_PX) {
    hidden = true;
  } else if (direction === 'up' && hidden && anchorY - scrollY >= AUTO_HIDE_SHOW_AFTER_PX) {
    hidden = false;
  }
  return { hidden, anchorY: hidden !== state.hidden ? scrollY : anchorY, lastY: scrollY, direction };
}

/** A hold (loading, editing, an offer, the setting turned off) shows the bar at once. */
export function onAutoHideHold(state: AutoHideState, hold: AutoHideHold): AutoHideState {
  return isHeld(hold) && state.hidden ? { ...state, hidden: false, anchorY: state.lastY, direction: 'none' } : state;
}
