/**
 * Detection contract: messages posted by the in-page detector (src/detection/page) through
 * window.ReactNativeWebView.postMessage, and the per-tab media model built from them.
 *
 * Every message from a WebView is untrusted input: validate shape and sizes before use.
 */
import type { EnqueueRequest, SiteId } from '@modules/vidorax-media/src/VidoraMedia.types';

export const DETECTOR_CHANNEL = 'vdx';
export const DETECTOR_VERSION = 1;

export type CandidateSource =
  | {
      kind: 'progressive';
      url: string;
      width?: number;
      height?: number;
      bitrate?: number;
      mimeType?: string;
      /** null or absent = unknown. */
      hasAudio?: boolean | null;
      /** e.g. TikTok downloadAddr. Ranked below clean sources. */
      watermarked?: boolean;
      sizeBytes?: number;
      /** Separate audio file to mux with `url` (then `url` is video-only). */
      audioUrl?: string;
    }
  | { kind: 'hls'; url: string; width?: number; height?: number; bitrate?: number }
  | { kind: 'dash'; url: string; manifestText?: string };

export type CandidateProvenance = 'json' | 'dom' | 'network' | 'manifest-body' | 'web-download';

export interface PageCandidate {
  /** '<site>:<assetId>' when the asset id is known (e.g. 'instagram:C9xYz'), else 'url:<canonical url>'. */
  key: string;
  site: SiteId;
  title?: string;
  thumbnailUrl?: string;
  durationSec?: number;
  /** Canonical content page, e.g. https://www.instagram.com/reel/C9xYz/ */
  contentUrl?: string;
  sources: CandidateSource[];
  provenance: CandidateProvenance;
}

export interface FrameInfo {
  url: string;
  isMain: boolean;
  userAgent: string;
}

export interface PlayerHint {
  /** Non-blob currentSrc when available. */
  src?: string;
  isBlob: boolean;
  poster?: string;
  durationSec?: number;
  width?: number;
  height?: number;
  playing: boolean;
  /** 0..1 fraction of the element inside the viewport. */
  visibleRatio: number;
  /** Codecs seen in MediaSource.addSourceBuffer for this element. */
  mseCodecs?: string[];
}

interface MessageBase {
  ch: typeof DETECTOR_CHANNEL;
  v: typeof DETECTOR_VERSION;
  frame: FrameInfo;
}

export type DetectorMessage =
  | (MessageBase & { type: 'hello' })
  | (MessageBase & { type: 'nav'; url: string; title?: string })
  | (MessageBase & { type: 'candidates'; candidates: PageCandidate[] })
  | (MessageBase & { type: 'players'; players: PlayerHint[] })
  | (MessageBase & { type: 'drm'; keySystem: string })
  | (MessageBase & { type: 'policy'; blocked: 'youtube' });

export type UnsupportedReason =
  | 'DRM_PROTECTED'
  | 'LIVE_UNSUPPORTED'
  | 'UNSUPPORTED_FORMAT'
  | 'NOT_MEDIA'
  | 'SOURCE_UNAVAILABLE'
  | 'POLICY_BLOCKED';

export interface DownloadOption {
  id: string;
  /** e.g. "1080p", "720p", "Original". */
  label: string;
  /** e.g. "MP4 · 42 MB". */
  detail: string;
  height: number | null;
  estimatedBytes: number | null;
  needsMux: boolean;
  request: EnqueueRequest;
}

export type ItemAvailability =
  | { status: 'unresolved' }
  | { status: 'resolving' }
  | { status: 'ready'; options: DownloadOption[] }
  | { status: 'unsupported'; reason: UnsupportedReason };

export interface MediaItem {
  key: string;
  site: SiteId;
  title: string;
  thumbnailUrl: string | null;
  durationSec: number | null;
  contentUrl: string | null;
  sources: CandidateSource[];
  /** Frame that reported the item: Referer and User-Agent for its requests. */
  frameUrl: string;
  userAgent: string;
  firstSeenAt: number;
  lastSeenAt: number;
  availability: ItemAvailability;
}

export interface TabMedia {
  /** Top-level document URL of the last full load. SPA navigations do not reset the tab. */
  documentUrl: string;
  /** Current URL including SPA navigations; the item matching it ranks first. */
  currentUrl: string;
  items: Record<string, MediaItem>;
  /** Insertion order, newest last, capped at 60. */
  order: string[];
  drmDetected: boolean;
  policyBlocked: 'youtube' | null;
}
