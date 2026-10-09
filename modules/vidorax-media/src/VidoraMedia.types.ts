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
 *   ERR_ALREADY_DOWNLOADED `enqueue`: the same video is already saved (prefer `enqueueUnique`, which says so without
 *                          an error)
 */

/**
 * `progressive`: one complete file (kept byte for byte when it already plays; a fragmented MP4, AVI or FLV is remuxed
 * into an MP4, and a track an MP4 cannot hold is converted). `hls`: an unencrypted VOD HLS stream (multivariant or
 * media playlist) — the chosen variant's segments and, when its sound is a separate `EXT-X-MEDIA TYPE=AUDIO`
 * rendition, that rendition's segments (MPEG-TS, fMP4 or packed audio), merged into one MP4. `dash`: an unprotected
 * VOD MPD with one period — the chosen video representation (one file, or init + segments) and, when the sound is a
 * separate adaptation set, its best audio representation, merged into one MP4 (WebM for VP8/VP9 + Opus/Vorbis).
 * `split`: a video file and an audio file of one video (a MediaSource player fed from two tracks), both downloaded
 * and merged. Encrypted/DRM → `DRM_PROTECTED`; live → `LIVE_UNSUPPORTED`; multi-period DASH and audio-only streams →
 * `UNSUPPORTED_FORMAT`. Two tracks whose lengths disagree are never merged (`TRACK_MISMATCH`).
 */
export type SourceKind = 'progressive' | 'hls' | 'dash' | 'split';

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

/**
 * Classifies a source without downloading it: `ok: true` is DOWNLOADABLE; `DRM_PROTECTED` is PROTECTED;
 * `UNSUPPORTED_FORMAT`/`LIVE_UNSUPPORTED`/`NOT_MEDIA`/`POLICY_BLOCKED` are UNSUPPORTED; `NETWORK`/`HTTP_ERROR`
 * (5xx, 408, 429) are transient and `HTTP_403`/`HTTP_404` mean the link must be refreshed from its page. Redirects
 * are followed (never into a private network); cookies, Referer, Origin and User-Agent are sent on every hop.
 */
export interface ProbeRequest {
  url: string;
  /** Omit to let native sniff Content-Type, extension and first bytes (a playlist or an MPD is classified as such). */
  kind?: SourceKind;
  /** Inline DASH manifest XML: always refused (`UNSUPPORTED_FORMAT`) — a download is re-resolved from a URL. */
  manifestText?: string;
  request: RequestContext;
  /**
   * HLS/DASH: the same choice as `EnqueueRequest.variant`, so the verdict is about the variant that enqueue would
   * download (omitted = the best decodable variant capped by `DownloadSettings.preferredMaxHeight`).
   */
  variant?: { videoId?: string; audioId?: string; maxHeight?: number };
  /**
   * `split` only (required): the audio file that goes with the video file `url`. Both are classified for their role
   * (a picture / sound, not encrypted) and, when their headers state lengths, checked to be one video's.
   */
  audioUrl?: string;
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
  | 'POLICY_BLOCKED'
  /** `split`: the video file has no video track. */
  | 'VIDEO_TRACK_MISSING'
  /** `split` / HLS rendition / DASH adaptation set: the audio has no sound. */
  | 'AUDIO_TRACK_MISSING'
  /** `split`: the two files are not tracks of the same video (their lengths disagree). */
  | 'TRACK_MISMATCH';

export type Container = 'mp4' | 'webm' | 'mov' | 'avi' | 'wmv' | 'mkv' | 'ts' | 'flv' | '3gp' | 'unknown';

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
  /**
   * True when the variant's sound is a separate track (HLS `EXT-X-MEDIA TYPE=AUDIO` with its own URI, a split
   * source): the engine downloads it too and merges it in. (DASH reports the merge through `mergesAudio`.)
   */
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
      /** The download merges a separate audio track into the video (split files, HLS/DASH separate audio). */
      mergesAudio?: boolean;
    }
  | { ok: false; reason: ProbeFailure; httpStatus: number | null; message: string | null };

/**
 * A pasted or shared link fetched the way its browser tab would navigate to it, so the page can be read for its
 * video before (and without) the WebView playing anything. Nothing on the page is executed. Redirects are followed
 * (at most 10 hops, each a public http(s) host — never into the user's network; a URL seen twice is a loop); YouTube
 * is refused by policy; one deadline covers every hop and the body, which is read up to `maxBytes`.
 */
export interface PageFetchRequest {
  url: string;
  /** Omit for the stock WebView User-Agent (a tab in mobile mode); a desktop tab passes its desktop UA. */
  userAgent?: string;
  /** Send the browsing session's cookies for each hop (default true). */
  useSessionCookies?: boolean;
  /**
   * Store the cookies the servers set into the WebView jar after a complete fetch inside the deadline — what the tab's
   * own navigation would store — so links the page signs for that session keep answering the tab and the engine.
   * Only for the fetch that precedes the tab's own navigation of the same URL.
   */
  commitCookies?: boolean;
  /** 1 000–20 000 ms (default 8 000). */
  timeoutMs?: number;
  /** 16 KiB–4 MiB (default 3 MiB). */
  maxBytes?: number;
}

export type PageFetchFailure =
  | 'INVALID_URL'
  /** A hop pointed at a private, loopback or link-local address. */
  | 'UNSAFE_URL'
  /** YouTube. */
  | 'POLICY_BLOCKED'
  | 'REDIRECT_LOOP'
  | 'TOO_MANY_REDIRECTS'
  | 'TIMEOUT'
  | 'NETWORK'
  /** An HTTP status of 400 or more (`status`), or a redirect without a usable Location. */
  | 'HTTP_ERROR'
  /** Neither a page nor media (an image, an archive…). */
  | 'UNSUPPORTED_CONTENT';

export type PageFetchResult =
  | {
      kind: 'document';
      finalUrl: string;
      status: number;
      contentType: string | null;
      body: string;
      /** The byte bound cut the body. */
      truncated: boolean;
      redirects: number;
      elapsedMs: number;
    }
  | {
      /** The link itself is a media file or a manifest (recognised from its type and first bytes, not read further). */
      kind: 'media';
      finalUrl: string;
      status: number;
      contentType: string | null;
      contentLength: number | null;
      redirects: number;
      elapsedMs: number;
    }
  | { kind: 'failure'; code: PageFetchFailure; status: number | null; redirects: number; elapsedMs: number };

export interface EnqueueRequest {
  /**
   * A progressive file URL; for `hls` a multivariant or media playlist URL; for `dash` an MPD URL, downloaded only
   * when its chosen representation is one complete file (muxed audio+video, or video in a manifest without audio).
   */
  url: string;
  kind: SourceKind;
  /** @deprecated DASH manifest text — not supported; the v2 engine ignores this field. */
  manifestText?: string;
  /** `split` only (required): the audio file merged with the video file `url`. Rejected for any other kind. */
  audioUrl?: string;
  /**
   * HLS (multivariant playlist) and DASH: `videoId` (a `ProbeVariant.id` — HLS variant URI, DASH representation id)
   * picks that exact variant, `maxHeight` the best one up to that height; neither = the best decodable variant
   * (capped by `DownloadSettings.preferredMaxHeight`). `audioId` (a `ProbeAudioTrack.id`) picks the separate audio
   * rendition/representation; omitted = the default one. A chosen variant is downloaded exactly, never substituted.
   */
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
  /**
   * The source as the page offered it, before a refresh or redirect. The engine derives the video's identity from it
   * (host, path, query without rotating signature fields, the chosen variant, and the page when a signature was
   * removed), so a re-signed or redirected link is still recognised as the same video. Defaults to `url`.
   */
  identityUrl?: string;
}

/**
 * What `enqueueUnique` did. A video is downloaded once: the same video already downloading returns that download
 * (a paused one is resumed); the same video already saved — in the library, or as the gallery copy VidoraX made —
 * returns its library item id (null when only the gallery copy is left). Racing calls start exactly one download.
 */
export type EnqueueResult =
  | { outcome: 'ENQUEUED'; record: DownloadRecord; libraryItemId: null }
  | { outcome: 'ALREADY_DOWNLOADING'; record: DownloadRecord; libraryItemId: null }
  | { outcome: 'ALREADY_DOWNLOADED'; record: null; libraryItemId: string | null };

export type DownloadState =
  | 'queued'
  | 'probing'
  | 'downloading'
  | 'paused'
  | 'waiting_network'
  | 'waiting_retry'
  /** Merging / remuxing / converting the downloaded tracks, verifying the result and adding it to the library. */
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
  /**
   * The finished file is byte-for-byte a video the user already has (reached through another link): it was discarded
   * and nothing was added. Final — retrying gives the same answer.
   */
  | 'DUPLICATE'
  | 'UNKNOWN'
  /** The "video" file of a split download has no picture. Final. */
  | 'VIDEO_TRACK_MISSING'
  /** The audio file / rendition / representation has no sound. Final. */
  | 'AUDIO_TRACK_MISSING'
  /** The video and the audio are not one video's (lengths or start disagree): never merged. Final. */
  | 'TRACK_MISMATCH'
  /** A segment of an HLS/DASH stream is missing on the server or refused (after the link was refreshed). */
  | 'SEGMENT_FAILED'
  /** Merging or re-containering the downloaded tracks failed; the tracks are kept, so Retry only processes again. */
  | 'MUX_FAILED'
  /** Converting a track the output cannot carry failed (no decoder/encoder); the tracks are kept for Retry. */
  | 'TRANSCODE_FAILED'
  /** The processed file did not read back as the video it should be (no picture, lost sound, wrong length). */
  | 'INVALID_MEDIA';

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

/** What the `processing` phase is doing (progress events only). */
export type ProcessingStage = 'merging' | 'remuxing' | 'transcoding' | 'verifying';

export interface DownloadProgressEvent {
  id: string;
  phase: 'download' | 'processing';
  /** `processing` only: merging tracks, remuxing into MP4, converting a track, or verifying the result. */
  stage?: ProcessingStage | null;
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

export interface DeviceVideo {
  /** MediaStore id, unique on this device. */
  id: string;
  /** `content://` URI to play; VidoraX never copies or modifies the file. */
  uri: string;
  title: string;
  durationMs: number | null;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  addedAt: number;
  mimeType: string | null;
}

export interface DeviceVideoPage {
  permissionGranted: boolean;
  /** `full` — all videos; `selected` — only the ones the user picked (Android 14+); `none` — no access. */
  access: 'none' | 'selected' | 'full';
  items: DeviceVideo[];
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
  /**
   * Default true: every completed download is also copied to the device gallery (`Movies/VidoraX/<Site>`), after it
   * is COMPLETED and only as the final verified file. A failed copy never affects the download or its library item.
   */
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
  /**
   * The activity stopped being visible (onStop): a PiP window was dismissed, leaving the app opened no PiP window, or
   * the screen went off. Sent on the main thread while JavaScript timers are paused — the player's cue to stop.
   */
  onActivityStop: (event: { inPictureInPicture: boolean }) => void;
};

/** A genuine completion the engine recorded for JavaScript to count once (see `listCompletedDownloads`). */
export type CompletedDownload = {
  id: string;
  /** Epoch ms of the `completed` commit. */
  completedAt: number;
};

export interface VidoraMediaModuleApi {
  // Probing
  probe(request: ProbeRequest): Promise<ProbeResult>;
  /** Reads a pasted/shared link's page for the direct analyzer; see `PageFetchRequest`. */
  fetchPage(request: PageFetchRequest): Promise<PageFetchResult>;

  // Downloads
  /** Rejects with ERR_ALREADY_DOWNLOADED for a video already saved; see `enqueueUnique`. */
  enqueue(request: EnqueueRequest): Promise<DownloadRecord>;
  /** Starts the download unless the same video is already downloading or saved (atomic; see `EnqueueResult`). */
  enqueueUnique(request: EnqueueRequest): Promise<EnqueueResult>;
  /** What `enqueueUnique` would find, without starting anything or touching the network; null for a new video. */
  findDuplicate(request: EnqueueRequest): Promise<EnqueueResult | null>;
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

  /**
   * Videos already on the device (MediaStore), newest first. Read-only. `permissionGranted` is false until the
   * user allows access to their media, and `items` is then empty rather than an error.
   */
  listDeviceVideos(limit: number, offset: number): Promise<DeviceVideoPage>;
  deleteLibraryItems(ids: string[]): Promise<void>;
  /**
   * Repairs the library after files changed outside VidoraX: items whose file is gone or empty are removed (row and
   * thumbnail) and announced with `onLibraryChange` `deleted`. `ids` limits the check; omitted/null checks every
   * item. Resolves with the removed ids. Also runs once whenever the module starts.
   */
  reconcileLibrary(ids?: string[] | null): Promise<string[]>;
  saveToGallery(ids: string[]): Promise<void>;
  /** System chooser to play the file in another app. */
  openWith(id: string): Promise<void>;
  share(ids: string[]): Promise<void>;
  getStorageStats(): Promise<StorageStats>;
  /** Deletes orphaned temp work folders; resolves with bytes freed. */
  clearTempFiles(): Promise<number>;

  // Completions
  /**
   * Downloads that reached `completed` with their verified library item and were not acknowledged yet, oldest
   * first — including ones that completed while no JavaScript ran (app closed, boot job). Recorded natively in the
   * same transaction as the `completed` state. Missing on older native builds.
   */
  listCompletedDownloads(): Promise<CompletedDownload[]>;
  /** Forgets completions JavaScript has counted, so each is reported once. */
  acknowledgeCompletedDownloads(ids: string[]): Promise<void>;

  // Player helpers (synchronous)
  /** Media stream volume 0..1. */
  getVolume(): number;
  setVolume(volume: number): void;
  /**
   * Arms (or disarms) the picture-in-picture window for when the user leaves the app while the player plays, with the
   * video's display size for the window's shape (0 when unknown). Acts on Android 8–11 only; from Android 12 the
   * player view's own auto-enter does it. Optional: builds before this function simply have no PiP there.
   */
  setPictureInPictureAutoEnter?(armed: boolean, aspectWidth: number, aspectHeight: number): void;
}
