import { isJavaScriptAllowed, parseJavaScriptExceptions } from '@/browser/privacy/privacy-settings';
import { escapePanels } from '@/browser/startup/escape-panels';
import { useBrowserStore } from '@/browser/stores';
import { tabControllerRegistry } from '@/browser/tabs/tab-controller-registry';
import { isBrowserHomeUrl } from '@/browser/utils';
import { useSettingsStore } from '@/store/settings';

import { FIND_CLEAR_SCRIPT, findScript, findStepScript } from './find-in-page-script';
import {
  applyFindResult,
  CLOSED_FIND_STATE,
  shouldCloseFind,
  type FindResult,
  type FindState,
} from './find-in-page-state';

/**
 * B7 #66–#71 — Find in page: one bar for the tab in front. Searches run in the page (`find-in-page-script.ts`) and
 * answer with numbers on the browser-chrome channel (`onResult`). Typing waits 150 ms; the toggles search at once.
 * The bar closes (and the page's highlights are cleared) on close, Back, Esc, another tab in front, or navigation.
 */

const TYPING_DELAY_MS = 150;

type Listener = () => void;

let state: FindState = CLOSED_FIND_STATE;
const listeners = new Set<Listener>();
let typingTimer: ReturnType<typeof setTimeout> | null = null;
let releaseEscape: (() => void) | null = null;
let unwatch: (() => void) | null = null;

function set(next: FindState): void {
  if (next === state) return;
  state = next;
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // ignore
    }
  }
}

function inject(tabId: string | null, script: string): boolean {
  if (!tabId) return false;
  const webView = tabControllerRegistry.get(tabId)?.webViewRef.current;
  if (!webView) return false;
  try {
    webView.injectJavaScript(script);
    return true;
  } catch {
    return false;
  }
}

function runSearch(): void {
  if (!state.open || state.unavailable) return;
  const requestId = state.requestId + 1;
  set({ ...state, requestId, answered: !state.query.trim(), current: 0, total: 0, capped: false });
  inject(state.tabId, findScript({ requestId, query: state.query, matchCase: state.matchCase, wholeWord: state.wholeWord }));
}

function cancelTyping(): void {
  if (typingTimer) clearTimeout(typingTimer);
  typingTimer = null;
}

function watchFront(): () => void {
  return useBrowserStore.subscribe((browser) => {
    const front = browser.tabs.find((tab) => tab.id === browser.activeTabId);
    if (!front || shouldCloseFind(state, { tabId: front.id, url: front.url })) findInPage.close();
  });
}

export const findInPage = {
  getState(): FindState {
    return state;
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  isOpen(): boolean {
    return state.open;
  },

  /** #66: opens the bar for the page in front (not on the start page). False when there is no page. */
  open(): boolean {
    const browser = useBrowserStore.getState();
    const tab = browser.tabs.find((t) => t.id === browser.activeTabId);
    if (!tab || isBrowserHomeUrl(tab.url)) return false;
    if (state.open && state.tabId === tab.id) return true;
    if (state.open) findInPage.close();
    const settings = useSettingsStore.getState();
    const javaScript = isJavaScriptAllowed(
      tab.url,
      settings.javaScript !== false,
      parseJavaScriptExceptions(settings.javaScriptExceptions),
    );
    set({ ...CLOSED_FIND_STATE, open: true, tabId: tab.id, pageUrl: tab.url, unavailable: javaScript ? null : 'javascriptOff' });
    releaseEscape = escapePanels.open('findInPage', () => findInPage.close());
    unwatch = watchFront();
    return true;
  },

  setQuery(query: string): void {
    if (!state.open) return;
    set({ ...state, query, answered: false });
    cancelTyping();
    typingTimer = setTimeout(() => {
      typingTimer = null;
      runSearch();
    }, TYPING_DELAY_MS);
  },

  setMatchCase(on: boolean): void {
    if (!state.open || state.matchCase === on) return;
    cancelTyping();
    set({ ...state, matchCase: on });
    runSearch();
  },

  setWholeWord(on: boolean): void {
    if (!state.open || state.wholeWord === on) return;
    cancelTyping();
    set({ ...state, wholeWord: on });
    runSearch();
  },

  /** #68: next (1) / previous (-1), wrapping; Enter is next. A pending search runs first. */
  step(delta: 1 | -1): void {
    if (!state.open || state.unavailable || !state.query.trim()) return;
    if (typingTimer || !state.answered) {
      cancelTyping();
      runSearch();
      return;
    }
    if (state.total === 0) return;
    const requestId = state.requestId + 1;
    set({ ...state, requestId });
    inject(state.tabId, findStepScript(requestId, delta));
  },

  /** A page's `find_result` (see the browser-chrome bridge). */
  onResult(result: FindResult, fromTabId: string | null): void {
    set(applyFindResult(state, result, fromTabId));
  },

  /** #71: closes the bar and clears every highlight. */
  close(): void {
    if (!state.open) return;
    cancelTyping();
    const tabId = state.tabId;
    releaseEscape?.();
    releaseEscape = null;
    unwatch?.();
    unwatch = null;
    set(CLOSED_FIND_STATE);
    inject(tabId, FIND_CLEAR_SCRIPT);
  },
};
