# Prompt B — Faran · Claude Opus · download engine + Phase 16 core fixes

> **How to use:** open Claude Code (model: **Opus**) in the `vidorax-mobile` folder on the Mac and paste everything
> below the line. Prompt A (Sonnet) is finished (PR #1). Branch: `faran/opus-engine`.
> Tasks: F1, F13, F16, F18, F2, F17, F14, F15, F3, F4, F6 (11 packages, 44 effort points).
> Version 2 (2026-10-11): updated with what Prompt A's run taught us.

---

You are working on **VidoraX**, an Android-first Expo SDK 57 / React Native 0.86 app (in-app browser + video
downloader + player). Native Kotlin modules: `modules/vidorax-media` (download engine, library, media processing) and
`modules/vidorax-web` (WebView hooks via a patched react-native-webview). The app is in Google Play testing (tag
`v1.0.0-test1`). Your job: build the 11 tasks below on the branch `faran/opus-engine`, **100% finished and 100%
tested — automated and manual** — one task at a time, in the order given. These are the hardest packages in the plan:
think through edge cases, process death, Android version differences and Play policy before coding.

## 0. Before writing any code

1. Read, in this order: `AGENTS.md` (read the Expo v57 docs it links before using any Expo API), `docs/RELEASING.md`,
   `docs/HANDOFF.md` §1, §3, §4.19–§4.32 and §5–§6, `docs/ARCHITECTURE.md` in full (it is the spec),
   `docs/ROADMAP.md`, `docs/play-console/PLAY_SUBMISSION.md`, the contract
   `modules/vidorax-media/src/VidoraMedia.types.ts`, **and `docs/work-log/faran-sonnet.md`** (Prompt A's work log:
   its test-build decisions, emulator lessons and "Found, not fixed" lists apply to you too).
2. Set up the branch:
   ```bash
   git fetch origin
   git checkout faran/opus-engine
   git merge --ff-only origin/faran/opus-engine
   git merge origin/main
   # Only if PR #1 is not merged into main yet:
   git merge origin/faran/sonnet-fixes
   ```
   Confirm the branch contains Prompt A's work (e.g. `src/player/duration-label.ts` and `scripts/qa/` exist). Never
   commit to `main` or `release/1.0` directly; never touch `release/1.0`. Before **each** task run
   `git merge origin/main` again: tester fixes from `release/1.0` are copied into `main` and must reach your branch.
3. Baseline: `npm ci`, `npm test`, `npm run typecheck`, `npm run lint`,
   `bash scripts/dev/gradle.sh :vidorax-media:testDebugUnitTest :vidorax-web:testDebugUnitTest --rerun`,
   `bash scripts/dev/gradle.sh :vidorax-media:connectedDebugAndroidTest` (emulator running). After Prompt A the
   expected numbers are about: JS 678 pass, lint 0 errors / **84 warnings**, vidorax-media 505 / 0, vidorax-web 27 / 0.
   Record yours in the work log (§4). Pre-existing failures: record, don't fix unless they block you.
4. Build the **test1 baseline APK** once, from the tag, before your first change (as Prompt A did):
   `git worktree add /tmp/vx-test1 v1.0.0-test1` → `npm ci` there → `bash scripts/dev/gradle.sh :app:assembleRelease`
   → keep the APK outside the repo. It's the "old version" every upgrade check (R10) installs first.

## 1. Rules (apply to every task)

- **Scope:** exactly the task. Bugs found elsewhere go in the work log under "Found, not fixed" — the owner fixes
  existing bugs only when a tester reports them.
- **One task = its own commits**, each message starting with the ID (`F1: …`); a separate `F1: work log and HANDOFF
  entry` commit is fine. Never mix tasks in a commit — this is what lets us change or revert one feature alone.
- **Contract first:** any change to the JS ⇄ native API goes into `VidoraMedia.types.ts` (or `VidoraWeb.types.ts`)
  first, then Kotlin (`VidoraMediaModule.kt`, `bridge/Records.kt`, `bridge/JsValues.kt`), then JS.
- **Every new setting must really work end to end.** Prompt A found that the existing "Auto Resume" switch never
  reaches the native engine (`src/downloads/v2/ensure-bridge.ts` pushes only Wi-Fi-only and concurrency). Each setting
  you add (connections per file, speed limits, schedules, conditions, background play, live recording) must be pushed
  to where it acts, survive a force-stop, and be **proven on the device to change behaviour** — not just saved.
- **Database:** never change or drop a table in place. A schema change bumps `db/Schema.kt` `VERSION` (now 4) with a
  forward migration that is safe to run twice. Test the upgrade from a v4 database with real rows.
- **Downloads in flight survive:** a download paused or queued on the `v1.0.0-test1` build must resume after upgrading
  to your build.
- **Strings:** every user-visible text in `src/localization/en.ts` **and** `ur.ts` (real Urdu). The parity test
  `src/localization/catalog-parity.test.ts` must pass. Also search your new code for hard-coded English (toasts,
  notification text, accessibility labels — Prompt A found several older ones) and check right-to-left.
- **Lint warnings may not grow** above the baseline (84).
- **Local only:** no server calls, accounts, analytics or cloud.
- **Still refused:** YouTube, DRM, encrypted HLS, login/paywall bypass.
- **Google Play:** no restricted permissions — no All Files Access, no `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, no
  `SCHEDULE_EXACT_ALARM`/`USE_EXACT_ALARM`, no overlay permission. The only new permission in this prompt is
  `FOREGROUND_SERVICE_MEDIA_PLAYBACK` (F18); write its Play Console declaration text in `PLAY_SUBMISSION.md` in the
  same task.
- **Tester-friendly:** new behaviour a tester might want changed gets a setting or a single named constant, listed in
  the work log with its default.
- **Build tools:** never `npx expo prebuild`; Gradle only via `bash scripts/dev/gradle.sh …`; Metro with
  `CI=1 npx expo start --port 8081` (never `--localhost`). Media3 stays at the version `expo-video` bundles (1.9.0).
- **Package id** `com.vidorax.fast.videodownloader` (`run-as`, `am start`, `pm clear`; the DB is
  `no_backup/vidorax-media.db`, pull `-wal`/`-shm` too). Launch activity:
  `com.vidorax.fast.videodownloader/com.anonymous.vidorax.MainActivity`. Kotlin packages stay `com.anonymous.vidorax` /
  `com.vidorax.media` — don't rename them.
- **The Home screen is hidden on purpose** (`(tabs)/index.tsx` redirects to Browser, the tab has `href: null`). Don't
  build features that are only reachable from Home.
- **Emulator:** don't reboot the emulator or wipe its data without asking the owner. Don't use the emulator while
  someone else is testing a `release/1.0` fix on it (same package id — installs overwrite each other).
- **Decisions:** don't stop to ask. Take the option that best fits the architecture, write decision + reason in the
  work log, and update `docs/ARCHITECTURE.md` where the design changed.
- **No fake results.** Never report a step as PASS that you didn't run and see. A script line marked `CHECK` must be
  confirmed from its screenshot. Untestable → **BLOCKED** + reason.

## 2. The task loop (repeat for each task)

1. `git merge origin/main`. Read every file named in the task and search for related code and tests.
2. Write the design in the work log: approach, files, edge cases, failure modes, tests.
3. Implement.
4. **Automated tests** — unit tests for every new decision/algorithm (JS `*.test.ts` via `node:test`; Kotlin JVM tests
   under `modules/*/android/src/test`, using the existing fakes for HTTP, clock and storage); an instrumented test
   (`modules/vidorax-media/android/src/androidTest`) when the task changes transfers, files or processing. Gate:
   ```bash
   npm test
   npm run typecheck
   npm run lint                                                                  # 0 errors, warnings ≤ 84
   bash scripts/dev/gradle.sh :vidorax-media:testDebugUnitTest :vidorax-web:testDebugUnitTest --rerun
   bash scripts/dev/gradle.sh :vidorax-media:connectedDebugAndroidTest           # when native transfer/file code changed
   node --test scripts/patch-react-native-webview.test.mjs                       # when WebView code changed
   git diff --check
   ```
   All must pass; paste the totals into the work log. A suspiciously fast `--rerun` → confirm from the test result
   files that the tests really ran.
5. **Manual tests** — every manual case in the task on the **Pixel_8 emulator (API 35)**: debug build first, final pass
   on a **release build** (`bash scripts/dev/gradle.sh :app:assembleRelease`). Signing, as in Prompt A: for per-task
   passes re-sign both the test1 baseline APK and the task's release APK with `android/app/debug.keystore`
   (`zipalign`, then `apksigner sign --ks android/app/debug.keystore --ks-pass pass:android`) so data survives switching
   between debug and release; the final pass (§7) uses both APKs exactly as Gradle signed them with the upload key in
   `~/.vidorax-signing` (never read or copy that key; never upload any APK). Where the task says so, also test on a
   real Android phone — the emulator can't pinch, and phone makers handle background apps differently. English +
   Urdu; System / Red / Dark where the screen changes.
6. **Regression smoke** (§3) on the release build.
7. Docs: work log entry; `docs/ARCHITECTURE.md` for design changes; one short `docs/HANDOFF.md` §4 entry per task.
8. Commit (ID prefix), push `faran/opus-engine`, update the pull request (§5).

## 3. Regression smoke (release build, after every task)

Use Prompt A's helpers in `scripts/qa/` (read its `README.md`): `seed_test1.sh` (fresh test1 + R10 data),
`regress.py <tag>`, `r8.sh`, `coldstart.sh`, `ui.py`, `shot.sh`. Keep `regress.py`
honest (`CHECK` for anything a person must look at), and commit your improvements to it.

| # | Check | Pass when |
| --- | --- | --- |
| R1 | Cold start | No crash or ANR; browser chrome no slower than test1 (6.2–6.4 s on this AVD — the branded splash is by design) |
| R2 | MP4 page | `https://www.w3schools.com/html/html5_video.asp` → download → plays |
| R3 | HLS | `https://hlsjs.video-dev.org/demo/?src=https%3A%2F%2Ftest-streams.mux.dev%2Fx36xhzz%2Fx36xhzz.m3u8` → 184p and one high quality download and play |
| R4 | Social | Public TikTok, Instagram reel and Facebook video (logged out) → offered → downloads; Facebook's separate audio + video merged with sound |
| R5 | Refusals | YouTube link refused — submit the address with **Enter** (the AVD keyboard can float over "Go") and confirm the toast on the screenshot; `https://playertest.longtailvideo.com/adaptive/oceans_aes/oceans_aes.m3u8` (AES) refused with a clear message |
| R6 | Pause / kill / resume | Pause → resume completes; `adb shell am force-stop` mid-download → reopen → resumes, file plays |
| R7 | Player | Play, seek, ±10 s, double-tap middle = play/pause, tap duration = time left, fullscreen, PiP, mini player |
| R8 | App Lock | `r8.sh`: PIN on return after enabling, none after disabling |
| R9 | Urdu and themes | Urdu right-to-left with no English left on the screens you touched; System / Red / Dark |
| R10 | Upgrade | Install over the seeded test1 build (download, favourite, history, recent search, plus one **paused** download) → all intact, the paused one resumes |
| R11 | DASH | `https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd` downloads and plays |
| R12 | Wi-Fi only | On + Wi-Fi off (`svc wifi disable`) → "Waiting for Wi-Fi"; Wi-Fi on → continues |

R1–R10 match `regress.py`'s steps `r1`–`r10`; add `r11` and `r12` to it (and a paused download to the seed for R10).

Test URLs go away — check each with `curl -sIL <url>` first and note replacements in the work log.

**Emulator lessons from Prompt A:** heavy load (Gradle + debug build + many tabs) can stall the whole emulator
(`system_server` at ~300 % CPU) and leave a stale "isn't responding" dialog that keeps returning — check
`adb shell dumpsys window | grep -i anr` and the event log; if the ANR belongs to a dead process, tap **Close app**,
restart the app and re-run the step, and record it. Keep few tabs open on debug builds. `uiautomator dump` hangs while
a page video plays — use screenshots. Don't seed or test while Gradle is building.

## 4. Work log

Create `docs/work-log/faran-opus.md` on the first task and keep it current: baseline numbers; per task — design,
decisions, files, automated test totals, a table of every manual case (PASS / FAIL / BLOCKED + note), measurements
(speeds, timings), regression R1–R12, "Found, not fixed".

## 5. Pull request

After the first finished task, open one PR `faran/opus-engine → main`, title "Faran · Opus · engine + Phase 16 core",
using the repo PR template, with a checklist of all 11 tasks. Tick each task as it finishes. Screenshots / screen
recordings: the in-app browser isn't signed in to GitHub, so save them to `.claude/pr-evidence/<ID>-<name>.png` (not
committed) and list them for the owner to attach. The owner may merge after any finished task; keep working on the
same branch afterwards (`git merge origin/main` first).

## 6. The tasks (in this order)

### F1 — Parallel connections (8 points)

Features: Multi-threaded Download (#336), Dynamic Segmentation (#338), Connections per File (#337).

**Today:** `transfer/ProgressiveTransfer.kt` uses one connection per file (fresh = whole resource; resume =
`bytes=<len>-` with `If-Range`, validator stored beside the `.part`). `transfer/HlsTransfer.kt` fetches segments one by
one with a per-segment checkpoint. `engine/DownloadEngine.kt` runs one worker per download; `engine/SpeedMeter.kt`
measures speed; progress events ≤ 4 Hz. The old v1 JS engine (`src/downloads/engine/multi-range`) is reference only —
don't revive it.

**Known issue to settle first (from Prompt A):** a 288p HLS download that was **paused and resumed** later stuck in
BUFFERING after seeks, and its file was missing one frame (`docs/work-log/faran-sonnet.md`, F9/F10). F1 rewrites how
segments are fetched and resumed, so: reproduce it on the current engine (pause/resume the Mux 288p download several
times, compare duration and frame count with an uninterrupted download using `ffprobe -count_frames`), find the cause,
and make sure the F1 code has no such gap. Record what you found.

**Build:**
1. **Progressive:** when the server proves range support (a `206` with a valid `Content-Range`), the total size is
   known, the file is ≥ 16 MiB and there is a strong validator (ETag or Last-Modified), download with N connections
   (setting, below). Write each range directly at its offset in one pre-allocated file (no join step, no double disk
   space). Each part keeps its own checkpoint so pause, network loss and process death resume every part.
2. **Dynamic segmentation:** when a part finishes early, split the largest remaining part (minimum 1 MiB) and give the
   free connection the second half.
3. **HLS / DASH segments:** fetch up to N segments at once, keeping the existing in-order assembly and checkpoint
   guarantees.
4. **Fallback, never failure:** a `200` to a range request, `416`, a validator change, a `403`/`429` on extra
   connections, or a signed social link that rejects ranges → continue on one connection automatically. Validator
   change → restart from zero (existing `SOURCE_CHANGED` semantics).
5. **Setting:** Download Settings → "Connections per file" 1–4, default 3 — through the `DownloadSettings` contract
   (`VidoraMedia.types.ts` ~line 426), the Kotlin bridge, **`ensure-bridge.ts`**, the engine and
   `src/screens/settings/download-settings/`. A download still counts as one slot of `maxConcurrent`.
6. Speed, progress, ETA and the notification show the combined value; the verifier, sniffer and duplicate check run
   on the finished file as today.

**Automated:** JVM tests with the existing fake HTTP layer: range support → N parts; no range support → 1; `200` to a
range → fallback; one part failing then retried; kill-and-resume per part; validator change → restart; dynamic split;
HLS parallel segments stay in order; **pause/resume of HLS several times → byte-identical to an uninterrupted
download**; disk full mid-write → storage error; cancel removes everything; final file byte-identical (SHA-256) to the
source. Instrumented: a parallel case in `ProgressiveE2EAndroidTest` and an HLS one.

**Manual (release build):**
1. A ≥ 30 MB public MP4 with range support (e.g. `https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/1080/Big_Buck_Bunny_1080_10s_30MB.mp4`;
   verify with `curl -sI -r 0-1`) with 1 vs 3 connections: record both times (3 runs each) in the work log.
2. Pause at ~40 %, resume → completes; airplane mode at ~60 % → waits → resumes; force-stop at ~70 % → reopen → resumes.
3. Compare the file's SHA-256 with `curl … | shasum -a 256` (debug build + `run-as` to read the file).
4. Mux HLS high quality: faster with parallel segments, plays start to end, seeking works; **the same after 3
   pause/resume cycles** (no buffering stall, same frame count).
5. TikTok, Facebook, Instagram downloads still succeed (fallback path).
6. Changing "Connections per file" changes the number of connections (check the fixture-server log or OkHttp logs on a
   debug build) — the setting must really act.
7. A download paused on the `v1.0.0-test1` build resumes after upgrading.

### F13 — Web video fullscreen (3 points)

Features: Fullscreen Mode (#167), Fullscreen Video (#219), Auto Rotate (#168).

**Today:** `allowsFullscreenVideo` is not set in `src/browser/webview/webview-configuration.ts`, so a website's
fullscreen button does nothing; `MainActivity` is portrait-locked in `AndroidManifest.xml`.

**Build:**
1. Set `allowsFullscreenVideo: true` and pass it in `src/browser/components/BrowserContainer/BrowserWebView.tsx` (~line
   670, next to the other WebView props). react-native-webview 13.16 then installs its own `RNCWebChromeClient`
   subclass (`node_modules/react-native-webview/android/.../RNCWebViewManagerImpl.kt` ~lines 150–200), which shows the
   video view and sets `SCREEN_ORIENTATION_UNSPECIFIED`.
2. **Orientation:** a wide video goes to landscape, a tall one stays portrait, leaving fullscreen restores portrait.
   Get the video's size from the page (`fullscreenchange` → the injected observer in
   `src/media-detection/observers/injected-script.ts` or `src/browser/bridge/browser-chrome.injected.ts`) and drive it
   through `src/player/orientation-controller.ts`.
3. **Back** (hardware/gesture) leaves fullscreen first (`src/browser/hooks/useBrowserHardwareBack.ts`); switching tabs,
   opening the tab switcher or backgrounding leaves fullscreen cleanly.
4. **Don't break the patch:** VidoraX patches react-native-webview (`scripts/patch-react-native-webview.js`) to hook
   downloads, document-start scripts and network observation. Prove the hooks still fire with the new chrome client
   (patch tests + a detection check on a real page). Only the active tab can enter fullscreen; parked tabs are
   unaffected. The "Video available" bar is hidden during fullscreen and correct afterwards. Translated pages (Prompt
   A's F11, `translate.goog`) behave the same.

**Automated:** tests for the orientation decision (wide / tall / square / unknown size); patch test passes.
**Manual:** w3schools video, a public Dailymotion video, the hls.js demo, a public Facebook video: fullscreen →
landscape, page controls work, back exits → portrait; system auto-rotate off → still landscape; a tall (vertical)
video stays portrait; detection + download still work after exiting; on a real phone too.

### F16 — Open video files from other apps (4 points)

Features: Open from Browser (#673), Set as Default (#693), Default App (#873), File Associations (#947).

**Today:** `video/*` and `audio/*` appear only in the manifest `<queries>` (for "Open with"); `MainActivity` has no
intent-filter for them. The player only opens library items by id (`src/player/resolve-playback-source.ts`,
`assertSafeMediaId`). Incoming http(s) links are read by `modules/vidorax-web/.../SharedText.kt` and must not create a
router path (`src/app/+native-intent.ts` explains why — a second app tree).

**Build:**
1. Manifest: `VIEW` + `DEFAULT` intent-filters for `video/*` and `audio/*` with `content` and `file` schemes (no
   http — the browser filter already handles web links).
2. Native: read the incoming media intent (URI, MIME type, display name, size) at cold start and on `onNewIntent`
   (`singleTask`), keep the read-URI grant, take a persistable permission when offered, and emit it to JS. Never
   put the raw URI into a router path or a log; hand JS an opaque token.
3. JS: an **external-source** player session (separate from library ids; resume position keyed by a hash of the URI,
   no library row, no watch-history entry); full player features (gestures, Prompt A's time-left and double-tap, PiP,
   mini player, orientation). App Lock must show its PIN before anything plays.
4. **Save to VidoraX** button: a new native call copies the file into the library (`StoragePaths.newLibraryFile`, site
   "device"), makes a thumbnail, runs the SHA-256 duplicate check (`library/ContentHash.kt`, `SavedVideoIndex.kt`) and
   announces `onLibraryChange('imported')`. A second save says it's already in the library. Files Android can't
   decode follow the existing keep-and-"Open with" rule (see F5 in `faran-sonnet.md`).
5. No new permission.

**Automated:** Kotlin tests for intent parsing (content, file, http ignored, no data, unknown MIME) and for the import
(copy, duplicate, failure cleanup); an instrumented test importing from a `FileProvider` URI; JS tests for the token
routing and the session's source building.
**Manual:** `adb push sample.mp4 /sdcard/Download/` → Files by Google → tap → "Open with VidoraX" → plays; Google Photos
→ Open with; an `.mp3`; a `.mkv`; app cold vs already open (`onNewIntent`); App Lock on; Save to VidoraX → in library
once; save again → "already in library"; PiP and mini player with the external file; Urdu; a real phone.

### F18 — Background play (4 points)

Features: Background Audio (#214), Media Notification (#215), Lock Screen Controls (#658), Notification Player (#659),
Background Play (#695).

**Today:** removed on 2026-10-01 — see the comment in `android/app/src/main/AndroidManifest.xml` and app.json
`"supportsBackgroundPlayback": false`. The player pauses in the background (`src/player/app-lifecycle-policy.ts`,
native `player/ActivityVisibility.kt`), except PiP. Known (Prompt A, not yours to fix unless it's in your way): pressing
Home during a landscape-fullscreen video pauses instead of entering PiP.

**Build:**
1. Settings → **"Keep playing in background"** (in a Player section — add one if Settings has none), **off by
   default**, stored on the device and proven to act after a force-stop.
2. Manifest: add `FOREGROUND_SERVICE_MEDIA_PLAYBACK` and the `expo.modules.video.playbackService.ExpoVideoPlaybackService`
   service exactly as `node_modules/expo-video/plugin/build/withExpoVideo.js` (lines ~34–60) would generate (exported
   false, `foregroundServiceType="mediaPlayback"`, `androidx.media3.session.MediaSessionService` intent-filter);
   app.json `supportsBackgroundPlayback: true`; replace the 2026-10-01 comment with an accurate one.
3. When the setting is on: `staysActiveInBackground` and `showNowPlayingNotification` on the player (check the exact
   expo-video API in `node_modules/expo-video/build/VideoPlayer.types.d.ts`); the lifecycle policy and the native
   activity-stop pause skip pausing — including from landscape fullscreen. Notification shows title (and artwork if
   available), text in English and Urdu; lock screen has play/pause and seek. PiP behaviour unchanged. Closing the
   player or reaching the end releases the service.
4. Setting off → today's behaviour exactly.
5. `docs/play-console/PLAY_SUBMISSION.md`: the mediaPlayback foreground-service declaration (description, user
   impact, demo-video steps). Confirm the merged manifest declares the service once
   (`apkanalyzer manifest print` on the release APK).

**Automated:** tests for the lifecycle decision with the setting on/off (background, inactive, activity stopped, PiP,
landscape fullscreen).
**Manual:** setting on → play → Home → sound continues with a media notification; screen off 5 min → continues;
lock-screen controls work; Bluetooth/headphones if available; close player → notification gone; setting off →
pauses on Home; PiP still works in both modes; mini player; an external file from F16; a real phone (some makers kill
background apps — record the model).

### F2 — Speed control (4 points)

Features: Speed Limiter (#339), Per-download Limit (#340), Bandwidth Priority (#346).

**Build:**
1. A token-bucket limiter shared by every transfer stream (progressive parts and segments from F1), applied in the
   read loop. Global limit in Download Settings (Off, 256 KB/s, 512 KB/s, 1, 2, 5 MB/s); per-download limit in
   Download details; one download can be marked **Priority** and gets bandwidth first.
2. Contract + bridge + `ensure-bridge.ts` + engine + screens, like F1's setting. Limits survive restarts.
3. Coordinate with Hamza's H4 (queue start order): F2 decides bandwidth, H4 decides start order — write the queue
   rules into `docs/ARCHITECTURE.md` §5 so both follow them.

**Automated:** JVM tests for the token bucket with a fake clock (rate, bursts, nested per-download inside global,
priority sharing, changing a limit mid-transfer).
**Manual:** 512 KB/s global → a large download holds 450–550 KB/s for 60 s (record); per-download 256 KB/s beside an
unlimited one; priority download gets most bandwidth; Off → full speed; survives force-stop.

### F17 — Play online streams (3 points)

Feature: Streaming Protocols (#664).

**Build:**
1. A **Play** button next to Download for each variant in the quality sheet (`src/screens/downloads/quality/` —
   `QualitySelectionSheet.tsx`, `MediaResultCard.tsx`, `QualityOptionRow.tsx`) and on a single offer. It opens the
   VidoraX player with a remote source.
2. `resolve-playback-source.ts`: a remote source kind with URL, the page's headers (Referer, User-Agent) and cookies,
   and content type (progressive / HLS / DASH) for expo-video's `VideoSource`.
3. Split audio + video offers (two files) → no Play button (only Download). DRM/YouTube are never offered, so never
   playable. An expired signed link → a clear "reload the page" message.
4. No library row; no resume record. The player title comes from the offer — known (Prompt A): a direct file link can
   carry the previous page's title; don't copy that mistake into the player.

**Automated:** tests for source building (headers, cookies, content-type mapping, split → not playable).
**Manual:** Mux HLS via the hls.js demo → Play at a chosen quality; w3schools MP4 → Play; a public Dailymotion/TikTok
video (needs Referer/cookies) → Play; DASH (Akamai bbb) → Play; Instagram split reel → no Play; PiP and mini player
with a stream; airplane mode mid-play → error, not crash.

### F14 — Seek preview frames (2 points)

Feature: Seek Thumbnail Preview (#530).

**Today:** scrubbing shows only a time label (`src/screens/player/components/SeekFeedback.tsx`,
`PlayerTimeline.tsx`). Prompt A's F10 changed `PlayerTimeline.tsx` (tap the duration → time left, saved by
`src/player/duration-label-preference.ts`; double-tap zones in `src/player/double-tap-seek.ts`) — keep both working.

**Build:** while dragging, show a small frame above the thumb using `player.generateThumbnailsAsync` (check the exact
options in `node_modules/expo-video/build/VideoPlayer.types.d.ts`): at most one request in flight, latest position
wins (~150 ms), cache by 1-second buckets, clear the cache on close. Local files and F16 external files only (no
preview for F17 streams).

**Automated:** tests for the throttle and cache logic.
**Manual:** 1080p H.264 (10 min), HEVC, WebM: preview follows the finger without stutter; audio-only file → no
preview, no crash; landscape fullscreen; Urdu right-to-left; time-left label and double-tap still work; memory doesn't
grow after 20 scrubs (`adb shell dumpsys meminfo com.vidorax.fast.videodownloader`, record).

### F15 — Leftover download files cleaner (3 points)

Feature: Junk Cleaner (#852).

**Today:** native `DownloadEngine.clearTempFiles()` (~line 517) already deletes work folders under
`StoragePaths.workRoot` (`no_backup/work/<id>`) that belong to no unfinished download, and is exposed in
`VidoraMedia.types.ts` (~line 537) — but nothing in JS calls it. The Storage screen (`src/screens/storage/`,
`StorageActions.tsx`) only has Clear Cache. v1 temp folders are listed in
`src/storage-manager/services/storage-locations.service.ts`.

**Build:**
1. A native "measure leftovers" call (count + bytes) using the same keep-rule, extended for F1's per-part files and
   F6's recordings.
2. Include orphaned v1 temp folders (HLS workspaces, multi-range parts) not owned by any active v1 record.
3. Storage screen: "Leftover download files — X MB" with **Clean up** + confirmation; afterwards "Freed X MB". Hidden
   when there's nothing to clean.
4. Never touch files of queued, running, paused, processing or recording downloads.

**Automated:** Kotlin tests (orphan vs queued vs paused vs processing vs per-part; v1 folders).
**Manual (debug build):** create an orphan with `run-as` (fake folder in `no_backup/work/`), have a paused download at
the same time → Storage shows only the orphan's size → Clean up → freed; the paused download still resumes and plays.

### F3 — Scheduling and conditions (5 points)

Features: Scheduled Download (#351), Start/Stop Time (#352), Weekly Schedule (#360), Disable on Roaming (#354), Pause
on Low Battery (#355), Only While Charging (#356).

**Today:** downloads run as a user-initiated data-transfer job on Android 14+ (`runner/AndroidRunnerHost.kt`,
`setUserInitiated(true)`) and a `dataSync` foreground service on Android 7–13; `net/AndroidNetworkGate.kt` handles
Wi-Fi-only; `runner/DownloadBootReceiver.kt` restores after reboot.

**Research first** and record in `docs/ARCHITECTURE.md`: on Android 14–16 a user-initiated job can only be scheduled
while the app is visible, and foreground services can't be started from the background. Pick a compliant design (for
example, regular JobScheduler jobs with constraints — `setRequiresCharging`, `setRequiresBatteryNotLow`, not-roaming
network, minimum latency for start times — that make resumable progress across several runs). **No exact alarms, no
battery-optimization exemption.** Tell the user in the UI that a scheduled start can be a few minutes late.

**Build:**
1. Per download: "Start at…" (date/time).
2. Download Settings: daily window (start/stop time) with weekdays; "Not on roaming"; "Pause when battery is low"
   (≤ 15 % and not charging); "Only while charging" — each pushed through `ensure-bridge.ts` to the engine and proven
   on the device.
3. Waiting states with clear labels, like today's "Waiting for Wi-Fi": "Scheduled for 02:00", "Waiting for charging",
   "Paused — battery low", "Paused — roaming", "Outside download hours" — in English and Urdu, in the list, details and
   notification.
4. Survives reboot and force-stop.

**Automated:** JVM tests for every rule with a fake clock, battery and network (window across midnight, weekday
filter, combined rules, rule changed while running).
**Manual:** schedule 3 minutes ahead with the app closed → starts (record delay); window excludes now → waits with
label; `adb shell dumpsys battery unplug` / `set level 10` / `reset`; roaming via the emulator console
(`adb emu gsm data roaming` / `home`); reboot with a scheduled download — **ask the owner before rebooting the
emulator**, or use a real phone; real phone too.

### F4 — MPEG Program Stream: .mpg, .mpeg, .vob (2 points)

**Follow Prompt A's F5 (commit `cad62b8`)** — it shows every place a new container touches: the Kotlin `Container`
enum, `plan/MediaSniffer.kt`, `verify/Verifier.kt`, `library/MediaTypes.kt`, `process/` (keep/remux/transcode and the
keep-and-"Open with" rule for undecodable video), the JS contract union in `VidoraMedia.types.ts`, the container
allowlist in `src/downloads/v2/enqueue-request.ts`, the web module's `NetworkMediaClassifier`, the injected-script
lists, `src/media-detection/constants/media.constants.ts` and the extension-parser tests.

**Build:**
1. Detect MPEG-PS (pack header `00 00 01 BA`, MPEG-1 and MPEG-2). Refuse scrambled/CSS DVD VOBs (PES scrambling control
   bits set) as protected.
2. `.mpg`, `.mpeg`, `.vob`; `video/mpeg`, `video/dvd`.
3. Processing (`process/Remuxer.kt` with Media3's PS extractor via `MediaExtractorCompat`, `process/Transcoder.kt`):
   output MP4; MPEG-1/2 video → H.264, MP2/AC-3 audio → AAC (ARCHITECTURE §1's conversion rule).

**Automated:** Kotlin tests with small ffmpeg fixtures (`ffmpeg -f lavfi -i testsrc=duration=3 -f lavfi -i
sine=duration=3 -c:v mpeg2video -c:a mp2 -f mpeg sample.mpg`, and `-f vob`), like `process/RemuxerTest`; a scrambled-
bit fixture is refused; JS detection tests.
**Manual:** a public-domain `.mpg` from archive.org → detected → downloads → MP4 in the library → plays and seeks,
duration right; a local `.vob` fixture (debug build, `fx.127.0.0.1.nip.io` + `adb reverse`) the same.

### F6 — Live stream recording (6 points, behind a switch)

Feature: Live Stream Recording (#377). **Needs the client's sign-off before it's visible:** build it fully, but show it
only when Settings → Downloads → Advanced → **"Live recording (beta)"** is on (default **off**).

**Today:** `plan/HlsPlanner.kt` refuses live playlists (`LIVE_HLS_UNSUPPORTED`).

**Build:**
1. For a live, unencrypted HLS media playlist: "Record" instead of Download. Poll the playlist about every target
   duration, fetch new segments (reusing F1's parallel fetch and F2's limiter), keep order, handle discontinuities and
   playlist stalls, stop on user Stop, `EXT-X-ENDLIST`, a max duration (setting, default 2 h) or low storage.
2. Finalize to MP4 with the existing remux path. Process death → on next start, finalize what was recorded.
3. Downloads row: "Recording · 12:34 · 85 MB" with **Stop** (English and Urdu). Same refusals (DRM, AES, YouTube).
   Live DASH is out of scope.

**Automated:** JVM tests with a fake live playlist (sliding window, discontinuity, gap, stall, endlist, max duration,
kill mid-recording).
**Manual (switch on):** a public unencrypted live HLS test stream (verify it's live with `curl`) → record 2 min →
Stop → plays ~2 min; force-stop mid-recording → reopen → finalized file plays; switch off → no Record button anywhere.

## 7. Finish

When all 11 tasks are done:
1. Full automated gate on the final branch head (including `connectedDebugAndroidTest`), and R1–R12 on a fresh
   release build — **Gradle-signed with the upload key, installed over a Gradle-signed test1 without re-signing** —
   plus one real phone. Record totals.
2. Work log complete (every manual case PASS or BLOCKED with a reason, no unconfirmed `CHECK`); PR checklist complete;
   `PLAY_SUBMISSION.md` has the F18 declaration; `scripts/qa/` improvements committed.
3. Final message to the owner: a table of the 11 tasks (status, commits, tests added, manual cases passed,
   measurements), anything BLOCKED, decisions, new settings and their defaults, the Play Console steps for F18, and
   "Found, not fixed".
