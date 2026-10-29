import type { ScrollSpeed } from './scroll-speed.ts';

/**
 * B6 #54 Auto scroll (Menu → Auto scroll): the page scrolls on by itself, with a floating control to pause / resume,
 * go slower / faster, and stop. It stops at the bottom of the page, on navigation (another page or another tab) and
 * when the app goes to the background; a touch on the page pauses it. Pure state machine.
 */

/** CSS px per second, slowest to fastest; Scroll speed (#53) picks the starting level. */
export const AUTO_SCROLL_LEVELS: readonly number[] = [15, 25, 40, 60, 90, 135, 200];

export type AutoScrollStatus = 'off' | 'running' | 'paused';

export type AutoScrollState = { status: AutoScrollStatus; level: number };

export type AutoScrollEvent =
  | { type: 'start'; speed: ScrollSpeed }
  | { type: 'toggle' }
  | { type: 'pause' }
  | { type: 'faster' }
  | { type: 'slower' }
  | { type: 'stop' }
  | { type: 'touched' }
  | { type: 'reachedBottom' }
  | { type: 'navigated' }
  | { type: 'background' };

export const AUTO_SCROLL_OFF: AutoScrollState = { status: 'off', level: 2 };

export function startLevel(speed: ScrollSpeed): number {
  return speed === 'slow' ? 1 : speed === 'fast' ? 4 : 2;
}

export function autoScrollPixelsPerSecond(level: number): number {
  const index = Math.max(0, Math.min(AUTO_SCROLL_LEVELS.length - 1, Math.round(level)));
  return AUTO_SCROLL_LEVELS[index]!;
}

export function nextAutoScroll(state: AutoScrollState, event: AutoScrollEvent): AutoScrollState {
  const top = AUTO_SCROLL_LEVELS.length - 1;
  switch (event.type) {
    case 'start':
      return { status: 'running', level: startLevel(event.speed) };
    case 'toggle':
      if (state.status === 'off') return state;
      return { ...state, status: state.status === 'running' ? 'paused' : 'running' };
    case 'pause':
    case 'touched':
      return state.status === 'running' ? { ...state, status: 'paused' } : state;
    case 'faster':
      return state.status === 'off' ? state : { ...state, level: Math.min(top, state.level + 1) };
    case 'slower':
      return state.status === 'off' ? state : { ...state, level: Math.max(0, state.level - 1) };
    case 'stop':
    case 'reachedBottom':
    case 'navigated':
    case 'background':
      return state.status === 'off' ? state : { ...state, status: 'off' };
    default:
      return state;
  }
}
