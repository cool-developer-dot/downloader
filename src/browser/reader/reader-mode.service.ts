import { useSyncExternalStore } from 'react';

import { useBrowserStore } from '@/browser/stores';
import { tabControllerRegistry } from '@/browser/tabs/tab-controller-registry';
import { isValidBrowserPageUrl } from '@/browser/utils';

import { parseReaderMessage, READER_MESSAGE_PREFIX } from './reader-article';
import {
  INITIAL_READER_STATE,
  isReaderAvailable,
  needsCheck,
  onCheckSent,
  onClose,
  onFrontChange,
  onOpenFailed,
  onOpenRequested,
  onReaderMessage,
  readerPageKey,
  type ReaderModeState,
} from './reader-mode-state';
import { readerCheckScript, readerExtractScript } from './reader-scripts';

export type { ReaderOpenState } from './reader-mode-state';

/**
 * B15 #161 — reader mode for the tab in front (state changes in reader-mode-state.ts).
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

let state: ReaderModeState = INITIAL_READER_STATE;
const listeners = new Set<() => void>();
let requestCounter = 0;
let checkTimer: ReturnType<typeof setTimeout> | null = null;
let extractTimer: ReturnType<typeof setTimeout> | null = null;
let unwatch: (() => void) | null = null;

function set(next: ReaderModeState): void {
  if (next === state) return;
  state = next;
  if (!state.pendingExtract && extractTimer) {
    clearTimeout(extractTimer);
    extractTimer = null;
  }
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // ignore
    }
  }
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
  const front = { tabId: browser.activeTabId, url: browser.currentUrl, isLoading: browser.isLoading };
  if (!front.tabId || !isValidBrowserPageUrl(front.url) || !needsCheck(state, front)) return;
  const requestId = ++requestCounter;
  set(onCheckSent(state, front.tabId, requestId));
  inject(front.tabId, readerCheckScript(requestId));
}

function scheduleCheck(): void {
  if (checkTimer) clearTimeout(checkTimer);
  checkTimer = setTimeout(checkFront, CHECK_DELAY_MS);
}

export const readerMode = {
  getState(): ReaderModeState {
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
        const key = `${browser.activeTabId}|${readerPageKey(browser.currentUrl)}|${browser.isLoading ? 1 : 0}|${browser.tabs.length}`;
        if (key === last) return;
        last = key;
        set(
          onFrontChange(state, {
            tabId: browser.activeTabId,
            url: browser.currentUrl,
            isLoading: browser.isLoading,
            tabIds: browser.tabs.map((tab) => tab.id),
          }),
        );
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
    if (message && tabId) set(onReaderMessage(state, tabId, message));
    return true;
  },

  /** Opens the reader for the page in front (from the address bar button or the menu). */
  open(): void {
    const browser = useBrowserStore.getState();
    const tabId = browser.activeTabId;
    const url = browser.currentUrl;
    if (!tabId || !isValidBrowserPageUrl(url)) return;
    const requestId = ++requestCounter;
    set(onOpenRequested(state, tabId, url, requestId));
    if (!inject(tabId, readerExtractScript(requestId))) {
      set(onOpenFailed(state, requestId));
      return;
    }
    if (extractTimer) clearTimeout(extractTimer);
    extractTimer = setTimeout(() => {
      extractTimer = null;
      set(onOpenFailed(state, requestId));
    }, EXTRACT_TIMEOUT_MS);
  },

  close(): void {
    set(onClose(state));
  },
};

const getState = () => state;

export function useReaderState(): ReaderModeState {
  return useSyncExternalStore(readerMode.subscribe, getState, getState);
}

/** Whether the page in front answered that it is an article. */
export function useReaderAvailable(): boolean {
  const current = useSyncExternalStore(readerMode.subscribe, getState, getState);
  const tabId = useBrowserStore((browser) => browser.activeTabId);
  const url = useBrowserStore((browser) => browser.currentUrl);
  return isReaderAvailable(current, tabId, url);
}
