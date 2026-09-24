import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
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
import { filterCorrelatedCandidates } from '../services/media-correlation.service';
import { logIgRuntime } from '../services/ig-runtime-diagnostics.service';
import { socialPageContextStore } from '../social';
import { mediaDetectionEngine } from '../engine';
import { buildOwnershipKey, selectDiscoveryMedia, subscribeOwnership } from './discovery-selection';

export type MediaDiscoveryViewModel = {
  visible: boolean;
  media: DetectedMedia | null;
  /** Changes on material ownership transitions (owner strength, visible/playing player, generation). */
  ownershipKey: string;
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

  const ownershipKey = useSyncExternalStore(subscribeOwnership, () => buildOwnershipKey(activeTabId));

  const media = useMemo(() => {
    const mse = getMsePlaybackContext(lastNavigation);
    return selectDiscoveryMedia({
      candidates,
      focusedMediaId,
      lastNavigation,
      activeTabId,
      navigationEpoch,
      ownershipKey,
      msePlaybackActive: mse.msePlaybackActive,
      msePlaybackAgeMs: mse.msePlaybackAgeMs,
    });
  }, [candidates, focusedMediaId, lastNavigation, activeTabId, navigationEpoch, ownershipKey]);

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
      logIgRuntime('discovery_media_selected', {
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
    ownershipKey,
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
