import {
  createContext,
  useContext,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
} from 'react';
import type WebView from 'react-native-webview';

import type { BrowserEngineCommands } from '@/browser/types';

export type ChromeNavState = {
  stack: string[];
  index: number;
};

export interface BrowserEngineContextValue extends BrowserEngineCommands {
  /** Phase 3B — owning tab for this controller (optional for noop facade). */
  tabId?: string;
  webViewRef: RefObject<WebView | null>;
  /** Live URI bound to the WebView `source` prop (chrome navigations + home blank). */
  sourceUri: string;
  /** Chrome navigation epoch — event handlers ignore stale completions. */
  navigationEpochRef: MutableRefObject<number>;
  /**
   * Epoch of the active document load. Seeded by chrome loadUrl/reload so
   * onError can correlate before native onLoadStart arrives.
   */
  loadStartEpochRef: MutableRefObject<number>;
  /**
   * URL for the active document load / chrome navigation intent.
   * Used when native error payloads omit `url` (Domain: undefined).
   */
  loadStartUrlRef: MutableRefObject<string | null>;
  /** Omnibox navigation stack used when native history flags are wrong. */
  chromeNavRef: MutableRefObject<ChromeNavState>;
  /** Last canGoBack reported by the WebView (not chrome-merged). */
  nativeCanGoBackRef: MutableRefObject<boolean>;
  /** Last canGoForward reported by the WebView (not chrome-merged). */
  nativeCanGoForwardRef: MutableRefObject<boolean>;
  /** Recompute store canGoBack/canGoForward from native + chrome stack. */
  publishChromeHistoryFlags: () => void;
  /** Suppress the next ERR_CONNECTION_ABORTED surfaced after user Stop. */
  suppressNextAbortErrorRef: MutableRefObject<boolean>;
  /**
   * Armed while a user-initiated native Back is in flight.
   *
   * A WebView seeded from Home starts on about:blank, so that blank stays as the
   * first back-history entry. Back into it committed a blank document that the
   * transient-blank guard ignored: blank page, stale URL, Back still enabled and
   * doing nothing. The flag tells the two cases apart — cleared by every
   * intentional chrome navigation.
   */
  pendingNativeBackRef: MutableRefObject<boolean>;
  /** Stable WebView instance generation — increments only on mount. */
  webViewInstanceGenerationRef: MutableRefObject<number>;
}

const BrowserEngineContext = createContext<BrowserEngineContextValue | null>(null);

export type BrowserEngineProviderProps = {
  value: BrowserEngineContextValue;
  children: ReactNode;
};

export function BrowserEngineProvider({ value, children }: BrowserEngineProviderProps) {
  return (
    <BrowserEngineContext.Provider value={value}>{children}</BrowserEngineContext.Provider>
  );
}

export function useBrowserEngineContext(): BrowserEngineContextValue {
  const context = useContext(BrowserEngineContext);

  if (!context) {
    throw new Error('useBrowserEngineContext must be used within BrowserEngineProvider');
  }

  return context;
}
