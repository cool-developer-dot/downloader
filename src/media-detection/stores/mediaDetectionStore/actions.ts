import type { StoreApi } from 'zustand';

import type { DetectedMedia, MediaDetectionActions, MediaDetectionStore } from '../../types';
import { initialDetectionStatistics, initialMediaDetectionState } from './state';
import { observeCandidateInWindow } from '../../observation/candidate-observation-window';
import { socialPageContextStore } from '../../social/social-page-context';
import { generalPageMediaContextStore } from '../../general-media/general-page-context';
import { resolveSocialPlatform } from '../../social/social-content-identity';
import { isSameDocumentUrl } from '../../utils/url';

type SetState = StoreApi<MediaDetectionStore>['setState'];
type GetState = StoreApi<MediaDetectionStore>['getState'];

function deriveFormats(detected: DetectedMedia[]) {
  const videoFormats = detected.filter((m) => m.category === 'video');
  const audioFormats = detected.filter((m) => m.category === 'audio');
  const streamFormats = detected.filter((m) => m.category === 'stream');
  const confidence =
    detected.length === 0
      ? 0
      : Number(
          (
            detected.reduce((sum, m) => sum + m.confidence, 0) / detected.length
          ).toFixed(3),
        );

  return { videoFormats, audioFormats, streamFormats, confidence };
}

export function createMediaDetectionActions(
  set: SetState,
  get: GetState,
): MediaDetectionActions {
  return {
    upsertMedia: (media) => {
      const state = get();
      const existingIndex = state.detectedMedia.findIndex((m) => m.id === media.id);
      let detectedMedia: DetectedMedia[];
      let duplicateUpdates = state.statistics.duplicateUpdates;

      if (existingIndex >= 0) {
        detectedMedia = state.detectedMedia.slice();
        detectedMedia[existingIndex] = {
          ...detectedMedia[existingIndex]!,
          ...media,
          confidence: Math.max(
            detectedMedia[existingIndex]!.confidence,
            media.confidence,
          ),
        };
        duplicateUpdates += 1;
      } else {
        const urlMatch = state.detectedMedia.findIndex(
          (m) =>
            m.url === media.url &&
            m.container === media.container &&
            m.category === media.category,
        );
        if (urlMatch >= 0) {
          detectedMedia = state.detectedMedia.slice();
          detectedMedia[urlMatch] = {
            ...detectedMedia[urlMatch]!,
            ...media,
            id: detectedMedia[urlMatch]!.id,
            confidence: Math.max(
              detectedMedia[urlMatch]!.confidence,
              media.confidence,
            ),
          };
          duplicateUpdates += 1;
        } else {
          detectedMedia = [media, ...state.detectedMedia];
        }
      }

      const tabId = socialPageContextStore.getActiveTabId();
      if (tabId && !media.url.toLowerCase().startsWith('blob:')) {
        const social = socialPageContextStore.get(tabId);
        const general = generalPageMediaContextStore.get(tabId);
        const platform =
          resolveSocialPlatform(media.pageUrl || state.lastNavigation || '') ??
          'general';
        observeCandidateInWindow(
          {
            tabId,
            navigationEpoch: state.navigationEpoch,
            generation:
              social?.contextGeneration ?? general?.pageGeneration ?? 0,
            platform,
          },
          media,
        );
      }

      const derived = deriveFormats(detectedMedia);
      set({
        detectedMedia,
        ...derived,
        statistics: {
          ...state.statistics,
          totalDetected: detectedMedia.length,
          videoCount: derived.videoFormats.length,
          audioCount: derived.audioFormats.length,
          streamCount: derived.streamFormats.length,
          duplicateUpdates,
        },
        lastScan: Date.now(),
      });
    },

    upsertMany: (mediaList) => {
      if (!mediaList.length) {
        return;
      }
      for (const media of mediaList) {
        get().upsertMedia(media);
      }
      const state = get();
      set({
        lastScan: Date.now(),
        statistics: {
          ...state.statistics,
          scansCompleted: state.statistics.scansCompleted + 1,
        },
      });
    },

    upsertQualities: (variants) => {
      if (!variants.length) {
        return;
      }
      const state = get();
      const byId = new Map(state.qualities.map((q) => [q.id, q]));
      for (const variant of variants) {
        byId.set(variant.id, variant);
      }
      set({ qualities: Array.from(byId.values()) });
    },

    selectMedia: (id) => {
      set({ selectedMediaId: id });
    },

    setPageMetadata: (metadata) => {
      set({ pageMetadata: metadata });
    },

    renamePageMedia: (pageUrl, fromTitle, toTitle) => {
      const { detectedMedia } = get();
      if (!detectedMedia.some((m) => m.title === fromTitle && isSameDocumentUrl(m.pageUrl, pageUrl))) {
        return;
      }
      set({
        detectedMedia: detectedMedia.map((m) =>
          m.title === fromTitle && isSameDocumentUrl(m.pageUrl, pageUrl) ? { ...m, title: toTitle } : m,
        ),
      });
    },

    setScanning: (scanning, progress) => {
      set({
        isScanning: scanning,
        scanProgress:
          progress != null
            ? Math.max(0, Math.min(1, progress))
            : scanning
              ? get().scanProgress
              : 0,
      });
    },

    setSupported: (supported) => {
      set({ supported });
    },

    setDetectionError: (error) => {
      set({ detectionError: error });
    },

    setLastNavigation: (url, epoch) => {
      set({
        lastNavigation: url,
        navigationEpoch: epoch ?? get().navigationEpoch,
      });
    },

    bumpStatistics: (patch) => {
      set({
        statistics: {
          ...get().statistics,
          ...patch,
        },
      });
    },

    recomputeDerived: () => {
      const { detectedMedia } = get();
      const derived = deriveFormats(detectedMedia);
      set({
        ...derived,
        statistics: {
          ...get().statistics,
          totalDetected: detectedMedia.length,
          videoCount: derived.videoFormats.length,
          audioCount: derived.audioFormats.length,
          streamCount: derived.streamFormats.length,
        },
      });
    },

    clearPageDetections: () => {
      set({
        detectedMedia: [],
        selectedMediaId: null,
        videoFormats: [],
        audioFormats: [],
        streamFormats: [],
        qualities: [],
        pageMetadata: null,
        isScanning: false,
        scanProgress: 0,
        detectionError: null,
        confidence: 0,
        statistics: {
          ...initialDetectionStatistics,
          scansCompleted: get().statistics.scansCompleted,
        },
      });
    },

    reset: () => {
      set({ ...initialMediaDetectionState });
    },
  };
}
