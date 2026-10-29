import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { AccessibilityInfo, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import {
  selectCurrentUrl,
  selectDesktopMode,
  selectPageTitle,
  useBrowserStore,
} from '@/browser/stores';
import { navigationService } from '@/browser/services';
import { grabPageLinks } from '@/browser/services/page-link-grabber';
import { announceTabsLimitReached } from '@/browser/services/tabs-limit-notice';
import { buildTranslatePageUrl } from '@/browser/services/translate-page';
import { requestAddressBarFocus } from '@/browser/services/address-bar-focus';
import { closedTabsService } from '@/browser/tabs/closed-tabs.service';
import { hardReloadRequests } from '@/browser/services/hard-reload';
import { pageActivity } from '@/browser/scroll/page-activity';
import { scrollActivePageToEdge } from '@/browser/scroll/page-scroll.service';
import { tabControllerRegistry } from '@/browser/tabs/tab-controller-registry';
import { extractPageHostname, isValidBrowserPageUrl } from '@/browser/utils';
import {
  navigation,
  routePaths,
  requestSecondaryDestination,
  SECONDARY_DESTINATIONS,
} from '@/navigation';
import { useTranslation } from '@/localization';
import { useBookmarksStore } from '@/store/bookmarks';
import { normalizeUrl } from '@/storage/utils';
import { batchAddPrefill } from '@/screens/batch-add/batch-add-prefill';
import { buildFaviconUrl } from '@/screens/bookmarks/utils/bookmark-format';

import type { BrowserMenuFeedback, BrowserMenuItemModel } from './types';

export type UseBrowserMenuActionsOptions = {
  onClose: () => void;
  onFeedback?: (feedback: BrowserMenuFeedback) => void;
};

export type UseBrowserMenuActionsResult = {
  items: BrowserMenuItemModel[];
  handleItemPress: (id: BrowserMenuItemModel['id']) => void;
  handleDesktopToggle: (enabled: boolean) => void;
};

export function useBrowserMenuActions({
  onClose,
  onFeedback,
}: UseBrowserMenuActionsOptions): UseBrowserMenuActionsResult {
  const { t, language } = useTranslation();

  const currentUrl = useBrowserStore(selectCurrentUrl);
  const pageTitle = useBrowserStore(selectPageTitle);
  const desktopMode = useBrowserStore(selectDesktopMode);
  const setDesktopMode = useBrowserStore((state) => state.setDesktopMode);

  const addBookmark = useBookmarksStore((state) => state.add);
  const bookmarked = useBookmarksStore((state) => {
    if (!isValidBrowserPageUrl(currentUrl)) {
      return false;
    }
    const key = normalizeUrl(currentUrl).trim().toLowerCase();
    return Boolean(state.urlIndex[key]);
  });
  const bookmarkPending = useBookmarksStore((state) => {
    if (!isValidBrowserPageUrl(currentUrl)) {
      return false;
    }
    const key = normalizeUrl(currentUrl).trim().toLowerCase();
    return Boolean(state.pendingUrls[key]);
  });

  const hasValidPage = useMemo(
    () => isValidBrowserPageUrl(currentUrl),
    [currentUrl],
  );
  const hasClosedTabs = useSyncExternalStore(closedTabsService.subscribe, closedTabsService.hasAny);
  const autoScrollOn = useSyncExternalStore(
    pageActivity.subscribe,
    () => pageActivity.getSnapshot().autoScroll.status !== 'off',
  );

  const announce = useCallback((message: string) => {
    onFeedback?.({ message, tone: 'success' });
    AccessibilityInfo.announceForAccessibility(message);
  }, [onFeedback]);

  const handleNewTab = useCallback(() => {
    onClose();
    const result = useBrowserStore.getState().createTab();
    if (result.status === 'LIMIT_REACHED') {
      onFeedback?.({
        message: t('browser.tabsLimitReached'),
        tone: 'neutral',
      });
      AccessibilityInfo.announceForAccessibility(t('browser.tabsLimitReached'));
    }
  }, [onClose, onFeedback, t]);

  // B1 #3: the last closed tab comes back at its old place, in front.
  const handleReopenClosedTab = useCallback(() => {
    onClose();
    const outcome = useBrowserStore.getState().reopenClosedTab();
    if (outcome.status === 'LIMIT_REACHED') {
      announceTabsLimitReached();
    } else if (outcome.status === 'RESTORED') {
      AccessibilityInfo.announceForAccessibility(t('browserTabs.reopened'));
    }
  }, [onClose, t]);

  // B1 #7: the same page in a new tab right after this one.
  const handleDuplicateTab = useCallback(() => {
    onClose();
    const store = useBrowserStore.getState();
    const result = store.duplicateTab(store.activeTabId);
    if (result.status === 'LIMIT_REACHED') {
      announceTabsLimitReached();
    }
  }, [onClose]);

  // B5 #57: the address bar opens with `site:<host> ` so the next words search only this site.
  const handleSearchSite = useCallback(() => {
    const host = extractPageHostname(currentUrl);
    onClose();
    if (host) {
      requestAddressBarFocus({ prefill: `site:${host} ` });
    }
  }, [currentUrl, onClose]);

  const handleAddBookmark = useCallback(async () => {
    if (!hasValidPage || bookmarked || bookmarkPending) {
      return;
    }

    const hostname = extractPageHostname(currentUrl);
    const bookmark = await addBookmark({
      url: currentUrl,
      title: pageTitle || hostname || currentUrl,
      hostname,
      faviconUrl: buildFaviconUrl(hostname),
    });

    onClose();

    if (!bookmark) {
      const error = useBookmarksStore.getState().error ?? t('browser.addBookmarkFailed');
      onFeedback?.({ message: error, tone: 'neutral' });
      AccessibilityInfo.announceForAccessibility(error);
      return;
    }

    announce(t('browser.bookmarkSaved'));
  }, [
    addBookmark,
    announce,
    bookmarkPending,
    bookmarked,
    currentUrl,
    hasValidPage,
    onClose,
    onFeedback,
    pageTitle,
    t,
  ]);

  const handleBookmarks = useCallback(() => {
    onClose();
    navigation.push(routePaths.bookmarks);
  }, [onClose]);

  const handleCopyLink = useCallback(async () => {
    if (!hasValidPage) {
      return;
    }

    await Clipboard.setStringAsync(currentUrl);
    onClose();
    announce(t('browser.linkCopied'));
  }, [announce, currentUrl, hasValidPage, onClose, t]);

  const handleShare = useCallback(async () => {
    if (!hasValidPage) {
      return;
    }

    const title = pageTitle || extractPageHostname(currentUrl) || t('browser.title');
    onClose();

    try {
      await Share.share({
        title,
        message: `${title}\n${currentUrl}`,
        url: currentUrl,
      });
    } catch {
      // User dismissed share sheet.
    }
  }, [currentUrl, hasValidPage, onClose, pageTitle, t]);

  // Google Translate's copy of this page, in the app's language; null where there is nothing to translate.
  const translateUrl = useMemo(
    () => buildTranslatePageUrl(currentUrl, language),
    [currentUrl, language],
  );

  const handleTranslate = useCallback(() => {
    if (!translateUrl) {
      return;
    }
    onClose();
    const result = useBrowserStore.getState().createTab({ url: translateUrl });
    if (result.status === 'LIMIT_REACHED') {
      announceTabsLimitReached();
    }
  }, [onClose, translateUrl]);

  // B6 #42: reload once without the browser cache.
  const handleHardReload = useCallback(() => {
    onClose();
    hardReloadRequests.request(useBrowserStore.getState().activeTabId);
  }, [onClose]);

  // B6 #46 / #47.
  const handleScrollEdge = useCallback(
    (edge: 'top' | 'bottom') => {
      onClose();
      scrollActivePageToEdge(edge);
    },
    [onClose],
  );

  // B6 #54: start, or stop while it runs.
  const handleAutoScroll = useCallback(() => {
    onClose();
    if (pageActivity.getSnapshot().autoScroll.status === 'off') pageActivity.startAutoScroll();
    else pageActivity.autoScroll({ type: 'stop' });
  }, [onClose]);

  const handleHistory = useCallback(() => {
    onClose();
    navigation.push(routePaths.history);
  }, [onClose]);

  const handleDesktopToggle = useCallback(
    (enabled: boolean) => {
      // Capture owning tab at user action time — never re-read activeTabId later.
      const targetTabId = useBrowserStore.getState().activeTabId;
      const tab = useBrowserStore.getState().tabs.find((t) => t.id === targetTabId);
      if (!tab || enabled === tab.desktopMode) {
        return;
      }

      // Store + Switch update synchronously — do not wait for WebView reload.
      setDesktopMode(enabled, { source: 'user', tabId: targetTabId });

      const message = enabled
        ? t('browser.desktopSiteEnabled')
        : t('browser.desktopSiteDisabled');
      onFeedback?.({ message, tone: 'neutral' });
      AccessibilityInfo.announceForAccessibility(message);
      // Close menu so the intentional one-shot page reload is visible immediately.
      onClose();
    },
    [onClose, onFeedback, setDesktopMode, t],
  );

  const handleOpenExternal = useCallback(async () => {
    if (!hasValidPage) {
      return;
    }

    onClose();
    const opened = await navigationService.openExternal(currentUrl);
    if (!opened) {
      onFeedback?.({ message: t('browser.openExternalFailed'), tone: 'neutral' });
      AccessibilityInfo.announceForAccessibility(t('browser.openExternalFailed'));
    }
  }, [currentUrl, hasValidPage, onClose, onFeedback, t]);

  const handleActiveDownloads = useCallback(() => {
    onClose();
    requestSecondaryDestination(SECONDARY_DESTINATIONS.activeDownloads);
    navigation.navigate(routePaths.downloads);
  }, [onClose]);

  const handleRecentDownloads = useCallback(() => {
    onClose();
    requestSecondaryDestination(SECONDARY_DESTINATIONS.recentDownloads);
    navigation.navigate(routePaths.downloads);
  }, [onClose]);

  // Page Link Grabber (#484): the page's video file links go to Batch Add, where the user starts the checks.
  const handleGrabLinks = useCallback(async () => {
    if (!hasValidPage) {
      return;
    }
    const activeTabId = useBrowserStore.getState().activeTabId;
    const webView = tabControllerRegistry.getActive(activeTabId)?.webViewRef.current;
    onClose();
    const links = await grabPageLinks(webView);
    if (links == null || links.length === 0) {
      const message = links == null ? t('browser.grabLinksFailed') : t('browser.grabLinksNone');
      onFeedback?.({ message, tone: 'neutral' });
      AccessibilityInfo.announceForAccessibility(message);
      return;
    }
    batchAddPrefill.set(links.join('\n'));
    navigation.push(routePaths.batchAdd);
  }, [hasValidPage, onClose, onFeedback, t]);

  const handleContinueWatching = useCallback(() => {
    onClose();
    requestSecondaryDestination(SECONDARY_DESTINATIONS.continueWatching);
    navigation.navigate(routePaths.library);
  }, [onClose]);

  const handleRecentlyWatched = useCallback(() => {
    onClose();
    requestSecondaryDestination(SECONDARY_DESTINATIONS.recentlyWatched);
    navigation.navigate(routePaths.library);
  }, [onClose]);

  const handleDownloads = useCallback(() => {
    onClose();
    requestSecondaryDestination(SECONDARY_DESTINATIONS.activeDownloads);
    navigation.navigate(routePaths.downloads);
  }, [onClose]);

  const handleSettings = useCallback(() => {
    onClose();
    navigation.navigate(routePaths.settings);
  }, [onClose]);

  const handleItemPress = useCallback(
    (id: BrowserMenuItemModel['id']) => {
      switch (id) {
        case 'active_downloads':
          handleActiveDownloads();
          break;
        case 'recent_downloads':
          handleRecentDownloads();
          break;
        case 'grab_links':
          void handleGrabLinks();
          break;
        case 'continue_watching':
          handleContinueWatching();
          break;
        case 'recently_watched':
          handleRecentlyWatched();
          break;
        case 'new_tab':
          handleNewTab();
          break;
        case 'reopen_closed_tab':
          handleReopenClosedTab();
          break;
        case 'duplicate_tab':
          handleDuplicateTab();
          break;
        case 'search_site':
          handleSearchSite();
          break;
        case 'add_bookmark':
          void handleAddBookmark();
          break;
        case 'bookmarks':
          handleBookmarks();
          break;
        case 'copy_link':
          void handleCopyLink();
          break;
        case 'share':
          void handleShare();
          break;
        case 'translate':
          handleTranslate();
          break;
        case 'hard_reload':
          handleHardReload();
          break;
        case 'scroll_top':
          handleScrollEdge('top');
          break;
        case 'scroll_bottom':
          handleScrollEdge('bottom');
          break;
        case 'auto_scroll':
          handleAutoScroll();
          break;
        case 'history':
          handleHistory();
          break;
        case 'open_external':
          void handleOpenExternal();
          break;
        case 'downloads':
          handleDownloads();
          break;
        case 'settings':
          handleSettings();
          break;
        default:
          break;
      }
    },
    [
      handleActiveDownloads,
      handleAddBookmark,
      handleAutoScroll,
      handleHardReload,
      handleScrollEdge,
      handleBookmarks,
      handleContinueWatching,
      handleCopyLink,
      handleDownloads,
      handleDuplicateTab,
      handleGrabLinks,
      handleHistory,
      handleNewTab,
      handleOpenExternal,
      handleRecentDownloads,
      handleRecentlyWatched,
      handleReopenClosedTab,
      handleSearchSite,
      handleSettings,
      handleShare,
      handleTranslate,
    ],
  );

  const items = useMemo((): BrowserMenuItemModel[] => {
    const addBookmarkLabel = bookmarked
      ? t('browser.alreadyBookmarked')
      : t('browser.addBookmark');

    return [
      {
        id: 'active_downloads',
        icon: 'download-outline',
        label: t('browser.activeDownloads'),
        accessibilityLabel: t('browser.activeDownloadsA11y'),
        kind: 'action',
        enabled: true,
      },
      {
        id: 'recent_downloads',
        icon: 'download',
        label: t('browser.recentDownloads'),
        accessibilityLabel: t('browser.recentDownloadsA11y'),
        kind: 'action',
        enabled: true,
      },
      {
        id: 'grab_links',
        icon: 'link-variant',
        label: t('browser.grabLinks'),
        accessibilityLabel: t('browser.grabLinksA11y'),
        kind: 'action',
        enabled: hasValidPage,
      },
      {
        id: 'continue_watching',
        icon: 'play-circle-outline',
        label: t('browser.continueWatching'),
        accessibilityLabel: t('browser.continueWatchingA11y'),
        kind: 'action',
        enabled: true,
        showDividerBefore: true,
      },
      {
        id: 'recently_watched',
        icon: 'clock-outline',
        label: t('browser.recentlyWatched'),
        accessibilityLabel: t('browser.recentlyWatchedA11y'),
        kind: 'action',
        enabled: true,
      },
      {
        id: 'history',
        icon: 'history',
        label: t('browser.history'),
        accessibilityLabel: t('browser.openHistoryA11y'),
        kind: 'action',
        enabled: true,
        showDividerBefore: true,
      },
      {
        id: 'bookmarks',
        icon: 'bookmark-box-outline',
        label: t('browser.bookmarks'),
        accessibilityLabel: t('browser.openBookmarksA11y'),
        kind: 'action',
        enabled: true,
      },
      {
        id: 'new_tab',
        icon: 'tab-plus',
        label: t('browser.newTab'),
        accessibilityLabel: t('browser.newTabA11y'),
        kind: 'action',
        enabled: true,
        showDividerBefore: true,
      },
      {
        id: 'reopen_closed_tab',
        icon: 'restore',
        label: t('browserTabs.reopenClosed'),
        accessibilityLabel: hasClosedTabs ? t('browserTabs.reopenClosedA11y') : t('browserTabs.noClosedTabs'),
        kind: 'action',
        enabled: hasClosedTabs,
      },
      {
        id: 'duplicate_tab',
        icon: 'content-duplicate',
        label: t('browserTabs.duplicate'),
        accessibilityLabel: t('browserTabs.duplicate'),
        kind: 'action',
        enabled: hasValidPage,
      },
      {
        id: 'add_bookmark',
        icon: bookmarked ? 'bookmark' : 'bookmark-outline',
        label: addBookmarkLabel,
        accessibilityLabel: bookmarked
          ? t('browser.alreadyBookmarkedA11y')
          : t('browser.addBookmarkA11y'),
        kind: 'action',
        enabled: hasValidPage && !bookmarked && !bookmarkPending,
      },
      {
        id: 'copy_link',
        icon: 'content-copy',
        label: t('browser.copyLink'),
        accessibilityLabel: t('browser.copyLinkA11y'),
        kind: 'action',
        enabled: hasValidPage,
        showDividerBefore: true,
      },
      {
        id: 'share',
        icon: 'share-variant',
        label: t('browser.sharePage'),
        accessibilityLabel: t('browser.sharePageA11y'),
        kind: 'action',
        enabled: hasValidPage,
      },
      {
        id: 'search_site',
        icon: 'text-search',
        label: t('browserSettings.search.searchThisSite'),
        accessibilityLabel: t('browserSettings.search.searchThisSiteA11y'),
        kind: 'action',
        enabled: hasValidPage,
      },
      {
        id: 'translate',
        icon: 'translate',
        label: t('browser.translatePage'),
        accessibilityLabel: t('browser.translatePageA11y'),
        kind: 'action',
        enabled: translateUrl != null,
      },
      {
        id: 'hard_reload',
        icon: 'refresh-circle',
        label: t('browserNav.hardReload'),
        accessibilityLabel: t('browserNav.hardReloadA11y'),
        kind: 'action',
        enabled: hasValidPage,
        showDividerBefore: true,
      },
      {
        id: 'scroll_top',
        icon: 'format-vertical-align-top',
        label: t('browserNav.scrollTop'),
        accessibilityLabel: t('browserNav.scrollTop'),
        kind: 'action',
        enabled: hasValidPage,
      },
      {
        id: 'scroll_bottom',
        icon: 'format-vertical-align-bottom',
        label: t('browserNav.scrollBottom'),
        accessibilityLabel: t('browserNav.scrollBottom'),
        kind: 'action',
        enabled: hasValidPage,
      },
      {
        id: 'auto_scroll',
        icon: autoScrollOn ? 'stop' : 'play-speed',
        label: autoScrollOn ? t('browserNav.autoScrollStop') : t('browserNav.autoScroll'),
        accessibilityLabel: autoScrollOn ? t('browserNav.autoScrollStop') : t('browserNav.autoScroll'),
        kind: 'action',
        enabled: hasValidPage,
      },
      {
        id: 'desktop_site',
        icon: 'monitor',
        label: t('browser.desktopSite'),
        accessibilityLabel: t('browser.desktopSiteA11y'),
        kind: 'toggle',
        enabled: hasValidPage,
        toggled: desktopMode,
        showDividerBefore: true,
      },
      {
        id: 'open_external',
        icon: 'open-in-new',
        label: t('browser.openExternal'),
        accessibilityLabel: t('browser.openExternalA11y'),
        kind: 'action',
        enabled: hasValidPage,
      },
      {
        id: 'settings',
        icon: 'cog-outline',
        label: t('browser.settings'),
        accessibilityLabel: t('browser.openSettingsA11y'),
        kind: 'action',
        enabled: true,
      },
    ];
  }, [
    autoScrollOn,
    bookmarkPending,
    bookmarked,
    desktopMode,
    hasClosedTabs,
    hasValidPage,
    t,
    translateUrl,
  ]);

  return {
    items,
    handleItemPress,
    handleDesktopToggle,
  };
}
