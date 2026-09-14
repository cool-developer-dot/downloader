import { useCallback, useMemo } from 'react';

import {
  buildBrowserChromeBeforeContentScript,
  buildBrowserChromeInjectedScript,
  parseBrowserChromeMessage,
} from '@/browser/bridge';
import type { BrowserLinkLongPressPayload } from '@/browser/actions';
import { browserSyncService } from '@/browser/services/browser-sync.service';
import { useBrowserStore } from '@/browser/stores';
import { isBrowserHomeUrl } from '@/browser/utils';

export type BrowserChromeBridgeBindings = {
  injectedJavaScript: string;
  injectedJavaScriptBeforeContentLoaded: string;
  handleChromeMessage: (raw: string) => boolean;
};

type UseBrowserChromeBridgeOptions = {
  onLinkLongPress: (payload: BrowserLinkLongPressPayload) => void;
  /** Android-oriented pull-to-refresh (RN WebView prop is iOS-only). */
  onPullToRefresh?: () => void;
  /** Owning tab — SPA / scroll messages never update another tab's chrome. */
  tabId?: string;
  /** When false, ignore chrome-mutating bridge messages (parked WebView). */
  isActive?: boolean;
};

/**
 * Browser chrome WebView bridge (long-press + scroll + pull-to-refresh).
 * Returns whether a message was consumed so media detection can demux.
 */
export function useBrowserChromeBridge(
  options: UseBrowserChromeBridgeOptions,
): BrowserChromeBridgeBindings {
  const { onLinkLongPress, onPullToRefresh, tabId, isActive = true } = options;

  const injectedJavaScript = useMemo(
    () => buildBrowserChromeInjectedScript(),
    [],
  );

  const injectedJavaScriptBeforeContentLoaded = useMemo(
    () => buildBrowserChromeBeforeContentScript(),
    [],
  );

  const handleChromeMessage = useCallback(
    (raw: string): boolean => {
      const message = parseBrowserChromeMessage(raw);
      if (!message) {
        return false;
      }

      switch (message.type) {
        case 'ready':
          return true;
        case 'scroll': {
          if (!isActive) {
            return true;
          }
          const state = useBrowserStore.getState();
          const url = tabId
            ? state.tabs.find((t) => t.id === tabId)?.url ?? state.currentUrl
            : state.currentUrl;
          if (isBrowserHomeUrl(url) || state.isLoading) {
            return true;
          }
          browserSyncService.onScroll(url, message.payload.scrollY);
          return true;
        }
        case 'link_long_press': {
          if (!isActive) {
            return true;
          }
          onLinkLongPress(message.payload);
          return true;
        }
        case 'pull_to_refresh': {
          if (!isActive) {
            return true;
          }
          const state = useBrowserStore.getState();
          const url = tabId
            ? state.tabs.find((t) => t.id === tabId)?.url ?? state.currentUrl
            : state.currentUrl;
          if (isBrowserHomeUrl(url) || state.error != null) {
            return true;
          }
          onPullToRefresh?.();
          return true;
        }
        case 'spa_navigation': {
          // Parked WebViews must never rewrite active address bar / title.
          if (!isActive) {
            return true;
          }
          const state = useBrowserStore.getState();
          const owningUrl = tabId
            ? state.tabs.find((t) => t.id === tabId)?.url ?? state.currentUrl
            : state.currentUrl;
          if (isBrowserHomeUrl(owningUrl)) {
            return true;
          }
          if (tabId) {
            // updateTab mirrors chrome only if this tab is still active at apply time.
            state.updateTab(tabId, {
              url: message.payload.url,
              ...(message.payload.title ? { title: message.payload.title } : null),
            });
          } else {
            state.setCurrentUrl(message.payload.url);
            if (message.payload.title) {
              state.setPageTitle(message.payload.title);
            }
          }
          return true;
        }
        default:
          return true;
      }
    },
    [isActive, onLinkLongPress, onPullToRefresh, tabId],
  );

  return useMemo(
    () => ({
      injectedJavaScript,
      injectedJavaScriptBeforeContentLoaded,
      handleChromeMessage,
    }),
    [
      injectedJavaScript,
      injectedJavaScriptBeforeContentLoaded,
      handleChromeMessage,
    ],
  );
}
