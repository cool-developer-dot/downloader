import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  StyleSheet,
} from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  FadeOutDown,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Text } from '@/components/base/Text';
import { BROWSER_TOUCH_TARGET } from '@/browser/constants';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation, type TranslationKey } from '@/localization';

import type { BrowserMediaStatusNotice } from './browser-download-presentation';
import { toastForUserTriggeredDownloadOutcome } from './media-resolution-outcome';
import { useBrowserMediaAction } from './useBrowserMediaAction';

const HORIZONTAL_INSET = 0;

const NOTICE_LABEL_KEYS: Record<BrowserMediaStatusNotice, TranslationKey> = {
  DETECTING: 'browser.media.detectingVideo',
  DOWNLOADING: 'browser.media.downloadingVideo',
  DOWNLOADED: 'browser.media.downloadedVideo',
  ALREADY_DOWNLOADED: 'browser.media.alreadyDownloaded',
  PROTECTED: 'browser.media.protectedVideo',
  UNSUPPORTED: 'browser.media.unsupportedVideo',
};

/** Notices about the current video's download (shown on the Download bar itself when an offer is up). */
function isDownloadProgressNotice(notice: BrowserMediaStatusNotice | null): boolean {
  return notice === 'DOWNLOADING' || notice === 'DOWNLOADED' || notice === 'ALREADY_DOWNLOADED';
}

/** One dot of the "Detecting video" ellipsis: fades in turn with the others. */
function DetectingDot({ progress, index, color }: { progress: SharedValue<number>; index: number; color: string }) {
  const style = useAnimatedStyle(() => {
    // Each dot peaks a third of the cycle after the previous one.
    const phase = (progress.value + 1 - index / 3) % 1;
    const lit = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
    return { opacity: 0.25 + 0.75 * lit };
  });
  return (
    <Animated.View
      style={[{ width: 5, height: 5, borderRadius: 2.5, marginLeft: 3, backgroundColor: color }, style]}
    />
  );
}

/**
 * "Detecting video…": a subtle scanning state for the current video while detection works on it — the label's three
 * dots light in sequence and a video icon softly breathes. Motion stops as soon as the state is replaced.
 */
function DetectingNotice({ label, color }: { label: string; color: string }) {
  const progress = useSharedValue(0);
  const breathe = useSharedValue(1);
  useEffect(() => {
    progress.value = withRepeat(withTiming(1, { duration: 1200, easing: Easing.linear }), -1, false);
    breathe.value = withRepeat(
      withSequence(
        withTiming(0.4, { duration: 700, easing: Easing.inOut(Easing.quad) }),
        withDelay(80, withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) })),
      ),
      -1,
      false,
    );
    return () => {
      cancelAnimation(progress);
      cancelAnimation(breathe);
    };
  }, [breathe, progress]);
  const iconStyle = useAnimatedStyle(() => ({
    opacity: breathe.value,
    transform: [{ scale: 0.9 + 0.1 * breathe.value }],
  }));
  return (
    <>
      <Box style={{ flexDirection: 'row', alignItems: 'flex-end', flexShrink: 1 }}>
        <Text variant="button" color="textPrimary" numberOfLines={1}>
          {label}
        </Text>
        <Box style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6, marginLeft: 1 }}>
          <DetectingDot progress={progress} index={0} color={color} />
          <DetectingDot progress={progress} index={1} color={color} />
          <DetectingDot progress={progress} index={2} color={color} />
        </Box>
      </Box>
      <Animated.View style={iconStyle}>
        <Icon name="movie-search-outline" size={20} color="primary" />
      </Animated.View>
    </>
  );
}

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
        // The same video again is not a second download: say which it is, never "Added" and never a failure.
        showToast(
          result.duplicate === 'ALREADY_DOWNLOADED'
            ? t('downloads.alreadyDownloadedToast')
            : result.duplicate === 'ALREADY_DOWNLOADING' || result.deduped
              ? t('downloads.alreadyDownloadingToast')
              : t('downloads.successToast'),
        );
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

  const notice = presentation.statusNotice;
  if (!presentation.showCard && !toastVisible && !notice) {
    return null;
  }

  const isPreparing = presentation.isPreparing;
  const barEnabled = !presentation.buttonDisabled;
  const noticeLabel = notice ? t(NOTICE_LABEL_KEYS[notice]) : null;
  const noticeIcon =
    notice === 'DOWNLOADED' || notice === 'ALREADY_DOWNLOADED'
      ? 'check-circle'
      : notice === 'PROTECTED'
        ? 'lock'
        : 'close-circle';
  const noticeIconColor =
    notice === 'DOWNLOADED' || notice === 'ALREADY_DOWNLOADED' ? 'success' : 'disabled';

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
                : isDownloadProgressNotice(notice) && noticeLabel
                  ? noticeLabel
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
      ) : notice && noticeLabel ? (
        // The current video is not (or not yet) a Download: say what it is, never point at a previous video.
        <Animated.View
          entering={FadeInDown.duration(220)}
          exiting={FadeOutDown.duration(160)}
          pointerEvents="none"
          style={{ width: '100%', elevation: 8 }}>
          <Box
            testID="browser-media-status"
            accessible
            accessibilityRole="text"
            accessibilityLiveRegion="polite"
            accessibilityLabel={noticeLabel}
            style={{
              minHeight: BROWSER_TOUCH_TARGET,
              width: '100%',
              paddingHorizontal: theme.spacing[16],
              backgroundColor: theme.colors.card,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: theme.colors.border,
              alignItems: 'center',
              justifyContent: 'space-between',
              flexDirection: 'row',
            }}>
            {notice === 'DETECTING' ? (
              <DetectingNotice label={noticeLabel} color={theme.colors.primary} />
            ) : (
              <>
                <Text
                  variant="button"
                  color={notice === 'DOWNLOADING' ? 'textPrimary' : 'textSecondary'}
                  numberOfLines={1}>
                  {noticeLabel}
                </Text>
                {notice === 'DOWNLOADING' ? (
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                ) : (
                  <Icon name={noticeIcon} size={20} color={noticeIconColor} />
                )}
              </>
            )}
          </Box>
        </Animated.View>
      ) : null}
    </Box>
  );
});
