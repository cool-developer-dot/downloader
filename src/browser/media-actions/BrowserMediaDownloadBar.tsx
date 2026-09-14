import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Text } from '@/components/base/Text';
import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
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
 * Opens an app-owned Play / Download sheet. Never auto-popups.
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

  const [sheetVisible, setSheetVisible] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announcedRef = useRef(false);

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
      setSheetVisible(false);
    }
  }, [presentation.showCard]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const closeSheet = useCallback(() => {
    setSheetVisible(false);
  }, []);

  const handleBarPress = useCallback(() => {
    if (presentation.buttonDisabled) {
      return;
    }
    setSheetVisible(true);
  }, [presentation.buttonDisabled]);

  const handlePlay = useCallback(() => {
    action.play();
  }, [action]);

  const handleDownload = useCallback(async () => {
    const result = await action.download();
    if (result.ok) {
      showToast(t('downloads.successToast'));
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
  }, [action, showToast, t]);

  const sheetActions = useMemo<ActionSheetItem[]>(
    () => [
      {
        id: 'play',
        label: t('browser.media.play'),
        icon: 'play',
        onPress: handlePlay,
      },
      {
        id: 'download',
        label: t('browser.media.download'),
        icon: 'download',
        onPress: () => {
          void handleDownload();
        },
      },
    ],
    [handleDownload, handlePlay, t],
  );

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
        <View pointerEvents="auto" style={{ width: '100%', elevation: 8 }}>
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
            <Icon
              name="chevron-down"
              size={20}
              color={barEnabled ? 'primary' : 'disabled'}
            />
          </Pressable>
        </View>
      ) : null}

      <ActionSheetModal
        visible={sheetVisible}
        title={t('browser.media.videoAvailable')}
        actions={sheetActions}
        onClose={closeSheet}
        testID="browser-media-action-sheet"
      />
    </Box>
  );
});
