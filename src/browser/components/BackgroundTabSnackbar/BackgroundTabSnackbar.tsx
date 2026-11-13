import { memo, useCallback, useEffect, useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';

import { Box } from '@/components/base/Box';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { useBrowserStore } from '@/browser/stores';
import { BACKGROUND_TAB_NOTICE_MS, backgroundTabNotice } from '@/browser/tabs/background-tab-notice';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

/** B6 #51: "Opened in background · Switch" after a link was opened in a background tab; Switch shows that tab. */
export const BackgroundTabSnackbar = memo(function BackgroundTabSnackbar({
  visible,
  bottom = 12,
  testID = 'browser-background-tab',
}: {
  visible: boolean;
  bottom?: number;
  testID?: string;
}) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const notice = useSyncExternalStore(backgroundTabNotice.subscribe, backgroundTabNotice.get, backgroundTabNotice.get);

  useEffect(() => {
    if (!notice) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Android's "Time to take action" accessibility setting can ask for longer.
    void AccessibilityInfo.getRecommendedTimeoutMillis(BACKGROUND_TAB_NOTICE_MS)
      .catch(() => BACKGROUND_TAB_NOTICE_MS)
      .then((visibleMs) => {
        if (cancelled) return;
        const remaining = Math.max(0, notice.shownAt + Math.max(BACKGROUND_TAB_NOTICE_MS, visibleMs) - Date.now());
        timer = setTimeout(() => backgroundTabNotice.dismiss(notice.tabId), remaining);
      });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [notice]);

  useEffect(() => {
    if (notice && visible) {
      AccessibilityInfo.announceForAccessibility(t('browserNav.openedInBackground'));
    }
    // Announce once per notice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notice?.tabId]);

  const handleSwitch = useCallback(() => {
    if (!notice) return;
    backgroundTabNotice.dismiss(notice.tabId);
    if (useBrowserStore.getState().tabs.some((tab) => tab.id === notice.tabId)) {
      useBrowserStore.getState().switchTab(notice.tabId);
    }
  }, [notice]);

  if (!notice || !visible) {
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
          {t('browserNav.openedInBackground')}
        </Text>
        <Pressable
          testID={`${testID}-action`}
          accessibilityRole="button"
          accessibilityLabel={t('browserNav.switchToTabA11y')}
          onPress={handleSwitch}
          style={{ minHeight: 48, minWidth: 64, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 }}>
          <Text variant="button" style={{ color: theme.colors.background }}>
            {t('browserNav.switchToTab')}
          </Text>
        </Pressable>
      </Box>
    </Animated.View>
  );
});
