import { memo, useCallback, useEffect, useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';

import { Box } from '@/components/base/Box';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { announceTabsLimitReached } from '@/browser/services/tabs-limit-notice';
import { useBrowserStore } from '@/browser/stores';
import { TAB_UNDO_VISIBLE_MS, tabUndo } from '@/browser/tabs/tab-undo';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

export type TabUndoSnackbarProps = {
  /** Two instances exist (browser screen, tab switcher); only the visible one draws. */
  visible: boolean;
  /**
   * Distance from the bottom of its container. In the tab switcher the bar floats exactly over the New tab button, so
   * a tap that comes just after the bar timed out opens a tab instead of closing one.
   */
  bottom?: number;
  testID?: string;
};

/** B1: "Tab closed · Undo" / "3 tabs closed · Undo" for at least 6 s after any close; Undo reopens the whole group. */
export const TabUndoSnackbar = memo(function TabUndoSnackbar({
  visible,
  bottom = 12,
  testID = 'browser-tab-undo',
}: TabUndoSnackbarProps) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const offer = useSyncExternalStore(tabUndo.subscribe, tabUndo.get, tabUndo.get);

  useEffect(() => {
    if (!offer) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Android's "Time to take action" accessibility setting can ask for longer.
    void AccessibilityInfo.getRecommendedTimeoutMillis(TAB_UNDO_VISIBLE_MS)
      .catch(() => TAB_UNDO_VISIBLE_MS)
      .then((visibleMs) => {
        if (cancelled) return;
        const remaining = Math.max(0, offer.shownAt + Math.max(TAB_UNDO_VISIBLE_MS, visibleMs) - Date.now());
        timer = setTimeout(() => tabUndo.dismiss(offer.batchId), remaining);
      });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [offer]);

  const message = offer
    ? offer.count === 1
      ? t('browserTabs.tabClosed')
      : t('browserTabs.tabsClosed', { count: offer.count })
    : '';

  useEffect(() => {
    if (offer && visible) {
      AccessibilityInfo.announceForAccessibility(message);
    }
    // Announce once per offer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offer?.batchId]);

  const handleUndo = useCallback(() => {
    if (!offer) return;
    const outcome = useBrowserStore.getState().undoCloseTabs(offer.batchId);
    if (outcome.status === 'LIMIT_REACHED') {
      announceTabsLimitReached();
    } else if (outcome.dropped > 0) {
      AccessibilityInfo.announceForAccessibility(
        t('browserTabs.restoredSome', { restored: outcome.restored, dropped: outcome.dropped }),
      );
      announceTabsLimitReached();
    }
  }, [offer, t]);

  if (!offer || !visible) {
    return null;
  }

  return (
    <Animated.View
      entering={FadeInDown.duration(160)}
      exiting={FadeOutDown.duration(160)}
      pointerEvents="box-none"
      style={{ position: 'absolute', left: 12, right: 12, bottom, zIndex: 50, elevation: 6 }}>
      <Box
        testID={testID}
        accessibilityLiveRegion="polite"
        style={{
          minHeight: 52,
          borderRadius: theme.radius.md,
          backgroundColor: theme.colors.textPrimary,
          flexDirection: rtl.rowDirection,
          alignItems: 'center',
          paddingHorizontal: 16,
          gap: 8,
          elevation: 6,
        }}>
        <Text variant="body" style={{ flex: 1, color: theme.colors.background }} numberOfLines={2}>
          {message}
        </Text>
        <Pressable
          testID={`${testID}-action`}
          accessibilityRole="button"
          accessibilityLabel={t('browserTabs.undoA11y')}
          onPress={handleUndo}
          style={{ minHeight: 48, minWidth: 64, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 }}>
          <Text variant="button" style={{ color: theme.colors.background }}>
            {t('browserTabs.undo')}
          </Text>
        </Pressable>
      </Box>
    </Animated.View>
  );
});
