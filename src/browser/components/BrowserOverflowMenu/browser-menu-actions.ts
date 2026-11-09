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
import { profileSwitcherRequests } from '@/browser/components/ProfileSwitcher/profile-switcher-requests';
import { canMoveTabToWindow, moveTabToWindow } from '@/browser/profiles/browser-window.service';
import { GUEST_PROFILE, profileDisplayName } from '@/browser/profiles/profile-registry';
import { useProfilesStore } from '@/browser/profiles/profile-service';
import { useTheme } from '@/hooks/use-theme';
import { normalizeUrl } from '@/storage/utils';
import { batchAddPrefill } from '@/screens/batch-add/batch-add-prefill';
import { buildFaviconUrl } from '@/screens/bookmarks/utils/bookmark-format';
import { exitBrowser } from '@/browser/history/browsing-data.service';
import { findInPage } from '@/browser/find/find-in-page.service';
import { addPageToReadingList, bookmarkEditRequests } from '@/browser/bookmarks/bookmarks.service';
import { bookmarkOrganizerRepository } from '@/storage/repositories';
import { readerMode, useReaderAvailable } from '@/browser/reader/reader-mode.service';
import { pageDisplayRequests } from '@/browser/page-display/page-display-requests';
import { useSettingsStore } from '@/store/settings';

import type { BrowserMenuFeedback, BrowserMenuItemModel } from './types';
import { isIncognitoAvailable, openIncognitoTab } from '@/browser/incognito/incognito.service';
import { isIncognitoInFront, isIncognitoTabId } from '@/browser/incognito/incognito-state';
import { openQrSheet } from '@/browser/share-qr/share-qr.service';
import { savePageNote } from '@/browser/notes/notes.service';
import { openDevtoolsPanel } from '@/browser/devtools/devtools.service';
import { openPageHighlights } from '@/browser/highlights/highlights.service';
import { startDrawing } from '@/browser/draw/draw.service';
import { watchPage } from '@/browser/page-alerts/page-alerts.service';
import { MAX_WATCHES } from '@/browser/page-alerts/page-alerts-core';
import { announceMenuNotice } from '@/browser/highlights/menu-notice';
import { captureFullPage, captureScreenshot, printPage } from '@/browser/capture/capture.service';
import { saveOffline } from '@/browser/capture/offline-pages.service';

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
  const { t, language, rtl } = useTranslation();
  const theme = useTheme();

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

  // B11 #104: a new incognito tab in front (its own temporary profile; nothing is kept).
  const handleNewIncognitoTab = useCallback(() => {
    onClose();
    void openIncognitoTab();
  }, [onClose]);

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

  // B20 #207: the profile switcher.
  const profileLabel = useProfilesStore((state) => {
    if (state.activeId === GUEST_PROFILE) return null;
    const profile = state.profiles.find((p) => p.id === state.activeId);
    return profile ? profileDisplayName(profile, t('browserProfiles.defaultName')) : null;
  });
  const handleProfile = useCallback(() => {
    onClose();
    profileSwitcherRequests.open();
  }, [onClose]);

  // B20 #16: this tab in a window of its own.
  const activeTab = useBrowserStore((state) => state.tabs.find((tab) => tab.id === state.activeTabId) ?? null);
  const canMoveToWindow = canMoveTabToWindow(activeTab);
  const handleMoveToWindow = useCallback(async () => {
    onClose();
    const tabId = useBrowserStore.getState().activeTabId;
    const outcome = await moveTabToWindow(tabId, {
      rtl: rtl.isRtl,
      dark: theme.mode === 'dark',
      colors: {
        background: theme.colors.background,
        surface: theme.colors.surface,
        text: theme.colors.textPrimary,
        textSecondary: theme.colors.textSecondary,
        accent: theme.colors.primary,
      },
      labels: {
        back: t('browserProfiles.windowBack'),
        forward: t('browserProfiles.windowForward'),
        reload: t('browserProfiles.windowReload'),
        stop: t('browserProfiles.windowStop'),
        moveBack: t('browserProfiles.windowMoveBack'),
        close: t('browserProfiles.windowClose'),
      },
    });
    if (outcome === 'moved') {
      AccessibilityInfo.announceForAccessibility(t('browserProfiles.moved'));
    } else if (outcome === 'failed') {
      onFeedback?.({ message: t('browserProfiles.moveFailed'), tone: 'neutral' });
    }
  }, [onClose, onFeedback, rtl.isRtl, t, theme]);

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
    // B11: translating an incognito page stays in incognito.
    const result = useBrowserStore
      .getState()
      .createTab({ url: translateUrl, ...(isIncognitoInFront() ? { incognito: true } : {}) });
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

  // B9 #78: Edit bookmark for the page in front (already bookmarked).
  const handleEditBookmark = useCallback(async () => {
    onClose();
    const found = await bookmarkOrganizerRepository.getByUrl(normalizeUrl(currentUrl)).catch(() => null);
    if (found) bookmarkEditRequests.open(found.id);
  }, [currentUrl, onClose]);

  // B7 #66: the find bar over the page.
  const handleFindInPage = useCallback(() => {
    onClose();
    findInPage.open();
  }, [onClose]);

  // B15 #161: the menu's way into reader mode (enabled on pages that look like an article).
  const readerAvailable = useReaderAvailable();
  const handleReaderMode = useCallback(() => {
    onClose();
    readerMode.open();
  }, [onClose]);

  // B16: the Page display (Aa) panel.
  const handlePageDisplay = useCallback(() => {
    onClose();
    pageDisplayRequests.open();
  }, [onClose]);

  // B10 #99: close every tab, clear browsing data and leave the app.
  const showExit = useSettingsStore((s) => s.clearHistoryOnExit === true);
  const handleExit = useCallback(() => {
    onClose();
    void exitBrowser();
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
        case 'new_incognito_tab':
          handleNewIncognitoTab();
          break;
        case 'reopen_closed_tab':
          handleReopenClosedTab();
          break;
        case 'duplicate_tab':
          handleDuplicateTab();
          break;
        case 'move_to_window':
          void handleMoveToWindow();
          break;
        case 'profile':
          handleProfile();
          break;
        case 'search_site':
          handleSearchSite();
          break;
        case 'add_bookmark':
          // B9 #78: the star on a bookmarked page opens Edit bookmark.
          if (bookmarked) void handleEditBookmark();
          else void handleAddBookmark();
          break;
        case 'reading_list_add':
          onClose();
          void addPageToReadingList(currentUrl, pageTitle || currentUrl);
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
        case 'qr_code':
          // B22 #249: this page as a QR code.
          onClose();
          openQrSheet(currentUrl, pageTitle);
          break;
        case 'save_page_note':
          // B22 #252
          onClose();
          void savePageNote();
          break;
        case 'notes':
          onClose();
          navigation.push(routePaths.notes);
          break;
        case 'devtools':
          // B19: the panel for the tab in front.
          onClose();
          openDevtoolsPanel(useBrowserStore.getState().activeTabId);
          break;
        case 'screenshot':
          // B17 #174 / #175 / #176 / #177 / #178
          onClose();
          void captureScreenshot();
          break;
        case 'full_page':
          onClose();
          void captureFullPage();
          break;
        case 'print_page':
          onClose();
          void printPage();
          break;
        case 'save_offline':
          onClose();
          void saveOffline();
          break;
        case 'saved_pages':
          onClose();
          navigation.push(routePaths.savedPages);
          break;
        case 'highlights_page':
          // B23 #261
          onClose();
          openPageHighlights(useBrowserStore.getState().activeTabId);
          break;
        case 'highlights':
          onClose();
          navigation.push(routePaths.highlights);
          break;
        case 'draw': {
          // B23 #279
          onClose();
          const tab = useBrowserStore.getState().tabs.find((t) => t.id === useBrowserStore.getState().activeTabId);
          if (tab) {
            void startDrawing(tab.id, tab.title).then((ok) => {
              if (!ok) announceMenuNotice(t('browserAnnotate.drawUnavailable'));
            });
          }
          break;
        }
        case 'watch_page': {
          // B23 #289
          onClose();
          const tab = useBrowserStore.getState().tabs.find((t) => t.id === useBrowserStore.getState().activeTabId);
          if (tab) {
            void watchPage(tab.id, tab.url, tab.title).then((outcome) => {
              const key = {
                watching: 'browserAnnotate.watching',
                already: 'browserAnnotate.alreadyWatching',
                cannotWatch: 'browserAnnotate.cannotWatch',
                failed: 'browserAnnotate.watchFailed',
                limit: 'browserAnnotate.watchLimit',
                incognito: 'browserAnnotate.watchIncognito',
              } as const;
              announceMenuNotice(t(key[outcome], { max: MAX_WATCHES }));
            });
          }
          break;
        }
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
        case 'exit':
          handleExit();
          break;
        case 'find_in_page':
          handleFindInPage();
          break;
        case 'reader_mode':
          handleReaderMode();
          break;
        case 'page_display':
          handlePageDisplay();
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
      handleNewIncognitoTab,
      handleOpenExternal,
      handleRecentDownloads,
      handleRecentlyWatched,
      handleReopenClosedTab,
      handleSearchSite,
      handleSettings,
      handleExit,
      handleFindInPage,
      handleReaderMode,
      handlePageDisplay,
      handleEditBookmark,
      bookmarked,
      currentUrl,
      pageTitle,
      onClose,
      handleShare,
      handleTranslate,
      handleMoveToWindow,
      handleProfile,
      t,
    ],
  );

  const devtoolsOn = useSettingsStore((s) => s.devTools === true);
  // B23: highlights, drawing and page alerts are left out for an incognito tab.
  const incognitoInFront = useBrowserStore((s) => isIncognitoTabId(s.activeTabId));
  // B11: incognito needs WebView profiles; that doesn't change while the app runs.
  const incognitoAvailable = useMemo(() => isIncognitoAvailable(), []);

  const items = useMemo((): BrowserMenuItemModel[] => {
    const addBookmarkLabel = bookmarked
      ? t('browser.alreadyBookmarked')
      : t('browser.addBookmark');

    return [
      {
        id: 'profile',
        icon: profileLabel ? 'account-circle-outline' : 'account-question-outline',
        label: profileLabel ? t('browserProfiles.menuProfile', { name: profileLabel }) : t('browserProfiles.menuGuest'),
        accessibilityLabel: profileLabel
          ? t('browserProfiles.menuProfileA11y', { name: profileLabel })
          : t('browserProfiles.leaveGuest'),
        kind: 'action',
        enabled: true,
      },
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
        id: 'new_incognito_tab',
        icon: 'incognito',
        label: t('browserIncognito.newTab'),
        accessibilityLabel: incognitoAvailable ? t('browserIncognito.newTabA11y') : t('browserIncognito.unavailable'),
        kind: 'action',
        enabled: incognitoAvailable,
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
        id: 'move_to_window',
        icon: 'dock-window',
        label: t('browserProfiles.moveToWindow'),
        accessibilityLabel: t('browserProfiles.moveToWindowA11y'),
        kind: 'action',
        enabled: canMoveToWindow,
      },
      {
        id: 'add_bookmark',
        icon: bookmarked ? 'bookmark' : 'bookmark-outline',
        // B9 #78: on a bookmarked page the star edits the bookmark.
        label: bookmarked ? t('browserBookmarks.editStar') : addBookmarkLabel,
        accessibilityLabel: bookmarked
          ? t('browserBookmarks.editStar')
          : t('browser.addBookmarkA11y'),
        kind: 'action',
        enabled: hasValidPage && !bookmarkPending,
      },
      {
        id: 'reading_list_add',
        icon: 'book-open-variant',
        label: t('browserBookmarks.readingAdd'),
        accessibilityLabel: t('browserBookmarks.readingAdd'),
        kind: 'action',
        enabled: hasValidPage,
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
        id: 'qr_code',
        icon: 'qrcode',
        label: t('browserShare.qrCode'),
        accessibilityLabel: t('browserShare.qrCodeA11y'),
        kind: 'action',
        enabled: hasValidPage,
      },
      {
        id: 'save_page_note',
        icon: 'note-plus-outline',
        label: t('browserShare.savePageToNotes'),
        accessibilityLabel: t('browserShare.savePageToNotes'),
        kind: 'action',
        enabled: hasValidPage,
      },
      {
        id: 'notes',
        icon: 'note-text-outline',
        label: t('browserShare.notes'),
        accessibilityLabel: t('browserShare.notesA11y'),
        kind: 'action',
        enabled: true,
      },
      // B17: pictures, printouts and offline copies (not for incognito tabs: no copies out of incognito).
      ...(incognitoInFront
        ? []
        : [
            { id: 'screenshot' as const, icon: 'cellphone-screenshot', label: t('browserCapture.screenshot'), accessibilityLabel: t('browserCapture.screenshotA11y'), kind: 'action' as const, enabled: hasValidPage },
            { id: 'full_page' as const, icon: 'image-size-select-actual', label: t('browserCapture.fullPage'), accessibilityLabel: t('browserCapture.fullPageA11y'), kind: 'action' as const, enabled: hasValidPage },
            { id: 'print_page' as const, icon: 'printer-outline', label: t('browserCapture.print'), accessibilityLabel: t('browserCapture.printA11y'), kind: 'action' as const, enabled: hasValidPage },
            { id: 'save_offline' as const, icon: 'content-save-outline', label: t('browserCapture.saveOffline'), accessibilityLabel: t('browserCapture.saveOfflineA11y'), kind: 'action' as const, enabled: hasValidPage },
          ]),
      {
        id: 'saved_pages',
        icon: 'archive-outline',
        label: t('browserCapture.savedPages'),
        accessibilityLabel: t('browserCapture.savedPagesA11y'),
        kind: 'action',
        enabled: true,
      },
      // B23: highlights, drawing and page alerts (not for incognito tabs: nothing of them is kept).
      ...(incognitoInFront
        ? []
        : [
            {
              id: 'highlights_page' as const,
              icon: 'format-color-highlight',
              label: t('browserAnnotate.onThisPage'),
              accessibilityLabel: t('browserAnnotate.onThisPageA11y'),
              kind: 'action' as const,
              enabled: hasValidPage,
            },
            {
              id: 'draw' as const,
              icon: 'draw',
              label: t('browserAnnotate.draw'),
              accessibilityLabel: t('browserAnnotate.drawA11y'),
              kind: 'action' as const,
              enabled: hasValidPage,
            },
            {
              id: 'watch_page' as const,
              icon: 'bell-ring-outline',
              label: t('browserAnnotate.watch'),
              accessibilityLabel: t('browserAnnotate.watchA11y'),
              kind: 'action' as const,
              enabled: hasValidPage,
            },
          ]),
      {
        id: 'highlights',
        icon: 'marker',
        label: t('browserAnnotate.allMenu'),
        accessibilityLabel: t('browserAnnotate.allMenuA11y'),
        kind: 'action',
        enabled: true,
      },
      // B19: only while Developer tools are on.
      ...(devtoolsOn
        ? [
            {
              id: 'devtools' as const,
              icon: 'code-tags',
              label: t('browserDevtools.menu'),
              accessibilityLabel: t('browserDevtools.menuA11y'),
              kind: 'action' as const,
              enabled: hasValidPage,
            },
          ]
        : []),
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
        id: 'find_in_page',
        icon: 'text-search',
        label: t('browserFind.menuItem'),
        accessibilityLabel: t('browserFind.menuA11y'),
        kind: 'action',
        enabled: hasValidPage,
      },
      {
        id: 'reader_mode',
        icon: 'book-open-page-variant-outline',
        label: t('browserReader.menuItem'),
        accessibilityLabel: readerAvailable ? t('browserReader.menuA11y') : t('browserReader.notArticle'),
        kind: 'action',
        enabled: hasValidPage && readerAvailable,
      },
      {
        id: 'page_display',
        icon: 'format-size',
        label: t('browserPageDisplay.menuItem'),
        accessibilityLabel: t('browserPageDisplay.menuA11y'),
        kind: 'action',
        enabled: true,
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
      ...(showExit
        ? [
            {
              id: 'exit',
              icon: 'exit-run',
              label: t('browserHistory.exit'),
              accessibilityLabel: t('browserHistory.exitA11y'),
              kind: 'action',
              enabled: true,
            } satisfies BrowserMenuItemModel,
          ]
        : []),
    ];
  }, [
    showExit,
    autoScrollOn,
    bookmarkPending,
    bookmarked,
    canMoveToWindow,
    desktopMode,
    hasClosedTabs,
    hasValidPage,
    incognitoAvailable,
    devtoolsOn,
    incognitoInFront,
    profileLabel,
    readerAvailable,
    t,
    translateUrl,
  ]);

  return {
    items,
    handleItemPress,
    handleDesktopToggle,
  };
}
