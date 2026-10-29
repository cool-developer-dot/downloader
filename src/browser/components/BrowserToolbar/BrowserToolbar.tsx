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
import { useTranslation } from '@/localization';

import { getBrowserToolbarItems, type BrowserToolbarItemId } from './toolbar-config';
import { ToolbarButton } from './ToolbarButton';

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

  const visibleItems = useMemo(
    () =>
      getBrowserToolbarItems(t)
        .filter((item) => item.enabled)
        .map((item) =>
          item.id === 'back'
            ? { ...item, icon: rtl.arrowBack }
            : item.id === 'forward'
              ? { ...item, icon: rtl.arrowForward }
              : item,
        ),
    [rtl.arrowBack, rtl.arrowForward, t],
  );

  const resolveDisabled = useCallback(
    (id: BrowserToolbarItemId): boolean => {
      if (id === 'back') {
        return !canGoBack;
      }
      if (id === 'forward') {
        return !canGoForward;
      }
      if (id === 'home') {
        // Deterministic: Home is a no-op on Browser Home — disable for clarity.
        return isHome;
      }
      return false;
    },
    [canGoBack, canGoForward, isHome],
  );

  const resolvePress = useCallback(
    (id: BrowserToolbarItemId) => {
      switch (id) {
        case 'back':
          return handleBack;
        case 'forward':
          return handleForward;
        case 'home':
          return handleHome;
        default:
          return () => undefined;
      }
    },
    [handleBack, handleForward, handleHome],
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
