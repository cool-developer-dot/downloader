/**
 * B7 — the find bar's state and its rules. Pure (the service applies them).
 */

export type FindState = {
  open: boolean;
  /** The tab the bar belongs to (it closes when another tab comes to the front or this one navigates). */
  tabId: string | null;
  /** The page it was opened on. */
  pageUrl: string | null;
  query: string;
  matchCase: boolean;
  wholeWord: boolean;
  /** The latest request; answers to older ones are dropped. */
  requestId: number;
  /** 1-based; 0 with no match. */
  current: number;
  total: number;
  capped: boolean;
  /** An answer to the latest request has come back. */
  answered: boolean;
  /** The page can't be searched: JavaScript is off for this site (B12). */
  unavailable: 'javascriptOff' | null;
  /** Bumped to put the cursor back in the field (Ctrl+F while the bar is open). */
  focusTick: number;
};

export const CLOSED_FIND_STATE: FindState = {
  open: false,
  tabId: null,
  pageUrl: null,
  query: '',
  matchCase: false,
  wholeWord: false,
  requestId: 0,
  current: 0,
  total: 0,
  capped: false,
  answered: false,
  unavailable: null,
  focusTick: 0,
};

export type FindResult = { requestId: number; current: number; total: number; capped: boolean };

/** Takes a page's answer only when it is for the latest request of the open bar's tab. */
export function applyFindResult(state: FindState, result: FindResult, fromTabId: string | null): FindState {
  if (!state.open || fromTabId !== state.tabId || result.requestId !== state.requestId) return state;
  return { ...state, current: result.current, total: result.total, capped: result.capped, answered: true };
}

export type FindCountLabel =
  | { kind: 'empty' }
  | { kind: 'searching' }
  | { kind: 'none' }
  | { kind: 'count'; current: number; total: string };

/** What the bar shows next to the field: nothing, "No matches", or "3 of 12" ("3 of 1000+" when capped). */
export function findCountLabel(state: FindState): FindCountLabel {
  if (!state.query.trim()) return { kind: 'empty' };
  if (!state.answered) return { kind: 'searching' };
  if (state.total === 0) return { kind: 'none' };
  return { kind: 'count', current: state.current, total: state.capped ? `${state.total}+` : String(state.total) };
}

/** Whether the bar should close for what the tab in front shows now. */
export function shouldCloseFind(state: FindState, front: { tabId: string; url: string }): boolean {
  if (!state.open) return false;
  return front.tabId !== state.tabId || front.url !== state.pageUrl;
}
