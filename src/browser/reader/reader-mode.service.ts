import { useSyncExternalStore } from 'react';

import { useBrowserStore } from '@/browser/stores';
import { tabControllerRegistry } from '@/browser/tabs/tab-controller-registry';
import { isValidBrowserPageUrl } from '@/browser/utils';

import { buildReaderArticle, parseReaderMessage, READER_MESSAGE_PREFIX, type ReaderArticle } from './reader-article';
import { readerCheckScript, readerExtractScript } from './reader-scripts';

/**
 * B15 #161 — reader mode for the tab in front.
 *
 * - After a page finishes loading (or its address changes without a load), the page is asked whether it looks like an
 *   article (`readerCheckScript`). The answer is kept per tab with the address it was for, so the address bar's reader
 *   button shows only while that page is in front.
 * - Opening the reader asks the page for the article (`readerExtractScript`); the answer is sanitised and turned into
 *   blocks (`reader-article.ts`) and shown over the page by `ReaderView`. The page itself is never changed, so closing
 *   the reader (Back) leaves it exactly where it was.
 * - Pages with JavaScript off for their site never answer: no reader button there.
 */

const CHECK_DELAY_MS = 700;
const EXTRACT_TIMEOUT_MS = 15_000;

export type ReaderOpenState =
  | { status: 'loading'; tabId: string; url: string }
  | { status: 'ready'; tabId: string; url: string; article: ReaderArticle }
  | { status: 'failed'; tabId: string; url: string };

type State = {
  /** Per tab: the page's last answer and the address it was for. */
  checks: Readonly<Record<string, { url: string; readerable: boolean }>>;
  open: ReaderOpenState | null;
};

let state: State = { checks: {}, open: null };
const listeners = new Set<() => void>();
let requestCounter = 0;
/** The newest check / extract request per tab (older answers are ignored). */
const pendingChecks = new Map<string, number>();
let pendingExtract: { tabId: string; requestId: number } | null = null;
let checkTimer: ReturnType<typeof setTimeout> | null = null;
let extractTimer: ReturnType<typeof setTimeout> | null = null;
let unwatch: (() => void) | null = null;

function set(next: State): void {
  state = next;
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // ignore
    }
  }
}

/** The address without its #fragment (an in-page jump is the same article). */
export function readerPageKey(url: string): string {
  const at = url.indexOf('#');
  return at < 0 ? url : url.slice(0, at);
}

function inject(tabId: string, script: string): boolean {
  const webView = tabControllerRegistry.get(tabId)?.webViewRef.current;
  if (!webView) return false;
  try {
    webView.injectJavaScript(script);
    return true;
  } catch {
    return false;
  }
}

function checkFront(): void {
  checkTimer = null;
  const browser = useBrowserStore.getState();
  const tabId = browser.activeTabId;
  if (!tabId || browser.isLoading || !isValidBrowserPageUrl(browser.currentUrl)) return;
  const known = state.checks[tabId];
  if (known && known.url === readerPageKey(browser.currentUrl)) return;
  const requestId = ++requestCounter;
  pendingChecks.set(tabId, requestId);
  inject(tabId, readerCheckScript(requestId));
}

function scheduleCheck(): void {
  if (checkTimer) clearTimeout(checkTimer);
  checkTimer = setTimeout(checkFront, CHECK_DELAY_MS);
}

function finishExtract(next: ReaderOpenState | null): void {
  if (extractTimer) clearTimeout(extractTimer);
  extractTimer = null;
  pendingExtract = null;
  set({ ...state, open: next });
}

export const readerMode = {
  getState(): State {
    return state;
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /** Starts watching the tab in front (the browser screen's reader host calls this while mounted). */
  start(): () => void {
    if (!unwatch) {
      let last = '';
      unwatch = useBrowserStore.subscribe((browser) => {
        const key = `${browser.activeTabId}|${readerPageKey(browser.currentUrl)}|${browser.isLoading ? 1 : 0}`;
        if (key === last) return;
        last = key;
        // Closed tabs' answers go.
        const stale = Object.keys(state.checks).filter((id) => !browser.tabs.some((tab) => tab.id === id));
        if (stale.length) stale.forEach((id) => readerMode.forgetTab(id));
        // Leaving the page (another tab, another address) closes the reader.
        const open = state.open;
        if (open && (open.tabId !== browser.activeTabId || readerPageKey(browser.currentUrl) !== readerPageKey(open.url))) {
          finishExtract(null);
        }
        if (!browser.isLoading) scheduleCheck();
      });
      scheduleCheck();
    }
    return () => {
      unwatch?.();
      unwatch = null;
      if (checkTimer) clearTimeout(checkTimer);
      checkTimer = null;
    };
  },

  /**
   * The WebView's message handler offers every message here first; true = it was a reader message (handled or
   * ignored), so nothing else should look at it.
   */
  handleMessage(tabId: string | null | undefined, raw: string | null | undefined): boolean {
    if (typeof raw !== 'string' || !raw.startsWith(READER_MESSAGE_PREFIX)) return false;
    const message = parseReaderMessage(raw);
    if (!message || !tabId) return true;
    if (message.type === 'state') {
      if (pendingChecks.get(tabId) !== message.requestId) return true;
      pendingChecks.delete(tabId);
      set({ ...state, checks: { ...state.checks, [tabId]: { url: readerPageKey(message.url), readerable: message.readerable } } });
      return true;
    }
    if (!pendingExtract || pendingExtract.tabId !== tabId || pendingExtract.requestId !== message.requestId) return true;
    const open = state.open;
    if (!open || open.status !== 'loading') return true;
    const article = message.ok ? buildReaderArticle(message) : null;
    finishExtract(article ? { status: 'ready', tabId, url: open.url, article } : { status: 'failed', tabId, url: open.url });
    return true;
  },

  /** Opens the reader for the page in front (from the address bar button or the menu). */
  open(): void {
    const browser = useBrowserStore.getState();
    const tabId = browser.activeTabId;
    const url = browser.currentUrl;
    if (!tabId || !isValidBrowserPageUrl(url)) return;
    const requestId = ++requestCounter;
    pendingExtract = { tabId, requestId };
    set({ ...state, open: { status: 'loading', tabId, url } });
    if (!inject(tabId, readerExtractScript(requestId))) {
      finishExtract({ status: 'failed', tabId, url });
      return;
    }
    if (extractTimer) clearTimeout(extractTimer);
    extractTimer = setTimeout(() => {
      if (pendingExtract?.requestId === requestId) finishExtract({ status: 'failed', tabId, url });
    }, EXTRACT_TIMEOUT_MS);
  },

  close(): void {
    finishExtract(null);
  },

  /** A closed tab's answer is dropped. */
  forgetTab(tabId: string): void {
    if (!(tabId in state.checks)) return;
    const checks = { ...state.checks };
    delete checks[tabId];
    pendingChecks.delete(tabId);
    set({ ...state, checks });
  },
};

const getState = () => state;

export function useReaderState(): State {
  return useSyncExternalStore(readerMode.subscribe, getState, getState);
}

/** Whether the page in front answered that it is an article. */
export function useReaderAvailable(): boolean {
  const checks = useSyncExternalStore(readerMode.subscribe, () => state.checks, () => state.checks);
  const tabId = useBrowserStore((browser) => browser.activeTabId);
  const url = useBrowserStore((browser) => browser.currentUrl);
  const check = tabId ? checks[tabId] : undefined;
  return !!check && check.readerable && check.url === readerPageKey(url);
}
