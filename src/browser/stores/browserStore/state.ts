import { BROWSER_HOMEPAGE } from '@/browser/constants';
import {
  hydrateTabEngineState,
  resolveActiveChromeSeed,
} from '@/browser/tabs';
import type { BrowserState } from '@/browser/types';
import { getSecurityLevel } from '@/browser/utils';

export const initialBrowserSessionState = {
  currentUrl: BROWSER_HOMEPAGE,
  pageTitle: '',
  canGoBack: false,
  canGoForward: false,
  isLoading: false,
  progress: 0,
  isSecure: true,
  securityLevel: getSecurityLevel(BROWSER_HOMEPAGE),
  lastVisited: null,
  error: null,
};

function resolveHydratedBrowserState(): BrowserState {
  const tabState = hydrateTabEngineState();
  const seed = resolveActiveChromeSeed(tabState);

  return {
    ...initialBrowserSessionState,
    currentUrl: seed.currentUrl,
    pageTitle: seed.pageTitle,
    isSecure: seed.isSecure,
    securityLevel: getSecurityLevel(seed.currentUrl),
    tabs: tabState.tabs,
    activeTabId: tabState.activeTabId,
    mountedTabIds: tabState.mountedTabIds,
    downloads: [] as never[],
    history: [] as never[],
    bookmarks: [] as never[],
    readerMode: false as const,
    incognito: false as const,
    desktopMode: seed.desktopMode,
    desktopModeUserExplicit: seed.desktopModeUserExplicit,
  };
}

export const initialBrowserState: BrowserState = resolveHydratedBrowserState();
