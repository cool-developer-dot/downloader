/**
 * B15 #161 — reader mode's state changes, pure (the service in reader-mode.service.ts applies them).
 */
import { buildReaderArticle, type ReaderArticle, type ReaderMessage } from './reader-article';

export type ReaderOpenState =
  | { status: 'loading'; tabId: string; url: string }
  | { status: 'ready'; tabId: string; url: string; article: ReaderArticle }
  | { status: 'failed'; tabId: string; url: string };

export type ReaderModeState = {
  /** Per tab: the page's last answer and the address (without #fragment) it was for. */
  checks: Readonly<Record<string, { url: string; readerable: boolean }>>;
  open: ReaderOpenState | null;
  /** The newest check request per tab (older answers are ignored). */
  pendingChecks: Readonly<Record<string, number>>;
  /** The article request being waited for. */
  pendingExtract: { tabId: string; requestId: number } | null;
};

export const INITIAL_READER_STATE: ReaderModeState = { checks: {}, open: null, pendingChecks: {}, pendingExtract: null };

/** The address without its #fragment (an in-page jump is the same article). */
export function readerPageKey(url: string): string {
  const at = url.indexOf('#');
  return at < 0 ? url : url.slice(0, at);
}

export type FrontPage = { tabId: string | null; url: string; isLoading: boolean; tabIds: readonly string[] };

/**
 * The tab in front changed (another tab, another address, loading started or finished): the reader closes when its
 * page is no longer in front, and closed tabs' answers go.
 */
export function onFrontChange(state: ReaderModeState, front: FrontPage): ReaderModeState {
  let next = state;
  const open = state.open;
  if (open && (open.tabId !== front.tabId || readerPageKey(front.url) !== readerPageKey(open.url))) {
    next = { ...next, open: null, pendingExtract: null };
  }
  const stale = Object.keys(state.checks).filter((id) => !front.tabIds.includes(id));
  const stalePending = Object.keys(state.pendingChecks).filter((id) => !front.tabIds.includes(id));
  if (stale.length || stalePending.length) {
    const checks = { ...next.checks };
    const pendingChecks = { ...next.pendingChecks };
    for (const id of stale) delete checks[id];
    for (const id of stalePending) delete pendingChecks[id];
    next = { ...next, checks, pendingChecks };
  }
  return next;
}

/** Whether the page in front should be asked whether it is an article. */
export function needsCheck(state: ReaderModeState, front: { tabId: string | null; url: string; isLoading: boolean }): boolean {
  if (!front.tabId || front.isLoading) return false;
  const known = state.checks[front.tabId];
  return !known || known.url !== readerPageKey(front.url);
}

export function onCheckSent(state: ReaderModeState, tabId: string, requestId: number): ReaderModeState {
  return { ...state, pendingChecks: { ...state.pendingChecks, [tabId]: requestId } };
}

export function onOpenRequested(state: ReaderModeState, tabId: string, url: string, requestId: number): ReaderModeState {
  return { ...state, open: { status: 'loading', tabId, url }, pendingExtract: { tabId, requestId } };
}

/** The request timed out or could not be sent. Ignored when it is no longer the one being waited for. */
export function onOpenFailed(state: ReaderModeState, requestId: number): ReaderModeState {
  if (state.pendingExtract?.requestId !== requestId || state.open?.status !== 'loading') return state;
  return { ...state, open: { status: 'failed', tabId: state.open.tabId, url: state.open.url }, pendingExtract: null };
}

export function onClose(state: ReaderModeState): ReaderModeState {
  return state.open || state.pendingExtract ? { ...state, open: null, pendingExtract: null } : state;
}

/** A page's answer from tab `tabId`. Only the newest request of that same tab counts. */
export function onReaderMessage(state: ReaderModeState, tabId: string, message: ReaderMessage): ReaderModeState {
  if (message.type === 'state') {
    if (state.pendingChecks[tabId] !== message.requestId) return state;
    const pendingChecks = { ...state.pendingChecks };
    delete pendingChecks[tabId];
    return {
      ...state,
      pendingChecks,
      checks: { ...state.checks, [tabId]: { url: readerPageKey(message.url), readerable: message.readerable } },
    };
  }
  const pending = state.pendingExtract;
  const open = state.open;
  if (!pending || pending.tabId !== tabId || pending.requestId !== message.requestId) return state;
  if (!open || open.status !== 'loading') return state;
  const article = message.ok ? buildReaderArticle(message) : null;
  return {
    ...state,
    pendingExtract: null,
    open: article ? { status: 'ready', tabId, url: open.url, article } : { status: 'failed', tabId, url: open.url },
  };
}

/** Whether the reader button shows for the page in front. */
export function isReaderAvailable(state: ReaderModeState, tabId: string | null, url: string): boolean {
  const check = tabId ? state.checks[tabId] : undefined;
  return !!check && check.readerable && check.url === readerPageKey(url);
}
