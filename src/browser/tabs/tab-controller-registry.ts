import type { MutableRefObject, RefObject } from 'react';
import type WebView from 'react-native-webview';

import type { BrowserEngineContextValue, ChromeNavState } from '@/browser/engine';

export type TabWebViewController = BrowserEngineContextValue & {
  tabId: string;
};

type RegistryState = {
  controllers: Map<string, TabWebViewController>;
  version: number;
};

const state: RegistryState = {
  controllers: new Map(),
  version: 0,
};

const listeners = new Set<() => void>();

function emit(): void {
  state.version += 1;
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // ignore
    }
  });
}

export const tabControllerRegistry = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  getVersion(): number {
    return state.version;
  },

  register(tabId: string, controller: TabWebViewController): void {
    state.controllers.set(tabId, controller);
    emit();
  },

  unregister(tabId: string): void {
    state.controllers.delete(tabId);
    emit();
  },

  get(tabId: string): TabWebViewController | undefined {
    return state.controllers.get(tabId);
  },

  getActive(activeTabId: string): TabWebViewController | undefined {
    return state.controllers.get(activeTabId);
  },
};

/** Stable no-op controller used before the active mount registers. */
export function createNoopTabController(tabId: string): TabWebViewController {
  const webViewRef = { current: null } as RefObject<WebView | null>;
  const navigationEpochRef = { current: 0 } as MutableRefObject<number>;
  const loadStartEpochRef = { current: 0 } as MutableRefObject<number>;
  const loadStartUrlRef = { current: null } as MutableRefObject<string | null>;
  const chromeNavRef = {
    current: { stack: [], index: -1 },
  } as MutableRefObject<ChromeNavState>;
  const nativeCanGoBackRef = { current: false } as MutableRefObject<boolean>;
  const nativeCanGoForwardRef = { current: false } as MutableRefObject<boolean>;
  const suppressNextAbortErrorRef = { current: false } as MutableRefObject<boolean>;
  const webViewInstanceGenerationRef = { current: 1 } as MutableRefObject<number>;

  return {
    tabId,
    webViewRef,
    sourceUri: 'about:blank',
    navigationEpochRef,
    loadStartEpochRef,
    loadStartUrlRef,
    chromeNavRef,
    nativeCanGoBackRef,
    nativeCanGoForwardRef,
    suppressNextAbortErrorRef,
    webViewInstanceGenerationRef,
    publishChromeHistoryFlags: () => undefined,
    goBack: () => undefined,
    goForward: () => undefined,
    reload: () => undefined,
    stopLoading: () => undefined,
    loadUrl: () => undefined,
    goHome: () => undefined,
  };
}
