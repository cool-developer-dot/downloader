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
export type SourceKind =
  | 'progressive'
  | 'hls'
  | 'dash'
  | 'split'
  /**
   * F6 (behind Settings → "Live recording (beta)"): a live, unencrypted HLS media playlist recorded from now until
   * Stop, the end of the stream (`EXT-X-ENDLIST`), the maximum length (`liveRecordingMaxMinutes`) or low storage;
   * then finalized like any download. Refused (`LIVE_UNSUPPORTED`) while the setting is off. With the setting on, a
   * `probe` of a live HLS stream (`kind: 'hls'` or `'live'`) answers `ok` with `kind: 'live'` — classified as the
   * recording would meet it, so an encrypted live stream is still `DRM_PROTECTED`.
   */
  | 'live';

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
  | 'web'
  /** A file opened in VidoraX from another app and saved to the library (`importIncomingMedia`). */
  | 'device';

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

export type Container = 'mp4' | 'webm' | 'mov' | 'avi' | 'wmv' | 'mkv' | 'ts' | 'flv' | '3gp' | '3g2' | 'mpg' | 'unknown';

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
  | {
      ok: false;
      reason: ProbeFailure;
      httpStatus: number | null;
      message: string | null;
      /** #299: the server answered 401 and asks for HTTP Basic sign-in. Absent from older native builds. */
      authChallenge?: AuthChallenge | null;
    };

/**
 * #299 Authentication Support: a `WWW-Authenticate: Basic` challenge. `origin` (scheme://host:port) is where the user
 * name and password would be sent — only an `https://` origin is ever sent them; `realm` is the server's own label.
 */
export interface AuthChallenge {
  scheme: 'basic';
  origin: string;
  realm: string | null;
}

/** #299: the user name and password the server asked for. Sent with one download only; never stored or read back. */
export interface DownloadCredentials {
  username: string;
  password: string;
}

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
  /**
   * #299: sign-in for this download only. Sent over https to the download URL's own origin (scheme, host and port)
   * and never on a redirect to another origin; held in native memory only (never saved, never sent back, cleared when
   * the download completes, is cancelled or fails). ERR_INVALID_REQUEST for a non-https URL or an invalid user name.
   * Ignored by older native builds.
   */
  credentials?: DownloadCredentials;
  /** Display label for the chosen quality, e.g. "1080p". */
  qualityLabel?: string;
  /** Overrides `DownloadSettings.autoSaveToGallery` for this download. */
  saveToGallery?: boolean;
  /**
   * Custom Extension (#494): the finished file's extension, used only when it is a safe alias for the container its
   * bytes prove — `mp4` or `m4v` for an MP4 video, `m4a` or `mp4` for an audio-only MP4. Anything else, or omitted,
   * keeps the usual extension. Kept by the engine until the file is named (survives a restart). Ignored by older
   * native builds.
   */
  preferredExtension?: 'mp4' | 'm4v' | 'm4a';
  /**
   * #480: this download's own Wi-Fi only — true waits for (and keeps to) Wi-Fi, false may use mobile data. Omitted
   * follows `DownloadSettings.wifiOnly`. Kept by the engine while the download can still run (survives a restart).
   * Ignored by older native builds.
   */
  wifiOnly?: boolean;
  /**
   * The source as the page offered it, before a refresh or redirect. The engine derives the video's identity from it
   * (host, path, query without rotating signature fields, the chosen variant, and the page when a signature was
   * removed), so a re-signed or redirected link is still recognised as the same video. Defaults to `url`.
   */
  identityUrl?: string;
  /**
   * H12 (Duplicate Action #386): download it although it is already saved ("Keep both", or the new copy of
   * "Replace"): no duplicate check for this request, and its finished file is kept even when the same bytes are
   * saved. Omitted = today's checks. Ignored by older native builds (they answer ALREADY_DOWNLOADED as before).
   */
  allowDuplicate?: boolean;
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
  /**
   * F3: held by a rule until it clears — its start time, the daily download hours, roaming, charging or low battery
   * (`DownloadRecord.waitReason`). Resumes by itself from the bytes on disk; not counted as running work.
   */
  | 'waiting_conditions'
  /** F6: a live stream being recorded (`kind: 'live'`) until `stopRecording`; not pausable. */
  | 'recording'
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
  | 'INVALID_MEDIA'
  /** #299: a download started with sign-in was refused (401): wrong or forgotten user name/password. Retry asks again. */
  | 'AUTH_REQUIRED';

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
  /** `waiting_conditions` only: which rule holds it. Missing on older native builds. */
  waitReason?: DownloadWaitReason | null;
  /** `waiting_conditions` only: when a time rule ends (the start time, the download hours opening), epoch ms. */
  waitUntil?: number | null;
  /** F3 "Start at…": the earliest moment this download may run, epoch ms; null = now. */
  startAt?: number | null;
  /** F6: how much of a live stream is recorded so far (`recording`, and the finished recording), ms. */
  recordedMs?: number | null;
}

/**
 * F3: why a download waits. `scheduled` — its own start time; `outside_hours` — the daily download hours;
 * `roaming` — "Not on roaming"; `charging` — "Only while charging"; `battery_low` — "Pause when battery is low"
 * (≤ 15 % and not charging).
 */
export type DownloadWaitReason = 'scheduled' | 'outside_hours' | 'roaming' | 'charging' | 'battery_low';

/**
 * F3: the daily download hours. Minutes after local midnight; `startMinute > endMinute` crosses midnight (22:00 →
 * 06:00), equal values mean the whole day. `days` are ISO weekdays (1 = Monday … 7 = Sunday) on which the window
 * *starts* — the hours after midnight of a crossing window belong to the day before.
 */
export interface DownloadWindow {
  startMinute: number;
  endMinute: number;
  days: number[];
}

/** What the `processing` phase is doing (progress events only). */
export type ProcessingStage = 'merging' | 'remuxing' | 'transcoding' | 'verifying';

export interface DownloadProgressEvent {
  id: string;
  phase: 'download' | 'processing';
  /** `processing` only: merging tracks, remuxing into MP4, converting a track, or verifying the result. */
  stage?: ProcessingStage | null;
  /**
   * Segment Progress (#315), HLS and DASH segment downloads only: segments durably on disk and segments in all (video
   * and a separate audio track together). Absent for a file download and from older native builds.
   */
  segmentsDone?: number | null;
  segmentsTotal?: number | null;
  bytesDone: number;
  totalBytes: number | null;
  /** 0..1 when known. */
  fraction: number | null;
  speedBps: number;
  etaSeconds: number | null;
  /** F6: a live recording's recorded length so far, ms (null for any other download). */
  recordedMs?: number | null;
}

export interface DownloadStateEvent {
  record: DownloadRecord;
}

/** H20 Checksum Verify (#409): a library item's SHA-256 (lowercase hex) when one is stored, and whether one is running. */
export interface ChecksumState {
  sha256: string | null;
  computing: boolean;
}

/**
 * H20 Repair Partial File (#412), what `repairDownload` did: resumed from where it stopped (the partial checked out);
 * restarted from zero because the server's file changed, the partial was damaged, or the server cannot continue it;
 * a damaged last segment is fetched again; the server could not be asked now (nothing changed); nothing to repair.
 */
export type RepairOutcome =
  | 'resumed'
  | 'restarted_changed'
  | 'restarted_corrupt'
  | 'restarted_no_resume'
  | 'segment_refetched'
  | 'unreachable'
  | 'nothing';

/** H20 Play While Downloading (#411): why an unfinished download cannot be played now. */
export type PlayableRefusal =
  | 'not_found'
  | 'stream'
  | 'processing'
  | 'not_downloading'
  | 'unknown_size'
  | 'not_mp4'
  | 'index_at_end'
  | 'fragmented'
  | 'encrypted'
  | 'not_enough_bytes'
  | 'unsupported_device';

/**
 * H20 Play While Downloading (#411): a `content://` URI (VidoraX only) the player reads the download's growing file
 * through — the bytes downloaded so far from the start, waiting at their end for more. Only a progressive MP4 whose
 * index comes first, with enough of it on disk. `releasePlayableSource(uri)` when the player closes.
 */
export type PlayableSource =
  | { playable: true; uri: string; playableBytes: number; totalBytes: number; mimeType: 'video/mp4' }
  | { playable: false; reason: PlayableRefusal };

/** `checkPlayable`: the same answer without opening a playback session (no URI). */
export type PlayableCheck =
  | { playable: true; playableBytes: number; totalBytes: number; mimeType: 'video/mp4' }
  | { playable: false; reason: PlayableRefusal };

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

/**
 * A video or audio file another app asked VidoraX to open (`VIEW` of a `content:`/`file:` URI with a `video/*` or
 * `audio/*` type). The URI never leaves native code except through `getIncomingMediaSource`, for the player: `token`
 * stands for it everywhere else (router paths, logs). It is the first 32 hex digits of SHA-256 of the URI, so the same
 * file opened again has the same token (its resume position is kept under it). Tokens live while the app process does.
 */
export interface IncomingMedia {
  token: string;
  /** The name the sending app gives the file (`OpenableColumns.DISPLAY_NAME`), when it gives one. */
  displayName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  kind: 'video' | 'audio';
}

/** What the player needs to play an incoming file. */
export interface IncomingMediaSource extends IncomingMedia {
  /** `content://` or `file://` URI; read access was granted with the intent. */
  uri: string;
}

/**
 * `importIncomingMedia`: the file was copied into the library (site `device`), or the library / a VidoraX gallery copy
 * already holds exactly these bytes and nothing was copied.
 */
export type ImportIncomingResult =
  | { status: 'imported'; item: LibraryItem }
  | { status: 'duplicate'; libraryItemId: string | null; galleryUri: string | null };

/**
 * Edit after download (#374, #376): what `startEdit` does to a library item. Every edit writes a new library item;
 * the original is never modified. Per track: `copy` keeps it as it is (no re-encoding), `h264`/`aac` re-encode,
 * `drop` leaves it out.
 */
export interface EditRequest {
  sourceId: string;
  kind: 'trim' | 'mp4' | 'audio';
  /** Trim only (ms). */
  startMs?: number | null;
  endMs?: number | null;
  /** Trim only: the start was moved to a keyframe (from `getTrimStart`), so the video can be copied. */
  keyframeStart?: boolean;
  video: 'copy' | 'h264' | 'drop';
  audio: 'copy' | 'aac' | 'drop';
  /** The new item's title. */
  title: string;
}

export interface DownloadSettings {
  /** 1..4, default 2. */
  maxConcurrent: number;
  /** Default false. */
  wifiOnly: boolean;
  /**
   * Download Settings → Advanced network: replaces the User-Agent of every download request (visible ASCII, at most
   * 256 characters). This and the three fields below are each sent only when the user changed them; omitted is
   * today's behaviour (the browser's own User-Agent, no extra headers, 20 s to connect and 30 s without data). They
   * never weaken TLS, the public-address check or the redirect checks. The native side saves the User-Agent and
   * timeouts so a download resumed before JavaScript runs uses them; headers are held in memory only. Ignored by older
   * native builds.
   */
  userAgent?: string;
  /**
   * Added to every download request that does not already carry the header (the page's own headers win). Names such
   * as Cookie, Authorization, Host, Range or Proxy-* / Sec-* are refused; values are visible ASCII without line
   * breaks. At most 10.
   */
  customHeaders?: Record<string, string>;
  /** Seconds to connect / to wait for data before the attempt counts as failed (5..300). */
  connectTimeoutSeconds?: number;
  readTimeoutSeconds?: number;
  /**
   * #332 Retry limit: how many transient failures in a row (a dropped connection, a 5xx/408/429) a download waits out,
   * without progress in between, before it fails. Sent only when the user changed it; omitted is "Automatic", today's
   * 5. The native side clamps it to 1..10 and saves it with the download settings. Ignored by older native builds.
   */
  retryLimit?: number;
  /**
   * Default true: every completed download is also copied to the device gallery (`Movies/VidoraX/<Site>`), after it
   * is COMPLETED and only as the final verified file. A failed copy never affects the download or its library item.
   */
  autoSaveToGallery: boolean;
  /** e.g. 1080; null = best available. */
  preferredMaxHeight: number | null;
  /**
   * Finished/failed download notifications: play a sound (default true), vibrate (default false), or neither
   * (silent, default false — overrides the other two). Omitted = the native side keeps what it has saved.
   * Progress notifications are never affected. Ignored by older native builds.
   */
  notificationSound?: boolean;
  notificationVibrate?: boolean;
  notificationSilent?: boolean;
  /**
   * 1..4, default 3 (Download Settings → "Connections per file"). A progressive file of at least 16 MiB whose server
   * proves byte ranges (a `206` with the total size and a strong ETag/Last-Modified) is fetched over this many
   * connections, each range written at its offset in one file (dynamic segmentation keeps every connection busy);
   * HLS/DASH segments are fetched this many at a time, still assembled in order. Anything that refuses ranges or extra
   * connections continues on one. A download still takes one `maxConcurrent` slot. Optional for older callers
   * (missing = 3).
   */
  connectionsPerFile?: number;
  /**
   * Speed limit for all downloads together, bytes per second (Download Settings → "Speed limit": Off, 256 KB/s,
   * 512 KB/s, 1, 2 or 5 MB/s). Null, 0 or missing = no limit. Applied in the read loop of every transfer stream
   * (single file, parallel parts, segments), so it holds whatever the connections per file.
   */
  speedLimitBytesPerSecond?: number | null;
  /** F3: downloads run only inside these daily hours; null or missing = any time. */
  downloadWindow?: DownloadWindow | null;
  /** F3: hold downloads while the phone is roaming. Default false. */
  notOnRoaming?: boolean;
  /** F3: hold downloads while the battery is at 15 % or less and not charging. Default false. */
  pauseOnLowBattery?: boolean;
  /** F3: run downloads only while the phone is charging. Default false. */
  onlyWhileCharging?: boolean;
  /** The app's language for the engine's own notification texts of F3 waits ('en' | 'ur'). Default 'en'. */
  language?: string;
  /** F6: Settings → Download Settings → Advanced → "Live recording (beta)". Default false: live streams are refused. */
  liveRecording?: boolean;
  /** F6: a recording stops by itself after this many minutes (15..720). Default 120. */
  liveRecordingMaxMinutes?: number;
}

/**
 * A download's own speed limit and the Priority mark (Download details). Persisted by the engine (survives restarts);
 * only one download has priority — marking one clears the others. While the priority download receives bytes, all
 * other downloads together get at most a quarter of its bandwidth. Bandwidth only: the queue's start order is not
 * changed (docs/ARCHITECTURE.md §3.6).
 */
/** F15: leftover download files — how many files and bytes. */
export interface LeftoverFiles {
  count: number;
  bytes: number;
}

export interface LeftoverFilesOptions {
  /** v1 downloads still in use (queued, downloading, paused, failed): their temporary parts are kept. */
  keepLegacyIds?: string[];
}

export interface DownloadBandwidth {
  id: string;
  /** Bytes per second; null = no limit of its own (the global limit still applies). */
  speedLimitBytesPerSecond: number | null;
  priority: boolean;
}

export interface StorageStats {
  libraryBytes: number;
  thumbnailBytes: number;
  tempBytes: number;
  freeBytes: number;
  totalBytes: number;
}

/** One copy `copyToFolder` wrote: the new document, the folder it is in (for Show in Folder), its final name. */
export interface FolderCopy {
  documentUri: string;
  folderUri: string;
  name: string;
  bytes: number;
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
  /** A file arrived while the app runs (`onNewIntent`). The launch file is read with `consumeIncomingMedia`. */
  onIncomingMedia: (event: IncomingMedia) => void;
};

/** H4 (Multiple Queues #343): a user-named queue. `main` always exists, is listed somewhere, and is never held. */
export type DownloadQueue = {
  /** `main`, or letters, digits, `_` and `-` (at most 40). */
  id: string;
  /** 1..40 characters; Main's name is shown translated. */
  name: string;
  /** A held queue's downloads do not start until it is resumed. */
  held: boolean;
};

/** H4: queues (in the order they run), queue of each download outside Main, and the user's start order. */
export type DownloadQueueState = {
  queues: DownloadQueue[];
  /** Download id → queue id; a download not listed is in Main. */
  assignments: Record<string, string>;
  /** Download ids in the user's order, all queues together; unlisted downloads follow in first-come order. */
  order: string[];
};

/** A genuine completion the engine recorded for JavaScript to count once (see `listCompletedDownloads`). */
export type CompletedDownload = {
  id: string;
  /** Epoch ms of the `completed` commit. */
  completedAt: number;
};

/** An item of the private vault: its own random id, never the library or download id it had. */
export interface VaultItem {
  id: string;
  title: string;
  mimeType: string;
  durationMs: number | null;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  /** When it was downloaded (epoch ms). */
  createdAt: number;
  /** When it was moved to Private (epoch ms). */
  addedAt: number;
  hasThumbnail: boolean;
  /**
   * True when the item cannot be opened (the device key that sealed it was lost, or its file is gone): only its id,
   * size and date are known, and the only action is deleting it.
   */
  unreadable?: boolean;
}

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
  /**
   * #299: where a download started with sign-in must sign in again before Resume/Retry can work (its credentials are
   * gone after a process death or a failure); null when nothing is needed. Never returns the credentials.
   */
  downloadNeedsCredentials?(id: string): { origin: string; realm: string | null } | null;
  /**
   * #299: the user name and password again for such a download, pinned to the origin it was started with. False when
   * the download never used sign-in. ERR_INVALID_REQUEST for invalid values.
   */
  setDownloadCredentials?(id: string, credentials: DownloadCredentials): Promise<boolean>;
  cancel(id: string): Promise<void>;
  /** Removes a failed/cancelled/completed download record and its temp files (never the library item). */
  removeDownload(id: string): Promise<void>;
  pauseAll(): Promise<void>;
  resumeAll(): Promise<void>;
  /**
   * H4: the user's queues and start order. Downloads start by queue (listed order), then by this order inside the
   * queue, then first-come; a held queue's downloads wait until it is resumed. Nothing set is today's order. Missing
   * on older native builds.
   */
  getDownloadQueues?(): Promise<DownloadQueueState>;
  /** These downloads first, in this order (each within its own queue). */
  setDownloadOrder?(ids: string[]): Promise<DownloadQueueState>;
  /** To the end of another queue's order. Rejects with ERR_INVALID_REQUEST for an unknown queue. */
  moveDownloadsToQueue?(ids: string[], queueId: string): Promise<DownloadQueueState>;
  /** The whole queue list (order, names, held). Main stays and is never held; a removed queue's downloads go to Main. */
  setDownloadQueues?(queues: DownloadQueue[]): Promise<DownloadQueueState>;
  /** Every non-completed record plus records completed in the last 24 h, newest first. */
  listDownloads(): Promise<DownloadRecord[]>;
  setDownloadSettings(settings: DownloadSettings): Promise<void>;
  /**
   * Sets a download's own speed limit and its Priority mark — both are applied (a missing limit is no limit, a missing
   * priority is off); priority on clears it from every other download. Resolves with every download's entry. Rejects with ERR_NOT_FOUND for an unknown id. Missing on older native builds.
   */
  setDownloadBandwidth?(
    id: string,
    options: { speedLimitBytesPerSecond?: number | null; priority?: boolean },
  ): Promise<DownloadBandwidth[]>;
  /**
   * F3 "Start at…": the earliest moment (epoch ms) this unfinished download may run; null starts it as soon as the
   * other rules allow. A running download set to a later time stops and waits (its bytes stay). Persisted, survives
   * restarts and reboots; the actual start can be a few minutes late (Android decides when background work runs).
   * Rejects with ERR_NOT_FOUND for an unknown id, ERR_INVALID_STATE for a finished one. Missing on older native builds.
   */
  setDownloadStartAt?(id: string, startAt: number | null): Promise<DownloadRecord>;
  /**
   * F6: ends a live recording; what was recorded is finalized into the library like any download. Rejects with
   * ERR_NOT_FOUND for an unknown id, ERR_INVALID_STATE for anything that is not recording. Missing on older builds.
   */
  stopRecording?(id: string): Promise<DownloadRecord>;
  /** Every download that has its own limit or the priority mark. Missing on older native builds. */
  listDownloadBandwidth?(): Promise<DownloadBandwidth[]>;

  // Library
  listLibrary(query: LibraryQuery): Promise<LibraryPage>;
  getLibraryItem(id: string): Promise<LibraryItem | null>;
  /**
   * H19 Subtitles (see subtitles.types.ts). Missing on older native builds: no subtitles then. `probeSubtitles` lists
   * an HLS/DASH stream's tracks (no URLs); `setDownloadSubtitles` keeps a download's choice, fetched beside the video
   * once it completed; `readSubtitle` returns a saved file's WebVTT text; `shareSubtitleText` offers a .vtt or .srt.
   */
  probeSubtitles?(request: ProbeRequest): Promise<import('./subtitles.types').SubtitleTrackInfo[]>;
  setDownloadSubtitles?(id: string, trackIds: string[]): Promise<void>;
  getDownloadSubtitles?(id: string): Promise<import('./subtitles.types').DownloadSubtitles | null>;
  readSubtitle?(id: string, index: number): Promise<string>;
  shareSubtitleText?(fileName: string, text: string): Promise<void>;
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

  // H20 File integrity. Missing on older native builds.
  /** The stored SHA-256 of a library item (from the duplicate check or an earlier compute), never computed here. */
  getChecksum?(id: string): Promise<ChecksumState>;
  /**
   * Streams the item's file through SHA-256 and stores the result; a second call while one runs joins it. Resolves
   * with the hex digest, or null when `cancelChecksum` stopped it. ERR_NOT_FOUND when the item or its file is gone.
   */
  computeChecksum?(id: string): Promise<string | null>;
  getChecksumProgress?(id: string): { bytesDone: number; totalBytes: number } | null;
  cancelChecksum?(id: string): void;
  /** A failed download's partial bytes on disk, or null when there is nothing to repair. */
  getRepairInfo?(id: string): { partialBytes: number } | null;
  /** Checks a failed download's partial file(s) against the server and retries it (see `RepairOutcome`). */
  repairDownload?(id: string): Promise<RepairOutcome>;
  /** Whether an unfinished download can be played now (no session is opened). */
  checkPlayable?(id: string): Promise<PlayableCheck>;
  getPlayableSource?(id: string): Promise<PlayableSource>;
  releasePlayableSource?(uri: string): void;

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
  /** Edit after download: the video keyframe time (ms) at or before `positionMs`; null when it can't be read. */
  getTrimStart?(id: string, positionMs: number): Promise<number | null>;
  /**
   * Runs one edit and resolves with the new library item (also announced as `added`). ERR_INVALID_STATE while another
   * edit runs, ERR_EDIT_REFUSED for a file that can't be edited (protected, unreadable, rejected by the verifier),
   * ERR_NO_SPACE without room for the output, ERR_STORAGE when it fails. A partial output is always deleted.
   */
  startEdit?(request: EditRequest): Promise<LibraryItem>;
  /** 0..1 while an edit runs; null otherwise. */
  getEditProgress?(): number | null;
  /** Stops the running edit; its partial output is deleted. */
  cancelEdit?(): Promise<void>;
  saveToGallery(ids: string[]): Promise<void>;
  /**
   * Saves the item's thumbnail as a JPEG in `Pictures/VidoraX` and resolves with its URI. ERR_NOT_FOUND without a
   * thumbnail; ERR_STORAGE_PERMISSION on Android 9 and older without the storage permission. Missing on older
   * native builds.
   */
  saveThumbnailToGallery?(id: string): Promise<string>;
  /** System chooser to play the file in another app. */
  openWith(id: string): Promise<void>;
  share(ids: string[]): Promise<void>;
  /**
   * Save location (#297): copies the library item's file into the folder the user picked (`treeUri`, a persisted
   * Storage Access Framework tree), inside `subfolders` (created when missing; at most two levels). The library file is
   * only read. A name that exists gets the folder's own unique name. Rejects with ERR_FOLDER_ACCESS when the folder
   * can no longer be written (permission revoked, folder moved or deleted), ERR_NOT_FOUND for an unknown item or a
   * missing file, ERR_STORAGE when the copy fails (a partial copy is removed). Missing on older native builds.
   */
  copyToFolder?(id: string, treeUri: string, subfolders: string[]): Promise<FolderCopy>;
  /** Bytes copied so far while `copyToFolder(id)` runs; null when no copy of `id` is running. */
  getFolderCopyProgress?(id: string): { bytesDone: number; totalBytes: number } | null;
  /** True while VidoraX still holds a persisted write grant for the picked folder. */
  hasFolderAccess?(treeUri: string): Promise<boolean>;
  /** Gives the folder grant back (Remove / Change). Never rejects. */
  releaseFolderAccess?(treeUri: string): Promise<void>;
  /** The picked folder's own name, or null when the provider does not say. */
  getFolderName?(treeUri: string): Promise<string | null>;
  /** Show in Folder (#398), best effort: false when no installed app opens folders. */
  openFolder?(folderUri: string): Promise<boolean>;
  getStorageStats(): Promise<StorageStats>;
  /** Deletes orphaned temp work folders; resolves with bytes freed. */
  clearTempFiles(): Promise<number>;
  /**
   * F15: download files that belong to nothing — work folders of no unfinished download (queued, running, paused,
   * waiting, processing, recording and failed downloads keep theirs) and the temporary parts (`.hls`, `.mranges`,
   * `*.part`) of v1 downloads not listed in `keepLegacyIds`. Finished files are never counted. Nothing is deleted.
   */
  measureLeftoverFiles(options?: LeftoverFilesOptions): Promise<LeftoverFiles>;
  /** F15: deletes what `measureLeftoverFiles` lists; resolves with what was freed. */
  cleanLeftoverFiles(options?: LeftoverFilesOptions): Promise<LeftoverFiles>;
  // Private downloads (#459, #463): an encrypted vault, separate from the library. Missing on older native builds.
  /**
   * Encrypts the library item's file (and its thumbnail) into the vault and verifies the encrypted copy; resolves with
   * the new vault item. The library item is never touched: JavaScript deletes it through its usual path afterwards.
   * ERR_NOT_FOUND for an unknown item or a missing file, ERR_STORAGE when it cannot be written or does not verify.
   */
  moveToVault?(id: string): Promise<VaultItem>;
  /** Every vault item, newest first; items that cannot be opened are listed with `unreadable: true`, never hidden. */
  listVault?(): Promise<VaultItem[]>;
  /** The item's thumbnail as a `data:image/webp;base64,…` URI (keep it in memory only), or null. */
  getVaultThumbnail?(vaultId: string): Promise<string | null>;
  /**
   * Decrypts the item to one temporary file in the private cache and resolves with its `file://` URI (an earlier
   * playback file is removed first). ERR_VAULT_CORRUPT when the file does not authenticate.
   */
  openVaultItem?(vaultId: string): Promise<string>;
  /** Deletes the temporary playback file. */
  clearVaultPlayback?(): Promise<void>;
  /** At start: removes playback leftovers and half-written vault files. */
  cleanUpVault?(): Promise<void>;
  deleteVaultItem?(vaultId: string): Promise<void>;
  /** Decrypts into `Movies/VidoraX` (audio: `Music/VidoraX`); resolves with the new item's URI. */
  exportVaultItemToGallery?(vaultId: string): Promise<string>;
  /** Decrypts into a folder the user picked (a persisted tree URI). ERR_FOLDER_ACCESS when it cannot be written. */
  exportVaultItemToFolder?(vaultId: string, treeUri: string): Promise<string>;
  /** Bytes done while a move (key: library id) or a decryption (key: vault id) runs; null otherwise. */
  getVaultProgress?(key: string): { bytesDone: number; totalBytes: number } | null;

  // Completions
  /**
   * Downloads that reached `completed` with their verified library item and were not acknowledged yet, oldest
   * first — including ones that completed while no JavaScript ran (app closed, boot job). Recorded natively in the
   * same transaction as the `completed` state. Missing on older native builds.
   */
  listCompletedDownloads(): Promise<CompletedDownload[]>;
  /** Forgets completions JavaScript has counted, so each is reported once. */
  acknowledgeCompletedDownloads(ids: string[]): Promise<void>;

  // Files opened from other apps
  /**
   * The file the app was launched with, or one that arrived while nothing listened to `onIncomingMedia` — at most
   * once per intent (a JS reload does not reopen it). Null when there is none.
   */
  consumeIncomingMedia?(): IncomingMedia | null;
  /** The playable URI and details for a token from this process; null for an unknown token. */
  getIncomingMediaSource?(token: string): IncomingMediaSource | null;
  /**
   * Copies the file into the library (thumbnail, SHA-256 duplicate check), announced with `onLibraryChange`
   * `imported`. Rejects with ERR_NOT_FOUND (unknown token or the file can no longer be read), ERR_INVALID_REQUEST (not
   * an audio or video file, or empty), ERR_NO_SPACE (not enough free storage), ERR_STORAGE (the copy failed). Nothing is
   * left behind when it rejects.
   */
  importIncomingMedia?(token: string): Promise<ImportIncomingResult>;
  /** System chooser to open the incoming file in another app. Rejects with ERR_NO_APP / ERR_NOT_FOUND. */
  openIncomingWith?(token: string): Promise<void>;

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
