import { useCallback, useMemo } from 'react';
import { AccessibilityInfo, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import {
  selectCurrentUrl,
  selectDesktopMode,
  selectPageTitle,
  useBrowserStore,
} from '@/browser/stores';
import { navigationService } from '@/browser/services';
import { announceTabsLimitReached } from '@/browser/services/tabs-limit-notice';
import { buildTranslatePageUrl } from '@/browser/services/translate-page';
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
        case 'continue_watching':
          handleContinueWatching();
          break;
        case 'recently_watched':
          handleRecentlyWatched();
          break;
        case 'new_tab':
          handleNewTab();
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
      handleBookmarks,
      handleContinueWatching,
      handleCopyLink,
      handleDownloads,
      handleHistory,
      handleNewTab,
      handleOpenExternal,
      handleRecentDownloads,
      handleRecentlyWatched,
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
        id: 'translate',
        icon: 'translate',
        label: t('browser.translatePage'),
        accessibilityLabel: t('browser.translatePageA11y'),
        kind: 'action',
        enabled: translateUrl != null,
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
    bookmarkPending,
    bookmarked,
    desktopMode,
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
