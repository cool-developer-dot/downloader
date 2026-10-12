# Work log — Faran · Opus · engine + Phase 16 core

Branch `faran/opus-engine` (from `main` at `a00b764`, with `origin/faran/sonnet-fixes` merged in because PR #1 is not
merged yet — merge commit `415f766`). Prompt: `docs/work-plans/faran-opus-prompt.md`. One task = its own commits,
prefixed with the task ID. Device: Pixel_8 AVD (API 35), `emulator-5554`.

## Baseline (2026-10-11, before any change)

| Gate | Result |
| --- | --- |
| `npm ci` | OK |
| `npm test` | 678 tests, 678 pass, 0 fail (111 suites) |
| `npm run typecheck` | OK (0 errors) |
| `npm run lint` | 0 errors, 84 warnings |
| `gradle :vidorax-media:testDebugUnitTest --rerun :vidorax-web:testDebugUnitTest --rerun` | BUILD SUCCESSFUL — vidorax-media 505 / 0 failures, vidorax-web 27 / 0 (result XMLs written 10:52) |
| `gradle :vidorax-media:connectedDebugAndroidTest` | 33 / 0 on `Pixel_8(AVD) - 15` |

Environment: macOS 26.6.2, Node 22.23.1, build-tools 37.0.0, Play upload key present in `~/.vidorax-signing` (never
read).

**test1 baseline APK.** `git worktree add /tmp/vx-test1 v1.0.0-test1` → `npm ci` → `bash scripts/dev/gradle.sh
:app:assembleRelease` (5 m 29 s). Kept outside the repo in `~/Downloads/VidoraX-QA-APKs/`:
`test1-release-uploadkey.apk` (as Gradle signed it, certificate SHA-256 `36b9c622…dd7b5af`, the same as Prompt A's) and
`test1-release-debugkey.apk` (zipaligned and re-signed with `android/app/debug.keystore`, for the per-task passes — see
Prompt A's test-build decisions, which this log follows).

---

## F1 — Parallel connections

### Known issue settled first: the 288p HLS file "missing one frame" / stuck in BUFFERING (Prompt A F9/F10)

**Reproduction.** Host side: the 64 segments of Mux `x36xhzz` 288p (`url_4/…_7.ts`, 10 s each, 30 fps) downloaded with
`curl` and concatenated exactly as `HlsTransfer` does — `ffprobe -count_frames` on that concatenation: **19,039 video /
13,656 audio frames, 634.63 s**. On the device, Prompt A's eleven 288p Gallery copies (each paused/resumed at a
different point in R6 runs, current engine) all have different MD5s (the muxer stamps creation times), but their
per-packet hashes (`ffmpeg -map 0 -c copy -f framemd5`) are identical to each other **and** to a host-side remux of
the plain, uninterrupted concatenation through the app's own `Remuxer` (scratch Robolectric test). So pause/resume
adds nothing: every HLS-TS download had the defect. Counts in those files: **18,979 video samples (60 missing) and
13,608 audio (48 missing)**; `ffprobe` decodes only 18,938 of the video samples ("illegal short term buffer state").

**Cause.** `process/MediaFiles` reads the assembled `.part` with Media3's `TsExtractor` in `MODE_SINGLE_PMT`, which
checks MPEG-TS continuity counters (confirmed in the 1.9.0 bytecode: on a jump → `TsPayloadReader.seek()`; on a repeat →
the packet is dropped as a duplicate). HLS packagers number every segment on its own: all 63 joins of this stream jump
on both the video and the audio PID. At each jump the PES reader is reset and the access unit it was still assembling —
the last frame of the segment before the join — is lost (60 one-frame gaps at 9.93, 19.93, … s). Because these
segments do not start on key frames, a lost reference frame also leaves the next frames undecodable until the next key
frame: 41 frames in 5 runs right after the joins at 70, 80, 190, 210 and 350 s. Prompt A's stuck position (84.0 s)
seeks back to the key frame at 77.9 s and decodes into the broken run at 80.0–80.4 s → BUFFERING. An HLS player never
sees this (it reads segments with `MODE_HLS`, which ignores the counters).

**Fix (in F1's segment code).** `transfer/TsContinuity`: as each TS segment is appended, every packet of a PID is
numbered one after that PID's previous packet (only the low nibble of header byte 3 changes; payloads, timestamps and
packet order do not; deterministic, so renumbering again is a no-op). The counters are kept in the HLS checkpoint
(`continuity`), so a resume continues them; a checkpoint written by an older build (no `continuity`) gets its whole
prefix renumbered once when it resumes. Proof: the same concatenation renumbered reads as 19,039 / 13,656 frames and
decodes with no error; `TsContinuityTest` shows the real fixtures losing a frame at a raw join and none after.
Decision: renumber at assembly (the `.part` becomes one valid transport stream — also the kept file of a stream with
discontinuities) rather than `MODE_HLS` in the remuxer (that mode refuses `seek` and gives no duration) or a
counter-rewriting `DataSource` (fragile at packet boundaries). ARCHITECTURE §3.2 updated.

### Design

- **Progressive** (`transfer/ProgressiveTransfer` + new `transfer/RangedDownload`). With "Connections per file" > 1 the
  first request asks `bytes=<from>-` (0 for a fresh file, the `.part` length for an existing one-connection partial).
  Parallel only when that answer proves it: a `206` starting at `<from>` with the total in `Content-Range`, at least
  16 MiB left, and a strong validator (strong ETag, else Last-Modified; a resumed partial's own validator). The `.part`
  is then pre-sized to the whole file (bytes before `<from>` stay), split into N equal parts, and each part is a bounded
  range (`If-Range` = the validator) written at its offset through one `FileChannel` (positional writes). The first
  response is read as the first part — no extra request.
- **Per-part checkpoint** `download.part.parts` (JSON: total, validator, `[start, end, done]` per part), written about
  once a second and whenever the transfer stops, always after `force()` and with counts read before it — so it never
  claims bytes not on disk. Pause, network loss and process death resume every part where it was; the setting lowered
  meanwhile just runs the same parts with fewer connections. A checkpoint that does not describe the file (a crash
  between writing it and sizing the file) keeps only its proven contiguous prefix as a one-connection partial.
- **Dynamic segmentation**: a free connection takes the second half of the largest running part when both halves are
  ≥ 1 MiB (a running part reads ≤ 64 KiB past where it is, so the cut never lands behind written bytes).
- **Fallback, never failure**: `200`/`416`/misaligned `206` to a part → continue on one connection from the bytes
  written contiguously from 0; another validator (a `206` with a different ETag, or a `200` to `If-Range`) → start over
  from 0 on one connection (`SourceChangedException`, the old "restart from zero" rule); `401`/`403`/`429` while other
  connections are open → the server limits connections: that part goes back to the queue and the download continues
  with one; a `403`/`416` to a fresh `bytes=0-` → the plain request (signed links that refuse any Range); a dropped
  part retries on its own (3 tries, refilled by progress). Only what one connection would also fail with (a `403` with
  nothing else open, `404`, a full disk) reaches the engine, which handles it as today (refresh, `SEGMENT_FAILED`,
  `NO_SPACE`…).
- **Size known small → today's exact requests**: the engine passes 1 connection when its probe already knows the file
  is under 16 MiB (most social videos), so their request pattern is unchanged.
- **HLS / DASH segments** (`transfer/HlsTransfer`): up to N segments fetched at once into `download.part.seg<i>`
  (`.tmp` while written, renamed when whole), appended strictly in playlist order with the existing per-segment
  sync + checkpoint. A fetch's failure is delivered only when its turn comes (a 503 on segment 3 never costs segments
  1–2); whole fetched-ahead files of the same stream are reused after a pause/restart (a zero checkpoint is now written
  at the start so even "paused before the first segment" keeps them). N = 1 is the old one-by-one path.
- **Engine**: `connectionsFor(size)` per transfer; `PartProgress.bytesOnDisk` (parts' bytes, not the pre-sized
  file's length) for progress, the retry budget, `hasRoomFor` and the paused-row reconciliation. Speed/ETA/notification
  get the combined bytes (one progress callback, thread-safe). Still one `maxConcurrent` slot per download.
- **Setting**: `DownloadSettings.connectionsPerFile` (1–4, default **3**; optional in the contract, an older bundle gets
  3) → `DownloadSettingsRecord` → engine → SharedPreferences (`connectionsPerFile`, survives a force-stop and is read
  before JavaScript runs); JS: settings store (`connectionsPerFile`, persisted in the zustand preferences),
  `v2DownloadSettings`/`sameV2Settings`, pushed by `ensure-bridge.ts`, Download Settings → Performance → "Connections
  per file" (segmented 1–4), en + ur strings.

**Tester-facing constants:** `DownloadSettings.DEFAULT_CONNECTIONS = 3`; `RangedDownload.MIN_PARALLEL_BYTES` (16 MiB),
`MIN_SPLIT_BYTES` (1 MiB), `CHECKPOINT_MS` (1 s), `MAX_PART_ATTEMPTS` (3).

**Found on the device and fixed during F1 (before commit):**
- *Several "connections" were one TCP connection.* test-videos.co.uk (and most CDNs) speak HTTP/2, and OkHttp
  multiplexes every request to a host on one connection: the release build's three ranges showed up as streams on the
  app's existing sockets (the app's established TCP count to the server stayed flat). Fix: `HttpClient.separateConnections`
  — the same client (cookies, interceptors, URL policy) on HTTP/1.1 with its own pool; parts and fetched-ahead
  segments use it, so each request in flight is its own TCP connection (after the fix the count rises by the
  connection setting during a download). Unit test `theSeparateConnectionClientSpeaksOnlyHttp11AndKeepsCookiesAndPolicy`.
- *HLS progress could step backwards* between the assembly loop and the fetch-ahead threads (the engine reads a drop
  as a restart and resets its speed meter) → progress is monotonic within a run.
- *Files the probe already knows are small kept today's exact requests* (no `bytes=0-` first request) — found when
  the instrumented throttle tests showed the request pattern change for small files.

**Fixture server** (`fx-f1.mjs` in the session scratchpad, not committed): a page per case with a 30.7 MB MP4 (the BBB
file + a `free` box naming the case, so every case is its own file), full Range/If-Range semantics, strong ETag,
per-connection throttle of 2 MB/s after the first 2 MiB, and a request log with the connections open at once. (A first
version kept `HEAD` responses open while it "sent" a body — the JS MIME probe then timed out; fixture bug, not the app.)
- *A server's unquoted ETag broke every resume* (found in case 2): upload.wikimedia.org sends `ETag: 19a40f3e…`
  without quotes; replayed as `If-Range` it never matches, so the server returns the whole file — before F1 every
  resume of such a download silently restarted from byte 0 (the R10 paused WebM did), and with F1 every part fell back
  to one connection, discarding the other parts' bytes (112.5 MB → 39.7 MB on the device). `Validators` quotes it (the
  same server then answers 206, checked with curl for bounded and open ranges), weak ETags still fall back to
  Last-Modified, validators stored by older builds are normalised. Commit `b52c534`.
- *Splits that only add a wait*: on a server slow to answer, a late split's request waited longer than it saved →
  splits now need the part's remaining time to exceed twice the measured request latency, and a free connection that
  cannot judge yet re-checks every 250 ms instead of stopping.

### Automated (final F1 code, `4c98cf7`, run 17:45–17:47)

| Gate | Result |
| --- | --- |
| `npm test` | 680 / 680 (baseline 678; +2 settings tests) |
| `npm run typecheck` | OK |
| `npm run lint` | 0 errors, 84 warnings (= baseline) |
| `:vidorax-media:testDebugUnitTest --rerun` | 551 / 0 (baseline 505, +46; result XMLs written 17:46: `ParallelTransferTest` 23, `TsContinuityTest` 7, `DownloadEngineParallelTest` 5, HLS +8, Records +1, HttpClient +2, ProgressiveTransfer +1) |
| `:vidorax-web:testDebugUnitTest --rerun` | 27 / 0 (unchanged module) |
| `:vidorax-media:connectedDebugAndroidTest` | 37 / 0 (baseline 33; +3 progressive parallel, +1 HLS parallel ×3 pauses with ExoPlayer playback) |
| `git diff --check` | clean |

New JVM tests (what each pins down): range support → N parts (`bytes=0-` + bounded parts with `If-Range`); one
connection = today's single plain GET; no range support → 1; small file → 1; weak ETag only → 1; Last-Modified is a
validator; a signed link refusing any Range → plain GET; `200` to a bounded range → one connection, file intact; extra
connections refused 403 → carry on with one; the only connection refused → the download's 403; a dropped part retried
alone; dynamic split; no late split on a slow-to-answer server; kill → every part resumes at its checkpoint; changed
resource → restart from 0; disk full → `StorageWriteException` (engine: `NO_SPACE`), parts kept; an old one-connection
partial continued in parallel; fewer connections after a pause; a checkpoint that does not describe the file keeps only
its proven prefix; plan/prefix arithmetic; the checkpoint holds every reported byte after a cancel and after a dropped
network; unquoted-ETag server gets every part as a range; HLS: parallel segments written in order, **3 pause/resume
cycles byte-identical to an uninterrupted download**, a failing later segment never costs earlier ones, fetched-ahead
whole segments reused, an older build's TS checkpoint renumbered on resume, continuity kept in the checkpoint;
`TsContinuity` rules incl. the real fixtures losing a frame at a raw join and none after; engine: the setting decides
the connection count (and a change applies to the next download), combined monotonic progress, paused parallel
download keeps its real bytes across a restart, cancel removes the part and its checkpoint, full disk → `NO_SPACE`;
`DownloadSettingsRecord` default 3 / range 1–4; `HttpClient.separateConnections` HTTP/1.1 only + cookies + policy;
`Validators`.

### Manual cases

| # | Case | Build | Result | Note |
| --- | --- | --- | --- | --- |
| 1 | 30 MB BBB (`curl -sI -r 0-1`: 206, strong ETag, 30,704,510 B), 1 vs 3 connections, 3 runs each | release (+debug for byte timelines) | PASS (measured) — no speed-up possible on this link | **Release, tap → completed (Gallery copy mtime):** 1 connection 23.6 / 21.5 / 20.4 s (plain URL 21.6 / 19.9 s); 3 connections 29.7 / 32.7 / 50.3 s (plain URL 46.5 / 37.3 s). **Engine's own byte timeline (debug, back to back):** 1 connection 30.7 MB in 17.2 s, 3 connections in 16.6 s and 18 s — same rate. The link is the limit: host `curl` on the same network, 1 vs 3 parallel HTTP/1.1 ranges, 19.8 / 18.9 s (BBB) and 25.9 / 26.3 s (Wikimedia 40 MB) — ~1.6–1.7 MB/s total whatever the connection count. The release spread comes from the phases before the transfer (probe/first-byte waits of 1–18 s on this server) and slow individual flows, not from the parallel code (notification timelines show the same ~1.7 MB/s while bytes move; checkpoint syncs take 8 ms avg, 16 ms max). Where a connection is the limit the speed-up is real: fixture with a 2 MB/s-per-connection cap, 30.7 MB in 14.6 s (1) / 4.2 s (3) / 2.85 s (4); fixture with a 1.6 MB/s shared cap, 19.0 vs 19.1 s via adb reverse and 19.0 vs 20.0 s via the emulator NAT (no penalty). A real phone on a faster link is BLOCKED (none available) |
| 2 | Pause ~40 %, airplane ~60 %, force-stop ~70 % (Wikimedia 168 MB WebM, 3 connections) | release | PASS | pause at 67 MB → held 67 MB for 8 s → resume; airplane mode at 101 MB, 16 s offline, network back → 121 MB 12 s later (no restart); force-stop at 121 MB → reopen → resumed on its own (144 MB 15 s later) → completed, SHA-256 `139b7ba2…` = source. 139 notification samples: one 103 → 101 MB step at the waiting → downloading switch (the notification rendering the row's last persisted count; the parts' checkpoint provably holds every reported byte — two new JVM tests). First attempt (before `b52c534`) found the unquoted-ETag bug |
| 3 | SHA-256 of the app's file vs `curl … \| shasum -a 256` | debug (`run-as`) | PASS | BBB 30 MB: both `5b603ec1…b453bc`; release: 168 MB WebM over 3 connections = source |
| 4 | Mux HLS high quality (720p, 64 segments, 170 MB) | release | PASS | uninterrupted 3 connections: transfer 106 s; 1 connection 113 s; 3 connections with **3 pause/resume cycles**: 160 s incl. pauses — all three files: **38,075 video / 27,312 audio frames = the source** (`ffprobe -count_frames` on the playlist), 0 decode errors, identical per-packet hash `6687ed7b…`. Player: PLAYING; seeks to 86 s, 96 s, 319 s, 578 s each played on (pause-position deltas 6.1 s per 6 s; no stall near the old 80–84 s point) |
| 5 | TikTok, Facebook, Instagram still succeed | release | see R4 below | small files take the unchanged one-connection path (`connectionsFor`) |
| 6 | "Connections per file" really changes the connection count | debug + fixture log | PASS | default 3: probe `bytes=0-` + 3 parallel ranges, peak 3 open, 4.2 s; set 1 (engine prefs `connectionsPerFile=1`): probe + one plain GET, 14.6 s; set 4 → **force-stop** → reopen → without touching Settings: 4 parallel ranges, peak 4, 2.85 s. All three files SHA-256 = what the server sent |
| 7 | A download paused on `v1.0.0-test1` resumes after upgrading | release over test1 | PASS | (a) 288p HLS paused on test1 at 29.6/37.6 MB → upgrade → resumed → 19,039 / 13,656 frames, 0 decode errors (its test1-assembled prefix renumbered); (b) WebM paused on test1 at 28.2 MB (one-connection `.part`, unquoted-ETag validator) → R10 → resumed and completed, SHA-256 = source |

Extra device checks: settings screen (English) shows the new row and segmented control in Performance; engine prefs
follow every change; combined speed/ETA in the Downloads row ("12.9 MB of 160.7 MB · 1.1 MB/s · 2m left") and the
notification ("Downloading · 103 MB of 168 MB · 2.2 MB/s").

### Regression (release build of `b52c534` — the code of `4c98cf7`; debug-key re-signed, installed over a freshly seeded test1)

| # | Result | Note |
| --- | --- | --- |
| R1 | PASS | browser chrome at 6.1 / 6.2 / 6.1 s (test1 6.2–6.4 s); no VidoraX crash (the first run flagged `uiautomator`'s own crashes in the crash buffer — `regress.py` now counts only the app's) |
| R2 | PASS | w3schools MP4 176p → Player PLAYING |
| R3 | PASS | hls.js demo → quality sheet → 184p completed (19.1 MB) |
| R4 | PASS | TikTok 576p completed, Facebook completed (2nd run — the 1st met the PIN screen left by R8's scripted disable) |
| R5 | PASS | `F1_r5_toast.png`: "YouTube downloads are not supported", page unchanged |
| R6 | PASS | 288p paused at 32.6 / 37.7 MB, unchanged after 8 s, resumed; **force-stop → running again on its own**; completed |
| R7 | PASS | 00:04 → +10 00:14 → −10 00:04 → seek 05:19, PLAYING, fullscreen ROTATION_90, PiP |
| R8 | PASS | `r8.sh`: PIN screen after enable + Home, none after disable (the scripted R8's disable failed again, as in Prompt A) |
| R9 | PASS | Settings in Urdu (27 strings, no Latin-only label); Download Settings in Urdu: the new row mirrored RTL (`F1-connections-setting-ur.png`) |
| R10 | PASS | 1 download, favorite, 5 history entries, recent-search row; **the WebM paused on test1 at 28.2 MB resumed and completed, SHA-256 = source** |
| R11 | PASS | Akamai `bbb_30fps.mpd` → 7 qualities (180p–1080p, listed as "MP4") → 180p downloaded and merged: H.264 320×180 634.6 s + AAC 634.3 s, 0 decode errors, plays. The script's completion check looked for "DASH"/"bbb" in the row and missed it (the row carries the previous page's title, see Found) — fixed in `regress.py` |
| R12 | Behaviour PASS, label FAIL (pre-existing) | Wi-Fi only on + `svc wifi disable` (mobile data default): mid-transfer held at 25.8 MB; from the start held at 0 B for 8 s+ (notification "Waiting for network · 0 B of 30 MB"); Wi-Fi back → continued (7.7 → 14 MB) and completed. The Downloads row says **"Queued"**, not "Waiting for Wi-Fi": `src/downloads/v2/projection.ts` maps `waiting_network` to QUEUED — identical in `v1.0.0-test1` (Found, not fixed). The script's first run failed because the mini player kept Settings from opening (R12 never switched Wi-Fi only on) |

Case 5 (social): TikTok + Facebook in R4; Instagram `/reel/DSxdvp9lcDa/` → offered by the pasted-link analyzer → "Video downloaded".

**Evidence for the PR** (`.claude/pr-evidence/`, not committed): `F1-connections-setting-en.png`,
`F1-connections-setting-ur.png`.

### Decisions (F1)

- Renumber TS continuity counters at assembly (not `MODE_HLS` in the remuxer, not a rewriting DataSource) — see above.
- First request `bytes=0-` only when parallel is possible (the probe's size unknown or ≥ 16 MiB); smaller files keep
  their exact old requests.
- One parts checkpoint file with every part's progress (atomic, consistent) rather than one file per part.
- A lowered connection setting resumes the same parts with fewer connections (no bytes discarded); a raised one
  applies to the next download.
- Parts on HTTP/1.1 connections of their own (`separateConnections`); HLS fetch-ahead too.
- Fetched-ahead HLS segments are kept across a pause (whole files only, `.tmp` until complete; a zero checkpoint at the
  start ties them to the stream).
- Splits only when they pay off (2 × request latency), re-checked every 250 ms while undecidable.
- Unquoted ETags are quoted (Wikimedia answers 206 to the quoted form); old stored validators normalised.
- R12's label gap and the title issue are pre-existing → logged, not fixed (scope rule).

### Found, not fixed (F1)

- **"Waiting for Wi-Fi" is never shown in the Downloads row** (R12): `src/downloads/v2/projection.ts` maps
  `waiting_network` to `QUEUED`, so the row says "Queued"; the native notification says "Waiting for network" also
  when only Wi-Fi-only holds it. Same in test1. (`downloads.waitingWifi` strings exist but nothing reaches them.)
- **A direct file / manifest link gets the tab's previous or current page title**: the Akamai DASH download was saved
  as the earlier Facebook page's caption; a download whose tab was sent Home right after the tap is titled "Home".
  (Prompt A noted the first case.)
- **The JS verification probe gives up after 5 s** (`TRANSFER_TIMEOUTS.probeTimeoutMs`): on a slow server
  (test-videos.co.uk from the AVD, 1–18 s to first byte at times) the offer never appears (`PROBE_FAILED`, transient,
  3 reruns) although the engine could download it.
- The quality sheet labels DASH qualities "MP4" (the output container), not "DASH".
- AVD housekeeping: `/sdcard/Movies/VidoraX` still holds ~1.2 GB of Gallery copies from earlier sessions (left alone;
  this session's own copies were removed). The data partition was at 94 % mid-session.
- Test tooling: `uiautomator dump` fails while the Downloads progress animates (and occasionally crashes with
  "UiAutomationService already registered" when dumps overlap) — progress is read from `dumpsys notification` instead.

---

## F13 — Web video fullscreen

**Evidence for the PR** (`.claude/pr-evidence/`, not committed): `F13-w3schools-landscape.png`,
`F13-after-back-portrait.png`, `F13-tall-video-stays-portrait.png`.

### Before (debug build of `5d1703f` + only `allowsFullscreenVideo: true`, w3schools, auto-rotate off)

- react-native-webview's own chrome client shows the page's video view over the whole app and hides the bars; it sets
  `SCREEN_ORIENTATION_UNSPECIFIED`, so with auto-rotate off a wide video stays **portrait**; leaving restores the
  orientation captured when the WebView was created (portrait).
- Back key and the back gesture (navigation mode 2: the first edge swipe shows the bars, the second goes back) already
  leave fullscreen: Chromium's fullscreen view has focus and consumes Back — the JS Back chain never saw the press, the
  page did not navigate.
- **The page lost its place**: after leaving (Back or the page's own button) the page was at the top. Measured with
  DevTools on the page: `fullscreenchange` (enter) fires with `scrollY` 265 still correct, then a `scroll` to 0 while
  the element is fullscreen; after leaving `scrollY` stays 0.

### Design

- **Page side** — `buildBrowserChromeBeforeContentScript()` (document start, main frame, every document) gets a
  fullscreen observer: on `fullscreenchange` / `webkitfullscreenchange` it posts `fullscreen` on the browser-chrome
  channel with `{ active, width?, height? }`. The size is the video's own (`videoWidth`/`videoHeight`): the fullscreen
  element itself, else the best `<video>` inside it (playing first, then the largest; open shadow roots and
  same-origin iframes searched, bounded); a cross-origin iframe (Dailymotion's player) gives its `width`/`height`
  attributes when it has both; otherwise no size. While fullscreen it listens to the chosen video's
  `loadedmetadata`/`resize` and posts again when the size becomes known or changes. Posts are de-duplicated.
- **Keeps the page's place** — the same script remembers the scroll position when fullscreen starts (the last
  position seen outside fullscreen when that is 0) and, after leaving, scrolls back once the viewport is the
  pre-fullscreen width again (rotation back to portrait), for up to `FULLSCREEN_RESTORE_MS` (1500 ms) or until the
  user touches the page.
- **Decision** — `src/browser/fullscreen/web-fullscreen-orientation.ts`, pure: no/invalid size → landscape (fullscreen
  is overwhelmingly for wide video, and Dailymotion's cross-origin player reports none); `width / height ≥
  WEB_FULLSCREEN_WIDE_RATIO` (1.1) → landscape; else (tall or square) → portrait. A later size message re-decides.
- **Orientation** — through `src/player/orientation-controller.ts` (`lockWebFullscreenOrientation`,
  `restoreWebFullscreenOrientation`; the player's own mode is untouched). The adapter is bound with
  `ensurePlayerChromeRuntime()`. `LANDSCAPE` is `SENSOR_LANDSCAPE`, so it rotates with system auto-rotate off. Our lock
  lands after react-native-webview's `UNSPECIFIED` (the page event follows `onShowCustomView`).
- **State** — `web-fullscreen.controller.ts` (pure, dependencies injected, unit-tested) holds which tab is fullscreen
  and the applied orientation. A message from a parked tab is answered with an exit and nothing else.
- **Only the active tab** — found on the device: a parked tab's page that requests fullscreen (still-valid user
  activation, e.g. a slow page after a quick tab switch; reproduced with DevTools) **was** shown over the whole app as a
  black view, and its throttled renderer never fired `fullscreenchange`, so nothing in JS could see it. Fix:
  `allowsFullscreenVideo={… && isActive}`. A parked WebView then gets react-native-webview's plain
  `RNCWebChromeClient`, which does not override `onShowCustomView`, so WebView reports fullscreen as unsupported and
  the request is refused; and on a tab switch react-native-webview calls the old client's `onHideCustomView` first —
  the old tab's video view closes natively even if its page never runs the exit script. (react-native-webview keeps
  the flag manager-wide but only reads it when it sets up a view's chrome client — at creation and when that view's
  own `allowsFullscreenVideo` / `hasOnOpenWindowEvent` prop is applied; tabs mount only while active, so every parked
  WebView got there through a prop change.)
- **Leaving** — the app asks the page to leave (`document.exitFullscreen()` injected into that tab) and restores
  portrait at once, so a page that never answers cannot trap Back or keep the app sideways. Triggers: Back (JS chain,
  ahead of page history — a fallback, Chromium normally consumes it first), the active tab changing, the tab switcher
  opening, the app going to the background, leaving the Browser route (e.g. a notification opens Downloads — the video
  view would otherwise cover every screen). The page navigating away, its renderer going, or its WebView unmounting
  clear the state and restore portrait without a message.
- **"Video available" bar** — hidden while fullscreen (`overlayBlocking`), shows the current detection state after.
- **Patch** — the new chrome client is react-native-webview's own `RNCWebChromeClient` subclass; our hooks live in the
  WebViewClient, the download listener, `onWebViewCreated` and the document-start script, none in the chrome client.
  Proven by the patch test and a detection + download after leaving fullscreen.
- Translated pages (`translate.goog`) are main-frame documents like any other: same script, same path.

Tester constants: `WEB_FULLSCREEN_WIDE_RATIO` = 1.1 (`src/browser/fullscreen/web-fullscreen-orientation.ts`),
`FULLSCREEN_RESTORE_MS` = 1500 (`src/browser/bridge/browser-chrome.injected.ts`), `allowsFullscreenVideo` = true
(`src/browser/webview/webview-configuration.ts`, false turns the feature off). No setting: it is the page's own button.

### Automated (final F13 code)

| Gate | Result |
| --- | --- |
| `npm test` | 705 tests, 705 pass, 0 fail — new: `web-fullscreen-orientation.test.ts` (5: wide / tall / square & threshold / unknown & invalid / normalise), `web-fullscreen.controller.test.ts` (9: lock, re-decide, page exit, parked tab refused, leave = Back consumed and no trap, tab switch, navigation/crash/unmount, second tab, failing lock), `browser-chrome.bridge.test.ts` (3: `fullscreen` parsing), `browser-chrome.fullscreen.test.ts` (8: the injected observer in a VM — video / container / shadow root / same-origin frame / cross-origin frame attributes / late metadata / scroll restore after rotation, zoom-independent / fallback position, touch ends it / one install per document) |
| `npm run typecheck` | OK |
| `npm run lint` | 0 errors, 84 warnings (unchanged) |
| `node --test scripts/patch-react-native-webview.test.mjs` | 5 / 5 |
| `gradle :vidorax-media:testDebugUnitTest --rerun :vidorax-web:testDebugUnitTest --rerun` | BUILD SUCCESSFUL — 551 / 0 and 27 / 0 (XMLs written 19:03–19:04); no native code changed in F13 |
| `git diff --check` | clean |

### Manual cases — debug build (Metro, `EXPO_PUBLIC_VIDORAX_PIPELINE_TRACE=1` for WebView DevTools), system auto-rotate **off**

Orientation read from `dumpsys activity activities` (`requestedOrientation`), page state from WebView DevTools,
screens from `screencap`. Fixture pages (`fx13.mjs`, scratchpad) serve 360×640 / 480×480 / 640×360 videos, a container
with a `preload="none"` tall video, and cross-origin frames from a second host.

| Case | Result |
| --- | --- |
| w3schools (320×176) — page's own button | PASS: `SENSOR_LANDSCAPE`, plays in landscape, Back → `PORTRAIT`, page back at `scrollY` 238 (was 0 before the fix); page's exit button same |
| hls.js demo (Mux 1280×720) | PASS: landscape; page controls in fullscreen: pause (paused = true), seek bar → 5:17; Back → portrait, `scrollY` 701.7 restored (page has no viewport meta: comes back at WebView's overview zoom — see limits) |
| Dailymotion `x9zk0s0` (player in a cross-origin frame, `width/height="100%"` → no size) | PASS: landscape; player controls shown; Back → portrait, "Video available" back; **download after leaving: 288p HLS → Completed, MP4 36.2 MB** |
| Facebook public video | **BLOCKED (site)**: logged-out mobile Facebook has no fullscreen button in any player — watch viewer (play/pause/±10 s only), reel viewer, embed plugin (none even at 560 px); desktop-site mode keeps the mobile site. Extra: Facebook's own `<video>` (1280×720) put fullscreen via DevTools → landscape, Back → portrait |
| Tall video, native controls (360×640) | PASS: stays `PORTRAIT`, fills the screen; page's exit button → `scrollY` 301 restored, "Video available" back |
| Square video (480×480) | PASS: stays portrait |
| Container, `preload="none"` tall video | PASS: no size → landscape; after `play()` the 360×640 size arrives → re-decided to portrait (`reorient`) |
| Cross-origin frame 315×560 / 560×315 attributes | PASS: portrait / landscape |
| "Video available" during fullscreen | PASS: absent from the view tree while fullscreen (tall case), present after |
| Home while fullscreen, back to the app | PASS: on return out of fullscreen, portrait, same scroll (the WebView ran the exit on resume) |
| Another screen opens while fullscreen (`vidorax://downloads`, like a notification tap) | PASS: Downloads shown in portrait, not covered (the activity pause already left fullscreen: `leave background`) |
| Page navigates away while fullscreen | PASS: `gone navigation`, portrait, new page normal |
| Parked tab requests fullscreen (DevTools, user gesture) | **FAIL first** (black view over the whole app, no `fullscreenchange`, Back needed) → fixed (active-only `allowsFullscreenVideo`) → PASS: `fullscreenEnabled` false in the parked page, request refused "Fullscreen is not supported", app untouched; active tab still enabled; a re-activated tab enters fullscreen |
| Tab switch / tab switcher while fullscreen | Not reachable from the UI (the video view covers the app); covered by the unit tests and by react-native-webview's `onHideCustomView` on the prop change |
| Translated page (`www-w3schools-com.translate.goog`, Urdu) | PASS: landscape, Back → portrait, `scrollY` 404.6 restored, "Already downloaded" offer intact |
| App in Urdu (RTL) | PASS: same behaviour (landscape, Back → portrait, scroll kept); no new strings in F13 |
| Back gesture (navigation mode 2) | PASS (also before F13: Chromium's view consumes Back; our JS Back is the fallback) |
| Real phone | BLOCKED: no phone available |

### Manual cases — release build (`F13-release-debugkey.apk`, installed over the seeded test1), auto-rotate off

The release build allows HTTPS only, so the local fixture pages are debug-only; release uses public pages.

| Case | Result |
| --- | --- |
| w3schools, page's fullscreen button | PASS: `SENSOR_LANDSCAPE`, plays landscape (`F13-w3schools-landscape.png`); Back → `PORTRAIT`, same place on the page, offer bar back (`F13-after-back-portrait.png`) |
| Tall public video — Wikimedia Commons "Astrophysics Holiday Vertical Video" (1080×1920, video.js player, fullscreen with its `F` key: the player's control row sits under the "Video available" bar on this page) | PASS: fullscreen stays `PORTRAIT`, fills the screen (`F13-tall-video-stays-portrait.png`); "Video available" absent from the view tree while fullscreen, back after Back |
| Home while fullscreen, back to the app | PASS: out of fullscreen, portrait, bar shown |

### Regression (release build of the F13 code, debug-key re-signed, installed over a freshly seeded test1)

| Check | Result |
| --- | --- |
| R1 cold start | PASS — 6.2 / 6.0 s with the branded splash; the 1.5 s readings are starts where the splash was skipped (see Found, not fixed: test1 does it too, 1 of 6) |
| R2 HTML video | PASS (offer, 176p MP4 completed, plays) |
| R3 hls.js | PASS (sheet 3+ rows, 184p completed) |
| R4 TikTok + Facebook | PASS on rerun (first run blocked by the App Lock left on by R8's scripted disable) |
| R5 YouTube refused | PASS — toast "YouTube downloads are not supported" confirmed on `F13_r5_toast.png` |
| R6 pause / resume / force-stop | PASS on rerun (first run: the script could not pick 288p — sheet timing): paused at 33.3 MB of 37.7 MB, unchanged after 8 s, resumed, running again after force-stop, completed |
| R7 player | PASS (±10 s, seek, fullscreen `ROTATION_90`, PiP) |
| R8 App Lock | PASS by hand (script's disable step flaky, as in F1): PIN screen after enabling (`F13_r8_locked.png`), no PIN after disabling (`F13_r8_after_disable.png`) |
| R9 Urdu | PASS on rerun (27 Urdu strings on Settings, no Latin-only labels) |
| R10 test1 data | PASS (download, favourite, history, recent search, the paused test1 download resumed and completed) |
| R11 DASH | PASS on rerun (qualities 180–1080, 180p completed, plays) |
| R12 Wi-Fi only | Behaviour PASS from screenshots: held at 11.4 MB on mobile data (row says "Queued" — known since F1), running 72.1 MB of 92.2 MB after Wi-Fi returned; the script read the row too early |

### Decisions (F13)

- Fullscreen state and size come from the page (`fullscreenchange` in the document-start script), not from a new native
  hook — no patch change, no rebuild; the native side only matters for the parked-tab case, solved with the existing
  `allowsFullscreenVideo` prop per tab.
- Unknown size → landscape (Dailymotion's cross-origin player reports none; web fullscreen is overwhelmingly wide
  video). A late size re-decides.
- Square → portrait (as large either way; no rotation). Threshold 1.1 : 1.
- The app restores portrait at once when it leaves fullscreen itself, without waiting for the page: a page that never
  answers cannot trap Back or leave the app sideways.
- Backgrounding leaves fullscreen (the task asks for it); the WebView runs the exit when the app is resumed.
- The scroll-position fix belongs to F13: the page losing its place is a defect of the fullscreen this task enables.
- No setting; the constants above are the tester knobs. No user-visible strings were added.

### Found, not fixed (F13)

- **The branded splash is sometimes skipped on a cold start** — the browser shows at ~1.5 s instead of after the ~6 s
  splash, although `resolve-initial-route.ts` says it is never skipped: test1 1 of 6 cold starts, this build 2 of 5
  (frame-by-frame sampling). `scripts/qa/coldstart.sh` then reports 1.5 s.
- **The "Video available" bar covers the bottom of the page** (it overlays the WebView): on Wikimedia Commons the
  video dialog's control row, including its fullscreen button, sits under it.
- Pages without a mobile viewport tag (the hls.js demo) come back from fullscreen at WebView's zoomed-out overview
  scale; the scroll offset itself is restored.
- Facebook (logged out, mobile site) offers no fullscreen control in its watch viewer, reel viewer or embed player;
  VidoraX's desktop-site switch keeps the mobile site there.
- Dailymotion: the legacy embed URL (`/embed/video/<id>`) now redirects to a player page that answers 403 (also from
  the Mac); the video page itself works. Its cookie banner offers only "I understand" (not tapped).
- Test tooling: the emulator screen went black for ~1 min under load right after a cold start of the debug build
  (launcher black too; recovered by itself); `regress.py`'s R12 reads the row before it refreshes.

---

## F16 — Open video files from other apps

### Design

- **Manifest** — `MainActivity` gets `VIEW` + `DEFAULT` filters for `video/*` and `audio/*` on `content` and `file`
  (no `http`: the browser filter owns web links). No permission.
- **Native (vidorax-media, `incoming/`)** — `IncomingMediaIntents.parse` (pure): a `VIEW` whose data is `content:` or
  `file:` and whose type (the intent's, else the resolver's, else the display name's extension) is a known audio/video
  type; anything else (http, no data, unknown type) is ignored. `IncomingMediaReader` fills the display name and size
  (`OpenableColumns`, or the file), takes a persistable read grant when the intent offers one, and marks the intent
  consumed (a JS reload does not reopen it). The URI stays native: JS gets a **token** — the first 32 hex of
  SHA-256(`incoming:` + URI) — so the same file opened again has the same token (resume key) and no URI ever reaches
  a router path or a log. `IncomingMediaRegistry` (in memory, last 32) maps token → URI/name/type/size. Cold start:
  `consumeIncomingMedia()`; while running (`singleTask`): `OnNewIntent` → `onIncomingMedia` (kept for
  `consumeIncomingMedia` when JS is not listening, like `SharedText`).
- **Contract** — `IncomingMedia { token, displayName, mimeType, sizeBytes, kind }`, `getIncomingMediaSource(token)`
  (the playable URI, for the player only), `importIncomingMedia(token)` → `{ status: 'imported', item } |
  { status: 'duplicate', libraryItemId, galleryUri }`, `openIncomingWith(token)`, event `onIncomingMedia`; `SiteId`
  gains `device` (`SiteId.DEVICE`, folder "Device").
- **Save to VidoraX** (`library/IncomingImport`) — copies the stream into a work file (SHA-256 while copying, free-space
  check first), `SavedVideoIndex.findByContent` → duplicate (work file deleted) or: type from name/MIME/container,
  `StoragePaths.newLibraryFile(DEVICE, title, id, ext)`, thumbnail, `LibraryStore.insert` (no gallery copy — the file
  is already on the device), content hash stored, announced as `imported`. A file Android cannot decode is still kept
  (the F5 keep-and-"Open with" rule); a file that is not audio/video at all is refused; every failure removes the work
  file, the library file and the thumbnail.
- **JS** — `src/player/external-media.ts` (pure): media id `external:<token>` (passes `assertSafeMediaId`), a registry
  of incoming records, predicates. `src/player/incoming-media.runtime.ts`: reads the launch intent and listens; each
  file becomes a pending target opened by `IncomingMediaHost` (inside `AppLockGate` in the `(app)` layout) once the
  launch has handed over (`src/navigation/launch-handover.ts`, see below) and only while App Lock is off or unlocked —
  nothing plays behind the PIN. The playback
  resolver plays `external:` ids from `getIncomingMediaSource` (like `device:` ids); the persistence coordinator keeps
  their position under the same id (= hash of the URI) but `listLocalPlaybackSummaries` drops `external:` ids, so they
  never appear in Watch history / Continue watching; no library row; Previous/Next have no queue. The Player shows a
  **Save to VidoraX** button for an external session (toast: saved / already in the library / failed / no space) and
  "Open with" on its error screen opens the original file in another app.

**Found while testing and fixed in F16** (design additions):

- **Cold start lost the file to the splash.** The router already shows `/browser` under the branded splash, and the
  splash ends with `router.replace(post-splash route)` — the Player opened before that was replaced (its session went
  on in the mini player). New `src/navigation/launch-handover.ts`: the splash marks `splashShown` on mount and
  `launchHandedOver` after its replace (the onboarding pages mark it when they finish, on a first launch);
  `IncomingMediaHost` waits for it. A launch where no splash appears within 5 s (`NO_SPLASH_HANDOVER_MS`; the known
  "splash sometimes skipped" case) counts as handed over.
- **An audio file stayed on "Preparing video" with no controls** although it played: the startup cover waits for a
  first video frame. `revealsWithoutFirstFrame(mimeType)` — an `audio/*` source is revealed when it is ready (also
  helps audio already in the library).
- **WMV (no decoder) showed "Unreadable video" with no way out.** For an external file the error screen now offers
  "Open with…" for `CORRUPT_MEDIA` too, and **Save to VidoraX** (the file is kept, F5 rule) — library videos unchanged.
- `content:`/`file:` links are non-routes in `src/app/+native-intent.ts` (expo-router would otherwise route them and
  stack a second app tree, as with web links).

Tester constants: `IncomingMediaRegistry.DEFAULT_CAPACITY` 32, `IncomingImport.FREE_SPACE_MARGIN_BYTES` 32 MiB,
`NO_SPLASH_HANDOVER_MS` 5000 (`src/player/IncomingMediaHost.tsx`). No setting: "Open with" is chosen in Android.

**Evidence for the PR** (`.claude/pr-evidence/`, not committed): `F16-open-with-chooser.png`, `F16-saved-to-vidorax.png`,
`F16-already-in-library.png`, `F16-mp3-cold-start.png`, `F16-app-lock-first.png`, `F16-pip.png`, `F16-saved-urdu.png`,
`F16-wmv-open-with.png`, `F16-wmv-saved.png`, `F16-release-external-player.png`.

### Automated (final F16 code)

| Gate | Result |
| --- | --- |
| `npm test` | 715 tests, 715 pass, 0 fail — new: `src/player/external-media.test.ts` (8: ids/token, file links, open gate, App Lock queue, newest wins, outcome mapping, audio reveal, shell route), `src/playback/external-history.test.ts` (resume kept, history/Continue watching exclude), `src/navigation/launch-handover.test.ts` |
| `npm run typecheck` | OK |
| `npm run lint` | 0 errors, 84 warnings (unchanged) |
| `gradle :vidorax-media:testDebugUnitTest --rerun :vidorax-web:testDebugUnitTest --rerun` | BUILD SUCCESSFUL — 570 / 0 (+19: `IncomingMediaIntentsTest` 8 — content, file, http/no data/other actions ignored, unknown type → resolver → name, not media, token, reader once per intent, registry; `IncomingImportTest` 11 — copy into `device`, duplicate, same size different bytes, failed copy leaves nothing, unreadable, not media / empty, no space before copying, undecodable kept, audio, type from MIME, crash leftovers) and 27 / 0 (XMLs 22:40–22:41) |
| `gradle :vidorax-media:connectedDebugAndroidTest` | 38 / 0 on Pixel_8 AVD (new `IncomingImportAndroidTest`: a real FileProvider URI → reader (name, size) → import (real metadata, real thumbnail) → second import = duplicate). First run 37 / 1: the test reused `av.mp4`'s exact bytes, which other on-device tests had already saved — a trailing `free` box makes them unique |
| `git diff --check` | clean |

### Manual cases — debug build (Metro), then release (`F16-release-debugkey.apk`)

| Case | Result |
| --- | --- |
| `adb push` → Files → tap MP4 → "Open with" lists VidoraX (and Photos) → Just once | PASS (debug + release): plays in the Player, title = file name, Save button, no Previous/Next |
| Save to VidoraX | PASS: toast "Saved to VidoraX", check icon; Player tab shows "VidoraX F16 sample" (MP4 · 2.3 MB · 360p, thumbnail); not in Continue Watching |
| Same file again → Save | PASS (debug + release): "Already in your VidoraX library", no second item |
| `.mkv` | PASS: plays; saved in Urdu ("VidoraX میں محفوظ ہو گئی") |
| `.mp3` | **FAIL first** (played, but "Preparing video" with no controls) → fixed → PASS (debug + release): controls, time advances |
| Cold start (app stopped) from Files | **FAIL first** (the splash's own navigation replaced the Player; session left in the mini player) → fixed (launch handover) → PASS: `launch_file` → `held_for_launch` → `opened` after the splash, Player shows the file (debug + release) |
| App already open (`onNewIntent`) | PASS (all cases above with the app running) |
| App Lock on → Home → open a file | PASS: PIN screen first, VidoraX has no audio track running behind it; after the PIN the Player opens and plays |
| PiP with an external file | PASS: Home while playing → PiP window |
| Mini player with an external file | PASS: Back from the Player → mini player "VidoraX F16 sample.mp4" |
| WMV (no decoder on this device; only VidoraX opens it) | "Unreadable video" → for external files now "Open with…" ("No compatible video app is installed." — correct here) and Save to VidoraX (kept, per the F5 rule) → PASS |
| Urdu | PASS: RTL top bar, Save label/hint and toast in Urdu |
| Google Photos → Open with | **BLOCKED**: Photos' first run asks to turn on cloud backup for the owner's Google account — not accepted on their behalf |
| Real phone | **BLOCKED**: no phone available |

### Regression

Regression: quick check only, full R1–R12 deferred to §7 — release build cold start: no crash, no ANR, browser opens
(`F16-release-debugkey.apk` over the F13 data).

### Decisions (F16)

- **Testing plan change (owner, 2026-10-11):** from F16 on, R1–R12 is not run after each task — only once, at §7, on
  the upload-key release installed over the upload-key test1; per task a quick release sanity check. Reason: the owner
  asked to save time by running the regression once at the end. A §7 failure is fixed in a commit prefixed with the
  task that caused it.
- The incoming intent lives in vidorax-media (the import needs its library); vidorax-web's shared-link reader ignores
  `content:`/`file:` data.
- Token = hash of the URI (stable → resume works; opaque in routes and logs); the URI crosses to JS only for playback.
- Imports get their own folder (`no_backup/imports/`) — the download temp cleaner deletes `work/` folders it doesn't
  know.
- `ERR_NO_SPACE` is its own rejection code so the toast can say "Not enough storage".
- Undecodable files are imported and kept (F5 rule); not-audio/video is refused.
- Title shows the file name with its extension (it is the file the user picked); the saved library item drops it.

### Found, not fixed (F16)

- **The floating mini player covers bottom buttons of stack screens**: on Settings → App Lock setup, "Enable App Lock"
  sat under it and a tap opened the Player instead (also any screen whose primary button is at the very bottom).
- The emulator under load: "Files isn't responding" / "Process system isn't responding" dialogs (recovered with Wait),
  and the app process was killed in the background once (memory). The AVD's data partition was at 91 %; this
  session's own gallery copies from today's test downloads (19 files, ~860 MB) were deleted by id to install builds.
- A WMV in the library or from another app is classified "Unreadable video / damaged" (Media3 has no ASF reader), not
  "format not supported".
- The Player's not-found message for an external token from an earlier process says "could not be found in your
  library" (only reachable after the app process died while the Player route was kept).

---

## F18 — Background play

### Design

- **Setting** — Settings → new **Player** section → "Keep playing in background" (`backgroundPlayback`, default
  **off**), in the persisted settings store (MMKV, survives a force-stop). It acts in the player session (JavaScript
  owns the pause policy; the native side only reports activity stops), so nothing native reads it.
- **Manifest / config** — `FOREGROUND_SERVICE_MEDIA_PLAYBACK` and expo-video's `ExpoVideoPlaybackService`
  (`exported=false`, `foregroundServiceType=mediaPlayback`, `androidx.media3.session.MediaSessionService` filter),
  exactly as `withExpoVideo.js` writes them; app.json `supportsBackgroundPlayback: true`; the 2026-10-01 comment
  replaced. `FOREGROUND_SERVICE` itself is already declared (downloads).
- **Policy** (`src/player/app-lifecycle-policy.ts`, pure): with the setting on, going to the background while playing
  → `continue_in_background` instead of `background_pause` (also from landscape fullscreen — the policy does not
  depend on fullscreen), and the activity stopping (screen off, left without PiP) keeps playing. PiP unchanged: armed
  → the window opens; a dismissed PiP window still pauses (`decideActivityStopped` gets "PiP just ended"). Setting off
  → exactly today's decisions.
- **Player** (`use-player-session.ts`): setting on → `staysActiveInBackground` and `showNowPlayingNotification` on the
  expo-video player (live when toggled), the source carries `metadata` (title, "Playing in VidoraX" in the app's
  language, the library thumbnail as artwork when there is one). Reaching the end turns both off (the notification
  and its service go); Replay turns them on again; closing the player releases it.
- **Play Console** — `docs/play-console/PLAY_SUBMISSION.md`: the mediaPlayback foreground-service declaration
  (description, user impact, demo-video steps).
- **Found while testing and fixed in F18:**
  - *A seek from the notification while backgrounded never finished* (stuck BUFFERING, Media3's stuck-player timeout
    failed it 10 min later): both player views use a TextureView, whose surface stays set but undrawn while the
    activity is stopped, so the decoder cannot hand out the frame a seek needs. `session-host/video-surface-attachment`:
    with background play on, an activity stop makes the views let go of the player (ExoPlayer drops the destroyed
    TextureView surface and plays sound only; the player stays registered with the playback service, so the
    notification stays); `AppState` active re-attaches them and a paused frame is redrawn. PiP is a paused activity —
    never affected.
  - *After closing a PiP window every later background exit paused*: the window closed while its view had let go of
    the player, so expo-video's PiP-stop event never came and the session believed PiP was still on. A stopped
    activity has no PiP window: the session and the Player clear their PiP state on every activity stop.

Evidence (`.claude/pr-evidence/`): `F18-setting-on-after-force-stop.png`, `F18-media-controls.png`,
`F18-pip-with-setting-on.png`, `F18-setting-urdu.png`, `F18-notification-urdu.png`, `F18-release-media-notification.png`.

### Automated (final F18 code)

| Gate | Result |
| --- | --- |
| `npm test` | 723 tests, 723 pass — new: `app-lifecycle-policy.test.ts` +6 (on: continue in background incl. fullscreen; off: today's pause; PiP unchanged either way; paused stays paused, no autoplay; activity stop keeps playing only when on; closing PiP still pauses), `video-surface-attachment.test.ts` (2) |
| `npm run typecheck` | OK |
| `npm run lint` | 0 errors, 84 warnings |
| `gradle :vidorax-media:testDebugUnitTest --rerun :vidorax-web:testDebugUnitTest --rerun` | 570 / 0 and 27 / 0 (00:27–00:28); no native code changed |
| `apkanalyzer manifest print` (release APK) | `ExpoVideoPlaybackService` declared once (`foregroundServiceType` mediaPlayback), `FOREGROUND_SERVICE_MEDIA_PLAYBACK` once; none of the restricted permissions |
| `git diff --check` | clean |

### Manual cases — debug build, then release (`F18-release-debugkey.apk`)

| Case | Result |
| --- | --- |
| Setting in Settings → Player, off by default; on survives force-stop (debug + release); off survives force-stop (release) | PASS |
| Setting on → play → (mini player) → Home | PASS (debug + release): sound continues, media notification + media session "hls.js demo · Playing in VidoraX", library thumbnail as artwork |
| Notification controls | PASS: pause, play, −10 s, +10 s (session PAUSED/PLAYING, position moves) |
| Screen off 5 min | PASS: kept playing to the video's end (498 s → 634.6 s); release: 1 min screen off, still playing |
| End of video / closing the player | PASS: notification and foreground service gone; close → no service, no sound |
| Setting off → Home | PASS (debug + release): pauses, no notification — today's behaviour |
| PiP, setting on | PASS: Home from the Player opens PiP; closing the PiP window pauses (unchanged) |
| Landscape fullscreen → Home, setting on | PASS: PiP window keeps playing |
| External file (F16) | PASS: keeps playing in the background, its own title in the session |
| Mini player after returning | PASS: picture back (≈3–8 s on this overloaded AVD while the TextureView re-attaches) |
| Urdu | PASS: Settings row RTL; notification subtitle "VidoraX میں چل رہی ہے" |
| Lock-screen controls | **BLOCKED**: the AVD has its lock screen disabled (`locksettings get-disabled` = true); enabling one is a security-setting change not made on the owner's emulator. The same media session drives them (its actions include play/pause/seek) |
| Bluetooth / headphones | **BLOCKED**: none on the AVD |
| Real phone | **BLOCKED**: no phone |

### Regression

Regression: quick check only, full R1–R12 deferred to §7 — release cold start: no crash, no ANR, browser opens.

### Decisions (F18)

- The setting lives in the JS settings store (MMKV) — the pause policy and the expo-video flags are JS; nothing native
  reads it, so there is no bridge push.
- The notification's second line is set when a video is opened (expo-video takes metadata only with the source): a
  language change applies to the next video opened.
- Closing the PiP window pauses even with background play on ("PiP behaviour unchanged").

### Found, not fixed (F18)

- expo-video's own notification builder sets only the title (Android 13+ draws the card from the session metadata, so
  the subtitle and artwork show there); on Android ≤ 12 the classic notification shows the title only.
- The emulator was closed between sessions and restarted from its snapshot (data kept); system auto-rotate is now on.

---

## F2 — Speed control

### Design

- **Limiter** — `transfer/BandwidthLimiter` (one per engine): token buckets in bytes/s with a 0.25 s burst that go
  into debt rather than splitting a read; a read reserves from every bucket it belongs to and waits for the longest.
  `Throttle.take(bytes)` is called right after every network read in the four read loops (single file, `RangedDownload`
  parts, HLS segments, segments fetched ahead), so the limit holds whatever "Connections per file" is.
- **Global limit** — `DownloadSettings.speedLimitBytesPerSecond` (contract, record, engine prefs, `ensure-bridge`),
  Download Settings → Performance → "Speed limit": Off (default), 256 KB/s, 512 KB/s, 1, 2, 5 MB/s.
- **Per-download limit and Priority** — Download details (while downloading, paused or queued): same choices +
  Priority switch. `setDownloadBandwidth` / `listDownloadBandwidth`; stored in a **new table** `download_bandwidth`
  (schema **v5**, `CREATE TABLE IF NOT EXISTS`, no existing table changed); loaded into the limiter once per process
  before the first transfer; dropped on completion and removal. One priority at a time (setting it clears the others).
- **Priority rule** — while the priority download read within the last 2 s, the others together get at most 25 % of
  the global limit, or of the priority download's measured speed when no global limit is set (≥ 32 KB/s together).
- **Queue rules** written into ARCHITECTURE §3.6 for H4 (start order) and F2 (bandwidth). ARCHITECTURE's §5 is
  detection, so the rules sit beside the download state machine (§3.5).

Tester constants: `PRIORITY_OTHERS_SHARE` 0.25, `MIN_OTHERS_BYTES_PER_SECOND` 32 KiB, `PRIORITY_ACTIVE_NS` 2 s
(`BandwidthLimiter`), burst 0.25 s / ≥ 16 KiB (`TokenBucket`).

Evidence (`.claude/pr-evidence/`): `F2-speed-limit-setting.png`, `F2-per-download-256k.png`, `F2-priority-on.png`,
`F2-priority-after-force-stop.png`, `F2-speed-limit-urdu.png`, `F2-details-urdu.png`.

### Automated (final F2 code)

| Gate | Result |
| --- | --- |
| `npm test` | 729 tests, 729 pass — new: `speed-limit.test.ts` (6: choices, normalise unknown/negative to Off, engine value 0 → null, labels KB/MB, short labels, settings merge), `settings.test.ts` (the engine settings carry `speedLimitBytesPerSecond`) |
| `npm run typecheck` | OK |
| `npm run lint` | 0 errors, 84 warnings (unchanged) |
| `gradle :vidorax-media:testDebugUnitTest --rerun :vidorax-web:testDebugUnitTest --rerun` | 587 / 0 (+17) and 27 / 0 — `BandwidthLimiterTest` 11 (fake clock: off = no wait; 512 KiB/s over 60 s within 2 %; one global limit shared by three readers; burst then rate, idle refills only the burst; per-download inside global; per-download without global; priority with global ≥ 72 % / others ≤ 28 %; priority without global → others ≈ 25 % of its speed; priority idle → others full speed; limit changed mid-transfer 1 MiB/s → 256 KiB/s → off; forget), `DownloadBandwidthStoreTest` 3 (save/list, one priority, empty entry deletes, delete with the download), `MediaDatabaseUpgradeTest` 2 (a v4 database with real download, library and completion rows → v5 with every row intact and the new table; migration 5 run twice is safe), `SpeedLimitRecordsTest` 2 |
| `gradle :vidorax-media:connectedDebugAndroidTest` | 38 / 0 on the Pixel_8 AVD (the transfer loops now take the throttle; `Throttle.NONE` by default). The first run could not install the test APK (AVD storage full: "not enough space") — this session's own F2 test videos were deleted and it was rerun |
| `git diff --check` | clean |

### Manual cases — debug build (Metro), then release (`F2-release-debugkey.apk`)

Measured on the device: the bytes written into each download's work folder (`run-as … du -sk no_backup/work/<id>`,
the ranged `.part` is sparse), sampled every 10 s (`measure.py`); the server is a local measuring server
(`fx.127.0.0.1.nip.io` + `adb reverse`, 150 MB MP4s with ETag/Last-Modified so F1 splits them into 3 parts) that
also logs what it sends.

| Case | Result |
| --- | --- |
| Global 512 KB/s, one large download, 100 s | PASS (debug): **511.2 KB/s average**, every 10 s sample 504.8–517.9 KB/s; server 505 KB/s. Release, Wikimedia BBB 1080p (286.5 MB): wlan0 RX **529 KB/s over 60 s** (the row read 512.2 KB/s) |
| Global 512 KB/s shared by two downloads, 3 connections each, 60 s | PASS: 244.7 + 265.5 = **510.2 KB/s** |
| Per-download 256 KB/s beside an unlimited download (global Off), 60 s | PASS: the limited one **249.7 KB/s** (samples 244.6–256.0), the unlimited Wikimedia Elephants Dream 1080p **2448 KB/s** |
| Priority (global 1 MB/s, two downloads), 60 s | PASS: before, 494 + 532 KB/s; Priority on → **764.4 KB/s (75 %) vs 256.1 KB/s** |
| Off → full speed | PASS: switched Off mid-download → 15.6 MB/s and 41.9 MB/s at once (the local link), both done in seconds |
| Survives force-stop | PASS: global 1 MB/s (engine prefs + MMKV), Priority on g, own 256 KB/s on f → `am force-stop` → relaunch: both resumed at **763.5 / 251.2 KB/s**; details show Priority on and 256K; when g finished, f alone stayed at **256.5 KB/s** with 1 MB/s free (its own limit held); the database (v5) kept only f's row — g's went with its completion |
| Contract → engine | PASS: the setting reaches `vidorax-media-settings.xml` (`speedLimitBytesPerSecond` 524288 / 262144 / 1048576 / 0) through `ensure-bridge` |
| Urdu | PASS: Download Settings row RTL ("رفتار کی حد", "بند"), details "اس ڈاؤن لوڈ کی رفتار کی حد" + "ترجیح" switch on the left |
| Real phone | **BLOCKED**: no phone |

### Regression

Regression: quick check only, full R1–R12 deferred to §7 — release build (`F2-release-debugkey.apk`, installed over the
F18 data) cold start: no crash, no ANR, browser opens.

### Decisions (F2)

- **The limit counts network bytes after every read** (not decoded or written bytes): it holds for every connection
  count, for parts and segments alike; disk-to-disk copies are never throttled.
- **Debt instead of splitting reads**: a 64 KiB read is never cut; the next read waits longer. A 0.25 s burst keeps
  short downloads (thumbnails, playlists, small segments) from waiting at all.
- **Per-download limits and Priority live in the engine's database** (new table, schema v5), not in MMKV: the engine
  owns downloads and must apply them before JavaScript is up (a download resumed by the system job).
- **Priority without a global limit** gives the others 25 % of the priority download's measured speed (a phone's link
  has no known capacity); with a global limit, 25 % of that limit. A priority download that has not read for 2 s
  (paused, waiting) holds nobody back.
- **One priority at a time**: marking another download clears the previous one (the switch says so).
- The queue rules (H4 start order / F2 bandwidth) are written in ARCHITECTURE §3.6 next to the download state machine:
  ARCHITECTURE's §5 is about detection.
- Measured on the debug build against a local server where the release build's network security config blocks
  cleartext; the release build was measured on Wikimedia over HTTPS.

### Found, not fixed (F2)

- **Download details jumps by one line while downloading**: the "speed · time left" line under the progress hides and
  shows, so the content below moves ~33 px — a tap on the speed segments can land on the wrong one (seen twice).
- Debug-build tooling: a CI=1 Metro does not see edited files — the debug app ran an old bundle (no Speed limit row)
  and pushed settings without the new field, which reset the engine's speed limit to 0 until Metro was restarted.
- The AVD's system server restarted once during an `adb install` under load (load average 35); the install was
  repeated. Space: this session's own gallery copies (F2 a/b/c, BBB 1080p) were removed by name to make room.

---

## F17 — Play online streams

### Design

- **Where**: **Play** in the quality sheet — a play icon on every quality row that plays exactly as chosen, and a Play
  button beside Download for the selected quality — and a play icon on the "Video available" bar for a single offer
  (the bar itself still downloads). Several qualities on the bar → choose in the sheet.
- **Source** (`src/player/remote-stream.ts`, pure): `buildRemoteStream` → URL, headers, `contentType`
  (`hls` / `dash` / `progressive`), title, thumbnail. Headers: User-Agent, Referer, Origin from the page's request
  context (Referer falls back to the page, like the download engine) and, when the engine would use cookies
  (`cookiesRequired || hasCookies`), the WebView's cookies for the stream URL as a `Cookie` header — expo-video's
  OkHttp has no cookie jar. Not playable: split audio + video (two files), refused/not downloadable (DRM, encrypted,
  live, YouTube are never offered), non-http.
- **Fresh link** (`browser-media-play.service.ts`): the same checks a download makes before enqueueing
  (`refreshStaleDirectSource` + `resolveFreshSourceForEnqueue`, the pre-download gate for a single file). An HLS
  master is resolved to the chosen height (`chooseHlsVariant`, the engine planner's rule: exact height, else the tallest
  below, nearest bandwidth), except when its variants use a separate audio rendition (a variant alone is silent → the
  master plays, adapting). A DASH option is the whole manifest and expo-video cannot pin a representation → it plays
  adaptively, so DASH rows get no per-quality Play (only the footer "Play this video").
- **Player**: the stream is kept in memory as `stream:<32 hex>` (no URL in the route; last 8 per run);
  `resolvePlaybackSource` returns it with `headers`, `contentType`, `artworkUrl`, `remote: true`; `replaceAsync` passes
  them. No library row, no resume record, no Watch history (`bind-playback-persistence` ignores `stream:` events); no
  "Open with" on its error screen. Errors: HTTP 401/403/404/410 → **Link expired** ("Reload the page in the browser and
  tap Play again"); a failed connection → **No connection** with Try again. A `stream:` id from an earlier run → Link
  expired.
- **Title**: the live page's name for the media, then the offer's; a media file or manifest opened directly in the tab
  is titled by its file name (the tab's title there can be the previous page's — Prompt A / F1 "Found, not fixed").

Tester constants: `STREAM_PREPARATION_TIMEOUT_MS` 30 s (local files keep 12 s), `MAX_REMEMBERED_STREAMS` 8.

Found while testing and fixed in F17:
- *TikTok played "Link expired"* (the download of the same video works): the player sent neither the session cookies
  nor a Referer (the engine falls back to the page and reads CookieManager per request) → Referer fallback + Cookie
  header under the engine's own rule. Then it played.
- *"Play 360p" played 720p*: that offer named the HLS master (its download picks the height natively) → the variant is
  resolved before playing (server log: the player then fetched `hls/360/index.m3u8` and its segments only).
- *A dropped connection showed the generic "Playback error"*: OkHttp's message is "unexpected end of stream" wrapped in
  `java.io.IOException` → classified as a network error.
- *Title "master.m3u8"* for a page offer: the analysis title came first → the live page's name for the media first
  (as downloads do) — "F17 local HLS".
- DASH quality rows each had a Play that would all have played the same adaptive stream → removed for DASH.

Evidence (`.claude/pr-evidence/`): `F17-bar-play.png`, `F17-w3s-player.png`, `F17-mini-player.png`,
`F17-sheet-hls.png`, `F17-sheet-dash.png`, `F17-dash-player.png`, `F17-airplane-error.png`, `F17-pip.png`,
`F17-ig-player.png`, `F17-tiktok-bar.png`, `F17-tiktok-player.png`, `F17-split-no-play.png`, `F17-link-expired.png`,
`F17-watch-history.png`, `F17-bar-urdu.png`, `F17-sheet-urdu.png`, `F17-error-urdu.png`, `F17-sheet-dark.png`,
`F17-fb-player.png`, `F17-mux-480-release.png`.

### Automated (final F17 code)

| Gate | Result |
| --- | --- |
| `npm test` | 744 tests, 744 pass — new `src/player/remote-stream.test.ts` (14: content-type mapping; split / refused / non-http → no Play; HLS/file play as chosen, DASH adapts; headers picked case-insensitively, nothing else; context Referer/UA; Referer falls back to the page and cookies follow the engine's rule; built stream; registry ids route-safe, unknown/old ids, oldest dropped; error classification incl. the device's "unexpected end of stream"; HLS master → chosen variant (exact, tallest below, nearest bandwidth, no match); media playlist / separate audio keep the URL; resolver returns the stream without touching the library; an old id → Link expired), `src/playback/stream-history.test.ts` (stream events never reach persistence) |
| `npm run typecheck` | OK |
| `npm run lint` | 0 errors, 84 warnings (unchanged) |
| Native | no native code changed |
| `git diff --check` | clean |

### Manual cases — debug build (Metro, local server `fx.127.0.0.1.nip.io` + `adb reverse`), then release (`F17-release-debugkey.apk`)

| Case | Result |
| --- | --- |
| w3schools MP4 (single offer) → bar Play | PASS (debug): plays in the VidoraX player, title "HTML Video"; the bar keeps "Already downloaded" (Play works whatever the download state) |
| Mux HLS via the hls.js demo → Play at a chosen quality | PASS (debug, then the final release): sheet rows 1080/720/480/288/184p each with Play; 480p row → plays (634 s). Local two-variant HLS: "Play 360p" → the player fetches `hls/360/index.m3u8` + its segments only (server log; Hermes shows the stream URL) — after the master fix |
| DASH (Akamai bbb) → Play | PASS (release): no per-row Play, footer "Play this video" → plays adaptively (640×360 → 1280×720 → 1920×1080 overlay) |
| Public social video needing Referer/cookies | TikTok `@complex/video/7626254334065511711`: **FAIL first** (Link expired) → fixed → PASS (release): plays, title = the post's caption. Instagram reel `DSxdvp9lcDa` and Facebook watch `1376350954687257` (single MP4 offers) → Play → plays (release; Facebook on the final build). Dailymotion **BLOCKED**: sign-in wall + cookie-consent banner (consent not given on the owner's behalf) |
| Split audio + video → no Play | PASS (debug): Instagram/Facebook served single MP4 offers today, so a local MediaSource page fed by `v.mp4` (video only) + `a.mp4` (audio only) was used: "Video available" with no Play; its download fetched both files (split) |
| Expired link | PASS: TikTok before the fix (a real 403) → "Link expired / Reload the page in the browser and tap Play again"; local HLS with the variant answering 403 → the same (debug) |
| Airplane mode mid-play | PASS (release, DASH): after the buffer ran out (~56 s) "No connection — Couldn't load the stream…" + Try again, no crash; airplane off → Try again → plays |
| Mini player | PASS (debug): Back from the stream → mini player "HTML Video" with replay/close |
| PiP | PASS (release): Home while the DASH stream plays → PiP window (`mode=pinned`) keeps playing |
| No library row / resume / history | PASS: Watch History and Continue Watching list only the earlier library videos after five streams |
| Urdu | PASS (release): bar play icon; sheet "چلائیں"; error "کنکشن نہیں / اسٹریم لوڈ نہیں ہو سکی…" |
| Dark theme | PASS (release): sheet Play/Download buttons |
| Real phone | **BLOCKED**: no phone |

### Regression

Regression: quick check only, full R1–R12 deferred to §7 — release build cold start (4.4 s): no crash, no ANR, browser
opens.

### Decisions (F17)

- Play does not consume the offer: the bar keeps offering the download afterwards.
- DASH plays adaptively (no per-quality Play) — expo-video has no way to pin a representation; HLS plays the chosen
  variant.
- Cookies travel as a header only when the download engine would send them for the same offer.
- Retry after a network error starts the stream again from the beginning (no resume record for streams).
- A stream keeps its source only for the app run (cookies included, never persisted).

### Found, not fixed (F17)

- Detection drops a page's candidates as `STALE_PAGE_GENERATION` when a page loads right after another one in the same
  tab (seen with two local fixture pages); a reload brings the offer back.
- The quality sheet's media card says "Audio —" and "Duration —" for HLS/DASH offers, and English-only labels
  ("Video found", "Audio") in Urdu.
- The player's error screen places "Try again" off-centre above "Go back" / "Get Help" (existing `ErrorState` layout).
- Debug builds on this AVD: a Metro reload sometimes leaves the app on a blank/spinner screen for minutes; testing
  moved to release builds where possible.

---

## F14 — Seek preview frames

### Design

- **Loader** (`src/player/seek-preview.ts`, pure, injected clock/timers/generator): `request(seconds)` while the
  finger moves. A cached 1-second bucket shows at once; otherwise at most one `generateThumbnailsAsync` in flight, the
  latest position wins (positions passed on the way are skipped), a new request starts at most every 150 ms. Frames are
  cached in an LRU of 40 (evicted ones released); `dispose()` on close or media change releases everything and
  ignores what is still in flight; 3 failures in a row → it stops asking (audio, unreadable source). A failed position
  is not retried by itself.
- **Hook** (`use-seek-preview.ts`): frames ≤ 256 px wide; released 1 s after leaving the cache (an Image may still be
  drawing one). On only when the media is not a stream (F17) and a video frame has been shown (`hasFirstFrame` — audio
  never has one). A new drag clears the last drag's frame from its start handler (never shown at the new position).
- **UI** (`PlayerTimeline`): a 160 dp frame (shape kept, portrait videos too) with its time, centred over the thumb and
  kept inside the track; the existing centre time pill stays. Physical left-to-right like the timeline (Urdu too).
- Expo's Android implementation opens a new MediaMetadataRetriever per call and decodes the exact frame
  (`OPTION_CLOSEST`): fast for H.264 here, ~1.2–1.5 s for 1080p VP9 on the AVD — the throttle keeps that off the UI.

Tester constants: `SEEK_PREVIEW_INTERVAL_MS` 150, `SEEK_PREVIEW_BUCKET_SECONDS` 1, `SEEK_PREVIEW_CACHE_LIMIT` 40,
`SEEK_PREVIEW_MAX_WIDTH_PX` 256, `SEEK_PREVIEW_WIDTH_DP` 160, `SEEK_PREVIEW_MAX_FAILURES` 3 (`seek-preview.ts`);
release delay 1 s (`use-seek-preview.ts`).

Evidence (`.claude/pr-evidence/`): `F14-preview-h264.png`, `F14-drag-strip.png`, `F14-preview-hevc.png`,
`F14-preview-webm.png`, `F14-preview-landscape.png`, `F14-audio-only.png`, `F14-preview-urdu.png`.

### Automated (final F14 code)

| Gate | Result |
| --- | --- |
| `npm test` | 753 tests, 753 pass — new `src/player/seek-preview.test.ts` (9: buckets; one in flight and the latest position wins; ≤ 1 start per interval; cache hit without a request; LRU bound releases the least recently used; dispose releases all and a late frame; a source without frames stops after 3 failures; a failed position is not retried in a loop and a success resets; preview size and position) |
| `npm run typecheck` | OK |
| `npm run lint` | 0 errors, 84 warnings (unchanged) |
| Native | no native code changed |
| `git diff --check` | clean |

### Manual cases — release build (`F14-release-debugkey.apk`)

Test files made with ffmpeg and pushed to `/sdcard/Movies/F14/`, opened through `VIEW` intents (the F16 path — the
media-permission prompt of "Videos on this device" was dismissed, not granted on the owner's emulator); WebM from the
library.

| Case | Result |
| --- | --- |
| H.264 1080p, 10 min (external file) | PASS: frame + time above the thumb (04:35, 07:24); a 4 s continuous drag shows new frames along the way (03:17 → 05:38 → 08:04) |
| HEVC 1080p | PASS (01:13) |
| WebM VP9 1080p (library, Elephants Dream) | PASS: real scene frames (06:41); ~1.2–1.5 s per new frame on the AVD, the scrubber itself never waits |
| Audio only (`.m4a`) | PASS: no frame, no crash, scrubbing works |
| Landscape fullscreen | PASS (04:46 frame above the thumb) |
| Urdu | PASS: RTL top bar; frame above the thumb (05:02) |
| Time-left label / double-tap | PASS: label toggles "Time left −05:36" ↔ "Total length 10:58" (left as it was); double-tap right third +10 s (00:37 → 00:47) |
| Memory after 20 scrubs (`dumpsys meminfo`, BBB 1080p WebM) | PASS: native heap 101.0 MB → 184.5 MB right after the first 20 (garbage not yet collected) → 96.4 MB a minute later; second 20: 96.4 → 126.6 → 97.4 MB after 60 s; player closed: 97.6 MB. TOTAL PSS 320.8 MB before → 291.6 MB at the end |
| Real phone | **BLOCKED**: no phone |

### Regression

Regression: quick check only, full R1–R12 deferred to §7 — release cold start (6.4 s): no crash, no ANR, browser
opens.

### Decisions (F14)

- The frame shows the exact position (`OPTION_CLOSEST`, expo-video's choice); a keyframe-only option would be faster
  for VP9 but is not exposed by expo-video and would show a different frame than the seek lands on.
- Cache of 40 one-second buckets (~6 MB at most) — enough to re-visit a scrubbed area, small enough for low-end
  phones.
- The preview follows the timeline's physical left-to-right layout in Urdu (as the timeline and double-tap zones do).

### Found, not fixed (F14)

- In landscape fullscreen the video is drawn inside a smaller area above the controls dock rather than the full height
  (existing layout).
- With the controls visible the Next/Previous buttons sit on the double-tap zones; a quick double tap there changes the
  video instead of seeking (seen while testing — existing behaviour).

---

## F15 — Leftover download files cleaner

### Design

- **Native** (`engine/LeftoverFiles`, `DownloadEngine.measureLeftovers` / `cleanLeftovers`, module
  `measureLeftoverFiles` / `cleanLeftoverFiles`, contract `LeftoverFiles {count, bytes}` + `LeftoverFilesOptions
  {keepLegacyIds}`): both run under the engine's lock, so no download is created or finishes between deciding what to
  keep and looking.
  - `work/` (`no_backup/work/<id>`): every entry not kept — folders of completed, cancelled or unknown downloads, with
    everything inside (single `.part`, F1's per-part `.part` + `.parts`, segments, split tracks, merge output, F6
    recordings) and loose files. **Kept**: every listed download that may still use its files — queued, probing,
    downloading, paused, waiting (network/retry), processing, recording, and **failed** (Retry resumes from the part).
  - v1 folders (`files/VidoraXDownloads/<id>/`): only `.hls` and `.mranges` workspaces and `*.part` files of v1
    downloads JavaScript does not list as active (`activeLegacyIds`: QUEUED, DOWNLOADING, PAUSED, FAILED); a v1
    folder's finished file is a library video and is never listed. Without the list (`null`) v1 folders are not read.
  - `clearTempFiles` (in the contract, unused by JS) now follows the same rule and leaves v1 folders alone.
- **Storage screen**: in Storage Actions, "Leftover download files — X MB" with a hint and **Clean up** → confirmation
  ("This deletes X that no download needs…") → "Freed X MB"; the Storage snapshot refreshes; pull-to-refresh measures
  again. Hidden when there is nothing to clean (and on builds without the native call). Urdu: mirrored row, sizes kept
  left-to-right with LRM marks.

### Automated (final F15 code)

| Gate | Result |
| --- | --- |
| `npm test` | 754 tests, 754 pass — new `src/downloads/v2/leftovers.test.ts` (active v1 ids: queued, downloading, paused, failed kept; completed/cancelled not) |
| `npm run typecheck` | OK |
| `npm run lint` | 0 errors, 84 warnings (unchanged) |
| `gradle :vidorax-media:testDebugUnitTest --rerun :vidorax-web:testDebugUnitTest --rerun` | 591 / 0 (+4 `LeftoverFilesTest`: an orphan folder with per-part files and a loose file → leftovers, measured without deleting, deleted with exact counts, a kept folder untouched; v1: only `.hls`/`.mranges`/`*.part` of inactive downloads, the finished file stays, active ones untouched, null → v1 not read; the engine keeps queued/probing/downloading/paused/waiting network/waiting retry/processing/failed and cleans completed/cancelled/unknown; `clearTempFiles` same rule, v1 untouched) and 27 / 0 |
| `gradle :vidorax-media:connectedDebugAndroidTest` | 38 / 0 (first run: the AVD had no room for the test APK — this session's F14/F15 test media were removed, then rerun) |
| `git diff --check` | clean |

### Manual cases — debug build (`run-as`), release quick check

| Case | Result |
| --- | --- |
| Orphan + paused download (spec case) | PASS: a 145.6 MB download paused at 38 MB (work folder 39.1 MB) + `run-as` orphan `no_backup/work/orphan-test` 20 MB + a v1 folder with a 5 MB `.hls` workspace beside a 3 MB "finished" file → Storage "Leftover download files — **25.0 MB**" (the paused download not counted) → Clean up → confirmation → "**Freed 25.0 MB**", the row disappears; orphan and `.hls` gone, the paused download's 38 MB and the v1 finished file intact |
| The paused download still resumes and plays | PASS: resumed → completed, **byte-identical** to the server file (SHA-256); a second run with a normal 1080p H.264 file (paused at ~30 MB, 12 MB orphan → "12.0 MB" → freed) → resumed, byte-identical, plays with picture. (The first test file, a ~240 Mbit/s level 5.2 clip, plays without picture on the AVD — its original from device storage never shows a frame either) |
| Nothing to clean | PASS (release): the row is hidden |
| Urdu | PASS (after an RTL fix: the size read "MB 7.0" and the icon sat on the left → LRM marks + mirrored row): "بچی ہوئی ڈاؤن لوڈ فائلیں — 7.0 MB", confirmation, "7.0 MB جگہ خالی ہو گئی" |
| Real phone | **BLOCKED**: no phone |

Evidence (`.claude/pr-evidence/`): `F15-storage-leftovers.png`, `F15-confirm.png`, `F15-freed.png`,
`F15-resumed-plays.png`, `F15-leftovers-urdu.png`, `F15-freed-urdu.png`.

### Regression

Regression: quick check only, full R1–R12 deferred to §7 — release cold start (5.5 s): no crash, no ANR, browser opens
(build before the two-attribute Urdu layout fix, which was checked on the debug build).

### Decisions (F15)

- **Failed downloads keep their files**: Retry resumes from the part (the spec's protected list did not name failed;
  deleting them would turn a retry into a restart).
- v1 records live in JavaScript, so JavaScript passes the active v1 ids; v1 folders are only cleaned of their
  temporary workspaces and parts — never a finished file.
- Imports in progress (`no_backup/imports/`) are not leftovers: `IncomingImport` cleans its own crash leftovers.

### Found, not fixed (F15)

- The Storage screen's v1 location cards label `{VidoraXDownloads}/{id}/.hls/` and `.mranges` sizes from the same
  `tempBytes` total, so a `.hls` workspace also showed under "Temporary Download Parts" (5.0 MB) before the clean-up.
