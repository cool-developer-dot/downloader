/**
 * Core media detection domain types.
 * Detection-only — no download queue / quality UI contracts live here.
 */

export type MediaCategory = 'video' | 'audio' | 'stream';

export type ProgressiveVideoContainer =
  | 'mp4'
  | 'webm'
  | 'mov'
  | 'm4v'
  | 'mkv'
  | 'avi'
  | 'mpeg'
  | 'mpg'
  | 'ts'
  | 'm2ts'
  | '3gp'
  | '3g2'
  | 'flv'
  | 'wmv';

export type ProgressiveAudioContainer = 'mp3' | 'm4a' | 'aac' | 'ogg';

export type StreamContainer = 'hls' | 'dash';

/** Progressive + stream containers. Unknown when MIME/ext unresolved. */
export type MediaContainer =
  | ProgressiveVideoContainer
  | ProgressiveAudioContainer
  | StreamContainer
  | 'unknown';

/** Normalized stream classification for UI + download handoff. */
export type StreamType = 'DIRECT' | 'HLS' | 'DASH';

/** Future-ready stream protocol identifiers. */
export type StreamProtocol = 'hls' | 'dash' | 'cmaf' | 'unknown';

export type HlsPlaylistType = 'master' | 'variant' | 'media' | 'unknown';

export type DetectionSource =
  | 'dom_video'
  | 'dom_audio'
  | 'dom_source'
  | 'network_request'
  | 'performance_resource'
  | 'og_meta'
  | 'manifest'
  | 'navigation'
  | 'js_fetch'
  | 'js_xhr'
  | 'native_network'
  | 'mime_probe';

/** Safe session headers for download handoff — never log cookie values. */
export type RequiredMediaHeaders = {
  userAgent?: string;
  referer?: string;
  /** Cookie presence only — values stay in WebView cookie jar. */
  hasCookies?: boolean;
};

export type MediaDetectionErrorCode =
  | 'unsupported_page'
  | 'private_content'
  | 'drm_protected'
  | 'encrypted_hls'
  | 'broken_manifest'
  | 'missing_metadata'
  | 'invalid_media'
  | 'malformed_url'
  | 'timeout'
  | 'cross_origin'
  | 'detection_failure'
  | 'unknown';

export interface MediaDimensions {
  width: number | null;
  height: number | null;
  resolution: string | null;
  aspectRatio: number | null;
}

/**
 * Where and when an observation was made. Applied to a candidate before dedupe, so a re-observation of a resource
 * already on record (same resource, rotated signed URL) moves it to the scope it was just seen in.
 */
export type MediaObservationStamp = Pick<
  DetectedMedia,
  'frameUrl' | 'observedTabId' | 'observedNavigationEpoch' | 'observedPageGeneration'
>;

/**
 * Fully normalized detected media candidate.
 * Unavailable fields are explicitly null — never fabricated.
 */
export interface DetectedMedia {
  ownerElementIdentity?: string | null;
  frameUrl?: string | null;
  observedTabId?: string | null;
  observedNavigationEpoch?: number;
  observedPageGeneration?: number;
  id: string;
  /** Canonical playback/download URL (prefer final after redirects). */
  url: string;
  /** Original observed URL before redirect resolution. */
  sourceUrl: string;
  /** Final URL after bounded redirect resolution. */
  finalUrl: string;
  pageUrl: string;
  title: string | null;
  thumbnailUrl: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  resolution: string | null;
  aspectRatio: number | null;
  fps: number | null;
  estimatedFileSize: number | null;
  codec: string | null;
  audioCodec: string | null;
  bitrate: number | null;
  mimeType: string | null;
  extension: string | null;
  container: MediaContainer;
  category: MediaCategory;
  streamType: StreamType;
  isLive: boolean;
  isDrm: boolean;
  playlistType: HlsPlaylistType | null;
  streamProtocol: StreamProtocol | null;
  websiteSource: string | null;
  detectionSource: DetectionSource;
  sourceDetector: DetectionSource;
  detectedAt: number;
  confidence: number;
  downloadable: boolean;
  requiresCookies: boolean;
  requiredHeaders: RequiredMediaHeaders | null;
  redirectCount: number;
  /** Soft tags for future Download Manager mapping (platform slug). */
  platformHint: string | null;
  /** Separate audio representation present (DASH). */
  hasSeparateAudio: boolean;
  /** Video representation has no muxed audio. */
  videoOnly: boolean;
}

export interface MediaQualityVariant {
  id: string;
  mediaId: string;
  bandwidth: number | null;
  width: number | null;
  height: number | null;
  resolution: string | null;
  codecs: string | null;
  frameRate: number | null;
  audioGroup: string | null;
  mimeType: string | null;
  representationId: string | null;
  hasAudio: boolean;
  hasVideo: boolean;
  url: string;
  playlistType: HlsPlaylistType;
}

export interface PageMediaMetadata {
  pageUrl: string;
  title: string | null;
  description: string | null;
  ogImage: string | null;
  ogVideo: string | null;
  canonicalUrl: string | null;
  websiteSource: string | null;
  updatedAt: number;
}

export interface DetectionStatistics {
  totalDetected: number;
  videoCount: number;
  audioCount: number;
  streamCount: number;
  duplicateUpdates: number;
  rejectedCount: number;
  lastScanDurationMs: number;
  scansCompleted: number;
}

export interface MediaDetectionError {
  code: MediaDetectionErrorCode;
  message: string;
  url: string | null;
  occurredAt: number;
}

/** Lightweight candidate emitted by observers before enrichment. */
export interface MediaCandidate {
  ownerElementIdentity?: string | null;
  frameUrl?: string | null;
  /** Observation evidence only; never implies a supported or verified container. */
  videoElementEvidence?: boolean;
  url: string;
  pageUrl: string;
  sourceUrl?: string | null;
  finalUrl?: string | null;
  mimeType?: string | null;
  extension?: string | null;
  title?: string | null;
  thumbnailUrl?: string | null;
  duration?: number | null;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  codec?: string | null;
  audioCodec?: string | null;
  bitrate?: number | null;
  estimatedFileSize?: number | null;
  isLive?: boolean;
  isDrm?: boolean;
  playlistType?: HlsPlaylistType | null;
  streamProtocol?: StreamProtocol | null;
  streamType?: StreamType | null;
  detectionSource: DetectionSource;
  confidenceHint?: number;
  requiresCookies?: boolean;
  requiredHeaders?: RequiredMediaHeaders | null;
  redirectCount?: number;
  hasSeparateAudio?: boolean;
  videoOnly?: boolean;
  /** Blob URL observed as indicator only — never downloadable. */
  blobIndicator?: string | null;
}
