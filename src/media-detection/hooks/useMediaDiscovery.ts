import { useCallback, useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { selectIsHome, useBrowserStore } from '@/browser/stores';

import { resolveAudioOptions, resolveQualities, type ResolvedQuality } from '../quality';
import {
  useDiscoveryUiStore,
  useMediaDetectionStore,
} from '../stores';
import type { DetectedMedia } from '../types';
import { isDownloadAffordable, resolveDiscoveryBadges, type DiscoveryBadge } from '../ui';
import { getMsePlaybackContext } from '../engine/mse-playback-context';
import { describePlatformPage } from '../platform';
import {
  filterCorrelatedCandidates,
  pickBestCorrelatedMedia,
} from '../services/media-correlation.service';
import { logIgRuntime } from '../services/ig-runtime-diagnostics.service';
import {
  resolveSocialPlatform,
  selectCurrentMediaForActiveSocialTab,
  socialPageContextStore,
} from '../social';
import { selectCurrentMediaForActiveGeneralTab } from '../general-media';
import { mediaDetectionEngine } from '../engine';

export type MediaDiscoveryViewModel = {
  visible: boolean;
  media: DetectedMedia | null;
  candidates: DetectedMedia[];
  /** All detected ids on the page (including dismissed) — used for session dismiss. */
  allDetectedIds: string[];
  qualities: ResolvedQuality[];
  audioOptions: ReturnType<typeof resolveAudioOptions>;
  badges: DiscoveryBadge[];
  isScanning: boolean;
  expanded: boolean;
  downloadable: boolean;
  pageTitle: string | null;
  errorMessage: string | null;
  platformStatus: string | null;
  dismiss: () => void;
  toggleExpanded: () => void;
  focusMedia: (id: string) => void;
};

/**
 * Composes detection store + discovery UI store into a presentation model.
 * Clears dismissals on navigation. Hides on home / empty / session dismiss.
 */
export function useMediaDiscovery(): MediaDiscoveryViewModel {
  const isHome = useBrowserStore(selectIsHome);
  const activeTabId = useBrowserStore((s) => s.activeTabId);
  const {
    detectedMedia,
    variants,
    isScanning,
    pageMetadata,
    detectionError,
    lastNavigation,
    navigationEpoch,
  } = useMediaDetectionStore(
    useShallow((s) => ({
      detectedMedia: s.detectedMedia,
      variants: s.qualities,
      isScanning: s.isScanning,
      pageMetadata: s.pageMetadata,
      detectionError: s.detectionError,
      lastNavigation: s.lastNavigation,
      navigationEpoch: s.navigationEpoch,
    })),
  );

  const {
    dismissedIds,
    sessionFingerprint,
    sessionDismissed,
    expanded,
    focusedMediaId,
    resetForNavigation,
    dismissSession,
    setExpanded,
    setFocusedMediaId,
  } = useDiscoveryUiStore(
    useShallow((s) => ({
      dismissedIds: s.dismissedIds,
      sessionFingerprint: s.sessionFingerprint,
      sessionDismissed: s.sessionDismissed,
      expanded: s.expanded,
      focusedMediaId: s.focusedMediaId,
      resetForNavigation: s.resetForNavigation,
      dismissSession: s.dismissSession,
      setExpanded: s.setExpanded,
      setFocusedMediaId: s.setFocusedMediaId,
    })),
  );

  useEffect(() => {
    resetForNavigation(lastNavigation);
  }, [lastNavigation, resetForNavigation]);

  useEffect(() => {
    if (activeTabId) {
      mediaDetectionEngine.setActiveTab(activeTabId);
      socialPageContextStore.setActiveTab(activeTabId);
    }
  }, [activeTabId]);

  // Note: generalPageMediaContextStore.setActiveTab is invoked via engine.setActiveTab.

  const fingerprintSet = useMemo(
    () => new Set(sessionFingerprint),
    [sessionFingerprint],
  );

  const candidates = useMemo(() => {
    const filtered = detectedMedia.filter((m) => {
      if (dismissedIds[m.id]) {
        return false;
      }
      if (sessionDismissed && fingerprintSet.has(m.id)) {
        return false;
      }
      return true;
    });

    const mse = getMsePlaybackContext(lastNavigation);
    return filterCorrelatedCandidates(filtered, {
      pageUrl: lastNavigation,
      msePlaybackActive: mse.msePlaybackActive,
      msePlaybackAgeMs: mse.msePlaybackAgeMs,
    });
  }, [
    detectedMedia,
    dismissedIds,
    sessionDismissed,
    fingerprintSet,
    lastNavigation,
  ]);

  const allDetectedIds = useMemo(
    () => detectedMedia.map((m) => m.id),
    [detectedMedia],
  );

  const media = useMemo(() => {
    if (candidates.length === 0) {
      return null;
    }
    if (focusedMediaId) {
      const focused = candidates.find((m) => m.id === focusedMediaId);
      if (focused) {
        return focused;
      }
    }

    const mse = getMsePlaybackContext(lastNavigation);
    const socialPlatform = lastNavigation
      ? resolveSocialPlatform(lastNavigation)
      : null;

    if (socialPlatform && activeTabId) {
      const social = selectCurrentMediaForActiveSocialTab({
        candidates,
        tabId: activeTabId,
        navigationEpoch,
        pageUrl: lastNavigation,
        msePlaybackActive: mse.msePlaybackActive,
        msePlaybackAgeMs: mse.msePlaybackAgeMs,
      });
      if (social.usedSocialCorrelation) {
        return social.media;
      }
    }

    // Phase 5A — ordinary websites: ownership evidence over latest/largest score.
    if (!socialPlatform && activeTabId) {
      const general = selectCurrentMediaForActiveGeneralTab({
        candidates,
        tabId: activeTabId,
        navigationEpoch,
        pageUrl: lastNavigation,
        msePlaybackActive: mse.msePlaybackActive,
        msePlaybackAgeMs: mse.msePlaybackAgeMs,
      });
      if (general.usedGeneralCorrelation) {
        if (general.media) {
          return general.media;
        }
        // Ownership found no current player, but HTTP media still exists on
        // the page (extensionless CDN, JSON-LD, preload). Offer that rather
        // than hiding a working download.
        const http = candidates.filter((m) => {
          const url = (m.finalUrl || m.url).toLowerCase();
          return url.startsWith('http://') || url.startsWith('https://');
        });
        if (http.length > 0) {
          return (
            pickBestCorrelatedMedia(http, {
              pageUrl: lastNavigation,
              msePlaybackActive: mse.msePlaybackActive,
              msePlaybackAgeMs: mse.msePlaybackAgeMs,
            }) ??
            http.find((m) => m.category === 'video') ??
            http.find((m) => m.category === 'stream') ??
            http[0] ??
            null
          );
        }
        return null;
      }
    }

    const correlated = pickBestCorrelatedMedia(candidates, {
      pageUrl: lastNavigation,
      msePlaybackActive: mse.msePlaybackActive,
      msePlaybackAgeMs: mse.msePlaybackAgeMs,
    });
    if (correlated) {
      return correlated;
    }

    return (
      candidates.find((m) => m.category === 'video') ??
      candidates.find((m) => m.category === 'stream') ??
      candidates[0] ??
      null
    );
  }, [
    candidates,
    focusedMediaId,
    lastNavigation,
    activeTabId,
    navigationEpoch,
  ]);

  const qualities = useMemo(
    () => (media ? resolveQualities({ media, variants }) : []),
    [media, variants],
  );

  const audioOptions = useMemo(
    () => resolveAudioOptions(candidates),
    [candidates],
  );

  const badges = useMemo(
    () => (media ? resolveDiscoveryBadges(media, detectionError) : []),
    [media, detectionError],
  );

  const platformStatus = useMemo(() => {
    const pageUrl = lastNavigation;
    if (!pageUrl) {
      return null;
    }
    const platform = describePlatformPage(pageUrl);
    if (isScanning && candidates.length === 0) {
      switch (platform.kind) {
        case 'tiktok':
          return 'Resolving TikTok video…';
        case 'instagram':
          return 'Detecting Instagram media…';
        default:
          return 'Scanning for media…';
      }
    }
    if (media) {
      switch (platform.kind) {
        case 'tiktok':
          return 'TikTok video detected';
        case 'instagram':
          return 'Instagram media detected';
        default:
          if (pageUrl.includes('youtube.com') || pageUrl.includes('youtu.be')) {
            return 'YouTube media detected';
          }
          return 'Video detected';
      }
    }
    if (!isScanning && candidates.length === 0 && platform.isPublicContentPath) {
      return 'Video not detected — tap play on the page';
    }
    return null;
  }, [candidates.length, isScanning, lastNavigation, media]);

  const visible = !isHome && media != null;

  useEffect(() => {
    if (visible && media) {
      logIgRuntime('overlay_visible', {
        hostname: safeHostname(media.url),
        mimeType: media.mimeType,
        confidence: media.confidence,
      });
    }
  }, [visible, media]);

  const dismiss = useCallback(() => {
    // Prefer current page detections; fall back to visible candidates.
    const ids = allDetectedIds.length > 0 ? allDetectedIds : candidates.map((c) => c.id);
    if (ids.length === 0 && media) {
      dismissSession([media.id]);
      return;
    }
    dismissSession(ids);
  }, [allDetectedIds, candidates, media, dismissSession]);

  const toggleExpanded = useCallback(() => {
    setExpanded(!expanded);
  }, [expanded, setExpanded]);

  return {
    visible,
    media,
    candidates,
    allDetectedIds,
    qualities,
    audioOptions,
    badges,
    isScanning,
    expanded,
    downloadable: media ? isDownloadAffordable(media) : false,
    pageTitle: pageMetadata?.title ?? media?.title ?? null,
    errorMessage:
      detectionError && media?.isDrm
        ? detectionError.message
        : detectionError?.code === 'encrypted_hls'
          ? detectionError.message
          : null,
    platformStatus,
    dismiss,
    toggleExpanded,
    focusMedia: setFocusedMediaId,
  };
}

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
