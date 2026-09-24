# VidoraX architecture (v2)

VidoraX is an Android-first in-app browser that downloads the videos you watch, keeps them in a clean local
library, and plays them back. This document is the source of truth for how the app is built. Contracts live in
code and are referenced below; when this document and a contract file disagree, the contract file wins and this
document must be fixed.

## 1. Goals and explicit non-goals

Goals

- The following video formats can be downloaded when found in the browser:
  - **Progressive:** MP4, M4V, MOV, WebM, AVI, WMV, standalone downloadable fMP4.
  - **Streaming:** unencrypted VOD HLS (MPEG-TS and fMP4/CMAF, single-track only — no separate audio rendition
    muxing). Unencrypted static DASH whose chosen representation is one complete file — audio and video muxed, or a
    manifest that carries no audio — downloaded as exactly that file (no muxing, no segment reassembly).
  - **Extensionless URLs** when probe/verification confirms one of the above formats.
- Progressive files are streamed directly to disk with no unnecessary remuxing.
- Downloads keep running with the app in the background, the screen off, and across process death.
  Pause, resume, retry and cancel always do what they say.
- One library with a single source of truth: thumbnail, title, site, duration, resolution, size. Search, sort,
  filter by site, favorites, multi-select, rename, delete, share, open with, save to gallery.
- A clean player: autoplay, resume position, simple controls, gestures, fullscreen, picture-in-picture, speed,
  next/previous.
- The browser is usable immediately at launch.
- **Downloadable ≠ internally playable.** Some containers/codecs (e.g. AVI, WMV) may download successfully but
  rely on "Open with" / external player if the device cannot decode them natively.

Non-goals (refused, with a clear message to the user)

- DRM: Widevine/PlayReady/FairPlay, HLS `SAMPLE-AES`/non-identity `KEYFORMAT`, DASH `ContentProtection`,
  encrypted samples.
- YouTube (`youtube.com`, `youtu.be`, `googlevideo.com`): SABR streaming makes it infeasible and it violates
  YouTube's terms.
- Encrypted HLS (AES-128 or any `EXT-X-KEY METHOD` other than `NONE`).
- DASH requiring segmented downloading or audio/video muxing.
- Separate audio/video muxing of any kind (including HLS alternate audio renditions with `URI`).
- Isolated init segments or isolated media fragments without a complete downloadable stream.
- Unresolved `blob:` / MSE-only sources.
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
│  service worker requests)    │   │  OkHttp transfer · HLS/DASH planners (no muxing)    │
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
- `media3-exoplayer-dash` (`DashManifestParser` — classifying MPDs only; nothing is played or muxed with it) and
  `media3-inspector` (`MediaExtractorCompat` for library metadata). `media3-muxer`/`media3-container` are declared but
  unused. No ffmpeg, no `media3-transformer` — remuxing is out of scope.

### 3.2 Components

| Component | Responsibility |
| --- | --- |
| `VidoraMediaModule` | Expo module definition. Thin: validates input, delegates, maps errors to coded exceptions. |
| `db/MediaDatabase` | `SQLiteOpenHelper` for `vidorax-media.db` in `noBackupFilesDir`. Tables below. The **only** store of download and library state. expo-sqlite never opens this file. |
| `engine/DownloadEngine` | Application-scoped singleton. Queue, concurrency (`maxConcurrent`), Wi-Fi-only policy, retries with capped exponential backoff + jitter, state persisted **before** side effects, progress events throttled to ≤ 4 Hz per download. A verified file (progressive, HLS or DASH) that decodes with sound and no picture fails as `UNSUPPORTED_FORMAT` before it reaches the library. |
| `engine/Runner` | API 34+: one user-initiated data transfer (UIDT) `JobService` that drains the whole queue. API 24–33: one `dataSync` foreground service. Started from user actions while the app is visible; stops when the queue is empty. |
| `net/HttpClient` | One OkHttp client. Per request: tab User-Agent, Referer, Origin, extra headers (never `Cookie`/`Authorization`), `Accept-Encoding: identity`, `Range`/`If-Range`, bounded `Range` for `EXT-X-BYTERANGE`. Redirects are followed by the client itself (max 20; a loop is a permanent `NOT_MEDIA`), and every hop — plus every HLS child URL — must pass `net/UrlSafety` (public http(s) hosts only; the page detector's SSRF rule, without DNS). Cookies: the WebView session per hop when `useCookies` (`net/SessionCookies`), plus an in-memory jar of cookies the servers set during the download; nothing persisted. |
| `plan/Probe` | The one classifier: DOWNLOADABLE (`ProbeResult.Success`), PROTECTED (`DRM_PROTECTED`), UNSUPPORTED (`UNSUPPORTED_FORMAT`, `LIVE_UNSUPPORTED`, `NOT_MEDIA`, `POLICY_BLOCKED`) or transient (`NETWORK`, `HTTP_ERROR` 5xx/408/429, `HTTP_403`/`HTTP_404` = refresh from the page). Progressive: bounded 64 KiB range sniff (magic bytes win over extension/Content-Type; a 206 must start at 0; encrypted MP4/WebM → PROTECTED; an MP4 whose track list in those bytes has sound and no video → UNSUPPORTED — the audio half of a split stream is not a video). `kind: hls`, or bytes that are a playlist, go to `plan/HlsPlanner` with the request's `variant` (the engine fills in the preferred-quality setting exactly as enqueue does), so the verdict is about the variant that would be downloaded; then `HlsPlanner.confirmMedia` reads that variant's init section (fMP4) or the first 4 KiB of its first segment and refuses WebVTT, packed audio, a track list without video, and Common Encryption boxes — a media playlist found on its own can be a stream's subtitle or audio rendition. A read that fails is no verdict (the transfer re-checks the bytes). `kind: dash`, or bytes that are an MPD, go to `plan/DashPlanner`; the representation it picks is then classified by its own bytes exactly as a progressive file, so DASH is DOWNLOADABLE only when that one file is a complete, clear video. MP3/AAC/M4A(B) are named as audio files (an `M4A `/`M4B ` brand even when the track list is past the probe). YouTube hosts, HTML/JSON pages, `blob:` and inline manifests (`manifestText`) refused. |
| `plan/DashPlanner` | Media3 `DashManifestParser` over a bounded (4 MiB) fetch. Refuses: any `ContentProtection` (raw, namespace-aware scan — Media3 records nothing for a bare `mp4protection`) or DRM init data → PROTECTED; `type="dynamic"` → LIVE; several periods, an audio-only manifest, SegmentTemplate/SegmentList representations, and a video-only representation next to an audio adaptation set (it would need muxing) → UNSUPPORTED; 401/403, 404/410, 5xx and transport failures keep their transient codes. Eligible = single-file (BaseURL/SegmentBase) representation, muxed or in a manifest without audio, decodable, on a public host. Selection: `variant.videoId` exactly (a chosen ineligible one is refused, never swapped), else best ≤ `maxHeight`, else best. The engine re-reads the manifest on every run (a signed representation link that expired is renewed from it) and downloads the file with `ProgressiveTransfer`. |
| `plan/HlsPlanner` | Media3 `HlsPlaylistParser` (multivariant with its `EXT-X-DEFINE` imports, or media). Variant: `variant.videoId` exactly, else best ≤ `maxHeight`, else best decodable; a chosen variant needing separate audio is refused, never substituted. Refuses: any `EXT-X-KEY`/`EXT-X-SESSION-KEY` method other than `NONE` (decided from the tag text too — Media3 records nothing for SAMPLE-AES identity or FairPlay), DRM init data, live (no `EXT-X-ENDLIST`), `EXT-X-GAP`, audio-only, separate `TYPE=AUDIO` renditions with a URI, fMP4 that changes init section or timeline mid-stream, segments on non-public hosts. A child playlist refused 401/403 is retried once with the parent's query (token propagation). Output: an `HlsPlan` with a structure fingerprint (not token-sensitive). |
| `transfer/ProgressiveTransfer` | Streamed write to `.part` file. Resume at byte level with `Range` + `If-Range`: the validator (a strong ETag, else Last-Modified — never a weak ETag) of the response that started the `.part` is kept beside it (`download.part.validator`), so it survives pause, process death, reboot and a re-signed link. On server 200 to a ranged request, restart from zero (never append a 200 onto an existing partial). A write the disk refuses is a `StorageWriteException` (ENOSPC → `NO_SPACE`), never a network error. A superseded worker never touches the `.part`. Atomic rename on completion. |
| `transfer/HlsTransfer` | Segments appended to the download's single `.part` in playlist order; after each one the `.part` is synced and `work/<id>/hls.checkpoint` advanced (segments done, bytes, fingerprint, container — no URL, no token). Resume truncates to the checkpoint and continues at the next segment; a checkpoint for another stream restarts from zero. MPEG-TS: byte concatenation. fMP4: init once, each segment's own `sidx` renamed `free`, one global `sidx` written into space reserved after the init (`transfer/Fmp4Index`) so players get the real duration and seeking — no sample byte changes, no remux. The container is confirmed from the bytes (packed audio / subtitles refused; `plan/HlsSegmentFormat`, shared with the classifier). |
| `verify/Verifier` | Post-download validation on the bytes on disk: expected length, container magic (MPEG-TS only when an HLS download produced it), no DRM brands and no encrypted tracks in the `moov` wherever it sits (protected → `DRM_PROTECTED`, not "corrupt"). HLS output must also decode as a video (MediaExtractor) before COMPLETED. |
| `library/LibraryStore` | Library rows, queries (search, site, favorites, sort, paging), rename (title only), per-item favorites, delete (file + thumbnail; gallery copy is left alone). Missing-file repair: an item whose file is gone or empty (deleted or moved outside VidoraX) is removed with its thumbnail and announced `deleted` — at module start, on `reconcileLibrary` (Player tab focus, app foreground, pull-to-refresh, the player finding the file missing) and when an action finds the file gone. The recorded MIME type follows the container proven from the bytes (a MOV is `video/quicktime`, even when the platform says `video/mp4`). |
| `library/MediaInfo` | `MediaMetadataRetriever` for duration, width, height, rotation, codecs. |
| `library/Thumbnails` | Frame at 10% of duration (min 1 s), scaled to 480 px wide, WebP in `filesDir/thumbs/<id>.webp`. |
| `library/GalleryExport` | API 29+: `MediaStore.Video` with `RELATIVE_PATH=Movies/VidoraX/<Site>` and `IS_PENDING`. API 24–28: public `Movies/VidoraX/<Site>` + media scan; rejects with `ERR_STORAGE_PERMISSION` when `WRITE_EXTERNAL_STORAGE` is missing. |
| `library/LegacyImport` | One-time import of completed files from the old layout `filesDir/VidoraXDownloads/<id>/<file>` (id preserved so existing playback progress still matches). Skips `.part` and workspace folders, generates metadata and thumbnails, then removes empty old folders. |
| `runner/DownloadNotifications` | Channel `vidorax_downloads_progress` (low importance, ongoing: "Downloading · 6.8 MB of 13 MB · 1.2 MB/s", Pause/Cancel; Paused with Resume/Cancel; Waiting for network) and `vidorax_downloads_status` (completed; failed with Retry unless the verdict is final). Speed is the engine's 2 s window, shown only while bytes move. Tapping opens `vidorax://downloads` (a transfer) or `vidorax://library` (a finished video) — also on a cold start: `MainActivity.onNewIntent` keeps the link and the splash honours it. |
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

Private by default so the library is protected by App Lock and stays out of the gallery. "Save to gallery" per
item, or the `autoSaveToGallery` setting, publishes a copy to `Movies/VidoraX/<Site>`.

### 3.4 Tables

```sql
downloads(id TEXT PRIMARY KEY, state TEXT NOT NULL, kind TEXT NOT NULL, url TEXT NOT NULL,
          request_json TEXT NOT NULL, title TEXT NOT NULL, site TEXT NOT NULL,
          page_url TEXT, thumbnail_url TEXT, quality_label TEXT, bytes_done INTEGER NOT NULL DEFAULT 0,
          total_bytes INTEGER, error_code TEXT, error_message TEXT, attempts INTEGER NOT NULL DEFAULT 0,
          next_retry_at INTEGER, save_to_gallery INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)
-- kind: 'progressive', 'hls' or 'dash' (url = the MPD; the chosen representation file is what lands on disk).
-- No audio_url (no separate A/V mux). No manifest_text (inline manifests are refused).
-- variant_json (HLS/DASH): {"videoId": HLS playlist scheme://host/path | DASH representation id, "maxHeight": n}
-- — the choice a resume re-selects.
-- HLS resume state is NOT a table: work/<id>/hls.checkpoint beside the .part (segments done, bytes, playlist
-- fingerprint, container). Segment URLs carry tokens and are re-read from a fresh playlist on every run, so none
-- are persisted.
library(id TEXT PRIMARY KEY, title TEXT NOT NULL, site TEXT NOT NULL, page_url TEXT, source_url TEXT, file_path TEXT NOT NULL,
        mime_type TEXT NOT NULL, container TEXT NOT NULL, video_codec TEXT, audio_codec TEXT, has_audio INTEGER NOT NULL,
        width INTEGER, height INTEGER, duration_ms INTEGER, size_bytes INTEGER NOT NULL, thumb_path TEXT,
        favorite INTEGER NOT NULL DEFAULT 0, gallery_uri TEXT, created_at INTEGER NOT NULL, completed_at INTEGER NOT NULL)
completions(download_id TEXT PRIMARY KEY, completed_at INTEGER NOT NULL)   -- schema v3
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
3. The WebView `DownloadListener` → `onDownloadStart(...)`. When the hook handles it, the built-in Android
   `DownloadManager` path is skipped and JS offers the file in the download sheet.
4. The existing containment of custom schemes (`snssdk…`, app links) in `shouldOverrideUrlLoading` is kept.

The module also reads links shared to the app (`ACTION_SEND text/plain`, e.g. "Share → VidoraX" from the Instagram
or TikTok app): the launch intent through `consumeSharedText()`, later intents through `OnNewIntent` →
`onSharedText`.

The module depends on the Gradle project `:react-native-webview`; there is no reflection on the request path.

## 5. Detection: `src/media-detection` + `src/browser/media-actions`

The detection stack that runs is the v1-derived one, hardened from Phase 6 on. (A planned replacement, `src/detection`
with a document-start detector, was never mounted and was removed on 2026-09-24.) One engine singleton serves every tab.

### 5.1 Signals

- **In-page observer** (`observers/injected-script.ts`): plain JavaScript injected by `BrowserWebView` through
  `injectedJavaScriptBeforeContentLoaded` / `injectedJavaScript` (main frame; it scans same-origin subframes itself).
  Watches `<video>`/`<source>` and players (MutationObserver, capture-phase media events, IntersectionObserver
  visibility, PerformanceObserver resource entries) and `history.pushState`/`replaceState`/`popstate`; posts `ready`,
  `page_meta`, `active_video`, `active_iframe_player`, `blob_indicator`, `mutation_batch` and `scan_complete` through
  `window.ReactNativeWebView.postMessage`. `window.__VIDORAX_MEDIA_RESCAN__()`, sent with `injectJavaScript`, makes the
  page announce itself again after it was hidden or its tab parked.
- **Native network observation** (`adapters/native-network.adapter.ts` ← VidoraWeb `onNetworkMedia`): media requested
  by the page, by cross-origin iframes and by service workers, scoped to the tab and navigation epoch it was seen in
  (`adapters/native-observation-scope.ts`).
- **Blob / MSE players** (`engine/mse-playback-context.ts`, `session-media/`): a `blob:` player is offered only when a
  real HTTP(S) source for it can be proven.

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
  plus the engine's own classification (`VidoraMedia.probe`, bounded at 25 s in JS; only definitive refusals block),
  HLS by fetching and parsing the playlist (the engine classifies it again at enqueue), DASH by
  `VidoraMedia.probe({ kind: 'dash' })`. Callers asking about the same source share one verification
  (`social-source/verification-session.ts`: caller-ref-counted, aborted only when every caller has left); results are
  cached per tab + navigation + content + resource, never with cookie or authorization values.

### 5.3 The offer ("Video available")

- `browser-media-action.service.ts` keeps one CTA slice per tab. `useBrowserMediaAction.ts` verifies the page's main
  video, publishes the offer, and runs verification again (≤ 3 times per page/media key) when a newer trigger arrived
  during a run or the run was aborted. `BrowserMediaDownloadBar.tsx` shows the offer; the quality sheet lists the
  verified variants (`verified-quality-options.ts`).
- Download: `browser-media-download.service.ts` → `src/downloads/v2/handoff.ts` → `VidoraMedia.enqueue` (the engine
  classifies the exact variant again).
- Web links from other apps (`http:`, `https:`, `about:`) belong to the browser, not to the router
  (`src/app/+native-intent.ts`, `isBrowserWebLink`): a cold start opens `/`, a warm link is left to the browser's
  incoming-link handling, and `+not-found` goes back instead of redirecting — a link never mounts a second app tree.

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
- Controls: back + title + picture-in-picture + menu (speed, fit/fill, audio and subtitle tracks) on top; play/pause
  with ±10 s in the centre; scrubber with times and fullscreen at the bottom. Auto-hide after 3 s while playing.
- Gestures: tap toggles controls; double-tap left/right seeks ±10 s; vertical swipe on the left edge changes
  **window** brightness (no system settings permission); right edge changes media volume; long-press plays at 2×;
  a lock button disables gestures.
- Next/previous follow the order of the library screen the player was opened from.
- Picture-in-picture and optional background audio need manifest entries mirrored from expo-video's config plugin
  (this repo does not run prebuild).

## 8. App shell

- Routes: `(tabs)` = Browser (initial) · Downloads (badge with active count) · Library · Settings. Stack routes:
  `player/[id]`, `downloads/[id]`, settings sub-pages, legal pages.
- Startup: the native splash stays up only until fonts, theme and settings hydrate (hard timeout 2 s), then the
  browser renders. No animated splash, no onboarding on every launch. Background services start after the first
  frame.
- One owner for Android back: the browser goes back in page history when it can; otherwise a double press exits.
- Theme follows the system by default.
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
- **Detection**: `src/media-detection/tests/page-harness.ts` runs the real injected observer in a `node:vm` DOM;
  `dynamic-detection-pipeline.ts` drives observer → engine → verification → offer with no device;
  `navigation-lifecycle.test.ts` covers links, SPA and query-only navigation, tracking rewrites, back/forward,
  reload, iframes, delayed video, a hidden browser and several tabs.
- **Kotlin**: JVM unit tests in `modules/*/android/src/test` (HLS planner from m3u8 fixture strings,
  Range/Content-Range handling, probe classification, state transitions, store migrations) via
  `bash scripts/dev/gradle.sh :vidorax-media:testDebugUnitTest :vidorax-web:testDebugUnitTest`.
- **End to end** (emulator): progressive MP4, unencrypted HLS TS, unencrypted HLS fMP4 (single-track), and public
  pages on social sites. Supported cases must produce a downloadable file. Unsupported cases (encrypted HLS,
  DASH, separate A/V mux) must reject cleanly with a clear reason. See `docs/research/e2e-test-matrix.md`.

## 11. Removed from v1

Every-launch splash and onboarding, the 130 source-grep `verify-*` scripts, phase documents and the inert
support/report-problem flow.

Not removed (corrected 2026-09-24): new downloads go only through the native engine (§3), but v1's JS download engine
(`src/downloads/engine`, with its AsyncStorage record map) is still in the tree for v1 records and shared helpers, and
`MainApplication.kt` still registers six hand-written Kotlin packages (`mediadetection`, `player`, `intent`,
`fileactions`, `mediaexport`, `notifications`). The v1-derived general/social correlation and CTA service were kept
and hardened as the detection stack (§5); the planned replacement (`src/detection`, `src/media`) was never mounted and
was removed.
