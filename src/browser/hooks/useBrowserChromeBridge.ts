import { useCallback, useMemo } from 'react';

import {
  buildBrowserChromeBeforeContentScript,
  buildBrowserChromeInjectedScript,
  parseBrowserChromeMessage,
} from '@/browser/bridge';
import type { BrowserLinkLongPressPayload } from '@/browser/actions';
import { webFullscreen } from '@/browser/fullscreen/web-fullscreen.runtime';
import { browserSyncService } from '@/browser/services/browser-sync.service';
import { receivePageLinks } from '@/browser/services/page-link-grabber';
import { addressBarVisibility } from '@/browser/address-bar/address-bar-visibility';
import { pageActivity } from '@/browser/scroll/page-activity';
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
 * Browser chrome WebView bridge (long-press + scroll + pull-to-refresh + website fullscreen).
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
          // B4 #29: Auto-hide follows the active page's scrolling (it ignores everything while the setting is off).
          addressBarVisibility.onPageScroll(message.payload.scrollY);
          // B6 #46 / #47: a fast scroll on a long page offers the ↑ / ↓ jump button.
          pageActivity.onScroll({
            y: message.payload.scrollY,
            height: message.payload.height,
            viewHeight: message.payload.viewHeight,
          });
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
        case 'auto_scroll': {
          // B6 #54: the page's loop reached the bottom or a touch paused it.
          if (isActive) {
            pageActivity.onAutoScrollEvent(message.payload.event);
          }
          return true;
        }
        case 'media_state': {
          // B6 #240: volume keys keep their job while the page plays audible media.
          const owner = tabId ?? useBrowserStore.getState().activeTabId;
          pageActivity.setMediaPlaying(owner, message.payload.playing);
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
        case 'fullscreen': {
          // A parked tab's page is told to leave again — only the active tab may cover the app.
          const owningTabId = tabId ?? useBrowserStore.getState().activeTabId;
          const { active, width, height } = message.payload;
          webFullscreen.onPageReport(owningTabId, isActive, {
            active,
            size: width != null && height != null ? { width, height } : null,
          });
          return true;
        }
        case 'page_links': {
          // Page Link Grabber (#484): only a grab the app started is waiting for this id.
          const { requestId, pageUrl, links } = message.payload;
          receivePageLinks(requestId, pageUrl, links);
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
