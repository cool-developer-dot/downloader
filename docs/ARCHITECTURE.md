# VidoraX architecture (v2)

VidoraX is an Android-first in-app browser that downloads the videos you watch, keeps them in a clean local
library, and plays them back. This document is the source of truth for how the app is built. Contracts live in
code and are referenced below; when this document and a contract file disagree, the contract file wins and this
document must be fixed.

## 1. Goals and explicit non-goals

Goals

- Any **non-DRM** video the user can play in the browser can be saved as **one playable file with audio**:
  progressive MP4/WebM/MOV, split video+audio files, HLS (MPEG-TS and fMP4/CMAF, AES-128, alternate audio
  renditions, byte-range segments) and DASH (SegmentBase, SegmentList, SegmentTemplate, inline manifests).
- Downloads keep running with the app in the background, the screen off, and across process death.
  Pause, resume, retry and cancel always do what they say.
- One library with a single source of truth: thumbnail, title, site, duration, resolution, size. Search, sort,
  filter by site, favorites, multi-select, rename, delete, share, open with, save to gallery.
- A clean player: autoplay, resume position, simple controls, gestures, fullscreen, picture-in-picture, speed,
  next/previous.
- The browser is usable immediately at launch.

Non-goals (refused, with a clear message to the user)

- DRM: Widevine/PlayReady/FairPlay, HLS `SAMPLE-AES`/non-identity `KEYFORMAT`, DASH `ContentProtection`,
  encrypted samples.
- YouTube (`youtube.com`, `youtu.be`, `googlevideo.com`): SABR streaming makes it infeasible and it violates
  YouTube's terms.
- Live streams (v2 may add "record from now").
- Bypassing logins or paywalls. Content is only reachable when the user can already play it in the browser.

## 2. System overview

```
┌──────────────────────────── JavaScript (Expo Router, React) ────────────────────────────┐
│ Browser (src/browser)        Detection (src/detection)       Media (src/media)          │
│  tabs, omnibox, WebView  ──►  per-tab media store, resolver ──► downloads store,        │
│                               download sheet + FAB              library hooks           │
│ Player (src/player)  ◄──────────────────────────────────────── Library / Downloads UI   │
└───────────────┬───────────────────────────────┬─────────────────────────────────────────┘
                │ VidoraWeb (events, fns)        │ VidoraMedia (events, fns)
┌───────────────▼──────────────┐   ┌─────────────▼───────────────────────────────────────┐
│ modules/vidorax-web (Kotlin) │   │ modules/vidorax-media (Kotlin)                      │
│  document-start detector     │   │  probe · queue/state machine · runners (UIDT / FGS) │
│  network observer            │   │  OkHttp transfer · HLS/DASH planners · AES-128      │
│  WebView download handoff    │   │  remux (Media3 extractors → Mp4Muxer)               │
│  cookies flush · intents     │   │  library DB · thumbnails · gallery export · notifs  │
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

- `androidx.media3:media3-muxer`, `media3-inspector` (`MediaExtractorCompat`), `media3-exoplayer-hls`
  (`HlsPlaylistParser`), `media3-exoplayer-dash` (`DashManifestParser`, `DashUtil`), `media3-datasource-okhttp`,
  `media3-container` (`Mp4OrientationData`), `media3-common` (`MediaFormatUtil`).
- `com.squareup.okhttp3:okhttp` 4.x (already in the APK via React Native).
- No ffmpeg.

### 3.2 Components

| Component | Responsibility |
| --- | --- |
| `VidoraMediaModule` | Expo module definition. Thin: validates input, delegates, maps errors to coded exceptions. |
| `db/MediaDatabase` | `SQLiteOpenHelper` for `vidorax-media.db` in `noBackupFilesDir`. Tables below. The **only** store of download and library state. expo-sqlite never opens this file. |
| `engine/DownloadEngine` | Application-scoped singleton. Queue, concurrency (`maxConcurrent`), Wi-Fi-only policy, retries with capped exponential backoff + jitter, state persisted **before** side effects, progress events throttled to ≤ 4 Hz per download. |
| `engine/Runner` | API 34+: one user-initiated data transfer (UIDT) `JobService` that drains the whole queue. API 24–33: one `dataSync` foreground service. Started from user actions while the app is visible; stops when the queue is empty. |
| `net/Http` | One OkHttp client. Per request: tab User-Agent, Referer, Origin, extra headers, `Cookie` from `CookieManager.getCookie(requestUrl)` when `useCookies`. `Accept-Encoding: identity` for media. Resume with `Range` + `If-Range`. 403/410 on a previously working signed URL → `SOURCE_EXPIRED`. |
| `plan/Probe` | Sniffs a URL (Content-Type, extension, first bytes): progressive container, HLS, DASH, HTML/JSON error page. For manifests returns variants and audio tracks, DRM/live flags. |
| `plan/HlsPlanner` | Media3 `HlsPlaylistParser`. Variant by preferred height then bandwidth, filtered by decodable codecs. `EXT-X-MEDIA TYPE=AUDIO` rendition with `URI` → second track to mux. AES-128 key + IV (explicit or media sequence). `EXT-X-BYTERANGE`, `EXT-X-MAP`, discontinuity groups. Refuses `SAMPLE-AES*`, non-identity `KEYFORMAT`, live playlists. |
| `plan/DashPlanner` | Media3 `DashManifestParser` (URL or inline XML). Best decodable video + best audio in the first period. `SegmentBase` → one whole file per representation; `SegmentList`/`SegmentTemplate` → segment list via `DashSegmentIndex`. Refuses `dynamic` and `ContentProtection`. |
| `transfer/*` | Streamed writes only. Progressive files resume at byte level. Segments download 3–4 in parallel per host, decrypt AES-128 while streaming, and resume at segment granularity via the `parts` ledger. Segment files are written to `*.part` then renamed. |
| `mux/Remuxer` | `MediaExtractorCompat` → `Mp4Muxer` (sample copy, no re-encode). One timebase for all tracks (min PTS over the first GOP), leading non-key video frames dropped, per-discontinuity-group offsets, rotation kept via `Mp4OrientationData`. VP8/Vorbis → `WebmMuxer`. Audio codecs Mp4Muxer can't write (MP3, AC-3, E-AC-3): keep a playable original container when possible (single progressive file, concatenated `.ts`) instead of failing. Output validated by re-opening it (track count, duration, A/V start delta). |
| `library/LibraryStore` | Library rows, queries (search, site, favorites, sort, paging), rename (title only), favorites, delete (file + thumbnail; gallery copy is left alone). |
| `library/MediaInfo` | `MediaMetadataRetriever` for duration, width, height, rotation; codecs recorded from the remux formats. |
| `library/Thumbnails` | Frame at 10% of duration (min 1 s), scaled to 480 px wide, WebP in `filesDir/thumbs/<id>.webp`. |
| `library/GalleryExport` | API 29+: `MediaStore.Video` with `RELATIVE_PATH=Movies/VidoraX/<Site>` and `IS_PENDING`. API 24–28: public `Movies/VidoraX/<Site>` + media scan; rejects with `ERR_STORAGE_PERMISSION` when `WRITE_EXTERNAL_STORAGE` is missing. |
| `library/LegacyImport` | One-time import of completed files from the old layout `filesDir/VidoraXDownloads/<id>/<file>` (id preserved so existing playback progress still matches). Skips `.part` and workspace folders, generates metadata and thumbnails, then removes empty old folders. |
| `notify/Notifications` | Channel `vidorax_downloads` (low importance, ongoing progress with Pause/Resume/Cancel actions) and `vidorax_download_events` (completed / failed). Tapping opens `vidorax://downloads` or `vidorax://player/<id>`. |
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
downloads(id TEXT PRIMARY KEY, state TEXT NOT NULL, kind TEXT NOT NULL, url TEXT NOT NULL, audio_url TEXT,
          manifest_text TEXT, variant_json TEXT, request_json TEXT NOT NULL, title TEXT NOT NULL, site TEXT NOT NULL,
          page_url TEXT, thumbnail_url TEXT, quality_label TEXT, bytes_done INTEGER NOT NULL DEFAULT 0,
          total_bytes INTEGER, error_code TEXT, error_message TEXT, attempts INTEGER NOT NULL DEFAULT 0,
          next_retry_at INTEGER, save_to_gallery INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)
parts(download_id TEXT NOT NULL REFERENCES downloads(id) ON DELETE CASCADE, track TEXT NOT NULL, idx INTEGER NOT NULL,
      url TEXT NOT NULL, byte_offset INTEGER, byte_length INTEGER, key_uri TEXT, iv TEXT, disc_group INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL, bytes_done INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(download_id, track, idx))
library(id TEXT PRIMARY KEY, title TEXT NOT NULL, site TEXT NOT NULL, page_url TEXT, source_url TEXT, file_path TEXT NOT NULL,
        mime_type TEXT NOT NULL, container TEXT NOT NULL, video_codec TEXT, audio_codec TEXT, has_audio INTEGER NOT NULL,
        width INTEGER, height INTEGER, duration_ms INTEGER, size_bytes INTEGER NOT NULL, thumb_path TEXT,
        favorite INTEGER NOT NULL DEFAULT 0, gallery_uri TEXT, created_at INTEGER NOT NULL, completed_at INTEGER NOT NULL)
```

Request context (`request_json`) contains User-Agent, Referer, Origin and extra headers, never cookie values.

### 3.5 Download state machine

```
queued → probing → downloading ⇄ paused
                        │  ⇅ waiting_network (Wi-Fi-only / offline)
                        │  ⇅ waiting_retry   (transient error, backoff)
                        ▼
                   processing (mux / remux / metadata / thumbnail / optional gallery export)
                        ▼
                   completed          failed(code)    cancelled
```

- On engine start, `downloading`/`probing`/`processing` rows with no live worker become `queued` (they resume from
  the parts ledger).
- `retry` is allowed from `failed`; `resume` from `paused`; `cancel` from any non-terminal state and deletes temp
  files. `completed` rows stay in `downloads` for 24 h for the Downloads screen, then are pruned (the library row
  remains).

## 4. Native module: `modules/vidorax-web`

Contract: `modules/vidorax-web/src/VidoraWeb.types.ts`. Kotlin package `com.vidorax.web`.

`scripts/patch-react-native-webview.js` (runs at `postinstall`, idempotent, **fails the install loudly** when an
anchor is not found) adds a `RNCWebViewHooks` class to react-native-webview and calls it from:

1. `RNCWebViewManagerImpl.createViewInstance` → `onWebViewCreated(webView)`. The module adds the detector with
   `WebViewCompat.addDocumentStartJavaScript(webView, script, setOf("*"))` before any page loads, so it runs before
   page scripts in every frame, including cross-origin iframes.
2. `RNCWebViewClient.shouldInterceptRequest` → `observe(view, request)`. Lock-free cheap prefilter, dedupe (URL
   without byte-range params, 2 s window), batched `onNetworkMedia` events every 250 ms. Never returns a response.
   Skips YouTube/googlevideo hosts.
3. The WebView `DownloadListener` → `onDownloadStart(...)`. When the hook handles it, the built-in Android
   `DownloadManager` path is skipped and JS offers the file in the download sheet.
4. The existing containment of custom schemes (`snssdk…`, app links) in `shouldOverrideUrlLoading` is kept.

The module also reads links shared to the app (`ACTION_SEND text/plain`, e.g. "Share → VidoraX" from the Instagram
or TikTok app): the launch intent through `consumeSharedText()`, later intents through `OnNewIntent` →
`onSharedText`.

The module depends on the Gradle project `:react-native-webview`; there is no reflection on the request path.

## 5. Detection: `src/detection`

Contract: `src/detection/types.ts`.

### 5.1 In-page detector (`src/detection/page`)

- Plain JavaScript (ES2017, no imports) so it runs in old WebViews. Source files are concatenated inside one IIFE by
  `scripts/build-detector.mjs` into `src/detection/page/detector.generated.ts` (committed). The same concatenated
  source is loaded into a Node `vm` context by tests.
- Guarded by `window.__vdx`, idempotent. Posts versioned messages (`ch: 'vdx'`) through
  `window.ReactNativeWebView.postMessage`, queueing until that object exists.
- Signals, in order of value:
  1. **Response taps**: wraps `fetch` and `XMLHttpRequest`. Reads bodies only for allowlisted endpoints
     (`/graphql`, `/api/`, item/feed endpoints, `.json`, player config) or JSON / `mpegurl` / `dash+xml` content
     types. 4 MB cap, parsing off the hot path. `#EXTM3U` and `<MPD` bodies become manifest candidates.
  2. **Embedded JSON**: `__UNIVERSAL_DATA_FOR_REHYDRATION__`, `__NEXT_DATA__`, `script[data-sjs]`, JSON-LD
     `VideoObject`, other `application/json` scripts ≤ 2 MB. Rescanned (debounced) after SPA navigation.
  3. **Site extractors** (pure functions): Instagram (`video_versions`, `video_dash_manifest`, `has_audio`),
     Facebook (`browser_native_hd_url`, `playable_url_quality_hd`, `progressive_urls`, `dash_manifest(s)`),
     TikTok (`playAddr`, `bitrateInfo`; `downloadAddr` marked watermarked), X (`video_info.variants`),
     Reddit (`reddit_video`), Vimeo (player config), Twitch clips, Pinterest (`video_list`), Snapchat
     (`snapUrls.mediaUrl`), JW Player, generic (`og:video`, JSON-LD, `<video>`/`<source>`, `data-sources`).
  4. **Players**: `<video>` elements (non-blob `currentSrc` becomes a candidate; blob players report poster,
     duration, size, playing and visible ratio as ranking hints), `MediaSource.addSourceBuffer` codecs.
  5. **DRM guard**: wraps `navigator.requestMediaKeySystemAccess`.
- On YouTube hosts it posts `policy: youtube` and does nothing else.

### 5.2 JS side

- `store.ts` (zustand): `TabMedia` per tab. A tab's items are cleared **only** when a new top-level document starts
  loading (not on SPA navigation, not on tab switch). Max 60 items per tab.
- `network.ts`: maps native observations to tabs through the view tag → tab registry, strips byte-range params
  (`bytestart`, `byteend`, `range`, `rn`, `rbuf`), turns manifests and progressive files into `url:` items;
  segments are hints, not items.
- `resolve.ts`: lazily turns an item into `DownloadOption`s (probe manifests for variants, progressive size/type),
  dedupes equal options, ranks items: matches current page content > playing/visible player > has audio >
  height > bitrate. Split A/V becomes one option with `needsMux`.
- `ui/`: a floating download button above the browser toolbar with a count badge, and a bottom sheet listing the
  videos on the page. Each item shows thumbnail, title, site and duration; tapping shows qualities
  (`1080p · MP4 · 42 MB`) and a primary **Download best** action. Unsupported items stay visible, greyed, with the
  reason.

## 6. Media JS: `src/media`

- `api.ts`: typed access to `VidoraMedia` (from `modules/vidorax-media`).
- `downloads.store.ts` (zustand): records and progress keyed by id, hydrated with `listDownloads()`, kept in sync
  by events. Components subscribe per id.
- `library.ts`: `useLibrary(query)` (paged, refetches on `onLibraryChange`), `useLibraryItem(id)`,
  `useLibrarySiteCounts()`.
- `settings.ts`: download settings persisted in MMKV and pushed to native at startup and on change.
- Migration: after native `LegacyImport`, old favorites (expo-sqlite) are applied with `setFavorite`, then the old
  catalog tables and the AsyncStorage download map are dropped.

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
- Sharing a link to VidoraX (`ACTION_SEND text/plain`) opens it in a browser tab.
- Diagnostics: a single `src/lib/log.ts`, silent in production.

## 9. Data ownership

| Data | Owner | Storage |
| --- | --- | --- |
| Downloads, parts ledger, library | `vidorax-media` | native SQLite `vidorax-media.db` |
| Media files, thumbnails | `vidorax-media` | `filesDir/library`, `filesDir/thumbs` (+ optional gallery copy) |
| Playback progress | JS | MMKV (`vidorax.playback.v1:local:<id>`) |
| Browser tabs and session | JS | MMKV |
| History, bookmarks, recent searches | JS | expo-sqlite `vidorax.db` |
| Settings, theme, App Lock | JS | MMKV / SecureStore |

## 10. Testing

- **JS pure logic**: `node --test` runs `*.test.ts` directly (Node 26 type stripping). Tested modules must not
  import React Native, must use erasable TypeScript only (no `enum`, `namespace`, parameter properties), and import
  relative siblings with explicit `.ts` extensions. `npm test` runs them all.
- **Detector**: the concatenated page source runs in a `vm` context with fixture JSON/HTML per site
  (`src/detection/page/__fixtures__`).
- **Kotlin**: JVM unit tests in `modules/*/android/src/test` (planners from m3u8/mpd fixture strings, IV derivation,
  Range/Content-Range handling, state transitions) via `./gradlew :vidorax-media:testDebugUnitTest`.
- **End to end** (emulator): progressive MP4, HLS TS, HLS fMP4 with separate audio, AES-128 HLS, DASH, and public
  pages on social sites; each must produce a file that plays with audio in the in-app player.

## 11. Removed from v1

Every-launch splash and onboarding, the JS transfer/HLS engine, the social/general correlation and "CTA" state
machines, AsyncStorage download persistence, the 130 source-grep `verify-*` scripts, phase documents, the inert
support/report-problem flow, and the hand-registered Kotlin packages (their working parts moved into the two
modules).
