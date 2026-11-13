/**
 * B6 #46 / #47: the small floating ↑ / ↓ button. It appears after a fast scroll on a long page — ↑ (to the top) when
 * flinging up, ↓ (to the bottom) when flinging down — and fades out a few seconds after the fast scrolling stops, or
 * at once when the page is already at that end. Fed by the page's scroll reports (`scroll` bridge message, ≤ 5/s,
 * with the page and window heights). Pure.
 */

export type ScrollJumpTarget = 'top' | 'bottom';

export type ScrollReport = {
  /** Scroll position, page height and visible height in CSS px. */
  y: number;
  height: number;
  viewHeight: number;
  /** ms */
  at: number;
};

export type FastScrollState = {
  last: ScrollReport | null;
  target: ScrollJumpTarget | null;
  /** When the button was last (re)armed by a fast scroll. */
  shownAt: number;
};

export const INITIAL_FAST_SCROLL: FastScrollState = { last: null, target: null, shownAt: 0 };

/** CSS px per ms (2 000 px/s). */
export const FAST_SCROLL_SPEED = 2;
/** A long page: at least this many screens. */
export const LONG_PAGE_SCREENS = 3;
export const SCROLL_JUMP_VISIBLE_MS = 2_500;

function atTop(report: ScrollReport): boolean {
  return report.y <= report.viewHeight * 0.5;
}

function atBottom(report: ScrollReport): boolean {
  return report.y + report.viewHeight >= report.height - report.viewHeight * 0.5;
}

function valid(report: ScrollReport): boolean {
  return [report.y, report.height, report.viewHeight, report.at].every(Number.isFinite) && report.viewHeight > 0;
}

export function onFastScrollReport(state: FastScrollState, report: ScrollReport): FastScrollState {
  if (!valid(report)) return state;
  const last = state.last;
  let { target, shownAt } = state;
  const longPage = report.height >= report.viewHeight * LONG_PAGE_SCREENS;
  if (last && longPage && report.at > last.at) {
    const speed = (report.y - last.y) / (report.at - last.at);
    if (Math.abs(speed) >= FAST_SCROLL_SPEED) {
      target = speed < 0 ? 'top' : 'bottom';
      shownAt = report.at;
    }
  }
  // Nothing to jump to once the page is at that end.
  if ((target === 'top' && atTop(report)) || (target === 'bottom' && atBottom(report)) || !longPage) {
    target = null;
  }
  return { last: report, target, shownAt };
}

/** The button should fade now. */
export function fastScrollExpired(state: FastScrollState, now: number): boolean {
  return state.target != null && now - state.shownAt >= SCROLL_JUMP_VISIBLE_MS;
}

export function hideFastScroll(state: FastScrollState): FastScrollState {
  return state.target == null ? state : { ...state, target: null };
}
