import type {
  DetectedMedia,
  DetectionStatistics,
  MediaDetectionError,
  MediaQualityVariant,
  PageMediaMetadata,
} from './media.types';

export interface MediaDetectionState {
  detectedMedia: DetectedMedia[];
  selectedMediaId: string | null;
  videoFormats: DetectedMedia[];
  audioFormats: DetectedMedia[];
  streamFormats: DetectedMedia[];
  qualities: MediaQualityVariant[];
  pageMetadata: PageMediaMetadata | null;
  isScanning: boolean;
  scanProgress: number;
  supported: boolean;
  detectionError: MediaDetectionError | null;
  lastScan: number | null;
  lastNavigation: string | null;
  statistics: DetectionStatistics;
  confidence: number;
  /** Navigation epoch alignment with browser engine (optional). */
  navigationEpoch: number;
}

export interface MediaDetectionActions {
  upsertMedia: (media: DetectedMedia) => void;
  upsertMany: (media: DetectedMedia[]) => void;
  upsertQualities: (variants: MediaQualityVariant[]) => void;
  selectMedia: (id: string | null) => void;
  setPageMetadata: (metadata: PageMediaMetadata | null) => void;
  /** The page renamed itself: its media that carried the previous name take the new one. */
  renamePageMedia: (pageUrl: string, fromTitle: string, toTitle: string) => void;
  setScanning: (scanning: boolean, progress?: number) => void;
  setSupported: (supported: boolean) => void;
  setDetectionError: (error: MediaDetectionError | null) => void;
  setLastNavigation: (url: string | null, epoch?: number) => void;
  bumpStatistics: (patch: Partial<DetectionStatistics>) => void;
  recomputeDerived: () => void;
  clearPageDetections: () => void;
  reset: () => void;
}

export type MediaDetectionStore = MediaDetectionState & MediaDetectionActions;
