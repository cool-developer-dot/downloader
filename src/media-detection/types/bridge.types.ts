/**
 * Bridge protocol between injected page observers and React Native.
 * Keep payloads small and JSON-serializable.
 */

import type { DetectionSource, HlsPlaylistType } from './media.types';

export const MEDIA_BRIDGE_CHANNEL = 'vidorax-media-detection' as const;

export type MediaBridgeMessageType =
  | 'ready'
  | 'page_meta'
  | 'media_candidate'
  | 'mutation_batch'
  | 'scan_complete'
  | 'error'
  | 'blob_indicator'
  | 'active_video'
  | 'active_iframe_player';

export interface MediaBridgeEnvelope<T = unknown> {
  channel: typeof MEDIA_BRIDGE_CHANNEL;
  type: MediaBridgeMessageType;
  payload: T;
  ts: number;
}

export interface BridgePageMetaPayload {
  pageUrl: string;
  title: string | null;
  description: string | null;
  ogImage: string | null;
  ogVideo: string | null;
  canonicalUrl: string | null;
}

export interface BridgeMediaCandidatePayload {
  ownerElementIdentity?: string | null;
  frameUrl?: string | null;
  url: string;
  pageUrl: string;
  mimeType: string | null;
  extension: string | null;
  title: string | null;
  thumbnailUrl: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  estimatedFileSize: number | null;
  isLive: boolean;
  isDrm: boolean;
  playlistType: HlsPlaylistType | null;
  detectionSource: DetectionSource;
  tagName: string | null;
  /** Blob URL indicator only — never a download target. */
  blobIndicator?: string | null;
}

export interface BridgeMutationBatchPayload {
  candidates: BridgeMediaCandidatePayload[];
  pageUrl: string;
}

export interface BridgeErrorPayload {
  code: string;
  message: string;
}

/** What a blob: URL stands for. `mse` means the real media arrives as separate HTTP(S) requests. */
export type BridgeMediaSourceKind = 'mse' | 'blob';

/**
 * How a MediaSource player's SourceBuffers carry the tracks, from the MIME types the page gave `addSourceBuffer`:
 * `muxed` — one buffer with video and audio; `split` — separate video and audio buffers (two sources that would
 * have to be muxed); `video` / `audio` — one track kind only.
 */
export type BridgeMseTrackLayout = 'muxed' | 'split' | 'video' | 'audio';

/**
 * The files a MediaSource's SourceBuffers were fed from (the latest appended to each), when the page read them as
 * ArrayBuffers: the exact video file and audio file of a split player — never another video's prefetch.
 */
export type BridgeMseFiles = { video: string | null; audio: string | null };

export interface BridgeBlobIndicatorPayload {
  pageUrl: string;
  blobUrl: string;
  /** The <video> the blob is attached to, when the sighting came from an element. */
  elementIdentity: string | null;
  /** Encrypted-playback evidence (MediaKeys / 'encrypted' event / EME negotiation). Observed only. */
  isProtected: boolean;
  sourceKind: BridgeMediaSourceKind | null;
  mseTracks?: BridgeMseTrackLayout | null;
  mseFiles?: BridgeMseFiles | null;
}

/**
 * Bounded active <video> evidence for Phase 4A ownership correlation.
 * Cheap fields only — never a full DOM dump.
 */
export interface BridgeActiveVideoPayload {
  pageUrl: string;
  elementIdentity: string;
  currentSrc: string | null;
  src: string | null;
  isBlob: boolean;
  paused: boolean | null;
  ended: boolean | null;
  readyState: number | null;
  videoWidth: number | null;
  videoHeight: number | null;
  muted: boolean | null;
  /** Floor(currentTime / 5) — coalesced, not per-frame. */
  currentTimeBucket: number | null;
  intersectionRatio: number | null;
  viewportCenterDistance: number | null;
  /** Rendered box in CSS px (not the intrinsic video size). */
  displayWidth: number | null;
  displayHeight: number | null;
  isDisplayed: boolean;
  isVisibleStyle: boolean;
  recentlyPlayed: boolean;
  explicitAdMarker: boolean;
  associatedContentId: string | null;
  /** Encrypted-playback evidence for this player. Observed only — never a bypass. */
  isProtected: boolean;
  sourceKind: BridgeMediaSourceKind | null;
  /** SourceBuffer layout of this element's MediaSource, when it plays one. */
  mseTracks?: BridgeMseTrackLayout | null;
  /** Files feeding this element's SourceBuffers (split players). */
  mseFiles?: BridgeMseFiles | null;
  /** The element's duration in seconds, when finite. */
  duration?: number | null;
}

export interface BridgeActiveIframePlayerPayload {
  pageUrl: string;
  iframeIdentity: string;
  iframeSrc: string | null;
  frameClass: 'same-origin' | 'cross-origin';
  isDisplayed: boolean;
  isVisibleStyle: boolean;
  intersectionRatio: number | null;
  viewportCenterDistance: number | null;
  width: number | null;
  height: number | null;
  allowFullscreen: boolean;
  allow: string | null;
  looksPlayer: boolean;
  sameOriginVideoCount: number | null;
  associatedContentId: string | null;
}

export type MediaBridgePayload =
  | BridgePageMetaPayload
  | BridgeMediaCandidatePayload
  | BridgeMutationBatchPayload
  | BridgeErrorPayload
  | BridgeBlobIndicatorPayload
  | BridgeActiveVideoPayload
  | BridgeActiveIframePlayerPayload
  | Record<string, never>;
