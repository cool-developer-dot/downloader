/**
 * Contract between JavaScript and the native `VidoraMedia` Expo module (modules/vidorax-media/android).
 *
 * Native owns download, processing, library and file state. JavaScript never touches media bytes.
 * Any change here must be mirrored in the Kotlin records/events in the same commit.
 *
 * Errors: rejected promises carry `code` (Expo CodedException):
 *   ERR_NOT_FOUND          unknown download / library id
 *   ERR_INVALID_STATE      action not allowed in the current state (e.g. resume a completed download)
 *   ERR_INVALID_REQUEST    malformed enqueue/probe input
 *   ERR_POLICY_BLOCKED     YouTube / googlevideo sources
 *   ERR_STORAGE_PERMISSION API 24-28 gallery export without WRITE_EXTERNAL_STORAGE
 *   ERR_RUNNER_START       background runner could not start (app not visible on API 34+)
 *   ERR_STORAGE            a file could not be copied or written (e.g. disk full while saving to the gallery)
 *   ERR_NO_APP             `openWith`: no installed app can open the file
 */

export type SourceKind = 'progressive' | 'hls' | 'dash';

export type SiteId =
  | 'instagram'
  | 'facebook'
  | 'tiktok'
  | 'twitter'
  | 'reddit'
  | 'vimeo'
  | 'dailymotion'
  | 'twitch'
  | 'pinterest'
  | 'snapchat'
  | 'linkedin'
  | 'web';

export interface RequestContext {
  /** Exact User-Agent of the WebView frame that observed the media (signed CDN URLs may be bound to it). */
  userAgent?: string;
  /** Referer to send: the observed request referer, else the page or embedding frame URL. */
  referer?: string;
  origin?: string;
  /** Extra headers. Never `Cookie`: cookies come from CookieManager when `useCookies` is true. */
  headers?: Record<string, string>;
  /** Attach `CookieManager.getCookie(requestUrl)` to every request (snapshot at enqueue, refreshed on retry). */
  useCookies: boolean;
}

export interface ProbeRequest {
  url: string;
  /** Omit to let native sniff Content-Type, extension and first bytes. */
  kind?: SourceKind;
  /** DASH manifest XML delivered inline by a page; `url` is then its base URL. */
  manifestText?: string;
  request: RequestContext;
}

export type ProbeFailure =
  | 'DRM_PROTECTED'
  | 'LIVE_UNSUPPORTED'
  | 'UNSUPPORTED_FORMAT'
  | 'NOT_MEDIA'
  | 'HTTP_403'
  | 'HTTP_404'
  | 'HTTP_ERROR'
  | 'NETWORK'
  | 'POLICY_BLOCKED';

export type Container = 'mp4' | 'webm' | 'mov' | 'mkv' | 'ts' | 'flv' | '3gp' | 'unknown';

export interface ProbeVariant {
  /** Opaque id to pass back as `EnqueueRequest.variant.videoId` (HLS variant URI or DASH representation id). */
  id: string;
  width: number | null;
  height: number | null;
  /** Bits per second (HLS BANDWIDTH / DASH bandwidth). */
  bitrate: number | null;
  frameRate: number | null;
  /** RFC 6381 codecs string or MIME type. */
  videoCodec: string | null;
  /** True when a separate audio track will be muxed in (DASH, HLS EXT-X-MEDIA with URI). */
  needsAudioMux: boolean;
  /** Estimated total bytes including the default audio track, null when unknown. */
  estimatedBytes: number | null;
  /** Whether this device reports a decoder for `videoCodec`. */
  decodable: boolean;
}

export interface ProbeAudioTrack {
  id: string;
  language: string | null;
  label: string | null;
  bitrate: number | null;
  codec: string | null;
  isDefault: boolean;
}

export type ProbeResult =
  | {
      ok: true;
      kind: SourceKind;
      /** Final URL after redirects. */
      finalUrl: string;
      /** Progressive only. */
      contentType: string | null;
      container: Container;
      sizeBytes: number | null;
      resumable: boolean;
      /** HLS/DASH only, best first. Empty for progressive. */
      variants: ProbeVariant[];
      audioTracks: ProbeAudioTrack[];
      durationMs: number | null;
    }
  | { ok: false; reason: ProbeFailure; httpStatus: number | null; message: string | null };

export interface EnqueueRequest {
  /** Progressive file, HLS playlist, or DASH manifest URL (base URL when `manifestText` is set). */
  url: string;
  kind: SourceKind;
  manifestText?: string;
  /** Separate progressive audio file to mux with a video-only progressive `url` (split A/V). */
  audioUrl?: string;
  /** HLS/DASH choice from `probe`. Omitted: best decodable video within `maxHeight` + default audio. */
  variant?: { videoId?: string; audioId?: string; maxHeight?: number };
  request: RequestContext;
  title: string;
  site: SiteId;
  /** Canonical content page ("Open source page", details screen). */
  pageUrl?: string;
  thumbnailUrl?: string;
  durationMs?: number;
  estimatedBytes?: number;
  /** Display label for the chosen quality, e.g. "1080p". */
  qualityLabel?: string;
  /** Overrides `DownloadSettings.autoSaveToGallery` for this download. */
  saveToGallery?: boolean;
}

export type DownloadState =
  | 'queued'
  | 'probing'
  | 'downloading'
  | 'paused'
  | 'waiting_network'
  | 'waiting_retry'
  /** Muxing, remuxing, metadata, thumbnail, optional gallery export. */
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type DownloadErrorCode =
  | 'NETWORK'
  | 'HTTP_403'
  | 'HTTP_404'
  | 'HTTP_ERROR'
  /** Signed URL expired: reopen the page and download again. */
  | 'SOURCE_EXPIRED'
  | 'DRM_PROTECTED'
  | 'LIVE_UNSUPPORTED'
  | 'UNSUPPORTED_FORMAT'
  /** Server returned an HTML/JSON/error page instead of media. */
  | 'NOT_MEDIA'
  | 'PROCESSING_FAILED'
  | 'NO_SPACE'
  | 'STORAGE_ERROR'
  | 'UNKNOWN';

export interface DownloadRecord {
  id: string;
  state: DownloadState;
  title: string;
  site: SiteId;
  kind: SourceKind;
  pageUrl: string | null;
  thumbnailUrl: string | null;
  qualityLabel: string | null;
  bytesDone: number;
  totalBytes: number | null;
  errorCode: DownloadErrorCode | null;
  errorMessage: string | null;
  attempts: number;
  /** Library item id once completed (equal to `id`). */
  libraryItemId: string | null;
  /** Epoch milliseconds. */
  createdAt: number;
  updatedAt: number;
}

export interface DownloadProgressEvent {
  id: string;
  phase: 'download' | 'processing';
  bytesDone: number;
  totalBytes: number | null;
  /** 0..1 when known. */
  fraction: number | null;
  speedBps: number;
  etaSeconds: number | null;
}

export interface DownloadStateEvent {
  record: DownloadRecord;
}

export type LibraryChangeReason = 'added' | 'updated' | 'deleted' | 'imported';

export interface LibraryChangeEvent {
  reason: LibraryChangeReason;
  ids: string[];
}

export interface LibraryItem {
  id: string;
  title: string;
  site: SiteId;
  pageUrl: string | null;
  /** `file://` URI of the playable file in private app storage. */
  fileUri: string;
  fileName: string;
  mimeType: string;
  container: Container;
  videoCodec: string | null;
  audioCodec: string | null;
  hasAudio: boolean;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  sizeBytes: number;
  /** `file://` URI of the WebP thumbnail; null while generating or when unavailable. */
  thumbnailUri: string | null;
  favorite: boolean;
  /** `content://` URI of the gallery copy, when one was saved. */
  galleryUri: string | null;
  createdAt: number;
  completedAt: number;
}

export type LibrarySort = 'newest' | 'oldest' | 'title' | 'largest' | 'longest';

export interface LibraryQuery {
  search?: string;
  site?: SiteId;
  favoritesOnly?: boolean;
  /** Default 'newest'. */
  sort?: LibrarySort;
  /** Default 50, max 200. */
  limit?: number;
  offset?: number;
}

export interface LibraryPage {
  items: LibraryItem[];
  total: number;
}

export interface DownloadSettings {
  /** 1..4, default 2. */
  maxConcurrent: number;
  /** Default false. */
  wifiOnly: boolean;
  /** Default false. */
  autoSaveToGallery: boolean;
  /** e.g. 1080; null = best available. */
  preferredMaxHeight: number | null;
}

export interface StorageStats {
  libraryBytes: number;
  thumbnailBytes: number;
  tempBytes: number;
  freeBytes: number;
  totalBytes: number;
}

export type VidoraMediaEvents = {
  onDownloadProgress: (event: DownloadProgressEvent) => void;
  onDownloadStateChange: (event: DownloadStateEvent) => void;
  onLibraryChange: (event: LibraryChangeEvent) => void;
  onVolumeChange: (event: { volume: number }) => void;
};

export interface VidoraMediaModuleApi {
  // Probing
  probe(request: ProbeRequest): Promise<ProbeResult>;

  // Downloads
  enqueue(request: EnqueueRequest): Promise<DownloadRecord>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  retry(id: string): Promise<void>;
  cancel(id: string): Promise<void>;
  /** Removes a failed/cancelled/completed download record and its temp files (never the library item). */
  removeDownload(id: string): Promise<void>;
  pauseAll(): Promise<void>;
  resumeAll(): Promise<void>;
  /** Every non-completed record plus records completed in the last 24 h, newest first. */
  listDownloads(): Promise<DownloadRecord[]>;
  setDownloadSettings(settings: DownloadSettings): Promise<void>;

  // Library
  listLibrary(query: LibraryQuery): Promise<LibraryPage>;
  getLibraryItem(id: string): Promise<LibraryItem | null>;
  /** Items for the given ids that exist, in the same order (missing ids are skipped). */
  getLibraryItems(ids: string[]): Promise<LibraryItem[]>;
  /**
   * One-time migration from the v1 app: JS reads titles/sites/pages/favorites from the old catalog and applies
   * them to items created by the native legacy file import (matched by id). Unknown ids are ignored.
   */
  applyLegacyMetadata(
    entries: {
      id: string;
      title?: string;
      site?: SiteId;
      pageUrl?: string | null;
      favorite?: boolean;
    }[],
  ): Promise<void>;
  /** Neighbours of `id` in `query` order, for player next/previous. */
  getAdjacentLibraryItems(
    id: string,
    query: LibraryQuery,
  ): Promise<{ previous: string | null; next: string | null }>;
  getLibrarySiteCounts(): Promise<{ site: SiteId; count: number }[]>;
  renameLibraryItem(id: string, title: string): Promise<LibraryItem>;
  setFavorite(id: string, favorite: boolean): Promise<void>;
  deleteLibraryItems(ids: string[]): Promise<void>;
  saveToGallery(ids: string[]): Promise<void>;
  /** System chooser to play the file in another app. */
  openWith(id: string): Promise<void>;
  share(ids: string[]): Promise<void>;
  getStorageStats(): Promise<StorageStats>;
  /** Deletes orphaned temp work folders; resolves with bytes freed. */
  clearTempFiles(): Promise<number>;

  // Player helpers (synchronous)
  /** Media stream volume 0..1. */
  getVolume(): number;
  setVolume(volume: number): void;
}
