import type { MediaDetectionStore } from '../../types';

export const selectDetectedMedia = (state: MediaDetectionStore) =>
  state.detectedMedia;
export const selectSelectedMediaId = (state: MediaDetectionStore) =>
  state.selectedMediaId;
export const selectSelectedMedia = (state: MediaDetectionStore) =>
  state.detectedMedia.find((m) => m.id === state.selectedMediaId) ?? null;
export const selectVideoFormats = (state: MediaDetectionStore) =>
  state.videoFormats;
export const selectAudioFormats = (state: MediaDetectionStore) =>
  state.audioFormats;
export const selectStreamFormats = (state: MediaDetectionStore) =>
  state.streamFormats;
export const selectQualities = (state: MediaDetectionStore) => state.qualities;
export const selectPageMetadata = (state: MediaDetectionStore) =>
  state.pageMetadata;
export const selectIsScanning = (state: MediaDetectionStore) => state.isScanning;
export const selectScanProgress = (state: MediaDetectionStore) =>
  state.scanProgress;
export const selectSupported = (state: MediaDetectionStore) => state.supported;
export const selectDetectionError = (state: MediaDetectionStore) =>
  state.detectionError;
export const selectLastScan = (state: MediaDetectionStore) => state.lastScan;
export const selectLastNavigation = (state: MediaDetectionStore) =>
  state.lastNavigation;
export const selectStatistics = (state: MediaDetectionStore) => state.statistics;
export const selectConfidence = (state: MediaDetectionStore) => state.confidence;
export const selectDetectedCount = (state: MediaDetectionStore) =>
  state.detectedMedia.length;
export const selectHasDetectedMedia = (state: MediaDetectionStore) =>
  state.detectedMedia.length > 0;
