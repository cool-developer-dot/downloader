import { AccessibilityInfo, Keyboard, Platform, Share, ToastAndroid } from 'react-native';

import { requestAddressBarFocus } from '@/browser/services/address-bar-focus';
import {
  goBackForTab,
  goForwardForTab,
  goHomeForTab,
  loadUrlForTab,
  reloadForTab,
  stopLoadingForTab,
} from '@/browser/services/active-tab-navigation.service';
import { hardReloadRequests } from '@/browser/services/hard-reload';
import { announceTabsLimitReached } from '@/browser/services/tabs-limit-notice';
import { useBrowserStore } from '@/browser/stores';
import { extractPageHostname, isBrowserHomeUrl, isValidBrowserPageUrl } from '@/browser/utils';
import { translate } from '@/localization';
import { navigation, requestSecondaryDestination, routePaths, SECONDARY_DESTINATIONS } from '@/navigation';
import { buildFaviconUrl } from '@/screens/bookmarks/utils/bookmark-format';
import { normalizeUrl } from '@/storage/utils';
import { useBookmarksStore } from '@/store/bookmarks';
import { useSettingsStore } from '@/store/settings';

import { cycleTabId } from './keyboard-shortcuts';
import { readHomepage } from './startup-settings';

/**
 * B21 — what the customizable toolbar buttons (#238) and the keyboard shortcuts (#246) do, in one place. Each acts on
 * the tab in front at the moment it runs, through the same services the menu and toolbar already use.
 */

function notify(message: string): void {
  if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
  AccessibilityInfo.announceForAccessibility(message);
}

function activeTab() {
  const state = useBrowserStore.getState();
  return state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
}

/** #232: '' = the start page. */
export function currentHomepage(): string {
  return readHomepage(useSettingsStore.getState().homepageUrl);
}

export const browserCommands = {
  newTab(): void {
    const result = useBrowserStore.getState().createTab();
    if (result.status === 'LIMIT_REACHED') announceTabsLimitReached();
  },

  closeTab(): void {
    const tab = activeTab();
    if (tab) useBrowserStore.getState().closeTab(tab.id);
  },

  reopenTab(): void {
    const outcome = useBrowserStore.getState().reopenClosedTab();
    if (outcome.status === 'LIMIT_REACHED') announceTabsLimitReached();
    else if (outcome.status === 'RESTORED') AccessibilityInfo.announceForAccessibility(translate('browserTabs.reopened'));
  },

  switchTab(delta: 1 | -1): void {
    const state = useBrowserStore.getState();
    const next = cycleTabId(
      state.tabs.map((tab) => tab.id),
      state.activeTabId,
      delta,
    );
    if (next) state.switchTab(next);
  },

  focusAddressBar(): void {
    requestAddressBarFocus();
  },

  /** Reload, or Stop while the page loads. */
  reload(): void {
    const tab = activeTab();
    if (!tab || isBrowserHomeUrl(tab.url)) return;
    if (useBrowserStore.getState().isLoading) stopLoadingForTab(tab.id);
    else reloadForTab(tab.id);
  },

  hardReload(): void {
    const tab = activeTab();
    if (!tab || isBrowserHomeUrl(tab.url)) return;
    hardReloadRequests.request(tab.id);
  },

  back(): void {
    const tab = activeTab();
    if (tab && !isBrowserHomeUrl(tab.url)) goBackForTab(tab.id);
  },

  forward(): void {
    const tab = activeTab();
    if (tab) goForwardForTab(tab.id);
  },

  /** #232 Home: the homepage when one is set, else the start page (today's). */
  home(): void {
    const tab = activeTab();
    if (!tab) return;
    Keyboard.dismiss();
    const homepage = currentHomepage();
    if (homepage) {
      if (tab.url !== homepage) loadUrlForTab(tab.id, homepage);
      return;
    }
    if (!isBrowserHomeUrl(tab.url)) goHomeForTab(tab.id);
  },

  /** Ctrl+D: bookmarks the page in front (a page already bookmarked stays so). */
  async bookmarkPage(): Promise<void> {
    const tab = activeTab();
    const url = tab?.url ?? '';
    if (!isValidBrowserPageUrl(url)) return;
    const store = useBookmarksStore.getState();
    const key = normalizeUrl(url).trim().toLowerCase();
    if (store.urlIndex[key]) {
      notify(translate('browser.alreadyBookmarked'));
      return;
    }
    const hostname = extractPageHostname(url);
    const saved = await store.add({
      url,
      title: useBrowserStore.getState().pageTitle || hostname || url,
      hostname,
      faviconUrl: buildFaviconUrl(hostname),
    });
    notify(saved ? translate('browser.bookmarkSaved') : translate('browser.addBookmarkFailed'));
  },

  history(): void {
    navigation.push(routePaths.history);
  },

  bookmarks(): void {
    navigation.push(routePaths.bookmarks);
  },

  downloads(): void {
    requestSecondaryDestination(SECONDARY_DESTINATIONS.activeDownloads);
    navigation.navigate(routePaths.downloads);
  },

  async share(): Promise<void> {
    const tab = activeTab();
    const url = tab?.url ?? '';
    if (!isValidBrowserPageUrl(url)) return;
    const title = useBrowserStore.getState().pageTitle || extractPageHostname(url) || translate('browser.title');
    try {
      await Share.share({ title, message: `${title}\n${url}`, url });
    } catch {
      // Dismissed.
    }
  },

  /** B5's Search this site: the address bar opens with `site:<host> `. */
  searchSite(): void {
    const host = extractPageHostname(activeTab()?.url ?? '');
    if (host) requestAddressBarFocus({ prefill: `site:${host} ` });
  },
};
