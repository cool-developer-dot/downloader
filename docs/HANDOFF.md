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
   - `src/detection/types.ts` — in-page detector message schema and per-tab media model
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
- Any non-DRM video the user can play in the browser can be saved as one playable file with
  audio: progressive MP4/WebM/MOV, split video+audio files, HLS (TS and fMP4/CMAF, AES-128,
  alternate audio renditions, byte-range segments), DASH (SegmentBase/List/Template).
- Downloads survive backgrounding, screen-off, and process death. Pause/resume/retry/cancel
  actually work.
- One library, single source of truth: thumbnail, title, site, duration, resolution, size.
  Search, sort, filter by site, favorites, multi-select, rename, delete, share, open-with,
  save-to-gallery.
- A clean player: autoplay, resume position, simple controls, gestures, fullscreen, PiP,
  speed, next/previous.
- The browser is usable immediately at launch (no long splash/onboarding).

**Explicit non-goals** (refused with a clear message):
- DRM (Widevine/PlayReady/FairPlay, HLS SAMPLE-AES/non-identity KEYFORMAT, DASH
  ContentProtection, encrypted samples).
- YouTube (`youtube.com`, `youtu.be`, `*.googlevideo.com`) — SABR streaming makes plain
  capture infeasible in 2026, and it violates YouTube's ToS.
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
- **No muxing anywhere.** No `MediaMuxer`/`MediaExtractor`/ffmpeg. Instagram, Facebook,
  Reddit, X (HLS with separate audio) and most modern DASH players need combining a
  video-only and audio-only stream into one file; v1 refuses these on purpose
  (`VIDEO_ONLY_UNSUPPORTED`/`DASH_UNSUPPORTED`) rather than doing it.
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
- `android-native-media.md` — implementation-grade Android brief: Media3 muxer/extractor
  APIs, HLS/DASH parsing, AES-128, background execution rules for Android 14-16, MediaStore,
  Expo SDK 57 module authoring without prebuild, react-native-webview 13.16 internals.

---

## 3. Target architecture (summary — full detail in `docs/ARCHITECTURE.md`)

Guiding rule: **native (Kotlin) owns everything that touches media bytes, files, background
execution and download state. JavaScript owns UI, detection ranking, and user choices.**

```
JS: Browser → Detection (per-tab store + resolver + download sheet) → Media (downloads store,
    library hooks) → Player, Library/Downloads UI
Native: modules/vidorax-web (WebView hooks: document-start detector injection, passive network
    observation, download handoff, cookies, shared-link intents)
Native: modules/vidorax-media (probe → HLS/DASH planners → transfer → Media3 remux → library →
    thumbnails → gallery export → background runners → notifications)
```

Two native Expo local modules, autolinked **without** `expo prebuild` (via `modules/*/expo-
module.config.json`, matching the pattern of `node_modules/expo-video`):

- **`modules/vidorax-media`** (`com.vidorax.media`) — SQLite DB (`vidorax-media.db`), download
  state machine, HLS/DASH planning (via `androidx.media3.exoplayer.hls`/`dash` parsers, NOT a
  hand-rolled parser), transfer with resume, AES-128 decrypt, remux via
  `androidx.media3.muxer.Mp4Muxer`/`WebmMuxer` (NOT platform `MediaMuxer` — it can't write
  VP9-in-MP4, Opus before API 29, or AV1 before API 34; NOT ffmpeg — ffmpeg-kit is retired),
  library store, thumbnails, gallery export, background runners (API 34+ user-initiated data
  transfer job; API 24-33 `dataSync` foreground service), notifications.
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
   native `probe()` for HLS/DASH), and the download-button + bottom-sheet UI.
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

Working tree is clean (`git status` → nothing to commit) as of this writing.

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
  exercised on a device/emulator.**
- **tsconfig correctness** (commit `38dcf8b`, this session): fixed the root `tsconfig.json`'s
  `**/*.ts` include pattern matching MPEG-TS video test fixtures (files literally named
  `*.ts` containing binary transport-stream data under `modules/vidorax-media/android/src/
  test/resources/`) and reporting them as TypeScript syntax errors (49 phantom errors);
  excluded `modules/**/android` and `modules/**/ios` from the app tsconfig, and moved the
  Node-only `src/detection/page/test-harness.ts` to the test tsconfig where it type-checks
  cleanly. This was a false alarm, not a real regression — no functional code was wrong.

### 4.2 Partial (files exist, feature incomplete — do not assume these work end-to-end)

- **`modules/vidorax-media` stage 2 (the actual download pipeline)** — **effectively not
  started.** Only test fixture media files (`android/src/test/resources/media/{progressive,
  hls-ts,hls-fmp4}/*`) and one `plan/ToolchainSmokeTest.kt` exist. There is **no** `net/`,
  `plan/{Probe,HlsPlanner,DashPlanner}.kt`, `transfer/`, or `mux/Remuxer.kt` yet. This is the
  single most important unfinished piece — without it, nothing can actually be downloaded.
  Read `docs/ARCHITECTURE.md` §3.2 and `docs/research/android-native-media.md` §§1-4 before
  starting it; both contain exact Media3 1.9.0 API signatures already verified against the
  real sources (source jars were downloaded and inspected during research — see method
  lists in the research doc; re-fetch from `https://dl.google.com/android/maven2/androidx/
  media3/<artifact>/1.9.0/<artifact>-1.9.0-sources.jar` if needed).
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
- **On-device end-to-end testing** — a test matrix of live public URLs covering every format
  (progressive MP4, HTML5 page, HLS-TS, HLS-fMP4-with-separate-audio, HLS-AES-128,
  DASH-SegmentTemplate, DASH-SegmentBase-separate-A/V, Vimeo) was prepared and verified live
  on 2026-09-15 (`docs/research/e2e-test-matrix.md`) but **no download has actually been
  attempted end-to-end yet** — there is no working pipeline to test (see §4.2, stage 2).

### 4.4 What this means practically

**The app in its current working-tree state does not yet do anything differently from v1 at
runtime.** All the new code is additive (new files under `modules/` and `src/detection/` and
`src/media/`) and has not been wired into the app's actual UI or Kotlin registration yet — v1's
browser, detection, player, and download engine are all still what runs when the app launches.
The rewrite is real progress on the *foundation* (contracts, native module skeletons, pure
logic, research) but is not yet an improvement a user could see or use. Don't report partial
completion as "the app now downloads videos" — it doesn't yet.

---

## 5. How to resume

1. **Read `docs/ARCHITECTURE.md` in full** if you haven't. It is the spec.
2. **Re-verify the two "done" native modules still build**, since time has passed:
   ```bash
   bash scripts/dev/gradle.sh :vidorax-media:testDebugUnitTest :vidorax-web:compileDebugKotlin :app:assembleDebug
   ```
3. **Fill in `media.en.ts`/`media.ur.ts`** (and `shell.*`, `videoPlayer.*` once their tracks
   need them) — real copy, real Urdu, not placeholders. This alone fixes the 2 failing tests
   in `src/media/`.
4. **Priority order for remaining work** (native pipeline is the critical path — nothing
   downloads without it; everything else can be built/tested against the contract in parallel
   but is worthless until the pipeline exists):
   1. `modules/vidorax-media` stage 2 (pipeline: probe/HLS/DASH/transfer/remux) — **do this
      first or in parallel with the highest priority**.
   2. `modules/vidorax-media` stage 3 (engine/runners/notifications), only after stage 2
      has something to call.
   3. Shell track (startup, browser bugs) — independent, can run any time.
   4. Browser integration — needs the shell track and the (already-mostly-done) detection
      track finished first.
   5. Player rewrite — independent, can run any time.
   6. Media UI screens — needs stage 3 (engine) to have real data to show; the pure-logic
      layer underneath is already ~done.
   7. Independent review pass per track.
   8. On-device end-to-end testing against `docs/research/e2e-test-matrix.md`, plus real
      Instagram/TikTok/Reddit/X posts found live in the browser (never sign into any account).
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
  exoplayer, exoplayer-dash, exoplayer-hls, ui, datasource-okhttp) but **not** muxer,
  transformer, or inspector — those must be added explicitly at the exact same version.
  Latest Media3 as of this research was 1.11.1; **do not** upgrade past 1.9.0 without also
  bumping whatever `expo-video` bundles, checked at build time, or the app crashes.
- **`androidx.media3.muxer.Mp4Muxer`** is the remux target, not platform `MediaMuxer` (codec
  support gaps by API level) and not ffmpeg (ffmpeg-kit retired, binaries pulled April 2025).
  MP3/AC-3/E-AC-3 audio can't be written by `Mp4Muxer` — for those, keep the source container
  playable as-is rather than failing.
- **`androidx.media3.inspector.MediaExtractorCompat`** (not platform `MediaExtractor`) for
  demuxing — handles fMP4/CMAF and TS consistently across API levels; platform behavior on
  concatenated fMP4 is inconsistent by OEM.
- **HLS/DASH parsing uses Media3's own parsers** (`HlsPlaylistParser`, `DashManifestParser`,
  `DashUtil`) — do not hand-roll a playlist/manifest parser; v1's hand-rolled HLS parser
  (`src/downloads/engine/hls/playlist.ts`, since deleted from the new pipeline's scope but
  still readable via `git show 3fb182d:src/downloads/engine/hls/playlist.ts`) is one reason
  v1 couldn't handle AES-128, byte ranges, or alternate audio renditions correctly.
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
  it does nothing; iframe injection requires patching in `WebViewCompat.
  addDocumentStartJavaScript(webView, script, setOf("*"))` instead, which is what
  `modules/vidorax-web` does. The built-in `DownloadListener` sends everything to the system
  `DownloadManager` unless intercepted — the patch intercepts it.
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
- `android-native-media.md` — the Android/Media3/Expo-module implementation brief.
  Also has explicit UNVERIFIED markers (e.g. `Mp4Muxer` behavior with files over 4GB, exact
  ADTS→ASC conversion behavior) — these are exactly the things worth spiking/testing early
  rather than assuming.
- `e2e-test-matrix.md` — public test URLs, live-verified 2026-09-15, one per format. Public
  test hosts do occasionally go dead; re-verify with `curl -sL -r 0-65535 <url>` before
  relying on one that's been sitting for a while.

If facts here go stale (API versions bump, a site changes its delivery method, a test URL
dies), update the file in place and note the new verification date — don't let this drift
silently.

---

## 8. Persistent memory pointers

This project also has entries in the assistant's cross-session memory
(`~/.claude/projects/-Users-mac-Downloads-vidorax-mobile/memory/MEMORY.md`) covering: full
autonomy granted by the user, the overhaul decision record, this progress/resume note (which
duplicates a summary of this file — keep both in sync if either changes materially), the
Metro `--localhost` IPv6 gotcha, and the e2e test stream URLs. Memory entries are short
pointers; this document is the detailed source of truth.
