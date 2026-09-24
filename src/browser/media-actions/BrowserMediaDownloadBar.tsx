import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  FadeOutDown,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Text } from '@/components/base/Text';
import { BROWSER_TOUCH_TARGET } from '@/browser/constants';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

import { toastForUserTriggeredDownloadOutcome } from './media-resolution-outcome';
import { useBrowserMediaAction } from './useBrowserMediaAction';

const HORIZONTAL_INSET = 0;

export type BrowserMediaDownloadBarProps = {
  testID?: string;
  /** When true, suppress CTA (tab switcher owns presentation). */
  overlayBlocking?: boolean;
  onRequestDownload?: (
    sourceUrl: string,
    options?: {
      referer?: string | null;
      requestContext?: import('@/downloads/types/request-context').MediaRequestContext | null;
    },
  ) => void | Promise<void>;
  onDownloadStarted?: (downloadId: string) => void;
};

/**
 * Compact persistent "Video available" bar above the browser toolbar.
 * Tap starts download (or quality selection). Never auto-popups.
 * In-page playback stays in the WebView — this bar is not a second player.
 */
export const BrowserMediaDownloadBar = memo(function BrowserMediaDownloadBar({
  testID = 'browser-media-download-bar',
  overlayBlocking = false,
  onRequestDownload,
  onDownloadStarted,
}: BrowserMediaDownloadBarProps) {
  const theme = useTheme();
  const { t } = useTranslation();

  const action = useBrowserMediaAction({
    onOpenQualitySheet: onRequestDownload,
    onDownloadStarted,
    overlayBlocking,
  });
  const presentation = action.presentation;

  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announcedRef = useRef(false);
  const downloadInFlightRef = useRef(false);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    setToastVisible(true);
    AccessibilityInfo.announceForAccessibility(message);
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = setTimeout(() => {
      setToastVisible(false);
      toastTimerRef.current = null;
    }, 2800);
  }, []);

  useEffect(() => {
    if (!presentation.showCard || announcedRef.current) {
      return;
    }
    announcedRef.current = true;
    AccessibilityInfo.announceForAccessibility(presentation.accessibilityButton);
  }, [presentation.accessibilityButton, presentation.showCard]);

  useEffect(() => {
    if (!presentation.showCard) {
      announcedRef.current = false;
    }
  }, [presentation.showCard]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const handleDownload = useCallback(async () => {
    if (downloadInFlightRef.current) {
      return;
    }
    downloadInFlightRef.current = true;
    try {
      const result = await action.download();
      if (result.ok) {
        // A second tap on the same video is not a second download; say so instead of claiming a new one.
        showToast(result.deduped ? t('detection.sheet.alreadyAdded') : t('downloads.successToast'));
        return;
      }
      const toast = toastForUserTriggeredDownloadOutcome(
        result.outcome ?? {
          kind: 'STALE_CONTEXT',
          reason: 'NOT_AVAILABLE',
        },
        action.errorMessage,
      );
      if (toast) {
        showToast(toast);
      }
    } finally {
      downloadInFlightRef.current = false;
    }
  }, [action, showToast, t]);

  const handleBarPress = useCallback(() => {
    if (presentation.buttonDisabled) {
      return;
    }
    void handleDownload();
  }, [handleDownload, presentation.buttonDisabled]);

  // The icon breathes only while the download is being prepared, so motion always means "working".
  const pulse = useSharedValue(1);
  const preparing = presentation.isPreparing;

  useEffect(() => {
    if (!preparing) {
      cancelAnimation(pulse);
      pulse.value = withTiming(1, { duration: 160 });
      return;
    }
    pulse.value = withRepeat(
      withTiming(0.45, { duration: 620, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
    return () => {
      cancelAnimation(pulse);
    };
  }, [preparing, pulse]);

  const iconStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  if (!presentation.showCard && !toastVisible) {
    return null;
  }

  const isPreparing = presentation.isPreparing;
  const barEnabled = !presentation.buttonDisabled;

  // Anchor to the bottom only — never cover the WebView with an elevated
  // full-screen layer. Android elevation + absoluteFill intercepts taps
  // even when pointerEvents is box-none (dead WebView / chrome buttons).
  return (
    <Box
      testID={testID}
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 40,
        paddingHorizontal: HORIZONTAL_INSET,
      }}>
      {toastVisible ? (
        <Box
          pointerEvents="none"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={{
            position: 'absolute',
            left: 16,
            right: 16,
            bottom: presentation.showCard ? 56 : 8,
            paddingHorizontal: theme.spacing[16],
            paddingVertical: theme.spacing[12],
            borderRadius: theme.radius.md,
            backgroundColor: theme.colors.black,
            opacity: 0.92,
            borderWidth: 1,
            borderColor: theme.colors.border,
          }}>
          <Text variant="bodySmall" color="white" align="center">
            {toastMessage}
          </Text>
        </Box>
      ) : null}

      {presentation.showCard ? (
        // Detection is a moment worth noticing: the bar rises into place instead of appearing from nowhere.
        <Animated.View
          entering={FadeInDown.duration(220)}
          exiting={FadeOutDown.duration(160)}
          pointerEvents="auto"
          style={{ width: '100%', elevation: 8 }}>
          <Pressable
            testID="browser-media-download-button"
            onPress={handleBarPress}
            disabled={!barEnabled}
            accessibilityRole="button"
            accessibilityState={{
              disabled: !barEnabled,
              busy: isPreparing,
            }}
            accessibilityLabel={
              isPreparing
                ? t('browser.media.preparingDownload')
                : t('browser.media.videoAvailableA11y')
            }
            accessibilityHint={
              barEnabled ? t('browser.media.videoAvailableHint') : undefined
            }
            style={{
              minHeight: BROWSER_TOUCH_TARGET,
              width: '100%',
              paddingHorizontal: theme.spacing[16],
              backgroundColor: theme.colors.card,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: theme.colors.border,
              borderBottomWidth: 2,
              borderBottomColor: theme.colors.primary,
              alignItems: 'center',
              justifyContent: 'space-between',
              flexDirection: 'row',
              opacity: barEnabled ? 1 : 0.72,
            }}>
            <Text variant="button" color="textPrimary" numberOfLines={1}>
              {isPreparing
                ? t('browser.media.preparingDownload')
                : t('browser.media.videoAvailable')}
            </Text>
            <Animated.View style={iconStyle}>
              <Icon
                name="download"
                size={20}
                color={barEnabled ? 'primary' : 'disabled'}
              />
            </Animated.View>
          </Pressable>
        </Animated.View>
      ) : null}
    </Box>
  );
});
