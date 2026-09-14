import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { BROWSER_TOOLBAR_HEIGHT } from '@/browser/constants';
import { useTheme } from '@/hooks/use-theme';
import { useReducedMotionPreference } from '@/screens/splash/hooks/useReducedMotionPreference';

import { useDiscoveryCardAnimation } from '../animations';
import { DetectionCard } from '../cards/DetectionCard';
import { useMediaDiscovery } from '../hooks/useMediaDiscovery';
import { DISCOVERY_ANIMATION, DISCOVERY_LAYOUT } from '../quality';
import { isSafeMediaUrl } from '../utils';
import { buildRequestContextFromDetectedMedia } from '../services/request-context.service';
import { logMediaDiagnostic } from '../services/media-diagnostics.service';
import type { MediaRequestContext } from '@/downloads/types/request-context';

const DOWNLOAD_FAILED_TOAST = 'Couldn’t start download. Try again.';

/**
 * Non-blocking floating discovery overlay.
 * pointerEvents="box-none" keeps the WebView fully interactive.
 * Download CTA hands off to Analyze → Quality → Create (canonical pipeline).
 */
export const MediaDiscoveryOverlay = memo(function MediaDiscoveryOverlay({
  testID = 'media-discovery-overlay',
  onRequestDownload,
}: {
  testID?: string;
  /** Browser Download CTA → open quality selection with detected URL. */
  onRequestDownload?: (
    sourceUrl: string,
    options?: {
      referer?: string | null;
      requestContext?: MediaRequestContext | null;
    },
  ) => void | Promise<void>;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotionPreference();
  const discovery = useMediaDiscovery();
  const announcedIdRef = useRef<string | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissGenerationRef = useRef(0);
  const dismissRef = useRef(discovery.dismiss);
  dismissRef.current = discovery.dismiss;
  const dismissingRef = useRef(false);
  const downloadInFlightRef = useRef(false);

  const mediaId = discovery.media?.id ?? null;
  const isVisible = discovery.visible;

  const [mountCard, setMountCard] = useState(false);
  const [cardVisible, setCardVisible] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState(DOWNLOAD_FAILED_TOAST);
  const [downloading, setDownloading] = useState(false);

  const clearExitTimer = useCallback(() => {
    if (exitTimerRef.current) {
      clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
  }, []);

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
    if (isVisible && mediaId) {
      clearExitTimer();
      dismissGenerationRef.current += 1;
      dismissingRef.current = false;
      setMountCard(true);
      setCardVisible(true);
      return;
    }

    if (dismissingRef.current) {
      return;
    }

    setCardVisible(false);
    const generation = dismissGenerationRef.current;
    const delay = reducedMotion ? 0 : DISCOVERY_ANIMATION.exitMs;
    clearExitTimer();
    exitTimerRef.current = setTimeout(() => {
      if (dismissGenerationRef.current !== generation) {
        return;
      }
      setMountCard(false);
      exitTimerRef.current = null;
    }, delay);

    return clearExitTimer;
  }, [isVisible, mediaId, reducedMotion, clearExitTimer]);

  const handleDismiss = useCallback(() => {
    if (dismissingRef.current) {
      return;
    }
    dismissingRef.current = true;
    setCardVisible(false);

    // Persist session dismiss immediately — prevents reappearance mid-exit.
    dismissRef.current();
    AccessibilityInfo.announceForAccessibility('Media discovery dismissed');

    const generation = dismissGenerationRef.current;
    const delay = reducedMotion ? 0 : DISCOVERY_ANIMATION.exitMs;
    clearExitTimer();
    exitTimerRef.current = setTimeout(() => {
      if (dismissGenerationRef.current !== generation) {
        return;
      }
      setMountCard(false);
      dismissingRef.current = false;
      exitTimerRef.current = null;
    }, delay);
  }, [reducedMotion, clearExitTimer]);

  const handleDownload = useCallback(async () => {
    if (
      downloadInFlightRef.current ||
      !discovery.downloadable ||
      !discovery.media
    ) {
      return;
    }

    const sourceUrl =
      discovery.media.finalUrl?.trim() ||
      discovery.media.url?.trim() ||
      '';
    if (!sourceUrl || !isSafeMediaUrl(sourceUrl)) {
      showToast(DOWNLOAD_FAILED_TOAST);
      return;
    }

    if (!onRequestDownload) {
      showToast(DOWNLOAD_FAILED_TOAST);
      return;
    }

    downloadInFlightRef.current = true;
    setDownloading(true);

    try {
      // Dismiss card first so Analyze / Quality sheet is the single surface.
      handleDismiss();
      const pageUrl = discovery.media.pageUrl?.trim() || null;
      const requestContext = await buildRequestContextFromDetectedMedia({
        mediaUrl: sourceUrl,
        pageUrl,
        requiresCookies: discovery.media.requiresCookies,
        requiredHeaders: discovery.media.requiredHeaders,
      });

      logMediaDiagnostic('download_request', {
        url: sourceUrl,
        pageUrl,
        cookiesRequired: requestContext.cookiesRequired,
        hasCookies: requestContext.hasCookies,
        refererRequired: Boolean(requestContext.referer),
        userAgentRequired: Boolean(requestContext.userAgent),
      });

      await onRequestDownload(sourceUrl, {
        referer: requestContext.referer,
        requestContext,
      });
    } catch {
      showToast(DOWNLOAD_FAILED_TOAST);
    } finally {
      downloadInFlightRef.current = false;
      setDownloading(false);
    }
  }, [
    discovery.downloadable,
    discovery.media,
    handleDismiss,
    onRequestDownload,
    showToast,
  ]);

  useEffect(() => {
    return () => {
      clearExitTimer();
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
      dismissingRef.current = false;
      downloadInFlightRef.current = false;
    };
  }, [clearExitTimer]);

  const { cardStyle, panGesture } = useDiscoveryCardAnimation({
    visible: cardVisible && mountCard,
    reducedMotion,
    mediaId,
    onSwipeDismiss: handleDismiss,
  });

  useEffect(() => {
    if (!isVisible || !mediaId || announcedIdRef.current === mediaId) {
      return;
    }
    announcedIdRef.current = mediaId;
    const title = discovery.media?.title ?? 'media';
    AccessibilityInfo.announceForAccessibility(
      discovery.downloadable
        ? `Download available: ${title}`
        : `Media detected: ${title}`,
    );
  }, [isVisible, mediaId, discovery.media?.title, discovery.downloadable]);

  useEffect(() => {
    if (!isVisible) {
      announcedIdRef.current = null;
    }
  }, [isVisible]);

  const bottomOffset = useMemo(
    () =>
      BROWSER_TOOLBAR_HEIGHT +
      insets.bottom +
      DISCOVERY_LAYOUT.bottomGapAboveToolbar,
    [insets.bottom],
  );

  if (!mountCard && !toastVisible) {
    return null;
  }

  return (
    <Box
      testID={testID}
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 20,
        paddingHorizontal: DISCOVERY_LAYOUT.horizontalInset,
        paddingBottom: bottomOffset,
      }}>
      {toastVisible ? (
        <Box
          pointerEvents="none"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          accessibilityLabel={toastMessage}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: mountCard ? undefined : 0,
            marginBottom: mountCard ? DISCOVERY_LAYOUT.thumbnailSize + 48 : 0,
            zIndex: 30,
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

      {mountCard ? (
        <GestureDetector gesture={panGesture}>
          <Animated.View
            pointerEvents={cardVisible ? 'auto' : 'none'}
            style={[cardStyle, { width: '100%' }]}>
            <DetectionCard
              discovery={discovery}
              onDismiss={handleDismiss}
              onDownload={() => {
                void handleDownload();
              }}
              downloading={downloading}
            />
          </Animated.View>
        </GestureDetector>
      ) : null}
    </Box>
  );
});
