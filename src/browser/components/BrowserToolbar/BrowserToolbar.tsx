import { memo, useCallback, useMemo, useState } from 'react';
import { AccessibilityInfo, ToastAndroid } from 'react-native';
import { GestureDetector, type PanGesture } from 'react-native-gesture-handler';

import { Box } from '@/components/base/Box';
import { useTheme } from '@/hooks/use-theme';
import { BackHistorySheet } from '@/browser/components/BackHistorySheet/BackHistorySheet';
import type { BackHistoryEntry } from '@/browser/navigation/back-history';
import { goBackInActiveTab, loadActiveTabBackHistory } from '@/browser/navigation/back-history.service';

import { BROWSER_TOOLBAR_HEIGHT, BROWSER_TOUCH_TARGET } from '@/browser/constants';
import { useBrowserNavigation } from '@/browser/hooks';
import { useTranslation, type TranslationKey } from '@/localization';
import type { IconName } from '@/components/base/Icon';
import { selectCurrentUrl, selectIsLoading, useBrowserStore } from '@/browser/stores';
import { browserCommands } from '@/browser/startup/browser-commands';
import { readHomepage } from '@/browser/startup/startup-settings';
import { parseToolbarButtons, type ToolbarButtonId } from '@/browser/startup/toolbar-buttons';
import { isValidBrowserPageUrl } from '@/browser/utils';
import { useSettingsStore } from '@/store/settings';

import { getBrowserToolbarItems } from './toolbar-config';
import { ToolbarButton } from './ToolbarButton';

/** B21 #238: the buttons beyond today's Back / Forward / Home. */
const EXTRA_BUTTONS: Record<Exclude<ToolbarButtonId, 'back' | 'forward' | 'home'>, { icon: IconName; label: TranslationKey }> = {
  newTab: { icon: 'tab-plus', label: 'browserStartup.buttonNewTab' },
  reload: { icon: 'refresh', label: 'browserStartup.buttonReload' },
  share: { icon: 'share-variant', label: 'browserStartup.buttonShare' },
  bookmarks: { icon: 'bookmark-outline', label: 'browserStartup.buttonBookmarks' },
  history: { icon: 'history', label: 'browserStartup.buttonHistory' },
  downloads: { icon: 'download', label: 'browserStartup.buttonDownloads' },
  searchSite: { icon: 'magnify', label: 'browserStartup.buttonSearchSite' },
};

export type BrowserToolbarProps = {
  /** B6 #45: the sideways swipe that goes back / forward (owned by the browser screen). */
  swipeGesture: PanGesture;
  testID?: string;
};

/**
 * Minimal production toolbar: Back, Forward, Home.
 * Flex-distributed — no device-specific coordinates.
 * Future actions flip `enabled` in toolbar-config — no layout changes required.
 */
export const BrowserToolbar = memo(function BrowserToolbar({
  swipeGesture,
  testID = 'browser-toolbar',
}: BrowserToolbarProps) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const {
    canGoBack,
    canGoForward,
    isHome,
    handleBack,
    handleForward,
    handleHome,
  } = useBrowserNavigation();
  // B21 #238 / #232: the user's buttons and order (default: today's Back, Forward, Home); Home opens the homepage.
  const toolbarValue = useSettingsStore((s) => s.toolbarButtons);
  const toolbarIds = useMemo(() => parseToolbarButtons(toolbarValue), [toolbarValue]);
  const homepage = readHomepage(useSettingsStore((s) => s.homepageUrl));
  const currentUrl = useBrowserStore(selectCurrentUrl);
  const isLoading = useBrowserStore(selectIsLoading);
  const hasPage = isValidBrowserPageUrl(currentUrl);
  // B6 #44: a long press on Back lists the tab's earlier pages.
  const [backHistory, setBackHistory] = useState<BackHistoryEntry[] | null>(null);

  const showBackHistory = useCallback(async () => {
    const entries = await loadActiveTabBackHistory();
    if (entries.length === 0) {
      ToastAndroid.show(t('browserNav.backHistoryEmpty'), ToastAndroid.SHORT);
      AccessibilityInfo.announceForAccessibility(t('browserNav.backHistoryEmpty'));
      return;
    }
    setBackHistory(entries);
  }, [t]);

  const closeBackHistory = useCallback(() => setBackHistory(null), []);

  const goBackTo = useCallback((entry: BackHistoryEntry) => {
    setBackHistory(null);
    void goBackInActiveTab(entry.steps);
  }, []);

  const visibleItems = useMemo(() => {
    const base = getBrowserToolbarItems(t);
    return toolbarIds.map((id): { id: ToolbarButtonId; icon: IconName; accessibilityLabel: string } => {
      if (id === 'back' || id === 'forward' || id === 'home') {
        const item = base.find((b) => b.id === id)!;
        const icon = id === 'back' ? rtl.arrowBack : id === 'forward' ? rtl.arrowForward : item.icon;
        return { id, icon, accessibilityLabel: item.accessibilityLabel };
      }
      const extra = EXTRA_BUTTONS[id];
      if (id === 'reload' && isLoading) {
        return { id, icon: 'close', accessibilityLabel: t('browserStartup.buttonStop') };
      }
      return { id, icon: extra.icon, accessibilityLabel: t(extra.label) };
    });
  }, [toolbarIds, isLoading, rtl.arrowBack, rtl.arrowForward, t]);

  const resolveDisabled = useCallback(
    (id: ToolbarButtonId): boolean => {
      if (id === 'back') {
        return !canGoBack;
      }
      if (id === 'forward') {
        return !canGoForward;
      }
      if (id === 'home') {
        // Deterministic: Home is a no-op on Browser Home — disable for clarity. With a homepage: on the homepage.
        return homepage ? currentUrl === homepage : isHome;
      }
      if (id === 'reload' || id === 'share' || id === 'searchSite') {
        return !hasPage;
      }
      return false;
    },
    [canGoBack, canGoForward, currentUrl, hasPage, homepage, isHome],
  );

  const resolvePress = useCallback(
    (id: ToolbarButtonId) => {
      switch (id) {
        case 'back':
          return handleBack;
        case 'forward':
          return handleForward;
        case 'home':
          return homepage ? browserCommands.home : handleHome;
        case 'newTab':
          return browserCommands.newTab;
        case 'reload':
          return browserCommands.reload;
        case 'share':
          return () => void browserCommands.share();
        case 'bookmarks':
          return browserCommands.bookmarks;
        case 'history':
          return browserCommands.history;
        case 'downloads':
          return browserCommands.downloads;
        case 'searchSite':
          return browserCommands.searchSite;
        default:
          return () => undefined;
      }
    },
    [handleBack, handleForward, handleHome, homepage],
  );

  return (
    <GestureDetector gesture={swipeGesture}>
      <Box
        testID={testID}
        row
        px={8}
        style={{
          minHeight: BROWSER_TOOLBAR_HEIGHT,
          height: BROWSER_TOOLBAR_HEIGHT,
          alignItems: 'center',
          justifyContent: 'space-around',
          backgroundColor: theme.colors.bottomNavBackground,
          borderTopWidth: 1,
          borderTopColor: theme.colors.bottomNavBorder,
          width: '100%',
        }}
        accessibilityRole="toolbar">
        {visibleItems.map((item) => (
          <Box
            key={item.id}
            flex={1}
            center
            style={{ minWidth: BROWSER_TOUCH_TARGET, minHeight: BROWSER_TOUCH_TARGET }}>
            <ToolbarButton
              icon={item.icon}
              accessibilityLabel={item.accessibilityLabel}
              disabled={resolveDisabled(item.id)}
              onPress={resolvePress(item.id)}
              onLongPress={item.id === 'back' ? () => void showBackHistory() : undefined}
              longPressLabel={item.id === 'back' ? t('browserNav.showBackHistory') : undefined}
              testID={`${testID}-${item.id}`}
            />
          </Box>
        ))}
        <BackHistorySheet
          visible={backHistory != null}
          entries={backHistory ?? []}
          onSelect={goBackTo}
          onClose={closeBackHistory}
        />
      </Box>
    </GestureDetector>
  );
});
