/**
 * A link the user pasted into the address bar, or shared/opened with VidoraX: the direct analyzer reads its page
 * first, then the tab navigates to it as usual. The tab's navigation waits only for the analyzer's first page fetch
 * (bounded), so the page and the tab share one browsing session; whatever the analyzer cannot resolve, the WebView
 * detection pipeline still handles on the loaded page. Links that are not a content page (a site's home, a search,
 * YouTube, a private address) load directly, with no analysis.
 */

import { useBrowserStore } from '@/browser/stores';
import {
  cancelDirectAnalysis,
  isDirectAnalysisAvailable,
  isDirectSessionCurrent,
  startDirectAnalysis,
} from '@/browser/media-actions/direct-analysis.service';
import { tabControllerRegistry } from '@/browser/tabs/tab-controller-registry';

import { isYouTubeLink, shouldAnalyzePastedLink } from './pasted-link';
import { loadUrlForTab } from './active-tab-navigation.service';

export { isYouTubeLink, shouldAnalyzePastedLink };

/**
 * Opens a pasted/shared link in `tabId` (default: the active tab). True when the link will load (now, or right after
 * the analyzer's first fetch); false when the tab cannot load it.
 */
export function openPastedLink(url: string, options: { source: 'omnibox' | 'share'; tabId?: string }): boolean {
  const tabId = options.tabId ?? useBrowserStore.getState().activeTabId;
  const trimmed = url.trim();
  // Never loaded, never fetched: callers tell the user YouTube is not supported (isYouTubeLink).
  if (isYouTubeLink(trimmed)) {
    return false;
  }
  if (!shouldAnalyzePastedLink(trimmed) || !isDirectAnalysisAvailable()) {
    return loadUrlForTab(tabId, trimmed);
  }
  const controller = tabControllerRegistry.get(tabId);
  if (!controller || controller.tabId !== tabId) {
    return loadUrlForTab(tabId, trimmed);
  }

  // A navigation the user starts in this tab meanwhile (Back, Home, another link) wins over the deferred one.
  const epochAtPaste = controller.navigationEpochRef.current;
  const urlAtPaste = useBrowserStore.getState().tabs.find((tab) => tab.id === tabId)?.url ?? null;
  let sessionId = 0;
  const load = () => {
    if (!isDirectSessionCurrent(tabId, sessionId)) {
      return;
    }
    const live = tabControllerRegistry.get(tabId);
    const tab = useBrowserStore.getState().tabs.find((t) => t.id === tabId);
    if (!tab) {
      cancelDirectAnalysis(tabId, 'tab_closed');
      return;
    }
    if (live && (live.navigationEpochRef.current !== epochAtPaste || tab.url !== urlAtPaste)) {
      cancelDirectAnalysis(tabId, 'user_navigated');
      return;
    }
    loadUrlForTab(tabId, trimmed);
  };
  sessionId = startDirectAnalysis({ tabId, url: trimmed, source: options.source, onRelease: load });
  // The page itself starts loading after the first fetch; show that the link was taken meanwhile.
  useBrowserStore.getState().updateTab(tabId, { loading: true, progress: 0.02 });
  return true;
}
