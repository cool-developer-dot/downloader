# VidoraX v2 — handoff / current state

Read this first. It is written for an AI assistant picking up this project cold, in a new
session or a different model, with no prior conversation memory. It is kept up to date at
every pause point — if you are resuming work, update it again before you stop.

Companion documents (read these next, in this order):
1. `docs/ARCHITECTURE.md` — the target design: every module, its files, its responsibilities,
   data ownership, and the state machines. This is the spec you implement against.
2. Contracts (fixed interfaces between the pieces being built in parallel):
   - `modules/vidorax-media/src/VidoraMedia.types.ts` — JS ⇄ native download/library API
   - `modules/vidorax-web/src/VidoraWeb.types.ts` — JS ⇄ native WebView hooks API
   - `src/media-detection/adapters/native-network.contract.ts` and
     `src/media-detection/observers/injected-script.ts` — native network observations and the in-page observer's
     messages (the old `src/detection/types.ts` contract was removed with its never-mounted module, §4.15)
3. `docs/research/` — point-in-time research, kept only as reference (see "Research" below).

---

## 1. What this app is

VidoraX (`/Users/mac/Downloads/vidorax-mobile`) is an Android-first Expo/React Native app:
an in-app browser that detects videos on whatever page the user is viewing (social apps like
Instagram/TikTok, or any website) and downloads them, plus a local library and video player.

**Owner's request, verbatim intent:** the existing app ("v1") is broken and over-engineered.
Fix everything. Download video of *any* format from *anything* browsed. Keep downloaded video
organized cleanly. Make the player, controls and UX clean. The owner granted full autonomy
over technical decisions ("up to you") and permission to use subagents, but asked not to spawn
them unnecessarily.

**Explicit product goals** (from `docs/ARCHITECTURE.md` §1):
- The following formats can be downloaded: progressive MP4/M4V/MOV/WebM/AVI/WMV, standalone
  downloadable fMP4, extensionless URLs when verified, and unencrypted VOD HLS (MPEG-TS and
  fMP4/CMAF, single-track only). Progressive files stream directly to disk with no remux.
  Downloadable ≠ internally playable — some containers may need "Open with" / external player.
- Downloads survive backgrounding, screen-off, and process death. Pause/resume/retry/cancel
  actually work.
- One library, single source of truth: thumbnail, title, site, duration, resolution, size.
  Search, sort, filter by site, favorites, multi-select, rename, delete, share, open-with,
  save-to-gallery.
- A clean player: autoplay, resume position, simple controls, gestures, fullscreen, PiP,
  speed, next/previous.
- The browser is usable immediately at launch (no long splash/onboarding).

**Explicit non-goals** (refused with a clear message):
- DRM (Widevine/PlayReady/FairPlay, encrypted samples of any kind).
- YouTube (`youtube.com`, `youtu.be`, `*.googlevideo.com`) — SABR streaming makes plain
  capture infeasible in 2026, and it violates YouTube's ToS.
- Encrypted HLS (AES-128 or any `EXT-X-KEY METHOD` other than `NONE`).
- DASH requiring segmented downloading or audio/video muxing.
- Separate audio/video muxing of any kind (including HLS alternate audio renditions).
- Isolated init segments or isolated media fragments without a complete stream.
- Unresolved `blob:` / MSE-only sources.
- Live streams (a v2+ idea: "record from now"; not in scope now).
- Bypassing logins/paywalls — only content the user can already play in the browser.

**Stack:** Expo SDK 57, React Native 0.86 (New Architecture, Hermes, React Compiler on),
Android-first (iOS not a current target). Native Kotlin Android modules under `modules/`.
**Do not run `npx expo prebuild`** — this repo hand-maintains `android/` and now also
`modules/*/android`; prebuild can destroy that.

---

## 2. Why v1 was scrapped, in one paragraph per finding

A 9-way parallel audit (full JSON: `docs/research/v1-audit.json`) read every subsystem and
ran the app on an emulator. Findings that drove the rewrite decision:
- **Separate A/V and DASH were out of reach.** v1 refused HLS with separate audio and all
  DASH (`VIDEO_ONLY_UNSUPPORTED`/`DASH_UNSUPPORTED`). v2 also treats these as out of scope
  (per the product contract) but rejects them cleanly with a user-facing reason instead of
  silently failing.
- **No background survival.** No foreground service, WorkManager, or user-initiated job.
  Downloads are JS promises; leaving the app or turning the screen off kills them. The
  Android controller referenced a native module that was never written.
- **Large files freeze the UI.** Every byte crosses the JS thread twice; merge/commit are
  synchronous whole-file copies; finalize needs 2-3x free disk; long faststart MP4s get
  deleted at 100% by an over-strict prefix sniffer.
- **Pause/resume/retry is actually broken.** Append-range resume discards progress on every
  re-pause; the dominant transfer path deletes the partial file on any transient network
  error and restarts from zero; stall timeouts are misread as user cancels.
- **Detection loses the video the user is watching.** Candidates are wiped on every SPA
  navigation and tab switch; native network observations are dropped after reload due to an
  epoch mismatch; JSON API responses (where Instagram/TikTok/Facebook/X/Reddit actually put
  the playable URLs) are thrown away — the native filter explicitly rejects `/api`,
  `/graphql`, `.json`.
- **Player is unreliable.** Resume position is reset to 0 on every exit (reads
  `player.currentTime` after the player is already released); every player open requests
  `WRITE_SETTINGS` for brightness, kicking the user to Android system settings; playback
  never auto-starts; audio-only files hang forever on "Preparing" because controls are gated
  on first video frame.
- **Startup is slow and confusing.** ~5 seconds of splash + 3-page onboarding on *every*
  launch, and the onboarding-complete flag is written but never read.
- **Bloat.** 139K lines of TS, 130 `verify-*.ts` scripts that are mostly source-text
  `.includes()` assertions (not real tests) pinning the broken behavior in place, dozens of
  "phase"/"week"/"hardening" architecture docs.

Several things in v1 *were* good and their ideas were carried into v2 (see
`keepWorthy` arrays inside `docs/research/v1-audit.json` per subsystem) — e.g. the pure URL
classifier, the intent:// resolver, the HLS playlist parser, the MediaStore export pattern,
the App Lock crypto/policy core, the Urdu localization. The rewrite reuses these ideas/files
where noted in track briefs below, it did not throw away everything indiscriminately.

Two research reports back the technical design (kept in `docs/research/`, see §7):
- `site-video-delivery.md` — how each platform (Instagram, Facebook, TikTok, X, Reddit,
  Vimeo, Twitch, Pinterest, Snapchat, generic HTML5, player libraries) actually delivers
  video in 2026, with a per-site table of where the URLs live, whether audio is separate,
  and what headers/cookies are required.
- `android-native-media.md` — Android implementation brief covering the broader media surface
  (Media3 muxer/extractor, DASH, AES-128 — **OUT OF CURRENT PRODUCT SCOPE**). Use selectively
  for HLS playlist parsing, OkHttp transfer, background execution rules (Android 14-16),
  MediaStore, Expo SDK 57 module authoring, react-native-webview 13.16 internals.

---

## 3. Target architecture (summary — full detail in `docs/ARCHITECTURE.md`)

> **2026-09-24:** the detection and media-JS parts of this original target were not built as described. The
> document-start detector, `src/detection/` and `src/media/` were never mounted and have been removed (§4.15). What
> runs: detection = `src/media-detection` + `src/browser/media-actions` (the v1-derived stack, hardened from Phase 6
> on); downloads/library JS = `src/downloads/v2` + `src/library` + `src/store/downloads`. `docs/ARCHITECTURE.md`
> §2 and §4–§6 describe the current design. Below, the `vidorax-media` summary still holds; `vidorax-web` no longer
> injects any document-start script.

Guiding rule: **native (Kotlin) owns everything that touches media bytes, files, background
execution and download state. JavaScript owns UI, detection ranking, and user choices.**

```
JS: Browser → Detection (per-tab store + resolver + download sheet) → Media (downloads store,
    library hooks) → Player, Library/Downloads UI
Native: modules/vidorax-web (WebView hooks: document-start detector injection, passive network
    observation, download handoff, cookies, shared-link intents)
Native: modules/vidorax-media (probe → HLS planner (unencrypted VOD) → transfer → verify →
    library → thumbnails → gallery export → background runners → notifications)
```

Two native Expo local modules, autolinked **without** `expo prebuild` (via `modules/*/expo-
module.config.json`, matching the pattern of `node_modules/expo-video`):

- **`modules/vidorax-media`** (`com.vidorax.media`) — SQLite DB (`vidorax-media.db`), download
  state machine, format-allowlist probe (progressive MP4/M4V/MOV/WebM/AVI/WMV/fMP4 or
  unencrypted VOD HLS; everything else rejected), HLS playlist parsing (via
  `androidx.media3.exoplayer.hls.playlist.HlsPlaylistParser`, NOT a hand-rolled parser),
  progressive direct-to-disk transfer with Range resume, HLS segment concatenation with
  per-segment checkpoint, post-download verification, library store, thumbnails, gallery
  export, background runners (API 34+ user-initiated data transfer job; API 24-33 `dataSync`
  foreground service), notifications. No remuxing, no DASH, no AES-128 decrypt, no ffmpeg.
  **Critical pinning rule:** every Media3 artifact must be at exactly the same version as
  `expo-video` bundles (currently **1.9.0**, see `node_modules/expo-video/android/build.gradle`)
  — mixed Media3 versions crash at runtime.
- **`modules/vidorax-web`** (`com.vidorax.web`) — patches `react-native-webview` via a
  postinstall script (`scripts/patch-react-native-webview.js`, replacing v1's
  `scripts/apply-webview-media-hook.js`) to add a static hook interface (no reflection, no
  locks) called from WebView creation (document-start script injection into every frame via
  `WebViewCompat.addDocumentStartJavaScript`), `shouldInterceptRequest` (passive network
  observation), and the `DownloadListener` (web-triggered file downloads). Also flushes
  cookies, launches `intent://` URIs safely, and reads shared links (`ACTION_SEND`).

JS detection (`src/detection/`) has three layers:
1. `src/detection/page/` — plain ES2017 JS (no imports/modules — must run unmodified inside
   the WebView) concatenated by `scripts/build-detector.mjs` into one generated file
   (`detector.generated.ts`, exports `DETECTOR_SCRIPT: string`). Hooks fetch/XHR response
   bodies (only for allowlisted endpoints or json/mpegurl/dash+xml content types — this is
   the fix for v1 throwing away API JSON), embedded JSON (`__NEXT_DATA__`,
   `__UNIVERSAL_DATA_FOR_REHYDRATION__`, `data-sjs`, JSON-LD), per-site extractors
   (Instagram/Facebook/TikTok/X/Reddit/Vimeo/Twitch/Pinterest/Snapchat/JW/generic), DOM
   `<video>`/`og:video`, and a DRM guard. Posts structured `DetectorMessage`s via
   `window.ReactNativeWebView.postMessage`.
2. `src/detection/` (everything except `page/`) — validates untrusted messages, a per-tab
   zustand store that is **not** wiped on SPA navigation or tab switch (only on a genuine new
   top-level document load — this is the fix for v1 losing the video the user is watching),
   a resolver that turns a raw candidate into downloadable `DownloadOption[]` (calling
   native `probe()` for supported formats; unsupported formats shown greyed with reason),
   and the download-button + bottom-sheet UI.
3. Native network observation (`modules/vidorax-web`) feeds the same store as a secondary,
   URL-only signal (catches plain progressive/manifest URLs the page-JS layer might miss).

`src/media/` is the JS side of the download engine and library: thin wrappers over the
`VidoraMedia` native module (zustand stores, hooks, settings, one-time v1→v2 data migration),
plus the Downloads/Library/Storage/Settings screens.

`src/player/` + `src/playback/` + `src/screens/player/` is a from-scratch player on
`expo-video` 57 (`useVideoPlayer`, custom controls, no native player controls) fixing every
v1 player bug listed in §2.

Full file-by-file layout, every Kotlin class's responsibility, the exact SQL schema, the
download state machine diagram, and the player's gesture/control spec are all in
`docs/ARCHITECTURE.md` — that document is authoritative; this handoff is a status report on
top of it.

---

## 4. Exact current state (as of commit `38dcf8b`, branch `overhaul`)

Git: `main` is untouched at the original v1 commit (`bfe38ea`). All v2 work is on branch
`overhaul`. Not pushed to `origin` (a real GitHub remote exists:
`cool-developer-dot/downloader.git`, but nothing has been pushed there this project).
`overhaul` is 8 commits ahead of the point it branched from (`517331c`, which itself is a
checkpoint of the user's own uncommitted pre-rewrite edits — preserved, not lost).

Working tree is clean (`git status` → nothing to commit) as of this writing. *(Later note: everything from Phase 6
on — §4.5 to §4.15 — is uncommitted on top of `e394dab`; read those sections for the current state.)*

### 4.1 Done and verified

- **Groundwork** (commit `3fb182d` and around it): `docs/ARCHITECTURE.md` written; the three
  contract files created; per-area localization catalog files scaffolded
  (`src/localization/catalogs/{shell,detection,media,videoPlayer}.{en,ur}.ts`, wired into
  `en.ts`/`ur.ts`); manifest updated (PiP, expo-video playback service, share-link intent,
  narrowed storage permissions to API ≤28 only); 130 `verify-*.ts` scripts and stale phase
  docs deleted; `scripts/dev/gradle.sh` added (serializes concurrent Gradle invocations across
  parallel agents/sessions via a lock directory — **always** build through this script, never
  call `./gradlew` directly, while multiple agents may be touching native code).
- **`modules/vidorax-media` stage 1** (scaffold + library + DB + module wiring): confirmed by
  its own agent to compile, pass 46 JVM tests, and get `:app:assembleDebug` past autolinking.
  Present: `expo-module.config.json`, `android/build.gradle` (Media3 1.9.0 pinned, okhttp
  4.12.0, junit/mockwebserver/org.json test deps), module `AndroidManifest.xml`, a
  `FileProvider`, `MediaErrors.kt`, `MediaServices.kt`, `VidoraMediaModule.kt` (implements the
  full library/file/volume/storage surface of the contract; `probe/enqueue/pause/resume/
  retry/cancel/removeDownload/pauseAll/resumeAll/listDownloads/setDownloadSettings/
  clearTempFiles` currently reject with `ERR_INVALID_STATE` via `engine/DownloadEngineApi` +
  `DownloadEngineProvider`, pending stage 3), `db/{Schema,MediaDatabase}.kt`, `bridge/
  {JsValues,Records}.kt`, `model/{ContractValues,Downloads,Library}.kt`, `library/
  {LibrarySql,LibraryStore,MediaTypes,FileNames,StoragePaths,LegacyLayout,LegacyImport,
  MediaInfo,Thumbnails,GalleryExport,StorageUsage,Titles}.kt`, `files/{FileActions,
  VidoraFileProvider}.kt`, `player/Volume.kt`. Ten JVM test files under `android/src/test`.
  **This has not been re-verified since the agent's own report** — re-run
  `bash scripts/dev/gradle.sh :vidorax-media:testDebugUnitTest :app:assembleDebug` before
  trusting it as still green (other tracks may have since touched things that affect the
  app-level build, e.g. `MainApplication.kt`, though nothing has as of this commit).
- **`modules/vidorax-web`** (native module + webview patch): confirmed by its own agent to
  compile. Present: `scripts/patch-react-native-webview.js` (+ `.test.mjs`) replacing
  `scripts/apply-webview-media-hook.js` (deleted); `expo-module.config.json`; `android/
  build.gradle`; `VidoraWebModule.kt`; `DocumentStartScripts.kt`; `IntentUris.kt`;
  `SharedText.kt`; `network/{NetworkMediaClassifier,NetworkMediaObserver,RecentKeys,
  ServiceWorkerRequests}.kt`. Three JVM test files. **Not yet wired into the browser or
  exercised on a device/emulator.** *(2026-09-24: `DocumentStartScripts.kt` and its `setDetectorScript` API were
  removed — only the never-mounted `src/detection` runtime ever set a script; §4.15.)*
- **tsconfig correctness** (commit `38dcf8b`, this session): fixed the root `tsconfig.json`'s
  `**/*.ts` include pattern matching MPEG-TS video test fixtures (files literally named
  `*.ts` containing binary transport-stream data under `modules/vidorax-media/android/src/
  test/resources/`) and reporting them as TypeScript syntax errors (49 phantom errors);
  excluded `modules/**/android` and `modules/**/ios` from the app tsconfig, and moved the
  Node-only `src/detection/page/test-harness.ts` to the test tsconfig where it type-checks
  cleanly. This was a false alarm, not a real regression — no functional code was wrong.

### 4.2 Partial (files exist, feature incomplete — do not assume these work end-to-end)

> **2026-09-24:** `src/detection/**`, `src/media/**`, `scripts/build-detector.mjs` and the `media.*` localization
> catalogs described below were never mounted by the app and were removed as dead scaffolding (§4.15); that also
> removed the 2 old test failures and the 17 TypeScript errors. The bullets are kept as history only. What runs is
> `src/media-detection` + `src/browser/media-actions` (detection) and `src/downloads/v2` + `src/library` +
> `src/store/downloads` (downloads/library).

- **`modules/vidorax-media` stage 2 (the actual download pipeline)** — **effectively not
  started.** Only test fixture media files (`android/src/test/resources/media/{progressive,
  hls-ts,hls-fmp4}/*`) and one `plan/ToolchainSmokeTest.kt` exist. There is **no** `net/`,
  `plan/{Probe,HlsPlanner}.kt`, `transfer/`, or `verify/` yet. This is the single most
  important unfinished piece — without it, nothing can actually be downloaded.
  **Contract-scoped stage 2** (per `docs/ARCHITECTURE.md` §3.2): `net/Http` (OkHttp, Range +
  If-Range), `plan/Probe` (format-allowlist classifier), `transfer/ProgressiveTransfer`
  (direct-to-disk with `.part` and resume), `verify/Verifier` (post-download validation),
  `plan/HlsPlanner` (Media3 `HlsPlaylistParser`, unencrypted VOD only, single-track only),
  `transfer/HlsTransfer` (segment concatenation with checkpoint/resume). **Not in scope:**
  `DashPlanner`, AES-128 decrypt, `Remuxer`/`Mp4Muxer`, separate A/V combining. Read
  `docs/ARCHITECTURE.md` §3.2 before starting.
- **`src/detection/`** (everything outside `page/`) — messages.ts, url.ts, store.ts
  (`tab-state.ts`), network.ts, resolve.ts, ranking.ts, options.ts, enqueue.ts, runtime.ts all
  exist with `.test.ts` siblings. **123 tests pass, 0 fail** (verified this session). Likely
  close to done for its scope, but has **not been reviewed** and has **not been wired into
  the browser** (no `DetectionHost`/`MediaFab`/`MediaSheet` UI components were confirmed to
  exist — check `src/detection/` for a `ui/` subfolder or similar before assuming the sheet
  UI was built; the track brief asked for it but completion wasn't independently confirmed).
- **`src/detection/page/`** (in-page detector) — `src/*.js` (14 files: `main.js`,
  `transport.js`, `network-taps.js`, `bodies.js`, `manifest.js`, `embedded.js`, `candidates.js`,
  `players.js`, `drm.js`, `navigation.js`, `util.js`, and per-site
  `site-{facebook,instagram,jwplayer,pinterest,reddit,snapchat,tiktok,twitch,twitter,
  vimeo}.js`), `detector.generated.ts` (built output), fixtures for 9 sites, and 5 `.test.ts`
  files. Generic/X(twitter)/no site file for "generic" — check `site-generic.js` is present
  (it is, per the file list). **Tests for this specific subfolder were not separately
  re-verified this session** (they're included in the 123-passing count above via
  `src/detection/page/*.test.ts` — confirmed passing).
- **`src/media/`** (downloads/library JS logic) — `format`, `sites`, `error-messages`,
  `download-sections`, `library-query`, `continue-watching`, `legacy-metadata`,
  `settings-schema`, each with a `.test.ts`. **57 tests, 55 pass, 2 fail** (verified this
  session: `describeDownloadFailure` and `actionErrorMessageKey maps contract rejection
  codes` in `error-messages.test.ts`). **Root cause confirmed, not yet fixed:**
  `src/localization/catalogs/media.en.ts` and `media.ur.ts` are still empty stub objects
  (`export const mediaEn = {} as const;`) — `error-messages.ts` references keys like
  `media.failure.network`, `media.errors.notFound`, etc. that don't exist yet, so at runtime
  the translation helper falls back to a humanized-key string instead of real copy, which is
  what the 2 failing tests catch. **Fix:** write the actual English strings (and real Urdu
  translations — this project maintains a genuine bilingual UI, not machine-translated
  placeholders) into those two files. No downloads/library stores (`downloads.store.ts`,
  `library.ts`, `settings.ts`, `migration.ts`, `MediaServicesHost.tsx`), and no screens
  (Downloads tab, Library tab, Download Settings, Storage) were confirmed built — only the
  pure-logic layer above exists.
- **Localization:** `shell.en.ts`/`shell.ur.ts` and `videoPlayer.en.ts`/`videoPlayer.ur.ts`
  are still empty stubs too (confirmed by line count: 5 and 4 lines respectively, i.e. just
  the `export const x = {} as const;` scaffold). Only `detection.en.ts`/`detection.ur.ts` have
  real content (confirmed populated with fab/sheet/option/reason/error strings, English and
  Urdu, in this session via the file-change notices at the top of this conversation).

### 4.3 Not started at all

- **`modules/vidorax-media` stage 3**: `engine/DownloadEngine` (the actual state-machine
  implementation of `DownloadEngineApi`), `runner/` (API 34+ UIDT job / API 24-33 foreground
  service), `notify/` (progress + completion notifications), wiring the engine into
  `VidoraMediaModule`, and — only after the new engine works — deleting the v1 native
  packages (`android/app/src/main/java/com/anonymous/vidorax/{player,fileactions,
  mediaexport,notifications,mediadetection,intent}/**`, `native/**`,
  `scripts/apply-player-native-modules.js`) and the 6 manual package registrations in
  `MainApplication.kt`. **Do not delete v1 native code before stage 3 confirms the
  replacement works** — v1's Kotlin modules (file actions, notifications, media export,
  volume) are still what's running in the app today for anything outside the new modules.
- **Shell track**: startup/splash/onboarding removal, browser bug fixes (Android back
  handling, stuck-spinner retry, popups replacing the page instead of opening tabs,
  fullscreen video, desktop-site simplification, cookie flush on background, App Lock
  recovery-code lockout bug), tabs layout (Browser/Downloads/Library/Settings), Settings
  screen cleanup, App Lock fix. Nothing in `src/browser/`, `src/app/`, `src/screens/`
  (outside downloads/library/player which don't exist yet either) has changed from v1 as far
  as this session confirmed — **the old splash/onboarding/browser bugs are still live in the
  working tree right now.**
- **Browser integration**: mounting the detection UI into `BrowserScreen`, routing
  `onMessage` to the detector, registering WebView tags, deleting `src/media-detection/**`
  and `src/browser/media-actions/**` (the v1 detection stack — **still present and still
  what the app uses today**), share-to-app wiring.
- **Player rewrite**: `src/player/**`, `src/playback/**`, `src/screens/player/**` are all
  still v1 code with all the bugs listed in §2.
- **Media UI screens**: Downloads tab, Library tab, Download Settings, Storage screen — not
  built (only the pure-logic `src/media/*.ts` files behind them exist, per §4.2).
- **Independent review passes** for every track (native, browser+detection, player, media
  UI) — planned in the original workflow design but never reached because of the usage-limit
  interruption and the pause request. Budget time for these before considering any track
  "done" — they were designed to catch real defects (races, resume correctness, gesture
  conflicts, Expo module API misuse), not style issues.
- **On-device end-to-end testing** — a test matrix of live public URLs was prepared and
  verified live on 2026-09-15 (`docs/research/e2e-test-matrix.md`). Supported cases:
  progressive MP4, HLS-TS (single-track), HLS-fMP4 (single-track), Vimeo. Unsupported cases
  (HLS-fMP4-with-separate-audio, HLS-AES-128, DASH) converted to clean-rejection tests.
  **No download has actually been attempted end-to-end yet** — there is no working pipeline
  to test (see §4.2, stage 2).

### 4.4 What this means practically

**The app in its current working-tree state does not yet do anything differently from v1 at
runtime.** All the new code is additive (new files under `modules/` and `src/detection/` and
`src/media/`) and has not been wired into the app's actual UI or Kotlin registration yet — v1's
browser, detection, player, and download engine are all still what runs when the app launches.
The rewrite is real progress on the *foundation* (contracts, native module skeletons, pure
logic, research) but is not yet an improvement a user could see or use. Don't report partial
completion as "the app now downloads videos" — it doesn't yet.

### 4.5 Phase 6 — browser video detection → "Video available" (uncommitted, 2026-09-17)

Status `BROWSER_VIDEO_DETECTION_PHASE6_VERIFIED`, with the limits below. Nothing is committed.
The v2 DownloadEngine hand-off (tap CTA → enqueue) is Phase 7 and is **not** wired.

- **Active runtime path (decided):** v1 `src/media-detection/**` + `src/browser/media-actions/**`
  is the production detector. v2 `src/detection/**` has no importers (dead; do not mount a
  third stack). Native requests: patched react-native-webview → `RNCWebViewHooks` →
  `modules/vidorax-web` `NetworkMediaObserver` → `VidoraWeb.onNetworkMedia` →
  `adapters/native-network.adapter.ts`. The v1 `MediaNetworkBridge`/`VidoraMediaNetworkObserverModule`
  Kotlin files are deleted (the hook no longer called them, so native media never reached JS).
- **CTA invariant:** a verified offer is published only for STRONG/MEDIUM current-content
  ownership (general and social paths alike). WEAK waits without probing; ownership changes
  re-run selection through `hooks/discovery-selection.ts` (`buildOwnershipKey`, uSES).
- **Generic fixes (all unit-tested):** origin-based request provenance for iframe → CDN
  (cross-origin Referers are origin-only); bounded MP4 top-level box walk
  (`resource/mp4-box-walk.ts`) for faststart files whose `moov` exceeds the 16 KB probe;
  identity-scoped verification abort; service-worker requests attributed by unique page origin;
  offscreen/idle-video and tiny-muted-loop rules; `useBrowserEngine` via uSES (React Compiler
  had cached the noop controller → every native candidate STALE_GENERATION); detection follows
  the tab navigation epoch on reload/same-URL load/tab switch (`hooks/detection-navigation-sync.ts`);
  observations are stamped before dedupe so a rotated signed URL or a reload re-scopes the
  existing candidate (`MediaObservationStamp`).
- **Device evidence (emulator, real debug app, logged out):** control w3schools, local fixtures
  (iframe-cdn, ad-frame, direct-extless, offscreen-preload, SPA feed, blob/MSE, reload), a public
  Instagram reel (including Instagram auto-advancing ~24 reels) and two public TikTok videos all
  behave as specified. Dailymotion `x9cv1hw` delivers no media behind its sign-up wall
  (`MEDIA_NOT_DELIVERED_IN_CURRENT_PAGE_STATE`, no login attempted by design).
- **Known limits:** service-worker end-to-end CTA untested on device (http fixtures are not a
  secure context; `localhost` pages are dropped by the private-network guard, correctly);
  emulator video rendering saturates the UI thread (~1 fps HWUI frames), and WebView
  `onMessage` is dispatched on that thread, so SPA transitions took 15–50 s there — measure on a
  physical device before judging latency.
- **Tests:** `npm test` (the script now registers `scripts/test/register-app-modules.mjs` so
  `node --test` can import app TS) — 261 pass, 2 pre-existing `src/media/error-messages` failures
  (§4.2). `bash scripts/dev/gradle.sh :vidorax-web:testDebugUnitTest` — 16 pass.

### 4.6 Phase 7 — CTA → v2 DownloadEngine → Downloads → Library (uncommitted, 2026-09-17)

Status `PHASE7_V2_UI_HANDOFF_VERIFIED`. Nothing is committed. The browser's "Video available" now downloads
through the native v2 engine; no JavaScript transfer runs for those downloads.

- **Replacement point:** the browser's two handoffs (`enqueueBrowserMediaDownload` for a single verified variant
  and `useQualitySelection.confirmDownload` when the CTA opened the quality sheet) call
  `enqueueVerifiedBrowserVariant` → `handOffVerifiedVariant` → `VidoraMedia.enqueue`. The v1 pre-download gate and
  social/page URL refresh were dropped from those two paths: the exact verified variant is enqueued, and the
  engine reports `SOURCE_EXPIRED` itself. `useDownloadsStore.create` (paste-link "Add download" on Home/Downloads)
  still uses the v1 engine, because v2 has no HLS transfer yet.
- **New module `src/downloads/v2/`:** `engine-port` (injectable native port), `enqueue-request` (pure request
  builder + format safety: HLS/DASH/audio-only/segments/blob never reach the progressive engine), `handoff`
  (stale-offer check, one enqueue per variant, no v1 fallback), `projection` (v2 record + library item → the
  existing `DownloadItem`/transfer-snapshot shapes), `store-reducer` (mirror + filtered view), `bridge`/
  `ensure-bridge` (hydrate from `listDownloads` + `listLibrary`, then live state/progress/library events),
  `actions` (pause/resume/retry/cancel/remove), `library-files` (the `files/library/**` guard for playback and
  file actions). 10 test files cover the required Phase 7 cases.
- **One store, one state:** v2 rows live in `engineRowsById` inside the existing downloads store (never persisted
  in JS, never written to the v1 catalog). v1 writers (`upsertItem`, `patchItem`, transfer snapshots, catalog
  pages, v1 recovery) are ignored for those ids; only the folder assignment stays app-side.
- **Completed items:** Library, Play, Open, Share, Save-to-device and Delete route v2 ids to the native module
  (`openWith`, `share`, `saveToGallery`, `deleteLibraryItems` + `removeDownload`). The v1 managed-path guards
  describe v1's own folders, so the v2 library root has its own check.
- **Device evidence (emulator, real debug app):** CTA → Downloads row → live progress → pause → ranged resume →
  verify/finalize → COMPLETED → Library → playback; the downloaded files match the fixture sources byte-for-byte;
  three rapid taps enqueue once; a restart restores the rows without duplicates; deleting removes the row and the
  file; an HLS offer stays detected but refuses with "This video streams in a format VidoraX can't download yet".
  No `VidoraXDownloads/<id>` folder exists for any v2 download.
- **Tests:** `npm test` — 293 pass, the same 2 pre-existing `src/media/error-messages` failures; `npx tsc
  --noEmit` for both projects adds no new errors; `git diff --check` clean. No native code changed in Phase 7.
- **Pause/Resume (fixed 2026-09-18):** `DownloadEngine.pause`/`cancel` now stop the worker and wait for it
  (`stopWorker`: cancel + bounded join), `launchWorker` joins any previous worker so one download is ever only one
  worker, and repeated Pause/Resume taps are no-ops instead of `ERR_INVALID_STATE`. `ProgressiveTransfer` aborts a
  read that is waiting on the socket by closing the body **on its own daemon thread** — closing it on the thread
  that cancels blocks that thread inside OkHttp, which is what made `VidoraMedia.pause()` never resolve and left
  the row's buttons disabled. Resume continues from the physical `.part` length (`Range: bytes=<len>-`), and a
  server that answers a ranged request with `200` still restarts safely from zero.
- **Known gaps:** thumbnails are null for engine downloads (native task); the v1 player still asks for
  WRITE_SETTINGS on open (pre-existing §2 bug). Background execution and notifications were closed by Phase 8
  (§4.7).

---

### 4.7 Phase 8 — background downloads + Android notifications (uncommitted, 2026-09-18)

Status `PHASE8_BACKGROUND_NOTIFICATIONS_VERIFIED`. Nothing is committed. v2 downloads now survive backgrounding,
screen-off and process restart, and they are visible as notifications.

- **The gap that was closed:** the engine ran only on `MediaServices.scope` (a process-scoped
  `CoroutineScope`). Nothing told Android the process was doing user-visible work, so a backgrounded app was
  eligible for the cached-app freezer and for being killed, and no notification existed at all.
- **New package `modules/vidorax-media/.../runner/`:** `DownloadRunner` (pure coordinator: engine state →
  "must a host run" + "what does the user see"), `DownloadNotificationContent` (pure state → notification
  mapping, byte/percent formatting, deterministic notification ids), `DownloadNotifications` (posts them),
  `AndroidRunnerHost` (picks the platform mechanism), `DownloadTransferJobService` (API 34+ user-initiated data
  transfer job), `DownloadForegroundService` (`dataSync` foreground service below 34), `BackgroundDownloads`
  (the process-wide seam). Wired once in `DownloadEngineProvider.build`, which also moved the engine's
  `restore()` there so the runner subscribes before reconciliation and then adopts its rows.
- **One runner, never a second engine:** the runner only *observes* `stateChanges`/`progress`. It never starts,
  resumes or cancels a transfer, so the engine's generation/single-worker guarantees are untouched. The job and
  the foreground service are mutually exclusive and idempotent (`start` twice starts one component).
- **Notification model:** the runner holds one ongoing notification (`SUMMARY_NOTIFICATION_ID`). While exactly
  one download is live that notification *is* that download (title + "Downloading · 6.8 MB of 13 MB" + percent),
  so nothing is shown twice; with two or more it becomes "Downloading N videos" and every live download also
  gets its own. Paused, completed and failed downloads always keep their own notification, on a separate
  "Finished downloads" channel for the terminal ones. Nothing is grouped: a group summary that Android removes
  at job end takes its children with it, which is exactly how the first device run lost its completion
  notification. Notification text comes only from the persisted record — never a URL, token or header.
- **Permission:** the browser handoff asks for POST_NOTIFICATIONS once per app run, right after an accepted
  enqueue (`src/downloads/v2/notification-permission.ts`). A denial is never a gate: `DownloadNotifications`
  posts nothing, the transfer and the Downloads screen are unaffected, and the runner still keeps the process
  alive (verified on device).
- **Device evidence (emulator API 35, real debug app):** transfer continues backgrounded and with the screen
  off (`mWakefulness=Asleep`, +4.0 MB in 22 s at full speed); notification tracks live progress; pause freezes
  the bytes in the background and shows a dismissible "Paused"; resume continues from the `.part`; completion
  in the background posts one completion notification and one Library item whose md5 matches the fixture;
  cancel removes the notification and the work folder; two concurrent downloads keep separate notifications
  under an aggregate; `am kill` cannot kill the process while the job runs; after `force-stop` the next launch
  resumes from the physical `.part` with no duplicate row; killing the fixture server produces "Download
  failed: network error" with no URL in it. The `dataSync` path was verified the same way by temporarily
  forcing it (only an API 35 emulator exists on this machine).
- **Tests:** 19 new JVM tests (`runner/DownloadRunnerTest`, `runner/DownloadNotificationsTest` under
  Robolectric) covering the 10 required cases; native suite 171 tests / 0 failures; `npm test` 296 pass with
  the same 2 pre-existing `src/media/error-messages` failures; `tsc` adds no new errors; `git diff --check`
  clean.
- **Known limits:** a true low-memory kill with the job surviving could not be simulated (no root on this
  emulator image); Android 15+ caps `dataSync` runtime, so `onTimeout` stops that service (the API 34+ job path
  is not affected). Notification actions and per-screen deep links were added in Phase 9 (§4.8).

---

### 4.8 Phase 9 — core product completion & reliability (uncommitted, 2026-09-19)

Status `PHASE9_CORE_PRODUCT_COMPLETION_VERIFIED`. Nothing is committed. 27 audited items: 4 were already done,
the rest fixed or built. The engine, stores and detection are the Phase 6–8 ones throughout.

- **Engine reliability (`DownloadEngine`).** New ports `NetworkGate` and `FreeSpace`, plus a `Slots` gate:
  - Wi-Fi-only and "no connection" are now states, not failures: a download waits in `WAITING_NETWORK` and
    resumes from its `.part` by itself. A transfer that is *already running* is stopped when the connection
    stops being one it may use (`awaitUnusable`), which is what makes Wi-Fi-only a promise rather than a
    preference.
  - A dropped connection is waited out up to five times with backoff before the download is called failed.
  - A volume that cannot hold the file is refused before the first byte (`NO_SPACE`), and an `ENOSPC` write is
    reported as "not enough storage" instead of a generic storage error.
  - A signed link that expires mid-transfer is re-probed **once** and continues from the bytes on disk; when the
    re-probe fails too, the row says "This link expired. Open the page again and start the download from there."
  - `maxConcurrent` is enforced: extra downloads stay `QUEUED` until a slot frees, and a paused queued download
    releases its place.
  - Settings are persisted natively (SharedPreferences), so a download resumed at boot obeys Wi-Fi-only before
    any JavaScript has run. `src/downloads/v2/settings.ts` pushes the app's preferences into the engine.
- **Boot recovery.** `DownloadBootReceiver` → `DownloadBootJobService`. A plain JobScheduler job, deliberately:
  Android 15 refuses a `dataSync` foreground service started from `BOOT_COMPLETED` (observed on device), and a
  user-initiated transfer job may only be scheduled from the foreground.
- **Notifications.** Pause / Resume / Retry / Cancel buttons (`DownloadActionReceiver` → the same engine calls
  the app's buttons make), and tapping a notification opens the screen it is about — `vidorax://downloads` for a
  transfer, `vidorax://library` for a finished video. The runner's own notification carries the buttons when it
  stands for a single download. Every action icon is a platform drawable: a null icon is dropped by the system UI.
- **Thumbnails.** The engine now writes the library thumbnail it always had the code for (`ThumbnailMaker` port
  → `Thumbnails`), and `normalizeThumbnailUri` accepts VidoraX's own `files/thumbs/<id>.webp` so the lists show
  it. A video with no decodable frame still completes.
- **Downloads vs Player.** Removing a finished download from Downloads no longer deletes it: `removeEngineDownload`
  drops the record only, and a video that exists solely as a library item is marked `libraryOnly` so it lives in
  Player and never reappears in the Downloads list. The confirmation says exactly that.
- **Player.** The Library tab is called **Player**; it opens "On this device" (`listDeviceVideos` over MediaStore,
  read-only, permission-gated) and plays those `content://` videos in the app's own player. A finished download the
  user just started plays by itself (`autoplay.ts`), and the player no longer asks for WRITE_SETTINGS — window
  brightness never needed it.
- **Browser.** VidoraX can be the device's browser: `http`/`https` intent filters, `DefaultBrowser` (ROLE_BROWSER)
  and a Settings row. Incoming links — a share or a web link — now actually open in a tab
  (`incoming-link.service.ts`); the native plumbing existed but nothing consumed it. The CTA rises into place and
  its icon pulses while preparing, and a second tap on the same video says "Already in your downloads".
- **Startup.** The intro plays on first launch only: `resolvePostSplashRoute` honours `onboardingComplete`, and
  the app store no longer writes its defaults over the persisted flag before hydration (`persist-guard.ts`) —
  that pre-hydration write is why the intro kept coming back. The launch window follows the theme
  (`values/colors.xml` + `values-night/`), so the app no longer opens on a colour it is about to replace.
- **Device evidence (emulator API 35, debug build):** Wi-Fi dropped mid-download → "Waiting for network", bytes
  frozen, automatic resume on Wi-Fi return; a real reboot → boot job → resumed from the `.part` → md5 matches the
  fixture; Pause/Resume from the notification; notification taps landing on Downloads and Player; WebM downloaded,
  verified and played; device videos listed and played; save-to-device visible in MediaStore; favourite → Favorites;
  remove keeps the video in Player; intro once; white/dark launch window per theme; Instagram reel downloaded
  end-to-end with a thumbnail and auto-play.
- **Known limits:** SD-card/removable storage is unverified (the only emulator has no removable volume, so nothing
  was shipped for it); MKV/MOV are not playable by the Android WebView, so no CTA is published for them (the
  engine and the JS gate accept them when a page does deliver them); TikTok's CDN links can expire before the
  transfer starts, which now fails truthfully instead of hanging.

---

### 4.9 Phase 11A — dynamic media detection reliability (uncommitted, 2026-09-20)

Status `PHASE11A_DYNAMIC_DETECTION_VERIFIED`. Nothing is committed. No second detector was built: the Phase 6
detector (`src/media-detection/observers/injected-script.ts` + `engine/media-detection.engine.ts`) was audited
against the live pipeline and five paths where late media was silently lost were fixed.

- **Root causes found (each reproduced through the real pipeline before fixing):**
  1. *Incomplete media lifecycle events.* Only `loadedmetadata` / `play` / `playing` / `loadeddata` were observed.
     A player that attaches its resource through `<source>` selection or a property assignment produces no
     attribute mutation and may never re-fire those, so `loadstart` / `durationchange` / `canplay` were the only
     notice and nothing listened. `<audio>` was ignored by the play listeners entirely.
  2. *SPA route changes dropped candidates.* `handlePageMeta` returned before its own SPA-repair branch (dead
     code), so the page's authoritative new `location.href` was discarded; `handleBatch` / `handleCandidate` then
     rejected the new route's candidates. When no active-player evidence arrived first (click-to-play, hidden or
     not-yet-laid-out player) the new route's media was lost **permanently**, because the page's `seen` cache
     produces each candidate exactly once.
  3. *Same-origin subframe media was never a candidate.* `scanDom()` queried only the top document and the media
     listeners were top-document only, so an embedded same-origin player's URL only ever produced *evidence*.
  4. *Teardown was irreversible.* `cleanup()` on `pagehide` disconnected everything but left
     `window.__VIDORAX_MEDIA_DETECTION__ = true`, so the WebView's re-injection on a back/forward restore
     returned immediately and the restored document had no observers at all.
  5. *`flush()` lost candidates.* It took `slice(0, maxBatch)` and then cleared `pending` outright, and a `post()`
     refused by the per-window throttle discarded the whole batch. Both losses are permanent for the same
     `seen`-cache reason.
- **Fixes (two files):** `observers/injected-script.ts` — `loadstart`/`durationchange`/`canplay` added and all
  media listeners registered through one idempotent `attachMediaListeners(doc)`; `scanDom()` also walks
  same-origin subframe documents (bounded by the existing `MAX_TRACKED_IFRAMES`) and wires their listeners;
  observers moved into `attachObservers()`/`detachObservers()` so `cleanup()` is reversible, the re-entry guard is
  released on `pagehide` and a bfcache `pageshow` re-arms; `post()` reports delivery and `flush()` keeps the
  overflow (bounded at 4 batches) and re-arms instead of dropping. `engine/media-detection.engine.ts` — one
  `adoptObservationPageUrl()` rule, extracted from the existing `handleActiveVideo` repair, now used by
  page_meta, mutation batches, single candidates and both active-player paths.
- **Invariants kept:** Phase 10 batching/debounce/throttle caps are unchanged (the caps now defer rather than
  drop); no duplicate observer or listener registration; no site-specific code; `blob:` is still never a
  downloadable URL; the private-host / URL-safety guards are untouched; ownership ranking, the downloader, and
  HLS/DASH handling were not modified.
- **Tests:** a new harness runs the real injected script in `node:vm` against a DOM
  (`src/media-detection/tests/page-harness.ts`) and pipes what it posts into the real engine, correlation and
  verification (`tests/dynamic-detection-pipeline.ts`); `tests/dynamic-detection.test.ts` covers all 11 required
  cases plus the five regressions, 21/21 pass. `npm test` — 369 tests, 367 pass, the same 2 pre-existing
  `src/media/error-messages` failures (§4.2). `tsc` for both projects reports nothing outside those same
  pre-existing `error-messages` keys. `git diff --check` clean.
- **Device evidence (emulator API 35, debug build, real app):** on public pages, each dynamic flow reached a
  visible "Video available" — JS-created video, delayed player init, inserted `<source>`, src change (offer
  re-targeted), recycled/replaced elements, lazy-load after scroll, same-origin iframe player created later,
  extensionless media behind a redirect (resolved by the MIME probe, `redirectCount: 1`, `video/mp4`,
  991017 bytes), and an SPA `pushState` route whose new player never plays. Navigating to a new document cleared
  the CTA with nothing stale published, and after navigating away and pressing Back a newly added video was
  observed, verified and offered again.
- **Testing note for next time:** the emulator cannot host fixture pages at `10.0.2.2` — `isSafeMediaUrl` rejects
  RFC1918 hosts, so every bridge message carrying that `pageUrl` is dropped at the adapter (correctly). Drive
  dynamic cases on a *public* page instead; the WebView's own devtools socket
  (`adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>` + `Runtime.evaluate`) can perform the DOM
  mutations, which the detector cannot distinguish from the page's own script.
- **Known limits / deferred:** `blob:`/MSE resolution is Phase 11B and untouched — a blob-backed player still only
  raises the MSE indicator. Main-video vs ad ranking is Phase 11C; the existing ownership rules were not
  retuned. A cross-origin player frame's media still arrives only through native request observation (by design —
  the page script cannot read that frame); the JS suite covers it and the same-origin case is covered on device.
  Hotlink-protected sources (w3schools' `mov_bbb.mp4` answers 403 to the verifier) are detected and correlated
  but correctly publish no CTA, because the source cannot be fetched.

---

### 4.10 Phase 11B — blob / MediaSource → real HTTP(S) source resolution (uncommitted, 2026-09-20)

Status `PHASE11B_BLOB_SOURCE_RESOLUTION_VERIFIED`. Nothing is committed. No second resolver: the Phase 6/11A
detector, native request observation, correlation and verification are the ones used throughout.

- **What already worked (do not "fix" it again):** an active blob player plus a whole-file HTTP(S) request on
  the same page already resolved and published an offer — `correlateGeneralCandidate` has a MEDIUM floor for
  exactly that. The premise "blob → detected → rejected" was only true for the cases below.
- **Root causes found:**
  1. *No protection classification at all for blob/MSE players.* `mediaFromElement` returns early on a `blob:`
     src, so `isDrm` (MediaKeys / the `encrypted` event) never left the page for the players where EME is
     actually used, and `blob_indicator` carried no protection state. An encrypted MSE player therefore still
     produced a **downloadable offer** built from an unrelated HTTP(S) request on the same page.
  2. *Blob/MSE state was process-global.* `mse-playback-context.ts` held one slot keyed only by page URL: two
     tabs collided, it was not cleared on a route change or a replaced player, and it was marked with the
     engine's page URL rather than the payload's — breaking the Phase 11A tab/epoch/generation rule.
  3. *No UNSUPPORTED outcome.* A segments-only or silent blob player was indistinguishable from "still
     looking", so the product could never say the stream has no downloadable source.
  4. *The `URL.createObjectURL` hook missed MediaSource.* It tested `obj.type`, which a `MediaSource` does not
     have — so the canonical MSE case never produced the earliest, most reliable signal.
- **Fixes:** the page now reports protection (`mediaKeys`, the `encrypted` event, and an observed
  `requestMediaKeySystemAccess` negotiation — observation only, no key system is created or inspected) and the
  source kind on both `blob_indicator` and `active_video`, and recognises a MediaSource by `addSourceBuffer`.
  `engine/mse-playback-context.ts` is now a bounded per-tab store (tab + epoch + page generation + player
  element, max 8 tabs) holding protection, segment counts and whole-source counts, plus a pure
  `classifyMsePlayback()` returning NONE / PENDING / RESOLVABLE / PROTECTED / UNSUPPORTED. The engine scopes
  every sighting, clears it on navigation, tab change and browser error, and records each observed request as
  `segment` or `whole` before the segment blocklist discards it. `useBrowserMediaAction` consults the
  classifier **before** verification, so a protected player never reaches the verifier, and withdraws a
  standing offer through the new `browserMediaActionService.invalidateProtectedOffer()` as soon as protection
  is proven — that check runs ahead of the "already verified this candidate" shortcut. `MSE_UNSUPPORTED` was
  added to the PROVEN_UNSUPPORTED taxonomy, and the MSE state is part of `buildOwnershipKey`, so protection
  appearing re-runs selection and verification like any other ownership change.
- **Never done:** no DRM bypass, no license or key-system access, no encrypted-HLS decryption, no MSE stream
  reconstruction, `blob:` is still never a candidate or a download target, and the URL / private-network
  guards are untouched. "Unsupported" is only ever said from evidence (≥3 segment sightings after a 2.5 s
  settle, or 12 s of silence); anything less stays transient, because "not seen yet" must never be reported as
  "cannot be downloaded".
- **Tests:** `src/media-detection/tests/blob-source-resolution.test.ts` — 16 cases through the real pipeline
  (blob→MP4, MediaSource recognition, iframe blob player, JS-generated blob player, MP4 and WebM underlying
  sources, encrypted player, EME-negotiation-only, segments-only, silent player, late whole-file source beating
  an earlier verdict, stale previous-page request, per-tab isolation, sticky protection). Three new service
  tests cover protected-offer withdrawal. `npm test` — 388 tests, 386 pass, the same 2 pre-existing
  `src/media/error-messages` failures (§4.2). `tsc` clean for both projects outside those same pre-existing
  keys. `git diff --check` clean.
- **Device evidence (emulator API 35, debug build, real app, public page):** a genuine blob player built from a
  real cross-origin fetch resolved to `cdn.jsdelivr.net` (`video/mp4`, 5510872 bytes, `transport: progressive`)
  and published "Video available" — the blob URL itself never appeared as a candidate. A real `MediaSource`
  player was recognised (`identityKind: 'mse-player'`) and, fed only init/segment requests, produced no offer.
  Real ClearKey EME negotiation (`requestMediaKeySystemAccess`, granted on device) marked the player
  `reason: 'PROTECTED'` and published nothing, and negotiating EME on a page that *already* had a CTA withdrew
  it.
- **Known limits / Phase 11C:** main-video vs ad ranking is still untouched — when several blob players are on
  one page, the existing ownership rules pick the owner. Segment-to-stream reassembly stays out of scope (no
  HLS/DASH downloader here), so a segmented MSE stream is reported as unsupported rather than rebuilt. A
  cross-origin player frame's media still arrives only through native request observation, by design.

---

### 4.11 Phase 11C — main video selection + signed/session source reliability (uncommitted, 2026-09-23)

Status `PHASE11C_MAIN_VIDEO_AND_SOURCE_RELIABILITY_VERIFIED`. Nothing is committed. Same pipeline throughout;
no second selector or resolver was built.

- **Root causes found:**
  1. *The offer ignored which video the user was watching.* `selectPreferredVariant` ranked by audio state,
     height then bitrate only. Correlation picked the right candidate, but when the active set held more than
     one resource (a preroll ad, or a larger second player) the **offer** went to whichever was biggest —
     reproduced: ad plays, main video takes over, `selected()` follows it, the published offer stayed the ad.
  2. *No freshness check before enqueue on the browser CTA path.* `handOffVerifiedVariant` handed over the URL
     verified when the CTA appeared, with no expiry check, no re-probe, no redirect resolution and no refresh —
     `buildV2EnqueueRequest` is explicitly pure. A signed URL with `Expires=` ten minutes in the past enqueued
     `ok: true`. `runPreDownloadGate` + `refreshMediaFromPage` already existed but were wired only to the
     paste-link path (dropped from the browser paths in Phase 7, §4.6).
  3. *Retry blindly re-probed the dead URL.* Native `retry()` → `probeOrFail(row.url)` with the same stored
     URL, so retrying an expired link looped.
  4. *`useCookies` was never implemented.* The contract says cookies come from `CookieManager` per request. The
     native `HttpClient` has no cookie jar, never reads `ctx.useCookies`, and strips `Cookie` — so every
     session-bound download went out with no session at all. **This was the TikTok failure.**
- **Fixes:** `selectPreferredVariant` takes the ownership pass's chosen source (`ownedResourceUrl`) and only
  that video's variants compete, with quality ranking still deciding between *its* renditions; both offer
  builders and `useBrowserMediaAction` thread it through. New `src/downloads/v2/source-refresh.ts` confirms the
  source right before the handoff: the live detection store's newest URL for the same resource first (free — a
  rotated signature is already there), then a network re-confirmation only when the URL looks expiring or the
  offer is older than 20 s (so Phase 10 is preserved), then one refresh-and-retry, then an honest
  `SOURCE_EXPIRED` with "Open the video page again to refresh the download link."; `enqueueVerifiedBrowserVariant`
  enqueues the redirect-resolved `finalUrl` with the session headers intact. `retryEngineDownload` never sends a
  known-expired source back to the engine: it asks the live page first and otherwise refuses with the same
  message. `net/SessionCookies.kt` implements `useCookies` as an OkHttp network interceptor reading
  `CookieManager` per hop at send time (so redirects and retries get the right, current cookies), and a public
  download never reads the jar at all.
- **Audited and found already correct:** User-Agent, Referer and `useCookies` all reach the engine request
  intact; mid-transfer expiry is re-probed once and continues from the `.part` (Phase 8, native tests).
- **TikTok — the actual failure stage:** detected ✓ → CTA ✓ → JS verification ✓ (offer time *and* tap time) →
  **native transfer refused HTTP 403**. Not expiry, not a stale candidate, not the wrong candidate, not
  redirects: the download carried no session because `useCookies` was ignored. After the fix the same video
  went `queued → probing → downloading → processing → completed` and landed as
  `files/library/tiktok/TikTok - Make Your Day_950ed97b.mp4`, auto-playing in the Player.
- **Tests:** `source-refresh.test.ts` (9), `main-video-selection.test.ts` (6, through the real pipeline),
  retry-policy cases in `actions.test.ts` (4), `SessionCookiesTest.kt` (5). `npm test` — 407 tests, 405 pass,
  the same 2 pre-existing `src/media/error-messages` failures (§4.2). Native — `vidorax-media` 197/0,
  `vidorax-web` 16/0. `tsc` clean for both projects outside those pre-existing keys. `git diff --check` clean.
- **Known limits:** Instagram could not be taken through a *fresh* end-to-end download today — its logged-out
  web wall ("Sign up to keep watching") stops playback within a few seconds on every entry point tried
  (reel permalink, `/reels/`, `/explore/`, topic grid), so ownership never holds long enough to publish a CTA.
  That is the Phase 6 CTA invariant behaving correctly, not a regression: detection, candidate ingestion
  (`scontent-*.cdninstagram.com`, `video/mp4`, signed, correct Referer, correlation 1.35–1.41) and verification
  all still run, and no new rejection appears. No account was used, by design. Retry-with-refresh re-enqueues as
  a new row because the native contract has no "update this download's URL" call; adding one would let a retry
  keep its `.part` bytes.

---

### 4.12 Phase 12A — HTTP resolution + protection classification + unencrypted VOD HLS (uncommitted, 2026-09-23)

Status `PHASE12A_HTTP_HLS_PROTECTION_VERIFIED`. Nothing is committed. Same pipeline throughout (Phase 6/11 detection
and verification → v2 `DownloadEngine` → runner/notifications → library → Player); no second engine or resolver.

- **Root causes / gaps found:** (1) no HLS at all — `probeOrFail` refused every non-progressive source and JS refused
  HLS with `HLS_NOT_YET_SUPPORTED`; (2) a 5xx/network blip during the probe, or a 5xx mid-transfer, failed the download
  at once, and the network-retry budget never refilled even while bytes kept arriving; (3) redirects were followed
  inside OkHttp with no private-network check per hop, and a redirect loop surfaced as a network error; (4) every
  FAILED row offered Retry (protected/live included), a non-downloadable option was refused as "no longer available",
  and the notification's Pause on waiting states was rejected by the engine; (5) `ProgressiveTransfer` could truncate
  the `.part` from a superseded worker returning from a slow request; (6) the request context sent a static "Android
  14 / Chrome 131" UA although the WebView browses with the stock system UA, and an observed `Origin` was dropped;
  (7) RN `fetch` silently shares the WebView cookie jar, so a cookie-bound source verified as "public" and the engine
  then went out without the session (403, reproduced on device); (8) found with Apple's public fMP4 example (separate
  audio + subtitles): the sheet preselected the stream's audio-only rendition file (`a1/main.mp4`, served as
  `video/mp4`) and the engine saved it to the library as a "video" with no picture, and a subtitle playlist offered
  as HLS was classified DOWNLOADABLE (the planner never looked at the bytes), enqueued, and only failed at transfer.
- **Native:** `net/UrlSafety` (+ `MediaRefusedException`), `HttpClient` follows redirects itself (policy per hop, 20
  max, loop = `NOT_MEDIA`), bounded ranges, in-memory response-cookie jar merged with the WebView session per hop;
  `plan/HlsPlanner` (Media3 parser, variant selection, PROTECTED/UNSUPPORTED refusals incl. a raw `EXT-X-KEY` scan —
  Media3 records nothing for SAMPLE-AES identity or FairPlay); `Probe` routes `kind: hls` or playlist bytes to it and
  rejects a misaligned 206; `MediaSniffer` accepts TS only for HLS output and refuses encrypted WebM; `Verifier`
  finds the `moov` anywhere and reports encrypted tracks as `DRM_PROTECTED`; `transfer/HlsTransfer` (ordered segments,
  synced `.part`, `hls.checkpoint`, token propagation, container confirmed from bytes) and `transfer/Fmp4Index`
  (per-segment `sidx` → `free`, one global `sidx` in space reserved after the init — without it Media3 reported 2 s for
  an 8 s fMP4 download). `DownloadEngine`: HLS pipeline sharing verify/finalize/library; transient classification
  retried with backoff (`WAITING_RETRY`); transfer 5xx/408/429 waited out; the retry budget refills on progress; 401/
  403 without the session retried once with it and `useCookies` kept; waiting states pausable; HLS restore/repair;
  `probe()` classifies the variant an enqueue would download (the request's `variant`, else the preferred-quality
  setting — as at enqueue); `HlsPlanner.confirmMedia` (probe only) reads the chosen variant's init section or the
  first 4 KiB of its first segment and refuses WebVTT, packed audio, a track list without video and CENC boxes
  (`plan/HlsSegmentFormat`, moved from the transfer, is shared by both); `Probe` refuses an MP4 whose track list
  has sound and no video, and the engine fails any verified file that decodes with sound and no picture
  (`failedAsAudioOnly`, progressive and HLS). `variant_json` now stores the HLS choice (path only). No schema bump.
- **JS:** HLS options enqueue as `kind: 'hls'` (`variant.maxHeight` = chosen height) after the native classifier says
  DOWNLOADABLE for that same variant (`handOffVerifiedVariant` → `engine.probe`), refusals mapped to PROTECTED / LIVE /
  UNSUPPORTED / unreachable / expired messages and never enqueued; the v1 JS HLS gate is a pass-through for HLS (one
  classifier); `unavailableReason` maps to the right refusal; Origin forwarded; stock WebView UA in the request
  context; Retry hidden for `DRM_PROTECTED`/`LIVE_UNSUPPORTED`/`UNSUPPORTED_FORMAT` (UI and notification).
- **Device evidence (emulator API 35, debug build, fixture server via `adb reverse` + `fx.127.0.0.1.nip.io`):** in the
  real app — direct, extensionless, signed, redirected (2 hops), cookie-required (403 → session adopted → done) and
  Referer-required MP4; HLS master with the 240p quality chosen in the sheet (only that variant fetched), media
  playlist, tokenized master, fMP4; HLS in the background (launcher on top, completion notification), process kill and
  relaunch (resumed at the checkpoint, finished segments not refetched), pause/resume from Downloads (zero requests
  while paused), injected 503s (`waiting_retry` → done); AES-128 and live pages never offered and never enqueued; a
  master with a clear 360p and an AES 240p variant offers only the clear one (the analysis read the AES playlist; its
  key and segments were never requested). Progressive and TS outputs are byte-identical to the source (TS = its
  segments in order; fMP4 differs only in its index boxes); library rows have real dimensions, duration and thumbnail;
  the Player plays HLS output. Instrumented on-device E2E (`HlsE2EAndroidTest`, `ProgressiveE2EAndroidTest`, 17/17)
  also opens the master, chosen-quality, pause/resume and fMP4 results in Media3 ExoPlayer: correct duration and
  resolution, seekable. Real public streams in the app: Mux `x36xhzz` at 184p (64 TS segments, 634 s, HE-AAC) twice,
  byte-identical to its segments (`d3888da6…`), 320x184 with thumbnail; JW Player `oceans_aes` (AES-128) plays in
  the page, detection says `DRM_UNSUPPORTED`, no button, no row; Apple's split-audio fMP4 — after the fix the
  audio-only rendition fails at the probe (`UNSUPPORTED_FORMAT`, 0 bytes, "Download failed: unsupported format", no
  Retry, nothing in the library) and choosing its HLS option created no row. The HLS fixture cases were re-run on the
  final build (bounded `Range: bytes=0-4095` peek visible in the server log, outputs unchanged).
- **Tests:** native `vidorax-media` 314/0 (new: `UrlSafetyTest`, `HlsPlannerTest`, `HlsTransferTest`, `Fmp4IndexTest`,
  `DownloadEngineHlsTest`, additions to HttpClient/Probe/Sniffer/Verifier/Engine/Records tests), `vidorax-web` 16/0,
  instrumented 17/0; `npm test` 426 tests, 424 pass, the same 2 pre-existing `src/media/error-messages` failures; `tsc`
  clean outside those keys; `git diff --check` clean.
- **Known limits:** the detection layer still offers a split stream's rendition files and subtitle playlist (they are
  now refused, but a progressive rendition leaves a FAILED row and a video-only one downloads without sound) — to be
  fixed in `src/media-detection`; the browser treats URLs that differ only in their query as the same page
  (`normalizePageIdentity` drops the query), so `page?v=B` does not load over `page?v=A`; both were found here and
  left for separate changes. Paste-link "Add download" still uses the v1 JS engine (not rewired this phase); fMP4
  HLS with several init sections/discontinuities and separate-audio renditions are refused rather than remuxed; DASH
  is refused; an HLS row shows "0 B" until its first size estimate. Device-testing notes: a Metro started with
  `CI=1` does not watch files (it served the pre-12A bundle until restarted — grep the served bundle to confirm); on
  a cold start the app can restore the last tab over an incoming link; the Phase 6/11 verifier sometimes drops a
  verification as stale after in-session navigation and does not retry the same content (CTA missing until reload);
  on heavy MSE pages (Apple's example) the verifier often answers "Still finding a downloadable source" and the
  trace logging evicts everything else from logcat (`adb logcat -G 16M`, capture to a file) — observed, not changed.

### 4.13 Phase 12B — DASH classification + format compatibility (uncommitted, 2026-09-24)

Status `PHASE12B_DASH_FORMAT_CLASSIFICATION_VERIFIED`. Nothing is committed. One classifier (native `Probe`), one
engine, one store; no muxer, no segment downloader, no DRM/licence handling, no site-specific code.

- **Gaps found:** (1) native `Probe` refused all DASH, while JS parsed MPDs itself and offered "standalone" BaseURL
  representations as progressive files (`tryStandaloneDashAsProgressive`) — a second classifier that never looked at
  the files' bytes; (2) a 5xx on a manifest was reported like "unsupported"; (3) (device) `variant_json` ran a DASH
  representation id through `Redact.url` and stored `"<url>"`, so the chosen quality only survived via the height
  ceiling; (4) (device) a page playing DASH exposes its representation files as ordinary files: a split stream's
  video-only and audio-only halves were offered as "Original Quality" MP4s, and a downloadable manifest's file showed
  twice in the sheet; (5) an M4A whose track list is past the 64 KiB probe classified as a video MP4 (only
  `failedAsAudioOnly` caught it, after the transfer); MP3/AAC were "unrecognized container".
- **Native:** new `plan/DashPlanner` (Media3 `DashManifestParser`, bounded 4 MiB fetch; see ARCHITECTURE §3.2 for the
  exact rules: single-file representation, muxed or in a manifest without audio → the file is then classified by its
  own bytes; ContentProtection/DRM → PROTECTED; live, multi-period, segmented, separate audio, audio-only →
  UNSUPPORTED; HTTP/network → transient). `Probe` routes `kind: dash` or MPD bytes to it (`resolveDash` for the
  engine); `DownloadEngine.runDash` re-resolves the manifest every run (transient retries with `WAITING_RETRY`,
  session adoption, expired representation links renewed from the manifest) and transfers the file with
  `ProgressiveTransfer`; `VariantChoiceJson` keeps a DASH representation id verbatim (bounded; HLS URLs still
  redacted). `MediaSniffer`: `isDashManifest`, a real EBML walk for WebM track types (audio-only WebM refused at the
  probe), MP3/AAC named, `M4A `/`M4B ` major brands refused as audio whatever the box order.
- **JS:** DASH candidates are classified by `engine.probe({kind:'dash'})` (`classifyDashSource`, verdicts mapped by
  `dashRejectionFor`); options carry `representationId` → `EnqueueRequest {kind:'dash', variant:{videoId,
  maxHeight}}`; hand-off re-classifies the exact representation. A manifest the engine classified (either way)
  claims the files it names (`dashRepresentationFiles`: bounded fetch + the detection parser, BaseURLs only): files
  of a refused manifest are refused with it, files of a downloadable one are covered by its qualities — neither is
  offered again on its own; manifests are verified first and a refusal is remembered per scope (bounded, 32).
  Progressive candidates get the engine's last word before a CTA (`nativeProgressiveRefusal`: only definitive
  refusals — audio only, unsupported container, DRM, live, not media — block; transient answers do not). New
  rejection reasons `LIVE_UNSUPPORTED`, `UNSUPPORTED_FORMAT` (both proven-unsupported). Removed the JS DASH
  standalone helpers from `dash.parser.ts`.
- **Device evidence (Pixel_8 API 35, debug build, `fx.127.0.0.1.nip.io:8090` fixtures, dash.js 4.7.4 pages; emulator
  booted with `-feature -HardwareDecoder` so the platform `c2.android.*` decoders are used):** final matrix, every case
  through the real app (CTA → sheet → engine → library → Player):
  | Case | Result |
  | --- | --- |
  | DASH single muxed representation | completed, byte-identical to the representation file (md5 `c61ca58c…`), 640x360, 10.0 s, AVC+AAC, plays |
  | DASH three muxed qualities, 480p chosen in the sheet | completed, `variant_json {"videoId":"av-480","maxHeight":480}`, byte-identical to `av-480.mp4`, only that file fetched, plays |
  | DASH separate video + audio adaptation sets | no CTA, no row (UNSUPPORTED — would need muxing) |
  | DASH with `ContentProtection` (CENC + Widevine) | no CTA, no row, media never requested (PROTECTED) |
  | DASH manifest answering 503 twice to the engine | `waiting_retry` → completed, byte-identical |
  | WebM VP9/Opus | completed, byte-identical (md5 `c7300131…`), library `webm` / `video/webm` / VP9 / Opus / 640x360 / 8.0 s, thumbnail is a real frame; plays (audio, clock, frames — see the emulator note below) |
  | QuickTime MOV (H.264/AAC) | completed, byte-identical (md5 `ae3ef9b5…`), plays with picture |
  | MP3 / M4A / M4A inside `<video>` / ADTS AAC | no CTA, no row; the only request for the file is the page's own media element — never probed or enqueued (audio files are not videos) |
- **WebM "black video" — root cause (2026-09-24): emulator graphics, not the app and not the fixture.** The fixture is a
  plain VP9 profile 0 / yuv420p file (ffprobe), the platform VP9 decoder produced the library thumbnail from it, and
  Google Photos plays it with picture (3/3). In the app the picture was black only in some runs while sound and the clock
  ran. Mechanism, from logcat + `dumpsys SurfaceFlinger`: ExoPlayer creates the decoder before the SurfaceView's surface
  exists, decodes into its placeholder surface, and ~50 ms later `setOutputSurface`s to the SurfaceView; Codec2 then
  logs `remote graphic buffer migration N/N`. Every VP9 run with N = 0 rendered; every black run was a VP9 run with
  migrated buffers (4/4, 5/5, 7/7 — 4/4 and 1/1 also rendered sometimes), while H.264 renders even with 8/8 migrated
  (Phase 13 playback check). In the black runs the SurfaceView layer is visible, HWC-composited and receiving ~30
  frames/s with the same crop/dataspace as a good run, the app's startup cover has been lifted
  (`player.surface_revealed`) and expo-video has raised the surface alpha — so the frames reach SurfaceFlinger and only
  their pixels are black: on this emulator the platform VP9 software decoder's buffers that were migrated to the
  SurfaceView's BufferQueue show black (`ranchu`/goldfish gralloc). The downloaded library item behaves the same
  (rendered 3/4, black only with 7/7 migrated). Nothing in VidoraX writes pixel contents, and the placeholder → surface
  switch is standard ExoPlayer behaviour on real devices, so no app change was made. To see VP9 frames on this
  emulator, re-open the video (a run without migration renders); check `grep "buffer migration"` in logcat.
- **Tests:** native `vidorax-media` 363/0 (new `DashPlannerTest` 20, `DownloadEngineDashTest` 11; format cases in
  `ProbeTest`/`MediaSnifferTest` with ffmpeg fixtures in `src/test/resources/media/formats/`; DASH id round trip in
  `DownloadStoreTest`); `npm test` 449 tests, 447 pass, the same 2 pre-existing `src/media/error-messages` failures;
  `tsc` (both configs) clean outside those keys; eslint 0 errors; `git diff --check` clean.
- **Known limits:** separate-A/V, segmented (SegmentTemplate/SegmentList), multi-period and live DASH stay
  UNSUPPORTED by design (no muxer, no segment downloader); a split stream played from a JSON playlist (no manifest
  seen) still exposes its video half as a silent MP4 — only a visible manifest can claim it (the audio half is
  refused by the engine's classifier); representation files that inherit their BaseURL from the AdaptationSet are not
  claimed (JS parser reads direct BaseURLs only); audio formats are UNSUPPORTED (VidoraX downloads videos). Emulator
  note: the goldfish VP9 decoder shows the same black picture (`queueBuffer failed: -32` on migrated buffers) and
  `-feature -HardwareDecoder` alone does not avoid it — see the WebM root cause above. A MOV's library `mime_type`
  comes from the inspector (`video/mp4`); the Library's format label is fixed in Phase 13 (§4.14).
- **Final 12B checks (2026-09-24, this session):** native `vidorax-media` 363/0, `vidorax-web` 16/0; `npm test` 447/449
  (the 2 pre-existing `src/media/error-messages` failures); `tsc` both configs: only the 17 pre-existing errors in
  `src/media/error-messages.ts` (dead v2 scaffolding — `src/media` is imported only by the unmounted `src/detection`);
  `git diff --check` clean.

### 4.14 Phase 13 — downloader, storage, library & player integrity + Play in-app review (uncommitted, 2026-09-24)

Status `PHASE13_DOWNLOADER_STORAGE_PLAYER_INTEGRITY_VERIFIED`. Nothing is committed. Same engine, runner, library and
player throughout; nothing duplicated, no schema change, no backend.

- **Root causes found and fixed:**
  1. *Offline read as online* (`net/AndroidNetworkGate`): with no active network `getNetworkCapabilities(null)` is null,
     which `read()` treated as "no answer → assume usable". An offline download burned its 5 network retries in ~4 s and
     failed "network error" instead of waiting. Now no active network (or `onLost` without a replacement) is OFFLINE;
     only a platform failure assumes usable.
  2. *Full disk reported as a network error*: `ProgressiveTransfer`/`HlsTransfer` wrapped every `IOException` in the
     write loop as `MediaNetworkException`, so ENOSPC was retried and ended as NETWORK. Disk writes now raise
     `transfer/StorageWriteException` → `NO_SPACE` (ENOSPC) or `STORAGE_ERROR`, at once, `.part` kept for Retry.
  3. *If-Range never sent on a resume*: the validator lived in an engine map filled only after a transfer completed,
     and weak ETags were allowed. It is now recorded beside the `.part` (`download.part.validator`, strong ETag else
     Last-Modified) when bytes start at 0, and replayed on every resume — pause, crash, reboot, re-signed link.
  4. *Speed per 64 KiB chunk and unthrottled progress*: `engine/SpeedMeter` (2 s window, resets on a restart) and
     ≤ 4 Hz emission with the final numbers always sent.
  5. *No speed in notifications*: "Downloading · 6.8 MB of 13 MB · 1.2 MB/s" (aggregate: combined speed); never a
     stale speed while waiting or paused.
  6. *Cold-start notification tap lost its destination*: the splash always replaced to Browser, and on a singleTask
     relaunch the link arrives via `onNewIntent` before React is ready and was dropped. `MainActivity.onNewIntent` now
     `setIntent`s it and `resolvePostSplashRoute` honours `vidorax://downloads` / `vidorax://library`.
  7. *Phantom library rows*: a v2 row was always "available" in JS (live state wins) and nothing repaired the native
     library. `LibraryStore.removeMissingFiles` removes items whose file is gone/empty (+ thumbnail, `deleted` event):
     at module start, `reconcileLibrary` on Player focus / app foreground / pull-to-refresh (`library-reconcile.ts`,
     15 s interval), from the player's missing-file path, and when share/open-with/save find the file gone.
  8. *MOV labelled MP4*: the inspector says `video/mp4` for any ISO-BMFF; the library now records the container's MIME
     (insert and read-time, so old rows read right) and the Library label covers MOV/AVI/WMV/MKV/3GP/FLV.
  9. *Completed quality = offer label* ("Original Quality"): now the file's real resolution (short side, "720p").
  10. *Title "Download"* when the offer was built before the page title arrived: the handoff falls back to the title
      of the tab showing that page (never a URL).
  11. *Rename failed for v2 items* (went to the v1 file-rename path): now the native title rename.
  12. *Favoriting one video marked every video from the same page* (favorites were page-URL keyed): v2 rows use the
      library item's own favorite; the page favorite is kept in sync for the Favorites screen, which now also finds
      v2 rows. (v2 favorites made before this change were page favorites only; a one-time, confident-only migration
      was added in §4.15.)
  13. A download repaired at startup after a crash mid-finalize now gets its thumbnail too.
- **Google Play In-App Review** (`src/review/`, `expo-store-review` 57.0.3 = Play `ReviewManager`): pure policy
  (`review-policy.ts`), controller (`review-controller.ts`), MMKV state (`vidorax.mmkv.review.inApp.v1`: count, counted
  ids, lastSuccessAt, lastReviewRequestAt, downloadsAtLastRequest), `ReviewPromptHost` inside the App Lock gate.
  Counts only COMPLETED downloads whose verified library item exists (bridge `onCompleted`), once per id. First request
  after 3; then ≥ 7 days since the last *attempt* and ≥ 1 new success, and the last success within 24 h. Calm moment =
  app active, unlocked, nothing queued/downloading/finishing, route `/downloads` or `/library` stable for 2.5 s. The
  attempt is recorded before calling Play; `isAvailableAsync` (Play Store present) gates the call; every failure is
  swallowed. No rating gate, no redirect, no assumption about the sheet or the review.
- **Device evidence (Pixel_8 API 35, debug build, fixture server with engine-only faults, md5 against the source):**
  | Case | Result |
  | --- | --- |
  | W Pause/Resume from the notification | paused: `.part` frozen 10 s, 0 requests; resume `Range: bytes=7938048-` + `If-Range` = `.part` length; md5 ✓ |
  | X app backgrounded, then process killed mid-transfer | +1.1 MB/10 s in background (UIDT job); relaunch resumed `bytes=12918784-` + `If-Range`; md5 ✓, 1 row, work dir gone |
  | V server connection reset mid-body | `waiting_retry` ⇄ `downloading` ×3, resumed at `.part` length + `If-Range`; md5 ✓ |
  | V device offline mid-transfer (after fix 1) | `waiting_network` in 6 s, bytes frozen, "Waiting for network · 5.3 MB of 24 MB"; online → resumed `bytes=5251072-`; md5 ✓ |
  | Retry of a NETWORK-failed download (before fix 1) | resumed from its kept `.part` (`bytes=5578752-`); md5 ✓ |
  | Server ignores Range | 200 to the ranged retry → `.part` truncated, restart from 0 (never appended); md5 ✓ |
  | Expired link (one 403) | re-probed, continued `bytes=4915200-` from disk; md5 ✓ |
  | Y low storage, size known | `NO_SPACE` before the first byte (probe only); "Download failed: not enough storage" |
  | Y disk filled mid-transfer, size unknown (after fix 2) | `NO_SPACE` at once, no retries, `.part` 7.6 MB kept; space freed → Retry resumed `bytes=7622656-`; md5 ✓ |
  | Reboot mid-download | boot job resumed without opening the app (`bytes=4128768-` + `If-Range`); md5 ✓ |
  | Z completed file after restart | plays with picture (frame 117 at 0:03.9, clock 00:04/01:00) |
  | Notifications | progress + speed + downloaded/total live; Pause/Resume/Cancel/Retry from the shade; completed/failed texts; tap → Downloads (transfer) / Player (finished) warm and cold (after fix 6) |
  | C library after completion | one row per download, file present, md5 ✓, title, real-frame thumbnail, 1280x720, 60 s, exact size, `720p`, MP4/MOV, site; search, sort (name/size), filters, favorites (per item after fix 12), rename (after fix 11), delete (row + file + thumbnail), share (chooser), open-with (Photos plays it) |
  | D file deleted outside VidoraX | Player focus → row + thumbnail removed (`library_file_missing`), count 76 → 75, not in Downloads; tapping a row whose file just vanished → "File is no longer available." and the row is removed |
  | In-app review | 3+ genuine completions counted once each; first calm Downloads visit → `requestCount 1`; later calm visits `ineligible` (weekly); with the interval shortened for one check: `review.requested` → Play Core `requestInAppReview (com.anonymous.vidorax)` → Play `InAppReviewService` → launch flow completed, no sheet (sideloaded build — expected) |
- **Tests:** native `vidorax-media` 392/0 (new: `SpeedMeterTest`, `LibraryStoreTest`, `AndroidNetworkGateTest`, engine
  storage/progress/speed cases, transfer validator/disk-write cases, runner speed, MIME), `vidorax-web` 16/0,
  instrumented on device 17/0; `npm test` 486, 484 pass (the 2 pre-existing `src/media/error-messages` failures); new JS
  tests for review policy/controller, library reconcile, file quality label, format label, favorites, rename, launch
  destination, title fallback; `tsc` both configs clean outside the pre-existing `src/media/error-messages.ts` keys;
  eslint 0 errors on changed files; `git diff --check` clean.
- **Known limits:** the real Play review sheet can only be validated from a Play-distributed build (internal testing /
  internal app sharing); a completion that happens while no JavaScript runs is not counted for review; the Phase 6/11
  detector still misses some in-session navigations (warm incoming link over a restored tab, NEXT-link navigation —
  CTA after a reload), not changed here; Wi-Fi-only was not re-tested this phase; the VP9 black picture on the
  emulator (§4.13). *(All but the Play sheet and the emulator VP9 note were fixed or re-tested in §4.15.)* Testing notes: fixture server `fx13-server.mjs` (scratchpad) with a stable
  `/p/current.html` whose case is chosen server-side (a cold start then always reloads the right page), engine-only
  faults (throttle, cut, 403/503, ignore Range, unknown length); press Home before a force-stop so the browser session
  is saved; `uiautomator dump` fails while a page video plays.

### 4.15 Final remaining fixes before release QA (uncommitted, 2026-09-24)

Status `FINAL_REMAINING_FIXES_VERIFIED`; Play sheet `REAL_GOOGLE_PLAY_REVIEW_SHEET_NOT_VALIDATED`. Nothing is committed;
no prebuild, no release build. One detection stack, one engine, one store; no site-specific code; no backend (every
piece of state stays on the device).

- **"Video available" missing after in-app navigation until a restart — root causes and fixes:**
  1. *Every incoming http(s) link stacked another app tree.* `+native-intent.ts` handed web links to expo-router, whose
     `+not-found` answered with a `<Redirect>` that replaced the root route, so each VIEW link mounted a further `(app)`
     tree; their CTA hooks aborted each other's shared verification and no offer appeared until a restart. Web links
     (`http:`, `https:`, `about:` — `isBrowserWebLink`) now belong to the browser: on a cold start the router opens `/`
     once the navigation container is ready, a warm link is ignored by the router (the browser's incoming-link path
     opens it), and `+not-found` goes back when it can instead of redirecting.
  2. *Page identity ignored the query.* `?id=1` → `?id=2` counted as the same page, so the old video was kept or handed
     off (before: `stream.mp4?id=1` was enqueued on `?id=3`) or the offer died as `STALE_PAGE_GENERATION`.
     `normalizePageIdentity` (`src/media-detection/utils/url.ts`) now keeps the meaningful query (sorted) and strips a
     noise list only (click ids, `utm_*`/analytics prefixes, share/referrer tags, player-state params like `t`,
     `start`, `autoplay`, `muted`); social pages stay path-only. General path keys and player-src keys use the same rule.
  3. *Detections posted while the browser was hidden or its tab parked were dropped* and never announced again. After
     dropping batches while paused, and on a tab switch, the engine asks the page to rescan
     (`window.__VIDORAX_MEDIA_RESCAN__`, sent with `injectJavaScript`).
  4. *A reload or same-URL load kept candidates stamped with the old epoch.* `MediaDetectionEngine.onNavigationStart`
     keeps detections (soft) only for the same tab, the same epoch and the same page content (`isSamePageContent`:
     identity equal after noise stripping, e.g. a tracking `replaceState`); anything else is a hard reset.
  5. *Verification lost wake-ups and aborted shared jobs.* Shared verification is caller-ref-counted
     (`joinOrStartVerification`: aborted only when every caller has left; entries older than 60 s are evicted, never
     refused); the CTA hook re-runs verification (≤ 3 per page/media key, `takeVerifyRerun`) when a newer trigger
     arrived during a run or the run was aborted; the native progressive probe is bounded at 25 s in JS.
  6. *Tab changes were detected against the wrong tab* (other hooks had already moved `activeTabId`). The engine keeps
     its own `navigationTabId`, snapshots the previous tab's detections (≤ 6 tabs) and restores them on return,
     `onGoHome(tabId)` snapshots as well, and MSE playback state is per tab.
  7. *Observations racing a navigation were dropped.* A native observation stamped with a newer epoch or for another
     page, or a page message from a page whose navigation has not started yet, is deferred (≤ 32, 15 s) and replayed
     when that navigation starts.
- **Device matrix** (Pixel_8 API 35 emulator, debug build, fixture server `fx.127.0.0.1.nip.io:8093`, every row
  through the real app; "correct media" = the file the offer would download):
  | # | Case | Result |
  | --- | --- | --- |
  | 1 | Link A→B (incoming link into a tab, then an in-page link) | CTA 2 s each, correct media |
  | 2 | SPA `pushState` home → `/v2` → `/v3` | CTA 2 s each, correct media |
  | 3 | Query-only document navigation `?id=1` → `?id=2`, also page + media differing only by query | CTA 2 s, the new query's media |
  | 3 | SPA query-only `?v=5` → `?v=6` | CTA 2 s each, correct media |
  | 4 | Tracking-only `replaceState` | 0 re-verifications, 0 offer resets, bar stays |
  | 5 | Back: history, hardware key, SPA `popstate`, query page `?id=2` → `?id=1` | CTA 2 s, the previous page's media |
  | 6 | Forward: history, toolbar, SPA `popstate` | CTA 2 s, correct media |
  | 7 | Same tab through four pages (a → b → c → d) | CTA 2 s each, correct media |
  | 8 | Tabs: T1 → T2, T2 → T1, new tab (Home) → page, link in T1, T1 → T3 | one offer per tab; a return restores it in 0.13 s; new pages 2 s |
  | 9 | Cross-origin iframe video after navigation, then an iframe query-only change | CTA 2 s each, correct media |
  | 10 | Video inserted after load (delayed/dynamic), then a query-only change | CTA 5 s each (the page's own delay), correct media |
  | R | Reload | bar stays on the same verified video |
  | H | Navigation while the Downloads tab was in front | CTA 2 s after returning to the browser |
  Before the fixes: no CTA at all after an incoming link or the error page until a restart; query-only pages offered
  the previous video; SPA `?v=` changes and `popstate`: no CTA; hidden browser: no CTA; reload: no CTA.
- **Review counting while no JS runs:** `vidorax-media.db` schema v3 adds `completions(download_id PRIMARY KEY,
  completed_at)`, an outbox row written in the same transaction as COMPLETED (both engine completion paths; the newest
  500 unacknowledged rows are kept), so the boot job and the background runner record completions without JS.
  `listCompletedDownloads` / `acknowledgeCompletedDownloads` (≤ 1,000 ids) expose it. JS reconciles at bridge attach,
  on every foreground and after each live completion, one run at a time: list → count each id once (counted-id set,
  bounded 200; `lastSuccessAt` = the completion's own time) → save → acknowledge. A failed save acknowledges nothing
  (counted next time); a crash between save and acknowledge finds the id already counted and only acknowledges it.
  Policy unchanged: first request after 3 genuine completions, then ≥ 7 days and a new success within 24 h, calm
  moment only; any review failure is swallowed and never touches downloads.
  Device: a live completion counted 12 → 13 through the outbox (acknowledged, outbox 0); reboot mid-download → the
  boot job resumed `bytes=5632000-` and completed with the app never opened (outbox row present) → first launch
  counted 14 (`reconciled: 1`), outbox 0; restart → nothing counted again.
- **Favorites migration (page-level → per video):** `src/library/favorites-migration.ts` (pure plan + runner) and
  `ensure-favorites-migration.ts` (runs once, 4 s after startup; MMKV `vidorax.mmkv.flags.favoritesPerItemMigrated.v1`
  is set only after success, so a failed run is retried). It first waits for the native v1 import
  (`applyLegacyMetadata([])` as a barrier). Migrated, confident matches only: a v1 download favorite
  (`downloads_catalog.favorite`) → the library item with the same id (the import kept ids); a page favorite
  (`url_favorites`) → a video only when exactly one downloaded video came from that page. Left alone: a page with
  several downloaded videos (ambiguous — never all of them, never a guess), a page one of whose videos already has its
  own favorite (the user chose), a page with no downloaded video, anything already a favorite. Nothing is
  un-favorited; page favorites and the legacy tables are only read; a re-run applies nothing new.
  Device: `favorited 3` (2 from v1 download favorites, 1 from a single-video page); 2 ambiguous pages (3 and 2 videos)
  untouched; 1 page already chosen; 1 page with no download; sibling videos stayed unfavorited; restart → not re-run,
  4 favorites (3 migrated + the 1 already chosen).
- **Wi-Fi-only re-test** (switched on in Download Settings; emulator with Wi-Fi and mobile data): no regression,
  nothing changed.
  | Case | Result |
  | --- | --- |
  | Wi-Fi connected | download runs from `bytes=0-` |
  | Wi-Fi lost mid-download, mobile data up | `waiting_network` in 2 s; `.part` kept (9,101,312 B); bytes frozen; 0 requests for the file during the whole ~3 h wait (a session pause) — no retry storm; notification "Waiting for network · 9.0 MB of 24 MB" |
  | Wi-Fi back | `downloading` in 6 s from `Range: bytes=9101312-` (exactly the `.part` length) with `If-Range: "fxnav-big"` |
  | Wi-Fi lost and back twice more | each loss `waiting_network`, each return resumed at the `.part` length with `If-Range`; completed, md5 `a3dea536…` = source, work folder removed |
  | New download started on mobile data only | offered (CTA 21 s, right after the network switch); `waiting_network`, 0 B, no requests, "Waiting for network · 0 B of 24 MB" |
  | Wi-Fi back | started at `bytes=0-`, completed in ~22 s, md5 = source |
- **JS/TS cleanup:** the 2 failing tests and the 17 `tsc` errors all came from `src/media/error-messages.ts` in dead v2
  scaffolding (`src/media/**` was imported only by `src/detection/**`, which nothing mounted). Removed 73 files
  (`src/detection/**` 58, `src/media/**` 15), `scripts/build-detector.mjs` (with its `postinstall`/`build:detector`
  use), the empty `media.en.ts`/`media.ur.ts` catalogs, and in `vidorax-web` `DocumentStartScripts.kt`, `ids.xml`,
  `setDetectorScript`/`isDocumentStartScriptSupported` and the `androidx.webkit` dependency only they used. No test
  disabled, no `any`/`ts-ignore`, no placeholder strings.
- **WebM sanity:** the Phase 12B fixture (VP9 profile 0 + Opus, 640×360, 8.008 s) downloaded through the app: md5
  `c7300131…` = source; library `webm` / `video/webm` / VP9 / Opus / 640×360 / 8,008 ms / 506,763 B; player `ready`
  (8.008 s), `first_frame`, progress saved every 5 s. First open: black picture with `c2.goldfish.vp9.decoder
  queueBuffer failed: -32` (the emulator issue in §4.13); replay: the picture renders (frame 55 at 00:00:01.833, then
  frame 123 at 00:00:04.100). Player unchanged (no app defect). The dev warning on screen was "Cannot connect to Expo
  CLI", caused by the Wi-Fi toggling.
- **Google Play review:** local integration verified — `expo-store-review` 57.0.3, Play Store and GMS installed; with
  the repeat interval shortened for one check (restored to 7 days and confirmed in the served bundle):
  `review.requested` (count 17) → Play Core `requestInAppReview (com.anonymous.vidorax)` → bound to Play's
  `InAppReviewService` → `onGetLaunchReviewFlowInfo` → `review.evaluated outcome: 'requested'`, no crash. "Play Store
  missing" and "Play call throws" are covered by controller tests (nothing recorded / attempt recorded, never thrown).
  No Play Console / internal testing access and no release build allowed → `REAL_GOOGLE_PLAY_REVIEW_SHEET_NOT_VALIDATED`.
- **Tests:** `npm test` 339/339 (new: `navigation-lifecycle.test.ts` 12, `verification-session.test.ts` 5,
  `cta-persistence.test.ts` 2, `favorites-migration.test.ts` 6, review controller +6, incoming-link cases); native
  `vidorax-media` 397/0 (outbox and v2 → v3 migration in `DownloadStoreTest`, outbox in `DownloadEngineTest`),
  `vidorax-web` 16/0; `tsc` both configs 0 errors; ESLint on this pass's 41 JS/TS files 0 errors (3 warnings, all
  already at HEAD); `git diff --check` clean; `:app:assembleDebug` OK.
- **Known limits:** the real Play sheet is not validated (needs internal testing / internal app sharing); under
  Wi-Fi-only the notification says "Waiting for network" also while mobile data is up (existing wording, not
  changed); an ambiguous page favorite stays page-level (the user picks the video); completions from builds before
  the outbox that were never counted live are not counted afterwards; live social sites were not part of this
  navigation matrix (fixture pages; social pages keep path-only identity by design); emulator timing varies (memory
  pressure) and its VP9 decoder still shows the intermittent black picture; ESLint errors remain outside this pass's
  files (`use-android-back-handler.ts` and `useBrowserSessionContinuity.ts`: ref writes during render, Phase 9 era;
  `useLibraryScreen.ts`: already at HEAD). Testing notes: fixture server `fxnav-server.mjs` (scratchpad, port 8093;
  `ENGINE` = requests with `Accept-Encoding: identity`, logs `If-Range`) behind `adb reverse tcp:8093`; `svc wifi
  disable/enable` keeps `adb reverse` working; checkpoint the WAL before pushing a DB snapshot back with `run-as`.

---

## 5. How to resume

1. **Read `docs/ARCHITECTURE.md` in full** if you haven't. It is the spec.
2. **Re-verify the two "done" native modules still build**, since time has passed:
   ```bash
   bash scripts/dev/gradle.sh :vidorax-media:testDebugUnitTest :vidorax-web:compileDebugKotlin :app:assembleDebug
   ```
3. ~~Fill in `media.en.ts`/`media.ur.ts`~~ — obsolete: those catalogs and `src/media/` were
   removed as dead scaffolding on 2026-09-24 (§4.15); `npm test` has no failures. (Steps 4–5
   below are the plan as it stood before Phase 6; §4.5–§4.15 record what has been built since.)
4. **Priority order for remaining work** (native pipeline is the critical path — nothing
   downloads without it; everything else can be built/tested against the contract in parallel
   but is worthless until the pipeline exists):
   1. `modules/vidorax-media` stage 2 (contract-scoped pipeline: `net/Http` → `plan/Probe` →
      `transfer/ProgressiveTransfer` → `verify/Verifier` → `plan/HlsPlanner` →
      `transfer/HlsTransfer`) — **do this first**. No DashPlanner, no AES decrypt, no Remuxer.
   2. `modules/vidorax-media` stage 3 (engine/runners/notifications), only after stage 2
      has something to call.
   3. Shell track (startup, browser bugs) — independent, can run any time.
   4. Browser integration — needs the shell track and the (already-mostly-done) detection
      track finished first.
   5. Player rewrite — independent, can run any time.
   6. Media UI screens — needs stage 3 (engine) to have real data to show; the pure-logic
      layer underneath is already ~done.
   7. Independent review pass per track.
   8. On-device end-to-end testing against `docs/research/e2e-test-matrix.md`: supported
      cases must download; unsupported cases must reject cleanly. Test with real social-site
      posts found live in the browser (never sign into any account).
5. **A prior orchestration script exists** at (session-local path, likely gone in a new
   session — check first): `.../workflows/scripts/vidorax-v2-build-resume-*.js`. Its prompts
   are resume-aware (they tell each agent to check `git status` on its own paths first and
   continue partial work rather than restart). If reusing it, update its embedded
   "ALREADY PRESENT" notes to match §4 above, and update the audit-JSON path (`SP` constant)
   to `docs/research/v1-audit.json` (now committed in-repo, not a scratchpad temp file).
6. **Concurrency lesson learned the hard way:** running 14 agents at once burned the entire
   usage limit in ~18 minutes with almost nothing finished (2 of 14 completed). **Cap
   concurrent agents at 3.** Sequence within a track (e.g. native stage 1 → 2 → 3) rather than
   parallelizing dependent stages.
7. **Emulator/Metro state:** both were stopped before the pause. Metro must be started
   *without* `--localhost` — on this machine that binds IPv6-only and the emulator (reached
   via `adb reverse`, which is IPv4) can't load the bundle. Use `CI=1 npx expo start --port
   8081` (no `--localhost`), then `adb reverse tcp:8081 tcp:8081` once the emulator is fully
   booted. macOS has no `timeout` command and no usable foreground `sleep` in this harness —
   use `perl -e 'alarm shift; exec @ARGV' <secs> <cmd>` for bounded waits.
8. **Always build Gradle through `scripts/dev/gradle.sh`**, never `./gradlew` directly — it
   holds a lock so parallel agents/sessions don't corrupt each other's builds.
9. **Ownership discipline**: if running parallel agents again, give each a strict path
   allowlist (see the workflow script for the pattern used) — cross-track edits caused no
   conflicts last time specifically because ownership was respected; keep doing that.

---

## 6. Key technical facts worth not re-deriving

- **minSdk 24, targetSdk/compileSdk 36** (verified from `node_modules/react-native/gradle/
  libs.versions.toml` and the merged manifest).
- **Media3 1.9.0** is already in the Gradle cache via `expo-video` (session-exoplayer,
  exoplayer, exoplayer-dash, exoplayer-hls, ui, datasource-okhttp). `vidorax-media` uses
  `media3-exoplayer-hls` (`HlsPlaylistParser`), `media3-exoplayer-dash` (`DashManifestParser`,
  classification only — Phase 12B), `media3-inspector` (`MediaExtractorCompat`),
  `media3-datasource-okhttp` and `media3-common`; `media3-muxer`/`media3-container` are declared
  but unused. **Do not** add `media3-transformer` or any remuxing — out of scope.
  **Do not** upgrade past 1.9.0 without also bumping whatever `expo-video` bundles, checked
  at build time, or the app crashes.
- **HLS playlist parsing uses Media3's `HlsPlaylistParser`** — do not hand-roll a playlist
  parser. v1's hand-rolled parser is one reason v1 couldn't handle byte ranges correctly.
  Only unencrypted VOD playlists are supported; any `EXT-X-KEY METHOD` other than `NONE`
  must reject at plan time.
- **OUT OF CURRENT SCOPE (preserved for future reference):** `Mp4Muxer`/`WebmMuxer` for
  remuxing (separate A/V DASH/HLS), demuxing, DASH segment reassembly, AES-128 decrypt for
  encrypted HLS. (`DashManifestParser` is used since Phase 12B, but only to classify an MPD and
  pick its single-file representation.) The research in `docs/research/android-native-media.md`
  covers these topics but they are not part of the current product contract.
- **Background execution on Android 14-16**: API 34+ should use a user-initiated data
  transfer job (`JobInfo.Builder(..).setUserInitiated(true)`, `RUN_USER_INITIATED_JOBS`); API
  24-33 uses a `dataSync` foreground service. `dataSync`/`mediaProcessing` foreground services
  are capped at 6h/24h on Android 15+ — don't rely on one long-running FGS on newer OSes.
  WorkManager has no UIDT support and long-running workers now count against job quota on
  Android 16 — avoid it for this purpose.
- **Storage**: private app storage (`filesDir/library/<site>/…`) is the default library
  location (so App Lock actually protects it); gallery export is opt-in per item or via a
  setting, via `MediaStore` with `IS_PENDING` on API 29+, public `Movies/` dir + media scan
  on API 24-28 (needs `WRITE_EXTERNAL_STORAGE`, `maxSdkVersion=28` in the manifest — already
  done).
- **react-native-webview 13.16.1 internals** (verified against `node_modules` source, not just
  docs): `injectedJavaScriptForMainFrameOnly=false` is stored but **never read** on Android —
  it does nothing; iframe injection would require `WebViewCompat.
  addDocumentStartJavaScript(webView, script, setOf("*"))`. `modules/vidorax-web` had that
  path, but only the never-mounted `src/detection` runtime used it and it was removed on
  2026-09-24. What runs: the observer from `src/media-detection/observers/injected-script.ts`
  is injected through `injectedJavaScript`/`injectedJavaScriptBeforeContentLoaded` (main
  frame; it reads same-origin subframes itself), and media requested by cross-origin iframes
  is seen by the native network observer (`observeRequest` → `onNetworkMedia`). The built-in
  `DownloadListener` sends everything to the system `DownloadManager` unless intercepted —
  the patch intercepts it.
- **Site-specific delivery facts** (full detail in `docs/research/site-video-delivery.md`):
  Instagram/Facebook put playable URLs in JSON (GraphQL responses, `<script data-sjs>`), not
  in the DOM — v1's fetch/XHR hooks only looked at URLs, never response bodies, which is why
  it couldn't see these at all. TikTok's real progressive URL requires the `tt_chain_token`
  cookie set during page load. YouTube (SABR + PO tokens) is treated as infeasible and
  explicitly refused, not attempted.

---

## 7. About `docs/research/` — treat as point-in-time reference, not living docs

These were generated by research/audit agents on 2026-09-15 and are committed for
traceability, not meant to be edited or kept current:
- `v1-audit.json` — the full structured 9-subsystem audit (verdicts, bugs with file:line,
  keep-worthy files, capability gaps, recommendations). Useful for "why was X torn out" or
  "was there a good idea in v1's Y I should reuse" questions.
- `site-video-delivery.md` — per-platform video delivery mechanics, with source citations.
  Some facts are explicitly marked UNVERIFIED where the research agent could not confirm them
  — re-verify anything load-bearing before shipping a fix based on it, platforms change
  frequently.
- `android-native-media.md` — the Android/Media3/Expo-module implementation brief. Covers
  the broader surface (DASH, AES-128, remuxing) which is **OUT OF CURRENT PRODUCT SCOPE** —
  use selectively for HLS parsing and OkHttp transfer patterns only. Also has explicit
  UNVERIFIED markers — re-verify anything load-bearing before building on it.
- `e2e-test-matrix.md` — public test URLs, live-verified 2026-09-15. Updated to separate
  supported-download cases from must-reject cases per the product contract. Public test hosts
  do occasionally go dead; re-verify with `curl -sL -r 0-65535 <url>` before relying on one.

If facts here go stale (API versions bump, a site changes its delivery method, a test URL
dies), update the file in place and note the new verification date — don't let this drift
silently.

---

## 8. Persistent memory pointers

This project also has entries in the assistant's cross-session memory
(`~/.claude/projects/-Users-mac-Downloads-vidorax-mobile/memory/MEMORY.md`) covering: full
autonomy granted by the user, the overhaul decision record, this progress/resume note (which
duplicates a summary of this file — keep both in sync if either changes materially), the
Metro `--localhost` IPv6 gotcha, the e2e test stream URLs, emulator testing pitfalls, and the
local-only rule (no backend: every user's data lives only on their device). Memory entries are
short pointers; this document is the detailed source of truth.
