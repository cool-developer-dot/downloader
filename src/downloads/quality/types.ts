/**
 * Canonical selectable media variant for download quality selection.
 * Evolved from Week 6 QualityOption — one model, no parallel V2 types.
 * Fields mirror Analyze MediaAnalysisVariant — never fabricate values.
 */

import type {
  AnalysisUnsupportedReason,
  MediaAnalysisContainer,
  MediaAnalysisMediaType,
  MediaAnalysisResult,
  MediaAnalysisStreamType,
} from '../../api/types';

export type { AnalyzePhase as QualitySelectionPhase } from '../analyze/analyze-state-machine';

/** Canonical stream classification — local DownloadStreamType domain. */
export type DownloadStreamType = MediaAnalysisStreamType;

/**
 * Canonical downloadable quality option.
 * UI convenience flags are derived from streamType (+ audio-only evidence).
 */
export type DownloadQualityOption = {
  id: string;
  /** Display label derived from real height/container — never invented tiers. */
  label: string;
  sourceUrl: string;

  resolution: string | null;
  width: number | null;
  height: number | null;

  bitrate: number | null;
  averageBitrate: number | null;
  videoBitrate: number | null;
  audioBitrate: number | null;

  /** Raw CODECS / codec string when known. */
  codec: string | null;
  videoCodec: string | null;
  audioCodec: string | null;
  rawCodec: string | null;

  container: MediaAnalysisContainer;
  mimeType: string | null;

  /** Decimal string when known; otherwise null. Maps from estimatedFileSize. */
  fileSize: string | null;
  estimatedFileSize: number | null;

  fps: number | null;
  frameRate: number | null;

  streamType: DownloadStreamType;
  isHls: boolean;
  isProgressive: boolean;
  isAudioOnly: boolean;

  mediaType: MediaAnalysisMediaType | null;
  /**
   * Known only when mediaType / codecs are definitive.
   * null = unknown — UI must omit rather than guess.
   */
  hasAudio: boolean | null;
  hasVideo: boolean | null;
  downloadable: boolean;
  unavailableReason: AnalysisUnsupportedReason | null;
  /** DASH only: the manifest representation this option downloads (sent to the engine as `variant.videoId`). */
  representationId?: string | null;
  /**
   * Split tracks: this option's `sourceUrl` is a video-only file and this is its audio file; the engine downloads
   * both and merges them (`kind: 'split'`).
   */
  audioSourceUrl?: string | null;
};

/** @deprecated Prefer DownloadQualityOption — alias retained for Week 6 callers. */
export type QualityOption = DownloadQualityOption;

/** Normalized analysis model for the selection surface. */
export type AnalyzedMediaSelection = {
  title: string | null;
  thumbnailUrl: string | null;
  sourceUrl: string;
  finalUrl: string;
  platform: string;
  mediaType: MediaAnalysisMediaType | null;
  mimeType: string | null;
  container: MediaAnalysisContainer;
  duration: number | null;
  options: DownloadQualityOption[];
  /** Top-level analysis reason when no downloadable option exists. */
  unsupportedReason: AnalysisUnsupportedReason | null;
  raw: MediaAnalysisResult;
};
