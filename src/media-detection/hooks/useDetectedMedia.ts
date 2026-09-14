import {
  selectAudioFormats,
  selectConfidence,
  selectDetectedCount,
  selectDetectedMedia,
  selectHasDetectedMedia,
  selectIsScanning,
  selectSelectedMedia,
  selectStreamFormats,
  selectVideoFormats,
  useMediaDetectionStore,
} from '../stores';

/** Convenience hooks with granular selectors. */
export function useDetectedMedia() {
  return useMediaDetectionStore(selectDetectedMedia);
}

export function useDetectedMediaCount() {
  return useMediaDetectionStore(selectDetectedCount);
}

export function useHasDetectedMedia() {
  return useMediaDetectionStore(selectHasDetectedMedia);
}

export function useIsMediaScanning() {
  return useMediaDetectionStore(selectIsScanning);
}

export function useSelectedDetectedMedia() {
  return useMediaDetectionStore(selectSelectedMedia);
}

export function useVideoFormats() {
  return useMediaDetectionStore(selectVideoFormats);
}

export function useAudioFormats() {
  return useMediaDetectionStore(selectAudioFormats);
}

export function useStreamFormats() {
  return useMediaDetectionStore(selectStreamFormats);
}

export function useDetectionConfidence() {
  return useMediaDetectionStore(selectConfidence);
}
