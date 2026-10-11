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
