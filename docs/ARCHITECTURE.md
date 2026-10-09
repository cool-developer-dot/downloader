# VidoraX architecture (v2)

VidoraX is an Android-first in-app browser that downloads the videos you watch, keeps them in a clean local
library, and plays them back. This document is the source of truth for how the app is built. Contracts live in
code and are referenced below; when this document and a contract file disagree, the contract file wins and this
document must be fixed.

## 1. Goals and explicit non-goals

Goals

- The following video formats can be downloaded when found in the browser:
  - **Progressive:** MP4, M4V, MOV, WebM, AVI, WMV, standalone downloadable fMP4.
  - **Streaming:** unencrypted VOD HLS (master and media playlists; MPEG-TS, fMP4/CMAF and packed-audio segments;
    byte ranges; a variant whose sound is a separate `EXT-X-MEDIA TYPE=AUDIO` rendition — both downloaded and
    merged). Unencrypted static single-period DASH: single-file (BaseURL/SegmentBase) or segmented
    (SegmentTemplate/SegmentList, init + segments) representations, and separate video + audio adaptation sets —
    the chosen video representation and the best audio representation are downloaded and merged.
  - **Split audio/video:** a video-only file and an audio-only file of one video (a MediaSource player fed from two
    SourceBuffers — Instagram/Facebook-style), resolved, checked to be one video's, downloaded and merged.
  - **Extensionless URLs** when probe/verification confirms one of the above formats.
- Progressive files are streamed directly to disk and kept byte for byte when they already play (MP4/M4V/MOV,
  WebM/MKV, 3GP); a container that plays or seeks poorly is remuxed without re-encoding (MPEG-TS, fragmented MP4, AVI,
  FLV → MP4); only a track the output cannot carry is re-encoded (MP3/AC-3 → AAC, VP8/MPEG-2 → H.264) with the
  platform's MediaCodec encoders. The output of a merge/remux is MP4 (H.264/H.265/MPEG-4/VP9/AV1 + AAC/Opus), or
  WebM when both tracks are VP8/VP9 + Opus/Vorbis.
- Downloads keep running with the app in the background, the screen off, and across process death.
  Pause, resume, retry and cancel always do what they say.
- One library with a single source of truth: thumbnail, title, site, duration, resolution, size. Search, sort,
  filter by site, favorites, multi-select, rename, delete, share, open with, save to gallery. *(2026-10-03: filter by
  site and multi-select are not built yet — Phase 21 in `docs/ROADMAP.md`.)*
- A clean player: autoplay, resume position, simple controls, gestures, fullscreen, picture-in-picture, speed,
  next/previous.
- The browser is usable immediately at launch.
- **Downloadable ≠ internally playable.** A container nothing on the device can read (ASF/WMV: Media3 has no ASF
  extractor and Android no WMV decoder) is kept exactly as downloaded and relies on "Open with" / an external player.

Non-goals (refused, with a clear message to the user)

- DRM: Widevine/PlayReady/FairPlay, HLS `SAMPLE-AES`/non-identity `KEYFORMAT`, DASH `ContentProtection`,
  encrypted samples.
- YouTube (`youtube.com`, `youtu.be`, `googlevideo.com`): SABR streaming makes it infeasible and it violates
  YouTube's terms.
- Encrypted HLS (AES-128 or any `EXT-X-KEY METHOD` other than `NONE`).
- Multi-period DASH (ads stitched between periods) and audio-only streams.
- Isolated init segments or isolated media fragments without a complete downloadable stream.
- Unresolved `blob:` / MSE-only sources: a player whose files cannot be tied to it exactly (e.g. several candidate
  files from a feed that prefetches the next item) is not guessed.
- Merging tracks whose lengths or starts disagree (they are not one video's): `TRACK_MISMATCH`.
- Live streams (v2 may add "record from now").
- Bypassing logins or paywalls. Content is only reachable when the user can already play it in the browser.

## 2. System overview

```
┌──────────────────────────── JavaScript (Expo Router, React) ────────────────────────────┐
│ Browser (src/browser)       Detection (src/media-detection,     Downloads + Library     │
│  tabs, omnibox, WebView ──►  src/browser/media-actions)     ──► (src/downloads/v2,      │
│                              page observer, engine, sources,    src/store/downloads,    │
│                              "Video available" + quality sheet  src/library)            │
│ Player (src/player)  ◄───────────────────────────────────────── Library / Downloads UI  │
└───────────────┬───────────────────────────────┬─────────────────────────────────────────┘
                │ VidoraWeb (events, fns)        │ VidoraMedia (events, fns)
┌───────────────▼──────────────┐   ┌─────────────▼───────────────────────────────────────┐
│ modules/vidorax-web (Kotlin) │   │ modules/vidorax-media (Kotlin)                      │
│  network observer (WebView + │   │  probe · queue/state machine · runners (UIDT / FGS) │
│  service worker requests)    │   │  OkHttp transfer · HLS/DASH planners · merge/remux  │
│  WebView download handoff    │   │  verify · library DB · thumbnails · gallery export  │
│  cookies flush · intents     │   │  notifications · completion outbox                  │
│  shared links · default app  │   │                                                     │
└──────────────┬───────────────┘   └─────────────────────────────────────────────────────┘
               │ static hooks (no reflection)
┌──────────────▼───────────────────────────────────────┐
│ react-native-webview (patched by                     │
│ scripts/patch-react-native-webview.js at postinstall)│
└──────────────────────────────────────────────────────┘
```

Rule of thumb: **native owns everything that touches media bytes, files, background execution and download
state. JavaScript owns UI, detection ranking and the user's choices.**

## 3. Native module: `modules/vidorax-media`

Contract: `modules/vidorax-media/src/VidoraMedia.types.ts`. Kotlin package `com.vidorax.media`.

### 3.1 Dependencies

All Media3 artifacts pinned to **exactly** the version expo-video uses (`1.9.0`, see
`node_modules/expo-video/android/build.gradle`). Mixed Media3 versions crash at runtime.

- `androidx.media3:media3-exoplayer-hls` (`HlsPlaylistParser` — for parsing unencrypted VOD playlists only),
  `media3-datasource-okhttp`, `media3-common`.
- `com.squareup.okhttp3:okhttp` 4.x (already in the APK via React Native).
- `media3-exoplayer-dash` (`DashManifestParser` — planning MPDs; nothing is played with it) and `media3-inspector`
  (`MediaExtractorCompat`: library metadata and every read of a downloaded track — the player's own extractors).
- `media3-muxer` (`Mp4Muxer`/`WebmMuxer`: lossless remux and A/V merge, `process/Remuxer`) and `media3-transformer`
  (re-encoding one track with the platform MediaCodec encoders, `process/Transcoder`; `media3-effect` comes with it).
  No ffmpeg: WMV/ASF is kept as downloaded.

### 3.2 Components

| Component | Responsibility |
| --- | --- |
| `VidoraMediaModule` | Expo module definition. Thin: validates input, delegates, maps errors to coded exceptions. |
| `db/MediaDatabase` | `SQLiteOpenHelper` for `vidorax-media.db` in `noBackupFilesDir`. Tables below. The **only** store of download and library state. expo-sqlite never opens this file. |
| `engine/DownloadEngine` | Application-scoped singleton. Queue, concurrency (`maxConcurrent`), Wi-Fi-only policy, retries with capped exponential backoff + jitter, state persisted **before** side effects, progress events throttled to ≤ 4 Hz per download. Progressive files run as before; HLS, DASH tracks and `split` sources run as a list of track jobs (the video, then the separate audio — each a file with its `.part` + validator, or segments with their checkpoint; a finished file track is marked `.part.done` and never fetched again), one expired-link re-resolution for all of them, `SEGMENT_FAILED` for a segment the server will not serve. Then PROCESSING: the video track is verified, then `MediaProcessing` keeps/remuxes/merges/transcodes (progress events carry `stage`: merging/remuxing/transcoding/verifying), a produced file is verified again, and it is finalized like any download. A failed merge or conversion keeps the tracks, so Retry only processes again. A verified file that decodes with sound and no picture fails as `UNSUPPORTED_FORMAT`. |
| `engine/Runner` | API 34+: one user-initiated data transfer (UIDT) `JobService` that drains the whole queue. API 24–33: one `dataSync` foreground service. Started from user actions while the app is visible; stops when the queue is empty. |
| `net/HttpClient` | One OkHttp client. Per request: tab User-Agent, Referer, Origin, extra headers (never `Cookie`/`Authorization`), `Accept-Encoding: identity`, `Range`/`If-Range`, bounded `Range` for `EXT-X-BYTERANGE`. Redirects are followed by the client itself (max 20; a loop is a permanent `NOT_MEDIA`), and every hop — plus every HLS child URL — must pass `net/UrlSafety` (public http(s) hosts only; the page detector's SSRF rule, without DNS). Cookies: the WebView session per hop when `useCookies` (`net/SessionCookies`), plus an in-memory jar of cookies the servers set during the download; nothing persisted. |
| `plan/Probe` | The one classifier: DOWNLOADABLE (`ProbeResult.Success`), PROTECTED (`DRM_PROTECTED`), UNSUPPORTED (`UNSUPPORTED_FORMAT`, `LIVE_UNSUPPORTED`, `NOT_MEDIA`, `POLICY_BLOCKED`) or transient (`NETWORK`, `HTTP_ERROR` 5xx/408/429, `HTTP_403`/`HTTP_404` = refresh from the page). Progressive: bounded 64 KiB range sniff (magic bytes win over extension/Content-Type; a 206 must start at 0; encrypted MP4/WebM → PROTECTED; an MP4 whose track list in those bytes has sound and no video → UNSUPPORTED — the audio half of a split stream is not a video). `kind: hls`, or bytes that are a playlist, go to `plan/HlsPlanner` with the request's `variant` (the engine fills in the preferred-quality setting exactly as enqueue does), so the verdict is about the variant that would be downloaded; then `HlsPlanner.confirmMedia` reads that variant's init section (fMP4) or the first 4 KiB of its first segment and refuses WebVTT, packed audio, a track list without video, and Common Encryption boxes — a media playlist found on its own can be a stream's subtitle or audio rendition. A read that fails is no verdict (the transfer re-checks the bytes). `kind: dash`, or bytes that are an MPD, go to `plan/DashPlanner`; the representation it picks is then classified by its own bytes exactly as a progressive file, so DASH is DOWNLOADABLE only when that one file is a complete, clear video. MP3/AAC/M4A(B) are named as audio files (an `M4A `/`M4B ` brand even when the track list is past the probe). YouTube hosts, HTML/JSON pages, `blob:` and inline manifests (`manifestText`) refused. |
| `plan/DashPlanner` | Media3 `DashManifestParser` over a bounded (4 MiB) fetch. Refuses: any `ContentProtection` (raw, namespace-aware scan — Media3 records nothing for a bare `mp4protection`) or DRM init data → PROTECTED; `type="dynamic"` → LIVE; several periods and audio-only manifests → UNSUPPORTED; 401/403, 404/410, 5xx and transport failures keep their transient codes. Every decodable video representation on a public host is eligible: single-file (BaseURL/SegmentBase → `DashTrackSource.File`) or segmented (SegmentTemplate `$Number$`/`$Time$`/SegmentTimeline, SegmentList → init + every segment as an `HlsPlan`-shaped segment plan, bounded 20 000 segments; unbounded templates refused). Selection: `variant.videoId` exactly (never swapped), else best ≤ `maxHeight`, else best. Sound: the representation's own (muxed codecs), else the separate audio adaptation set's `variant.audioId`, else main role > unlabelled > AAC > Opus/Vorbis > others, highest bitrate. `presentationTimeOffset` becomes the track's time offset. A plan that is one complete muxed file keeps the progressive path (`DashResolution.Ready`); anything else is `DashResolution.Tracks` (file tracks classified by their own bytes for their role, segment tracks by their init section). The engine re-reads the manifest on every run. |
| `plan/HlsPlanner` | Media3 `HlsPlaylistParser` (multivariant with its `EXT-X-DEFINE` imports, or media). Variant: `variant.videoId` exactly (never substituted), else best ≤ `maxHeight`, else best decodable. A variant whose `AUDIO` group has only renditions with a URI gets that group's rendition (`variant.audioId`, else `DEFAULT`, else `AUTOSELECT`, else the first) planned too, as `HlsPlan.audio` (same refusals; discontinuities with separate audio refused). Refuses: any `EXT-X-KEY`/`EXT-X-SESSION-KEY` method other than `NONE` (decided from the tag text too — Media3 records nothing for SAMPLE-AES identity or FairPlay), DRM init data, live (no `EXT-X-ENDLIST`), `EXT-X-GAP`, audio-only, fMP4 that changes init section or timeline mid-stream, segments on non-public hosts. `confirmTrack` checks a track's first bytes for its role (video: a picture; audio: TS, packed audio or a sound track; never encrypted). A child playlist refused 401/403 is retried once with the parent's query (token propagation). Output: an `HlsPlan` with a structure fingerprint (not token-sensitive). |
| `transfer/ProgressiveTransfer` | Streamed write to `.part` file. Resume at byte level with `Range` + `If-Range`: the validator (a strong ETag, else Last-Modified — never a weak ETag) of the response that started the `.part` is kept beside it (`download.part.validator`), so it survives pause, process death, reboot and a re-signed link. On server 200 to a ranged request, restart from zero (never append a 200 onto an existing partial). A write the disk refuses is a `StorageWriteException` (ENOSPC → `NO_SPACE`), never a network error. A superseded worker never touches the `.part`. Atomic rename on completion. |
| `transfer/HlsTransfer` | One segment track (an HLS media playlist, the audio rendition, or a DASH segment representation — `HlsTransferSpec.role`) appended to its own `.part` (`download.part` / `audio.part`) in order; after each one the `.part` is synced and `work/<id>/hls.checkpoint` advanced (segments done, bytes, fingerprint, container — no URL, no token). Resume truncates to the checkpoint and continues at the next segment; a checkpoint for another stream restarts from zero. MPEG-TS: byte concatenation. fMP4: init once, each segment's own `sidx` renamed `free`, one global `sidx` written into space reserved after the init (`transfer/Fmp4Index`) so players get the real duration and seeking — no sample byte changes, no sample byte changes. The container is confirmed from the bytes (subtitles refused; DASH WebM accepted; `plan/HlsSegmentFormat`, shared with the classifier). An audio track may be HLS packed audio: each segment's ID3 tag is dropped and the first one's `com.apple.streaming.transportStreamTimestamp` is kept (checkpointed) as the track's time offset, so the merge keeps it in sync with an MPEG-TS video. |
| `process/MediaProcessor` | After the transfers: keep (MP4/MOV/M4V not fragmented, WebM/MKV, 3GP, and anything Media3 cannot read — WMV — byte for byte), remux (MPEG-TS, fragmented MP4, AVI, FLV → MP4), merge (separate video + audio → MP4, or WebM for VP8/VP9 + Opus/Vorbis) or transcode (only the track the output cannot carry, into its own file, then merged losslessly with the copied track at its original timeline offset). Split inputs are refused before a byte is written when their stated lengths disagree (`TRACK_MISMATCH`), and every produced file is read back: a video track, the audio when one went in, the source's length, and merged tracks that start within 2 s and last as long as each other (from the samples actually written). Failures: `VIDEO_TRACK_MISSING`, `AUDIO_TRACK_MISSING`, `TRACK_MISMATCH`, `MUX_FAILED`, `TRANSCODE_FAILED`, `INVALID_MEDIA`, `DRM_PROTECTED`. |
| `process/Remuxer` | `MediaExtractorCompat` (Media3's extractors; MPEG-TS with `TimestampAdjuster.MODE_NO_OFFSET` so renditions keep their offsets) → `Mp4Muxer` (moov at the end: no reserved padding) / `WebmMuxer`. One video + at most one audio track; files interleaved by time; every file shifted by its time offset, the output moved so its earliest sample is at 0 (a later track keeps its delay as an edit list). A fragmented MP4's own edit-list start delays, which Media3's fragmented extractor leaves out (an empty edit followed by the media edit, as HLS fMP4 from ffmpeg writes them), are added per track (`process/FragmentEdits`) — without them an fMP4 audio rendition starts up to tens of ms early. In-band codec configs (MPEG-4 VOL, H.264 SPS/PPS, HEVC VPS/SPS/PPS in AVI/FLV) recovered from the first key frame (`process/CodecConfig`). Rotation kept. Cancellable between samples; a partial output is deleted. |
| `process/Transcoder` | Media3 Transformer on its own looper thread: one track of one file → a single-track MP4 (H.264 video or AAC audio, platform MediaCodec — hardware where available). Only asked when a track cannot be copied and this device can decode it (`AndroidCodecSupport`). |
| `verify/Verifier` | Post-download validation on the bytes on disk: expected length, container magic (MPEG-TS only when an HLS download produced it), no DRM brands and no encrypted tracks in the `moov` wherever it sits (protected → `DRM_PROTECTED`, not "corrupt"). HLS output must also decode as a video (MediaExtractor) before COMPLETED. |
| `library/LibraryStore` | Library rows, queries (search, site, favorites, sort, paging), rename (title only), per-item favorites, delete (file + thumbnail; gallery copy is left alone). Missing-file repair: an item whose file is gone or empty (deleted or moved outside VidoraX) is removed with its thumbnail and announced `deleted` — at module start, on `reconcileLibrary` (Player tab focus, app foreground, pull-to-refresh, the player finding the file missing) and when an action finds the file gone. The recorded MIME type follows the container proven from the bytes (a MOV is `video/quicktime`, even when the platform says `video/mp4`). |
| `library/MediaInfo` | `MediaMetadataRetriever` for duration, width, height, rotation, codecs. |
| `library/Thumbnails` | Frame at 10% of duration (min 1 s), scaled to 480 px wide, WebP in `filesDir/thumbs/<id>.webp`. |
| `library/GalleryExport` | API 29+: `MediaStore.Video` with `RELATIVE_PATH=Movies/VidoraX/<Site>`, `DISPLAY_NAME=<Safe Title>.<ext>`, the proven MIME type, `TITLE`, `IS_PENDING` while copying (MediaStore ignores an app's `DATE_TAKEN`; the scanner reads it from the file, else the gallery uses the date added). API 24–28: public `Movies/VidoraX/<Site>` + media scan; rejects with `ERR_STORAGE_PERMISSION` when `WRITE_EXTERNAL_STORAGE` is missing. **Automatic** (`publishCompleted`): the engine calls it after COMPLETED for every download whose `saveToGallery ?: autoSaveToGallery` is true (default true); the item carries `gallery_state='pending'` from the insert until the copy is recorded, so a process death resumes it at the next start (`resumePending`, which first deletes the app's own half-written `IS_PENDING` items). A failed copy sets `failed` and never touches the download or the library item. **Idempotent**: a recorded copy that still exists is reused, and before publishing, the app's own `Movies/VidoraX` items of the same size are compared by SHA-256 — a crash between publishing and recording, a repeated tap or the manual Save never creates `video (1).mp4`. Different videos that share a title are different files: MediaStore names the second `Title (1).mp4`. |
| `engine/DownloadIdentity` | The identity of the video a request is for: SHA-256 of host (no `www.`) + case-sensitive path + query without rotating signature fields (`token`, `sig`, `expires`, `oe`/`oh`, `x-amz-*`…) + the chosen HLS/DASH variant, plus the page (without tracking fields) whenever a signature field was removed — a generic `/stream?token=…` never makes two videos one. Computed from `EnqueueRequest.identityUrl` (the offer's own link, before refresh/redirect) or `url`. Stored hashed in `downloads.identity_key` and `library.identity_key`; older rows get it at engine start. |
| `library/SavedVideoIndex` | What the user already has: by identity (a library item whose file exists, else a `gallery_exports` copy that still exists in MediaStore — a copy the user deleted is forgotten) and by content (same size, then SHA-256; each item's hash is computed once, only when another file of exactly its size appears). |
| `library/LegacyImport` | One-time import of completed files from the old layout `filesDir/VidoraXDownloads/<id>/<file>` (id preserved so existing playback progress still matches). Skips `.part` and workspace folders, generates metadata and thumbnails, then removes empty old folders. |
| `runner/DownloadNotifications` | Channel `vidorax_downloads_progress` (low importance, ongoing: "Downloading · 6.8 MB of 13 MB · 1.2 MB/s", Pause/Cancel; Paused with Resume/Cancel; Waiting for network) and `vidorax_downloads_status` (completed; failed with Retry unless the verdict is final). Speed is the engine's 2 s window, shown only while bytes move. Tapping opens `vidorax://downloads` (a transfer) or `vidorax://library` (a finished video) — also on a cold start: `MainActivity.onNewIntent` keeps the link and the splash honours it. |
| `analyze/PageFetcher` | `fetchPage`: a pasted/shared link read the way its tab would navigate to it, for the direct analyzer (§5.4). GET with the tab's identity (the stock WebView User-Agent via `BrowserIdentity`, or the desktop UA; device Accept-Language; `Sec-Fetch-*` navigation headers; OkHttp's transparent gzip). Redirects followed here, ≤ 10 hops, every hop checked against `UrlPolicy` (public hosts only) and the YouTube policy before it is contacted, a URL seen twice = `REDIRECT_LOOP`; one deadline (1–20 s) spans all hops and the body; the body is read up to a byte bound (16 KiB–4 MiB) and decoded with its declared charset. Media (a pasted file or manifest) is recognised from Content-Type and the first 4 KiB (`ContentClassifier`) and never read further. Cookies: the WebView session's per hop plus those earlier hops set; with `commitCookies`, the `Set-Cookie`s of a complete fetch that finished inside its deadline are stored in the WebView jar (`CookieSink`), exactly what the tab's navigation would store. Typed failures: `INVALID_URL`, `UNSAFE_URL`, `POLICY_BLOCKED`, `REDIRECT_LOOP`, `TOO_MANY_REDIRECTS`, `TIMEOUT`, `NETWORK`, `HTTP_ERROR` (status), `UNSUPPORTED_CONTENT`. Nothing is executed, nothing persisted, no cookie value reaches JavaScript or a log. |
| `files/FileActions` | Open with / share via a `FileProvider` (`${applicationId}.vidorax.files`) with read grants. |
| `player/Volume` | Media stream volume get/set and change events (for the player's volume gesture). |

### 3.3 Storage layout (private by default)

```
filesDir/
  library/<site>/<Safe Title>_<shortId>.<ext>   completed media (the user's library)
  thumbs/<id>.webp                              thumbnails
noBackupFilesDir/
  vidorax-media.db
  work/<id>/                                    temp parts, segments, keys (deleted on completion/cancel)
```

The library copy is private (App Lock protects it). Since 2026-09-26 every completed download is **also** published
to `Movies/VidoraX/<Site>` by default (`autoSaveToGallery`, Settings → Download Settings → "Save to Gallery"; the
per-item "Save to gallery" action reuses that copy). Deleting a video in VidoraX leaves the user's gallery copy alone.

### 3.4 Tables

```sql
downloads(id TEXT PRIMARY KEY, state TEXT NOT NULL, kind TEXT NOT NULL, url TEXT NOT NULL,
          request_json TEXT NOT NULL, title TEXT NOT NULL, site TEXT NOT NULL,
          page_url TEXT, thumbnail_url TEXT, quality_label TEXT, bytes_done INTEGER NOT NULL DEFAULT 0,
          total_bytes INTEGER, error_code TEXT, error_message TEXT, attempts INTEGER NOT NULL DEFAULT 0,
          next_retry_at INTEGER, save_to_gallery INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)
-- kind: 'progressive', 'hls', 'dash' (url = the MPD) or 'split' (url = the video file, audio_url = the audio file).
-- No manifest_text (inline manifests are refused).
-- variant_json (HLS/DASH): {"videoId": HLS playlist scheme://host/path | DASH representation id,
--   "audioId": HLS rendition scheme://host/path | DASH audio representation id, "maxHeight": n}
-- — the choice a resume re-selects.
-- Track files live in work/<id>/: download.part (video, or the whole file) and audio.part, each with its
-- .validator and, once finished, .done; segment tracks with hls.checkpoint / audio.checkpoint.
-- HLS resume state is NOT a table: work/<id>/hls.checkpoint beside the .part (segments done, bytes, playlist
-- fingerprint, container). Segment URLs carry tokens and are re-read from a fresh playlist on every run, so none
-- are persisted.
library(id TEXT PRIMARY KEY, title TEXT NOT NULL, site TEXT NOT NULL, page_url TEXT, source_url TEXT, file_path TEXT NOT NULL,
        mime_type TEXT NOT NULL, container TEXT NOT NULL, video_codec TEXT, audio_codec TEXT, has_audio INTEGER NOT NULL,
        width INTEGER, height INTEGER, duration_ms INTEGER, size_bytes INTEGER NOT NULL, thumb_path TEXT,
        favorite INTEGER NOT NULL DEFAULT 0, gallery_uri TEXT, created_at INTEGER NOT NULL, completed_at INTEGER NOT NULL)
completions(download_id TEXT PRIMARY KEY, completed_at INTEGER NOT NULL)   -- schema v3
-- schema v4 (duplicate detection, automatic gallery copies; additive only):
--   downloads.identity_key, library.identity_key (hashed engine/DownloadIdentity), library.content_sha256 (lazy),
--   library.gallery_state ('pending' until the automatic copy is recorded, 'failed', else NULL)
gallery_exports(uri TEXT PRIMARY KEY, library_id TEXT, identity_key TEXT, created_at INTEGER NOT NULL)
-- Every gallery copy VidoraX made; outlives the library row, so the video stays "already downloaded" while the copy
-- exists. The v4 migration records the copies older versions saved.
-- Outbox of genuine completions, written in the same transaction that saves a download as COMPLETED — also by the
-- boot job and background runner while no JavaScript runs. JS lists it (`listCompletedDownloads`), counts each id
-- once for the in-app review, then acknowledges (`acknowledgeCompletedDownloads`), which deletes the rows. Bounded:
-- the newest 500 unacknowledged rows are kept.
```

Request context (`request_json`) contains User-Agent, Referer, Origin and extra headers, never cookie values.
Sessions/cookies may be used during active transfer but are not persisted. `useCookies` is the only persisted
session fact: a source that refuses a request made without the browsing session (401/403) is retried once with it,
and when that works the download keeps `useCookies = true` for resume and retry. The User-Agent is the tab's real
one (the stock system WebView UA in mobile mode), so UA-bound signed URLs still answer.

### 3.5 Download state machine

```
queued → probing → downloading ⇄ paused
                        │  ⇅ waiting_network (Wi-Fi-only / offline)
                        │  ⇅ waiting_retry   (transient error, backoff)
                        ▼
                   verifying (file validation / metadata / thumbnail / optional gallery export)
                        ▼
                   completed          failed(code)    cancelled
```

- On engine start, `downloading`/`probing`/`verifying` rows with no live worker become `queued` (they resume from
  the segment ledger for HLS, or from the `.part` file byte offset for progressive).
- **One download per video.** `enqueueUnique` checks, atomically with creating the row (engine mutex): a non-terminal
  download with the same identity → `ALREADY_DOWNLOADING` (that download; a paused one is resumed); a saved copy
  (library or VidoraX gallery) → `ALREADY_DOWNLOADED`. `findDuplicate` is the same check without creating anything
  (JS asks it before any network request). The same bytes reached through another link are caught at finalization:
  under a finalize lock, the finished file is compared by size + SHA-256 with the library and VidoraX's gallery
  copies; a match deletes the new file and ends the download `failed(DUPLICATE)` ("Video already downloaded", final,
  no Retry, no library item, no gallery copy). The gallery copy is made only after COMPLETED, from the final file.
- `retry` is allowed from `failed`; `resume` from `paused`; `cancel` from any non-terminal state and deletes temp
  files. `completed` rows stay in `downloads` for 24 h for the Downloads screen, then are pruned (the library row
  remains).

## 4. Native module: `modules/vidorax-web`

Contract: `modules/vidorax-web/src/VidoraWeb.types.ts`. Kotlin package `com.vidorax.web`.

`scripts/patch-react-native-webview.js` (runs at `postinstall`, idempotent, **fails the install loudly** when an
anchor is not found) adds a `RNCWebViewHooks` class to react-native-webview and calls it from:

1. `RNCWebViewManagerImpl.createViewInstance` → `onWebViewCreated(webView)`. Installs, once per process, a
   `ServiceWorkerClient` that sends service-worker requests (which belong to no WebView) through the same observer.
   (A document-start script path existed here until 2026-09-24; nothing the app mounts used it, so it was removed.
   The in-page observer is injected by the browser itself — §5.)
2. `RNCWebViewClient.shouldInterceptRequest` → `observe(view, request)`. Lock-free cheap prefilter, dedupe (URL
   without byte-range params, 2 s window), batched `onNetworkMedia` events every 250 ms. Never returns a response.
   Skips YouTube/googlevideo hosts. This is how media requested inside cross-origin iframes is seen.
3. The WebView `DownloadListener` → `onDownloadStart(...)`: a navigation or link whose response the WebView cannot
   render (a pasted `.mpd` or `.mov`, a file served as an attachment). Only videos are claimed —
   `NetworkMediaClassifier.classifyDownload` (HLS/DASH MIME types, `video/*` except `video/mp2t`, or a generic binary
   named like a video by Content-Disposition or the URL; an unnamed generic binary is `unknown`) — and sent to JS as
   `onWebDownload`; every other download goes to Android's `DownloadManager` as before. JS makes a claimed download a
   user-requested candidate of the tab that owns the WebView (§5.1); an `unknown` one only after `VidoraMedia.probe`
   identifies a video. Anything that is not a video, or has no owning tab, is handed back with `startSystemDownload`
   (the same `DownloadManager` request react-native-webview would have made).
4. The existing containment of custom schemes (`snssdk…`, app links) in `shouldOverrideUrlLoading` is kept.
5. `RNCWebViewManagerImpl.setInjectedJavaScriptBeforeContentLoaded` → `setDocumentStartScript(view, script)`: the
   before-content script is registered with `WebViewCompat.addDocumentStartJavaScript` (main frame only, all origins;
   `WebViewFeature.DOCUMENT_START_SCRIPT`), so it runs when each document starts, before any page script. Stock
   react-native-webview 13.16.1 evaluates it from `onPageStarted`, which on Android runs after the page's first
   scripts — too late for the MediaSource hooks of a player built while the page loads (2026-09-27, Pixel 8 AVD:
   hooks absent at `sourceopen` before; present after). `RNCWebView.callInjectedJavaScriptBeforeContentLoaded` skips
   its late evaluation when the document-start registration is in place (the stock path remains the fallback on a
   WebView without the feature).

The module also reads links shared to the app (`ACTION_SEND text/plain`, e.g. "Share → VidoraX" from the Instagram
or TikTok app): the launch intent through `consumeSharedText()`, later intents through `OnNewIntent` →
`onSharedText`.

It also carries the app's light/dark choice to Android (`setAppNightMode('light' | 'dark' | 'system')`, `AppNightMode`):
kept in SharedPreferences for `MainApplication`, and on Android 12+ handed to `UiModeManager.setApplicationNightMode` so
the system splash follows Settings → Theme (§8).

The module depends on the Gradle project `:react-native-webview`; there is no reflection on the request path.

## 5. Detection: `src/media-detection` + `src/browser/media-actions`

The detection stack that runs is the v1-derived one, hardened from Phase 6 on. (A planned replacement, `src/detection`
with a document-start detector, was never mounted and was removed on 2026-09-24.) One engine singleton serves every tab.

### 5.1 Signals

- **In-page observer** (`observers/injected-script.ts`): plain JavaScript injected by `BrowserWebView` through
  `injectedJavaScriptBeforeContentLoaded` (document start, §4 item 5) / `injectedJavaScript` (when the page has
  loaded; main frame; it scans same-origin subframes itself). The MediaSource observation (`vidoraxMseObservation`:
  `URL.createObjectURL`, `addSourceBuffer`, `appendBuffer`, `Response.arrayBuffer`/arraybuffer XHR, EME requests) is
  one installer shared by both scripts and installed once per document by whichever runs first — normally the
  before-content script — and the main script adopts its state (`window.__VIDORAX_MSE__`) and receives its events.
  Watches `<video>`/`<source>` and players (MutationObserver, capture-phase media events, IntersectionObserver
  visibility, PerformanceObserver resource entries) and `history.pushState`/`replaceState`/`popstate`; posts `ready`,
  `page_meta`, `active_video`, `active_iframe_player`, `blob_indicator`, `mutation_batch` and `scan_complete` through
  `window.ReactNativeWebView.postMessage`. `window.__VIDORAX_MEDIA_RESCAN__()`, sent with `injectJavaScript`, makes the
  page announce itself again after it was hidden or its tab parked.
- **Native network observation** (`adapters/native-network.adapter.ts` ← VidoraWeb `onNetworkMedia`): media requested
  by the page, by cross-origin iframes and by service workers, scoped to the tab and navigation epoch it was seen in
  (`adapters/native-observation-scope.ts`). A ranged read of a media file (`bytestart`/`byteend`, `range`, … on a
  playback path, a CDN video-object path or a media-file extension) is ingested as the whole file
  (`canonicalizeObservedMediaUrl`), never as the slice one request read.
- **WebView downloads** (`adapters/native-network.adapter.ts` `handleWebDownload` ← VidoraWeb `onWebDownload`): the
  user asked the browser for exactly this resource. It enters as a `userRequested` observation of the owning tab; the
  general page context adopts it as the page's current media (`adoptUserRequestedMedia`: a new generation, until the
  page's player moves to another element or source), and correlation gives it STRONG ownership. It is verified and
  classified like any other source. This is how a pasted DASH/MOV/attachment/extensionless link gets its offer.
- **Blob / MSE players** (`engine/mse-playback-context.ts`, `session-media/`): a `blob:` player is offered only when a
  real HTTP(S) source for it can be proven. The page reports each MediaSource's SourceBuffer layout (`mseTracks`, from
  the MIME types given to `addSourceBuffer`; a MediaSource created before the observer was injected is matched to its
  element as the only attached one, or by duration). Separate video and audio buffers with no manifest are a split
  audio/video player (`SPLIT_TRACKS`): no file it fetched is ever offered on its own (each is one half); instead the
  pair is resolved (`pipeline/split-tracks.ts`) and offered as one download that merges both (`kind: 'split'`).
  **Exact pair:** the page names the file behind each SourceBuffer — responses read with `Response.arrayBuffer()` or an
  `arraybuffer` XHR are remembered weakly by their URL, and `SourceBuffer.appendBuffer` of those bytes records the
  file per buffer on that MediaSource (`mseFiles`); a new `blob:` (the next item's MediaSource on a recycled element)
  starts from nothing. **Fallback:** only a player fed from exactly two whole files (network evidence, after a 2.5 s
  settle; byte-range query parameters such as `bytestart`/`byteend` dropped) is resolved — requests the page made
  before it first reported a player (a short video's files are often all fetched by then) are kept per tab and
  navigation epoch and replayed into the player it reports next; three or more (a feed
  prefetching the next item) is never guessed (`SPLIT_AMBIGUOUS`). Either way `VidoraMedia.probe({ kind: 'split' })`
  proves the pair from the bytes (a picture, sound, not encrypted, lengths that agree) and its length must agree with
  the element's; the same native probe re-checks the pair right before the enqueue (like HLS/DASH, never the JS
  progressive gate, which would see only the video half). With one file seen, nothing is offered for up to 12 s. Split buffers alone prove nothing — hls.js
  demuxes one MPEG-TS stream into two buffers — so a page with an HLS/DASH manifest is left to the engine's own
  manifest classification. Protection evidence also comes from `HTMLMediaElement.setMediaKeys`, and any
  change of a player's verdict (protection, layout, file count) re-runs selection (`subscribeMsePlayback`).

### 5.2 Engine, page identity and navigation

- `engine/media-detection.engine.ts` routes messages and observations per tab to the general correlation
  (`general-media/`) or the social one (`social/`: Instagram and TikTok content identity), which pick the page's main
  video.
- **Page identity** (`utils/url.ts` `normalizePageIdentity`): `scheme://host/path` plus the meaningful query (sorted);
  a noise list is stripped (click ids, `utm_*` and other analytics prefixes, share/referrer tags, player-state params
  such as `t`, `start`, `autoplay`, `muted`). Social pages are path-only (their content id is in the path).
- **Navigation rule** (`onNavigationStart`): detections survive only within the same tab, the same navigation epoch and
  the same page content (identity equal after noise stripping — e.g. a tracking `replaceState`). Another document, a
  query change that changes the content, a reload or a new epoch is a hard reset. A tab switch snapshots the previous
  tab's detections (≤ 6 tabs), restores the returning tab's and asks its page to rescan. Observations that arrive
  before their navigation (a newer epoch, another page) are deferred (≤ 32, 15 s) and replayed when it starts.
- **Verification before any offer** (`general-source/`, `social-source/`): progressive files by a bounded range read
  plus the engine's own classification (`VidoraMedia.probe`, bounded at 25 s in JS, run alongside the range read rather
  than after it; only definitive refusals block; a temporary network/server answer is verified again after 3 s, within
  the same ≤ 3 reruns per page/media/owner),
  HLS by `VidoraMedia.probe({ kind: 'hls' })` (every decodable variant becomes a quality carrying its playlist URL as
  `representationId` → `variant.videoId`; a master claims its variant and rendition playlists so a rendition is never
  offered alone; manifests are verified first, earliest seen first), DASH by `VidoraMedia.probe({ kind: 'dash' })`. Callers asking about the same source share one verification
  (`social-source/verification-session.ts`: caller-ref-counted, aborted only when every caller has left); results are
  cached per tab + navigation + content + resource, never with cookie or authorization values.

### 5.3 The offer ("Video available")

- `browser-media-action.service.ts` keeps one CTA slice per tab. `useBrowserMediaAction.ts` verifies the page's main
  video, publishes the offer, and runs verification again (≤ 3 times per page/media key) when a newer trigger arrived
  during a run or the run was aborted. `BrowserMediaDownloadBar.tsx` shows the offer; the quality sheet lists the
  verified variants (`verified-quality-options.ts`).
- The offer holds the owned video's renditions only: when ownership chose a source, other active sources on the page (a
  preroll, a second player, a link the user did not pick) are left out of it, so the quality sheet never lists another
  video as a "quality". A single tap downloads the variant the offer was published for (`offered-option.ts`), never a
  higher-ranked option from another source.
- Download: `browser-media-download.service.ts` → `src/downloads/v2/handoff.ts` → `VidoraMedia.enqueueUnique` (the
  engine classifies the exact variant again). Before the pre-download gate touches the network, `findExistingDownload`
  asks the engine whether the user already has the video; a DUPLICATE (`ALREADY_DOWNLOADING` /
  `ALREADY_DOWNLOADED`) is a successful tap that started nothing: the CTA is consumed and the toast says "Video is
  already downloading" / "Video already downloaded" — never "Added to Downloads", never a failure. The pipeline
  records it as `DUPLICATE`.
- **Pipeline outcomes** (`src/media-detection/pipeline/pipeline-outcome.ts`): every stage records what it decided about
  a source — OBSERVED / OFFERED / ENQUEUED / DUPLICATE, or a typed rejection: STALE (not the current video of the
  current page: another tab/page/generation, a previous or preloaded item, an ad, a hidden or thumbnail player, an
  expired link, two tracks that are not one video's), PROTECTED, LIVE_UNSUPPORTED, UNSUPPORTED (multi-period DASH,
  audio only, isolated segments, a container the engine refuses), SOURCE_UNRESOLVED (no real source tied to the
  current video, a split pair not known exactly), VIDEO_TRACK_MISSING, AUDIO_TRACK_MISSING, SEGMENT_FAILED,
  MUX_FAILED, TRANSCODE_FAILED, TRANSIENT_FAILURE (network/server/session) and INVALID_MEDIA (not a video, or a
  processed file that does not read back as one). An engine failure maps through `pipelineOutcomeForDownloadError`. Recorded by the engine (dropped native requests), both correlations, the CTA hook's
  verification and the enqueue. Bounded, hostnames and hashes only; logged as `[VidoraPipeline]` in debug builds or a
  build made with `EXPO_PUBLIC_VIDORAX_PIPELINE_TRACE=1`.
- Web links from other apps (`http:`, `https:`, `about:`) belong to the browser, not to the router
  (`src/app/+native-intent.ts`, `isBrowserWebLink`): a cold start opens `/`, a warm link is left to the browser's
  incoming-link handling, and `+not-found` goes back instead of redirecting — a link never mounts a second app tree.

### 5.4 Pasted links: the direct analyzer

A link pasted into the address bar (the typed `navigate` intent or the "Go to website" row) or shared/opened with
VidoraX (`ACTION_SEND` / `ACTION_VIEW`) is read **before** the WebView plays anything, so a video the page names in its
own bytes is offered at once — no "Continue on web", no playback needed. Links that are not a content page (a site's
home, a search, YouTube, a private address) load as before (`src/browser/services/pasted-link.ts`).

```
paste ─► pasted-link.service ─► direct-analysis.service (one session per tab; a newer paste supersedes → STALE)
          │                        │
          │                        ├─ analyzePastedLink (media-detection/direct-analyzer/resolve-direct-page.ts, pure)
          │                        │    policy (YouTube / private host: no request)
          │                        │    fetchPage(tab identity, commitCookies) ──► the tab navigates now (onRelease)
          │                        │    media? ─► the link itself is the candidate ("direct")
          │                        │    page  ─► extractPageMedia ─► none? declared player page (1 level) ─► desktop site
          │                        │    verify (direct-verifier.ts → the existing classifiers) ─► typed result
          │                        └─ publish (direct-offer-policy.ts) ─► browserMediaActionService.handoffVerified
          └─ WebView loads the page: the WebView detection pipeline runs as always (the fallback)
```

- **Navigation order.** The tab's own navigation waits only for the first page fetch (native deadline 6 s, safety net
  7.5 s). That fetch commits the cookies the page set, so a link the page signs for its session (TikTok's
  `tt_chain_token`) answers the tab, the verification and the engine alike; a later navigation the user starts in the
  tab (Back, Home, another link) cancels the deferred one.
- **Extraction** (`extract-page-media.ts`, no DOM, nothing executed, bounded: 4 MiB of HTML, 300 000 JSON nodes). In
  order of evidence: *declared* — `og:video*`, `twitter:player:stream`, JSON-LD `VideoObject.contentUrl` (only the
  VideoObject naming the pasted content when there are several); *content* — URLs in embedded JSON (`<script
  type=*json*>`, strict-JSON values assigned in scripts), `<video>` elements and `data-*` attributes that are tied to
  the link's content id (`content-tokens.ts`: path/query ids such as `/reel/<code>`, `?v=<id>`, `/video/<id>`):
  the nearest object up the data tree whose id field is one of them, never across a list of items and never past an
  object whose id field names another item of the same id shape (a related reel pointing back at the page is not the
  page's video); *single* — failing both, exactly one distinct video file named anywhere on the page. Several unrelated
  videos: `AMBIGUOUS_MEDIA`, never a guess. A URL counts as video by extension, a MIME hint in its query
  (`mime_type=video_mp4`), or the field that holds it (`playAddr`, `video_url`, `hls_url`, `video_versions[].url`…) —
  artwork, captions, music, ads, one-track representations (`representation_id`, video-only codecs) and links back
  into the page's own site are excluded. An inline DASH manifest (`video_dash_manifest`, …) contributes its muxed file,
  else its best video file + best audio file as a `split` pair (`inline-dash.ts`), and its `ContentProtection` /
  `type="dynamic"` flags. Many sites render media data only for desktop browsers: a page naming nothing is fetched once
  more as the desktop site (no cookie commit). Generic only — no site is named anywhere in the analyzer.
- **Verification** (`direct-verifier.ts`) reuses the WebView pipeline's classifiers: `verifyGeneralSourceCandidate`
  (range read + the engine's native probe for progressive; the engine's HLS/DASH planners for manifests), public
  first, then once with the session cookies after an auth-like refusal; a split pair through the engine's `split`
  probe (`resolveSplitPair`, roles/encryption/lengths). Whole files are verified first and published at once (early
  offer); a better split pair proven afterwards is added to the same offer in place (a merged quality beside the
  whole file). The offer is a normal `MediaAnalysisResult`, so the quality sheet, `enqueueVerifiedBrowserVariant`,
  `enqueueUnique`/`findDuplicate`, the engine, merge/remux/transcode, verification, library and gallery are unchanged.
- **Typed results:** `SUPPORTED`, `PROTECTED`, `LIVE_UNSUPPORTED`, `UNSUPPORTED` (YouTube, refused formats),
  `UNRESOLVED` (no/ambiguous media, 4xx, redirect loop), `TRANSIENT_FAILURE` (timeout, network, 5xx/408/429),
  `INVALID_MEDIA` (unsafe redirect, not a page and not media), `STALE` (superseded). Each is recorded in the pipeline
  ledger (`resolver` stage, reason `DIRECT_*`) and, in debug/trace builds, logged as `[VidoraDirect]`. Anything but
  `SUPPORTED` leaves the page to the WebView pipeline, which runs for it regardless.
- **Publishing** (`direct-offer-policy.ts`): only while the session's tab is in front and shows the session's page (the
  pasted URL, where it redirected, or the same site naming the same content id), only after the detection pipeline
  has started that navigation (its reset cannot wipe the offer), and never over an offer already standing (the same
  video, or the video the WebView pipeline found playing). The offer carries the content identity the WebView
  pipeline gives the same page (`platform:type:id` on social pages, `video:<id>`), so the pipeline's later detection
  of the same video keeps it (sticky AVAILABLE) instead of replacing it. For 2 minutes the session follows the page: a
  same-content URL rewrite (`&vanity=…`) moves the offer to the new URL, a same-page reset re-offers it. Consumed and
  duplicate rules are the CTA service's and the engine's.
- **Late taps.** Signed links without a readable expiry are treated as expired 2 minutes after verification by the
  pre-download gate. A direct offer tapped after 90 s has its links re-read from the page (`refreshStaleDirectSource`:
  same file by host + path; no cookie commit, the engine's probe still checks the file).

## 6. Downloads and library JS: `src/downloads/v2`, `src/store/downloads`, `src/library`

- `downloads/v2/engine-port.ts`: typed access to `VidoraMedia` (newer methods optional, so an older native build
  degrades instead of crashing). `ensure-bridge.ts` attaches once at startup: pushes the download settings (Wi-Fi-only,
  concurrency) to the engine, subscribes to its events, hydrates `listDownloads()` into the zustand store
  (`src/store/downloads`), repairs the library on foreground (`library-reconcile.ts`) and reconciles review
  completions (§8).
- `downloads/v2/handoff.ts` and `enqueue-request.ts` turn a verified browser variant into an `EnqueueRequest`;
  `actions.ts` runs retry, pause/resume/cancel, remove, rename and per-item favorites against the engine.
- `src/library`: library queries and presentation (`query.ts`, `assemble.ts`, `format-label.ts`, `mapper.ts`).
- **Favorites migration** (`src/library/favorites-migration.ts`, `ensure-favorites-migration.ts`): once per device,
  4 s after startup and after the native v1 import. A v1 download favorite moves to the library item with the same
  id; a page favorite moves to a video only when exactly one downloaded video came from that page. A page with several
  downloaded videos, a page where the user already favorited one of its videos, and a page with no download are left
  alone; nothing is un-favorited; the legacy tables are only read. MMKV
  `vidorax.mmkv.flags.favoritesPerItemMigrated.v1` is set only after success.

## 7. Player: `src/player`

- Built directly on `expo-video` 57: `useVideoPlayer`, `VideoView` with `nativeControls={false}`, events via
  `useEvent`/`useEventListener` from `expo`.
- Opens with autoplay; resumes from `src/playback/persistence.ts` (`vidorax.playback.v1:local:<id>`, unchanged
  format). Progress is saved every 5 s while playing, on pause, on background, on end, and on unmount **from refs**
  (never from a released player).
- Controls: back, orientation sheet and fullscreen on top; previous / −10 s / play-pause / +10 s / next in the
  centre; scrubber with current / total time, mute and the speed sheet at the bottom; a lock control. Picture-in-picture
  is entered automatically when the user leaves the app while a video plays (no button). Auto-hide after 3 s while
  playing. *(Not built yet, planned in Phase 20 — `docs/ROADMAP.md`: fit/fill/crop, audio and
  subtitle track menus, remaining-time toggle.)*
- Gestures: tap toggles controls; double-tap in the centre zone seeks ±10 s by left/right half and resets the zoom;
  vertical swipe on the left 25 % changes **window** brightness (no system settings permission); right 25 % changes
  media volume; pinch zooms; the lock button disables gestures. *(Long-press 2× and a play/pause double-tap are not
  built yet — Phases 20 and 16.)*
- Next/previous follow the order of the library screen the player was opened from. The player only opens local
  library files (`resolve-playback-source.ts`, by media id); network streams and files from other apps are Phase 16.
- Picture-in-picture needs manifest entries mirrored from expo-video's config plugin (this repo does not run
  prebuild). Background audio is **off**: expo-video's `ExpoVideoPlaybackService` and
  `FOREGROUND_SERVICE_MEDIA_PLAYBACK` were removed on 2026-10-01 (app.json `supportsBackgroundPlayback: false`), so
  playback pauses in the background (PiP excepted) and there is no media notification. Re-adding it (Phase 16) needs
  both manifest entries back plus the Play Console foreground-service declaration.
- **One session, two views** (`src/player/session-host`). The session (`usePlayerSession`: the native player, resume
  seek, autoplay, background/PiP pause policy, playback events) runs in `PlayerSessionHost`, mounted once in the
  `(app)` stack beside the navigator — not in the Player screen. The Player route attaches to it
  (`useFullPlayerSession(mediaId)`: reuses the running session for the same healthy media, otherwise opens a new one);
  leaving the Player collapses it into the **in-app mini player** (`src/screens/player/mini`) instead of pausing. The
  mini player attaches its own `VideoView` (textureView, no PiP) to the same player — no second player, no restart —
  docked on top of the tab bar (`tabBar` render function) on the tabs and floating at the bottom of other stack
  screens. It shows the picture, title, time, play/pause (replay when finished) and close; tap restores the full
  Player; a sideways swipe or Close ends the session (the runner unmounts: pause, `playerExited` with the last known
  position, player released). Opening another media replaces the session (new runner key → one native player per
  session, so views never pile up on one player). Visibility is a pure rule (`mini-player-policy.ts`): a playable
  session exists, no full Player shows it, no PiP window, no error (a session failing while minimised is closed).
- A view that takes the picture over from another shows nothing while the player is paused (the decoder only draws
  into a surface when it renders a frame): the mini player, and the full Player reopened from it, re-seek in place
  once attached (`useRedrawOnAttach`).
- PiP stays the full Player's: only it arms `startsPictureInPictureAutomatically` / the activity's auto-enter, and it
  disarms both when it unmounts, so leaving the app from the mini player pauses (the session's background policy).

## 8. App shell

- Routes: `(tabs)` = Browser (initial) · Downloads (badge with active count) · Library · Settings. Stack routes:
  `player/[id]`, `downloads/[id]`, settings sub-pages, legal pages.
- Startup: the native splash stays up only until fonts, theme and settings hydrate (hard timeout 2 s), then the
  branded JS splash plays and the browser renders. The launch follows the app theme (Settings → Theme: Light, Logo
  (default), Dark, System): native `splashscreen_background` #FFFFFF with a #171717 "VidoraX" wordmark
  (`drawable-*/splashscreen_logo.png`) for Light/Logo, #0D0D0D with #F5F5F5 (`values-night`, `drawable-night-*`) for
  Dark, the device's for System; then the JS splash in the same colours (`resolveSplashIntro(theme.mode)`), the
  transparent VidoraX logo on both. Android is told the choice before any app code runs next time: VidoraWeb
  `setAppNightMode` records it (`AppNightMode`, SharedPreferences) and on Android 12+ sets the per-app night mode
  (`UiModeManager.setApplicationNightMode`) that the system splash is drawn with; `MainApplication.onCreate` applies it
  with AppCompat on every start (the launch frames on Android 8–11, the window background everywhere). Until the app has
  recorded a choice (the very first launch after install) the system splash follows the device. Background services
  start after the first frame.
- One owner for Android back: the browser goes back in page history when it can; otherwise a double press exits.
- Theme defaults to Logo; System follows the device's light/dark (`resolveThemeMode(preference, deviceScheme)`).
- Sharing a link to VidoraX (`ACTION_SEND text/plain`) opens it in a browser tab. Web links opened with VidoraX
  (`VIEW` `http(s)`) belong to the browser too: `src/app/+native-intent.ts` keeps them away from the router (§5.3).
- Diagnostics: a single `src/lib/log.ts`, silent in production.
- In-app review (`src/review`): the official Google Play In-App Review flow (expo-store-review → Play `ReviewManager`),
  requested after the third genuine successful download, then at most once a week and only after a new successful
  download, and only at a calm moment — the Downloads or Player list has been showing for 2.5 s, nothing is downloading,
  the app is in front and unlocked. No rating gate; the app never assumes the sheet appeared or a review was left.
  Local state only (MMKV `vidorax.mmkv.review.inApp.v1`); a failure never touches downloads. Completions are counted
  from the native completion outbox (§3.4) at startup, on every foreground and after each live completion — each
  download once, including downloads that finished while no JavaScript ran (background runner, boot job).

## 9. Data ownership

There is no backend: everything below lives only on the user's device.

| Data | Owner | Storage |
| --- | --- | --- |
| Downloads, parts ledger, library | `vidorax-media` | native SQLite `vidorax-media.db` |
| Completions not yet counted for the in-app review | `vidorax-media` (written), JS (acknowledged) | `vidorax-media.db` `completions` |
| Media files, thumbnails | `vidorax-media` | `filesDir/library`, `filesDir/thumbs` (+ optional gallery copy) |
| Playback progress | JS | MMKV (`vidorax.playback.v1:local:<id>`) |
| Browser tabs and session | JS | MMKV |
| History, bookmarks, recent searches | JS | expo-sqlite `vidorax.db` |
| Settings, theme, App Lock | JS | MMKV / SecureStore |
| In-app review eligibility (successful-download count, last request) | JS | MMKV |
| One-time migration flags (e.g. favorites per item) | JS | MMKV |
| v1 favorites and catalog (read by the favorites migration, never written) | JS | expo-sqlite `vidorax.db` |

## 10. Testing

- **JS pure logic**: `node --test` runs `*.test.ts` directly (Node 26 type stripping). Tested modules must not
  import React Native, must use erasable TypeScript only (no `enum`, `namespace`, parameter properties), and import
  relative siblings with explicit `.ts` extensions. `npm test` runs them all.
- **Direct analyzer** (`src/media-detection/direct-analyzer/*.test.ts`): extraction (declared, JSON-LD, content-id
  ownership, related items, HLS/DASH/inline-manifest split discovery, HTML5 single video, ambiguity, invalid HTML), the
  orchestrator with fake ports (direct file, redirects, timeout/5xx/4xx, loop, unsafe, YouTube, desktop retry, player
  page, protected/live, stale, Video 1 → 2 → 3), the verifier (session retry, split, mixed/early offer, refusal
  precedence) and the publish policy (including duplicate protection through the CTA service); `PageFetcherTest`
  (JVM, MockWebServer) and `PageFetcherAndroidTest` (the device's real WebView cookie jar and User-Agent).
- **Detection**: `src/media-detection/tests/page-harness.ts` runs the real injected observer in a `node:vm` DOM;
  `dynamic-detection-pipeline.ts` drives observer → engine → verification → offer with no device;
  `navigation-lifecycle.test.ts` covers links, SPA and query-only navigation, tracking rewrites, back/forward,
  reload, iframes, delayed video, a hidden browser and several tabs.
- **Kotlin**: JVM unit tests in `modules/*/android/src/test` (HLS/DASH planners from fixture strings,
  Range/Content-Range handling, probe classification, state transitions, store migrations, and the processing layer
  through Media3's real extractors and muxers under Robolectric — `process/RemuxerTest`, `engine/DownloadEngineMergeTest`
  with ffmpeg-made fixtures in `src/test/resources/media/{process,hls-split}`) via
  `bash scripts/dev/gradle.sh :vidorax-media:testDebugUnitTest :vidorax-web:testDebugUnitTest`.
- **Instrumented** (`src/androidTest`): the real engine against an on-device MockWebServer, and the processing layer
  with the platform codecs (Transformer re-encoding, merges, remux) — every output opened in ExoPlayer.
- **End to end** (emulator): every supported container and stream layout (progressive MP4/MOV/WebM/AVI/WMV/fMP4, HLS
  TS/fMP4/separate audio/packed audio, DASH single-file/segmented/separate audio, MSE split players) through the app,
  and public pages on social sites. Supported cases must produce a playable merged/kept file; encrypted, DRM and live
  sources must be refused with their typed reason. See `docs/research/e2e-test-matrix.md`.

## 11. Removed from v1

Every-launch splash and onboarding, the 130 source-grep `verify-*` scripts, phase documents and the inert
support/report-problem flow.

Not removed (corrected 2026-09-24): new downloads go only through the native engine (§3), but v1's JS download engine
(`src/downloads/engine`, with its AsyncStorage record map) is still in the tree for v1 records and shared helpers, and
`MainApplication.kt` still registers six hand-written Kotlin packages (`mediadetection`, `player`, `intent`,
`fileactions`, `mediaexport`, `notifications`). The v1-derived general/social correlation and CTA service were kept
and hardened as the detection stack (§5); the planned replacement (`src/detection`, `src/media`) was never mounted and
was removed.
