# Prompt B — Faran · Claude Opus · download engine + Phase 16 core fixes

> **How to use:** open Claude Code (model: **Opus**) in the `vidorax-mobile` folder on the Mac and paste everything
> below the line. Start it after Prompt A (Sonnet) is finished, or run it in a separate `git worktree` and take turns
> on the emulator (both builds use the same package id, so they overwrite each other on the device).
> Branch: `faran/opus-engine`. Tasks: F1, F13, F16, F18, F2, F17, F14, F15, F3, F4, F6 (11 packages, 44 effort points).

---

You are working on **VidoraX**, an Android-first Expo SDK 57 / React Native 0.86 app (in-app browser + video
downloader + player). Native Kotlin modules: `modules/vidorax-media` (download engine, library, media processing) and
`modules/vidorax-web` (WebView hooks via a patched react-native-webview). The app is in Google Play testing (tag
`v1.0.0-test1`). Your job: build the 11 tasks below on the branch `faran/opus-engine`, **100% finished and 100%
tested — automated and manual** — one task at a time, in the order given. These are the hardest packages in the plan:
think through edge cases, process death, Android version differences and Play policy before coding.

## 0. Before writing any code

1. Read, in this order: `AGENTS.md` (read the Expo v57 docs it links before using any Expo API), `docs/RELEASING.md`,
   `docs/HANDOFF.md` §1, §3, §4.19–§4.31, §5–§6, `docs/ARCHITECTURE.md` in full (it is the spec),
   `docs/ROADMAP.md`, `docs/play-console/PLAY_SUBMISSION.md`, and the contract
   `modules/vidorax-media/src/VidoraMedia.types.ts`.
2. Set up the branch:
   ```bash
   git fetch origin
   git checkout faran/opus-engine
   git merge --ff-only origin/faran/opus-engine
   git merge origin/main
   ```
   Never commit to `main` or `release/1.0` directly. Never touch `release/1.0`.
3. Baseline: `npm ci`, `npm test`, `npm run typecheck`, `npm run lint`,
   `bash scripts/dev/gradle.sh :vidorax-media:testDebugUnitTest :vidorax-web:testDebugUnitTest --rerun`,
   `bash scripts/dev/gradle.sh :vidorax-media:connectedDebugAndroidTest` (emulator running). Record the numbers in the
   work log (§4). Pre-existing failures: record, don't fix unless they block you.

## 1. Rules (apply to every task)

- **Scope:** exactly the task. Bugs found elsewhere go in the work log under "Found, not fixed".
- **One task = its own commits**, each message starting with the ID (`F1: …`). Never mix tasks in a commit — this is
  what lets us change or revert one feature when a tester asks.
- **Contract first:** any change to the JS ⇄ native API goes into `VidoraMedia.types.ts` (or `VidoraWeb.types.ts`)
  first, then Kotlin (`VidoraMediaModule.kt`, `bridge/Records.kt`, `bridge/JsValues.kt`), then JS.
- **Database:** never change or drop a table in place. A schema change bumps `db/Schema.kt` `VERSION` (now 4) with a
  forward migration that is safe to run twice. Test the upgrade from a v4 database with real rows.
- **Downloads in flight survive:** a download paused or queued on the `v1.0.0-test1` build must resume after upgrading
  to your build.
- **Strings:** every user-visible text in `src/localization/en.ts` **and** `ur.ts` (real Urdu). Check right-to-left.
- **Local only:** no server calls, accounts, analytics or cloud.
- **Still refused:** YouTube, DRM, encrypted HLS, login/paywall bypass.
- **Google Play:** no restricted permissions — no All Files Access, no `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, no
  `SCHEDULE_EXACT_ALARM`/`USE_EXACT_ALARM`, no overlay permission. The only new permission in this prompt is
  `FOREGROUND_SERVICE_MEDIA_PLAYBACK` (F18); write its Play Console declaration text in `PLAY_SUBMISSION.md` in the
  same task.
- **New behaviour a tester might want changed** gets a setting or a single constant, documented in the work log, so it
  can be adjusted without rewriting.
- **Build tools:** never `npx expo prebuild`; Gradle only via `bash scripts/dev/gradle.sh …`; Metro with
  `CI=1 npx expo start --port 8081` (never `--localhost`). Media3 stays at the version `expo-video` bundles (1.9.0).
- **Package id** `com.vidorax.fast.videodownloader` (`run-as`, `am start`, `pm clear`; the DB is
  `no_backup/vidorax-media.db`, pull `-wal`/`-shm` too). Kotlin packages stay `com.anonymous.vidorax` /
  `com.vidorax.media` — don't rename them.
- **Decisions:** don't stop to ask. Take the option that best fits the architecture, write decision + reason in the
  work log, and update `docs/ARCHITECTURE.md` where the design changed.
- **No fake results.** Never report a step as passed that you didn't run. Untestable → **BLOCKED** + reason.

## 2. The task loop (repeat for each task)

1. Read every file named in the task and search for related code and tests.
2. Write the design in the work log: approach, files, edge cases, failure modes, tests.
3. Implement.
4. **Automated tests** — unit tests for every new decision/algorithm (JS `*.test.ts` via `node:test`; Kotlin JVM tests
   under `modules/*/android/src/test`, using the existing fakes for HTTP, clock and storage); an instrumented test
   (`modules/vidorax-media/android/src/androidTest`) when the task changes transfers, files or processing. Gate:
   ```bash
   npm test
   npm run typecheck
   npm run lint                                                                  # 0 errors
   bash scripts/dev/gradle.sh :vidorax-media:testDebugUnitTest :vidorax-web:testDebugUnitTest --rerun
   bash scripts/dev/gradle.sh :vidorax-media:connectedDebugAndroidTest           # when native transfer/file code changed
   node --test scripts/patch-react-native-webview.test.mjs                       # when WebView code changed
   git diff --check
   ```
   All must pass; paste the totals into the work log.
5. **Manual tests** — every manual case in the task on the **Pixel_8 emulator (API 35)**: debug build first, final pass
   on a **release build** (`bash scripts/dev/gradle.sh :app:assembleRelease`). If the upload key
   (`~/.vidorax-signing/keystore.properties`) isn't on this Mac, sign the release APK for local testing only with
   `android/app/debug.keystore` (`zipalign`, then `apksigner sign --ks android/app/debug.keystore --ks-pass pass:android`);
   never upload it. Where the task says so, also test on a real Android phone. English + Urdu; System / Red / Dark
   where the screen changes.
6. **Regression smoke** (§3) on the release build.
7. Docs: work log entry; `docs/ARCHITECTURE.md` for design changes; one short `docs/HANDOFF.md` §4 entry per task.
8. Commit (ID prefix), push `faran/opus-engine`, update the pull request (§5).

## 3. Regression smoke (release build, after every task)

| # | Check | Pass when |
| --- | --- | --- |
| R1 | Cold start | Browser usable within ~2 s, no crash, no ANR |
| R2 | MP4 page | `https://www.w3schools.com/html/html5_video.asp` → download → plays |
| R3 | HLS | `https://hlsjs.video-dev.org/demo/?src=https%3A%2F%2Ftest-streams.mux.dev%2Fx36xhzz%2Fx36xhzz.m3u8` → 184p and one high quality download and play |
| R4 | DASH / split | `https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd` downloads; a public Facebook video (separate audio + video) downloads merged with sound |
| R5 | Social | Public TikTok and Instagram reel (logged out) → offered → downloads |
| R6 | Refusals | YouTube link refused; `https://playertest.longtailvideo.com/adaptive/oceans_aes/oceans_aes.m3u8` (AES) refused with a clear message |
| R7 | Pause / kill / resume | Pause → resume completes; `adb shell am force-stop` mid-download → reopen → resumes, file plays |
| R8 | Wi-Fi only | On + Wi-Fi off (`svc wifi disable`) → "Waiting for Wi-Fi"; Wi-Fi on → continues |
| R9 | Player | Play, seek, ±10 s, fullscreen, PiP, mini player |
| R10 | App Lock, Urdu, themes | PIN on return; Urdu right-to-left; System / Red / Dark |
| R11 | Upgrade | Install over the `v1.0.0-test1` build holding downloads (one paused), favorites, history → all intact, the paused one resumes |

Test URLs go away — check each with `curl -sIL <url>` first and note replacements in the work log.

## 4. Work log

Create `docs/work-log/faran-opus.md` on the first task and keep it current: baseline numbers; per task — design,
decisions, files, automated test totals, a table of every manual case (PASS / FAIL / BLOCKED + note), measurements
(speeds, timings), regression R1–R11, "Found, not fixed".

## 5. Pull request

After the first finished task, open one PR `faran/opus-engine → main`, title "Faran · Opus · engine + Phase 16 core",
using the repo PR template, with a checklist of all 11 tasks. Tick each task as it finishes; attach screenshots /
screen recordings to the PR (don't commit them). The owner may merge after any finished task; keep working on the same
branch afterwards (`git merge origin/main` first). Prompt A's branch also edits `PlayerTimeline.tsx` (F10): merge
`origin/main` before F14 and resolve carefully.

## 6. The tasks (in this order)

### F1 — Parallel connections (8 points)

Features: Multi-threaded Download (#336), Dynamic Segmentation (#338), Connections per File (#337).

**Today:** `transfer/ProgressiveTransfer.kt` uses one connection per file (fresh = whole resource; resume =
`bytes=<len>-` with `If-Range`, validator stored beside the `.part`). `transfer/HlsTransfer.kt` fetches segments one by
one with a per-segment checkpoint. `engine/DownloadEngine.kt` runs one worker per download; `engine/SpeedMeter.kt`
measures speed; progress events ≤ 4 Hz. The old v1 JS engine (`src/downloads/engine/multi-range`) is reference only —
don't revive it.

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
   (`VidoraMedia.types.ts` ~line 426), the Kotlin bridge, the engine and
   `src/screens/settings/download-settings/`. A download still counts as one slot of `maxConcurrent`.
6. Speed, progress, ETA and the notification show the combined value; the verifier, sniffer and duplicate check run
   on the finished file as today.

**Automated:** JVM tests with the existing fake HTTP layer: range support → N parts; no range support → 1; `200` to a
range → fallback; one part failing then retried; kill-and-resume per part; validator change → restart; dynamic split;
HLS parallel segments stay in order; disk full mid-write → storage error; cancel removes everything; final file
byte-identical (SHA-256) to the source. Instrumented: a parallel case in `ProgressiveE2EAndroidTest` and an HLS one.

**Manual (release build):**
1. A ≥ 30 MB public MP4 with range support (e.g. `https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/1080/Big_Buck_Bunny_1080_10s_30MB.mp4`;
   verify with `curl -sI -r 0-1`) with 1 vs 3 connections: record both times (3 runs each) in the work log.
2. Pause at ~40 %, resume → completes; airplane mode at ~60 % → waits → resumes; force-stop at ~70 % → reopen → resumes.
3. Compare the file's SHA-256 with `curl … | shasum -a 256` (debug build + `run-as` to read the file).
4. Mux HLS high quality: faster with parallel segments, plays start to end, seeking works.
5. TikTok, Facebook, Instagram downloads still succeed (fallback path).
6. A download paused on the `v1.0.0-test1` build resumes after upgrading.

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
   unaffected. The "Video available" bar is hidden during fullscreen and correct afterwards.

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
   no library row, no watch-history entry); full player features (gestures, PiP, mini player, orientation). App Lock
   must show its PIN before anything plays.
4. **Save to VidoraX** button: a new native call copies the file into the library (`StoragePaths.newLibraryFile`, site
   "device"), makes a thumbnail, runs the SHA-256 duplicate check (`library/ContentHash.kt`, `SavedVideoIndex.kt`) and
   announces `onLibraryChange('imported')`. A second save says it's already in the library.
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
native `player/ActivityVisibility.kt`), except PiP.

**Build:**
1. Settings → **"Keep playing in background"** (in a Player section — add one if Settings has none), **off by default**, stored on the device.
2. Manifest: add `FOREGROUND_SERVICE_MEDIA_PLAYBACK` and the `expo.modules.video.playbackService.ExpoVideoPlaybackService`
   service exactly as `node_modules/expo-video/plugin/build/withExpoVideo.js` (lines ~34–60) would generate (exported
   false, `foregroundServiceType="mediaPlayback"`, `androidx.media3.session.MediaSessionService` intent-filter);
   app.json `supportsBackgroundPlayback: true`; replace the 2026-10-01 comment with an accurate one.
3. When the setting is on: `staysActiveInBackground` and `showNowPlayingNotification` on the player (check the exact
   expo-video API in `node_modules/expo-video/build/VideoPlayer.types.d.ts`); the lifecycle policy and the native
   activity-stop pause skip pausing. Notification shows title (and artwork if available); lock screen has play/pause
   and seek. PiP behaviour unchanged. Closing the player or reaching the end releases the service.
4. Setting off → today's behaviour exactly.
5. `docs/play-console/PLAY_SUBMISSION.md`: the mediaPlayback foreground-service declaration (description, user
   impact, demo-video steps). Confirm the merged manifest declares the service once
   (`apkanalyzer manifest print` on the release APK).

**Automated:** tests for the lifecycle decision with the setting on/off (background, inactive, activity stopped, PiP).
**Manual:** setting on → play → Home → sound continues with a media notification; screen off 5 min → continues;
lock-screen controls work; Bluetooth/headphones if available; close player → notification gone; setting off →
pauses on Home; PiP still works in both modes; mini player; a real phone (some makers kill background apps — record
the model).

### F2 — Speed control (4 points)

Features: Speed Limiter (#339), Per-download Limit (#340), Bandwidth Priority (#346).

**Build:**
1. A token-bucket limiter shared by every transfer stream (progressive parts and segments from F1), applied in the
   read loop. Global limit in Download Settings (Off, 256 KB/s, 512 KB/s, 1, 2, 5 MB/s); per-download limit in
   Download details; one download can be marked **Priority** and gets bandwidth first.
2. Contract + bridge + engine + screens, like F1's setting. Limits survive restarts.
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
4. No library row; no resume record.

**Automated:** tests for source building (headers, cookies, content-type mapping, split → not playable).
**Manual:** Mux HLS via the hls.js demo → Play at a chosen quality; w3schools MP4 → Play; a public Dailymotion/TikTok
video (needs Referer/cookies) → Play; DASH (Akamai bbb) → Play; Instagram split reel → no Play; PiP and mini player
with a stream; airplane mode mid-play → error, not crash.

### F14 — Seek preview frames (2 points)

Feature: Seek Thumbnail Preview (#530).

**Today:** scrubbing shows only a time label (`src/screens/player/components/SeekFeedback.tsx`,
`PlayerTimeline.tsx`). **Merge `origin/main` first** — Prompt A's F10 also changes `PlayerTimeline.tsx`.

**Build:** while dragging, show a small frame above the thumb using `player.generateThumbnailsAsync` (check the exact
options in `node_modules/expo-video/build/VideoPlayer.types.d.ts`): at most one request in flight, latest position
wins (~150 ms), cache by 1-second buckets, clear the cache on close. Local files only (no preview for F17 streams).

**Automated:** tests for the throttle and cache logic.
**Manual:** 1080p H.264 (10 min), HEVC, WebM: preview follows the finger without stutter; audio-only file → no
preview, no crash; landscape fullscreen; Urdu right-to-left; memory doesn't grow after 20 scrubs (`adb shell dumpsys
meminfo <package>`, record).

### F15 — Leftover download files cleaner (3 points)

Feature: Junk Cleaner (#852).

**Today:** native `DownloadEngine.clearTempFiles()` (~line 517) already deletes work folders under
`StoragePaths.workRoot` (`no_backup/work/<id>`) that belong to no unfinished download, and is exposed in
`VidoraMedia.types.ts` (~line 537) — but nothing in JS calls it. The Storage screen (`src/screens/storage/`,
`StorageActions.tsx`) only has Clear Cache. v1 temp folders are listed in
`src/storage-manager/services/storage-locations.service.ts`.

**Build:**
1. A native "measure leftovers" call (count + bytes) using the same keep-rule, extended for F1's per-part files.
2. Include orphaned v1 temp folders (HLS workspaces, multi-range parts) not owned by any active v1 record.
3. Storage screen: "Leftover download files — X MB" with **Clean up** + confirmation; afterwards "Freed X MB". Hidden
   when there's nothing to clean.
4. Never touch files of queued, running, paused or processing downloads.

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
   (≤ 15 % and not charging); "Only while charging".
3. Waiting states with clear labels, like today's "Waiting for Wi-Fi": "Scheduled for 02:00", "Waiting for charging",
   "Paused — battery low", "Paused — roaming", "Outside download hours".
4. Survives reboot and force-stop.

**Automated:** JVM tests for every rule with a fake clock, battery and network (window across midnight, weekday
filter, combined rules, rule changed while running).
**Manual:** schedule 3 minutes ahead with the app closed → starts (record delay); window excludes now → waits with
label; `adb shell dumpsys battery unplug` / `set level 10` / `reset`; roaming via the emulator console
(`adb emu gsm data roaming` / `home`); reboot with a scheduled download; real phone too.

### F4 — MPEG Program Stream: .mpg, .mpeg, .vob (2 points)

**Build:**
1. `plan/MediaSniffer.kt`: detect MPEG-PS (pack header `00 00 01 BA`, MPEG-1 and MPEG-2). Refuse scrambled/CSS DVD
   VOBs (PES scrambling control bits set) as protected.
2. `library/MediaTypes.kt`, JS `src/media-detection/constants/media.constants.ts`: `.mpg`, `.mpeg`, `.vob`;
   `video/mpeg`, `video/dvd`.
3. Processing (`process/Remuxer.kt` with Media3's PS extractor via `MediaExtractorCompat`, `process/Transcoder.kt`):
   output MP4; MPEG-1/2 video → H.264, MP2/AC-3 audio → AAC (follow ARCHITECTURE §1's conversion rule).

**Automated:** Kotlin tests with small ffmpeg fixtures (`ffmpeg -f lavfi -i testsrc=duration=3 -f lavfi -i
sine=duration=3 -c:v mpeg2video -c:a mp2 -f mpeg sample.mpg`, and `-f vob`), like `process/RemuxerTest`; a scrambled-
bit fixture is refused.
**Manual:** a public-domain `.mpg` from archive.org → detected → downloads → MP4 in the library → plays and seeks,
duration right; a local `.vob` fixture (debug build) the same.

### F6 — Live stream recording (6 points, behind a switch)

Feature: Live Stream Recording (#377). **Needs the client's sign-off before it's visible:** build it fully, but show it
only when Settings → Downloads → Advanced → **"Live recording (beta)"** is on (default **off**).

**Today:** `plan/HlsPlanner.kt` refuses live playlists (`LIVE_HLS_UNSUPPORTED`).

**Build:**
1. For a live, unencrypted HLS media playlist: "Record" instead of Download. Poll the playlist about every target
   duration, fetch new segments, keep order, handle discontinuities and playlist stalls, stop on user Stop,
   `EXT-X-ENDLIST`, a max duration (setting, default 2 h) or low storage.
2. Finalize to MP4 with the existing remux path. Process death → on next start, finalize what was recorded.
3. Downloads row: "Recording · 12:34 · 85 MB" with **Stop**. Same refusals (DRM, AES, YouTube). Live DASH is out of
   scope.

**Automated:** JVM tests with a fake live playlist (sliding window, discontinuity, gap, stall, endlist, max duration,
kill mid-recording).
**Manual (switch on):** a public unencrypted live HLS test stream (verify it's live with `curl`) → record 2 min →
Stop → plays ~2 min; force-stop mid-recording → reopen → finalized file plays; switch off → no Record button anywhere.

## 7. Finish

When all 11 tasks are done:
1. Full automated gate on the final branch head (including `connectedDebugAndroidTest`), and R1–R11 on a fresh
   release build plus one real phone. Record totals.
2. Work log complete (every manual case PASS or BLOCKED with a reason); PR checklist complete;
   `PLAY_SUBMISSION.md` has the F18 declaration.
3. Final message to the owner: a table of the 11 tasks (status, commits, tests added, manual cases passed,
   measurements), anything BLOCKED, decisions, new settings and their defaults, and "Found, not fixed".
