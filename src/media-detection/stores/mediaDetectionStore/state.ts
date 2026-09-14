import type { DetectionStatistics, MediaDetectionState } from '../../types';

export const initialDetectionStatistics: DetectionStatistics = {
  totalDetected: 0,
  videoCount: 0,
  audioCount: 0,
  streamCount: 0,
  duplicateUpdates: 0,
  rejectedCount: 0,
  lastScanDurationMs: 0,
  scansCompleted: 0,
};

export const initialMediaDetectionState: MediaDetectionState = {
  detectedMedia: [],
  selectedMediaId: null,
  videoFormats: [],
  audioFormats: [],
  streamFormats: [],
  qualities: [],
  pageMetadata: null,
  isScanning: false,
  scanProgress: 0,
  supported: true,
  detectionError: null,
  lastScan: null,
  lastNavigation: null,
  statistics: initialDetectionStatistics,
  confidence: 0,
  navigationEpoch: 0,
};
