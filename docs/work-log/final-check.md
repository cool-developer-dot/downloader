# Work log — final check of the Hamza & Faran downloader plan

Plan: `VidoraX Downloader — Work Plan for Hamza & Faran` (7 Oct 2026, 29 packages: F1–F6 Faran, H1–H23 Hamza).
Branch `integration/final-check` = `origin/hamza/opus-engine-merge-preview` (Hamza's integration of every H branch,
the six `fix/*` / `feat/*` PRs and `faran/opus-engine`) + `origin/chore/test2-into-main` (test build 2's tester
fixes, PR #4) + the completions below. Plan rule 5 ("Faran confirms each merged package on a release build on the
emulator") and Faran's "final release-build check for both people's work" are this log.

## 1. Where each package stood (2026-10-24, before this check)

| ID | Package | PR | Code | Gap found |
| --- | --- | --- | --- | --- |
| F1 | Parallel connections | #2 | done, device-checked | "Queued" instead of "Waiting for Wi-Fi"; direct-file title (found, not fixed) |
| F2 | Speed control | #2 | done, device-checked | Download details jumps a line (found, not fixed) |
| F3 | Scheduling and conditions | #2 | done, device-checked | — (roaming/reboot BLOCKED on the AVD) |
| F4 | MPEG Program Stream | #2 | done, device-checked | test imported a type from the wrong module (typecheck of the test config failed) |
| F5 | Extra file types | #1 | done, device-checked | — |
| F6 | Live stream recording | #2 | done, device-checked, off by default | client sign-off (owner) |
| H1 | Quick fixes | #11 | done | device check pending |
| H2 | Save thumbnail | #21 | done | device check pending |
| H3 | Bulk controls | #12 | done | device check pending |
| H4 | Queue order | #29 | done | device check pending |
| H5 | Progress details | #13 | done | device check pending |
| H6 | Data usage | #22 | done | device check pending |
| H7 | More ways to add | #23 | **#484 Page Link Grabber not done** | device check pending |
| H8 | Before the download starts | #24 | **#381 preview: no playback ("skipped")** | device check pending |
| H9 | Save location and folders | #25 | done | device check pending |
| H10 | File naming | #16 | done | device check pending |
| H11 | After the download | #17 | done | device check pending |
| H12 | Duplicates and organizing | #30 | done | device check pending |
| H13 | History and logs | #18 | done | device check pending |
| H14 | Queue backup | #19 | done | device check pending |
| H15 | Network options | #26 | done | device check pending |
| H16 | Notification options | #14 | done | device check pending |
| H17 | Dangerous file warning | #15 | done | device check pending |
| H18 | Downloader settings | #20 | done | device check pending |
| H19 | Subtitle download | #31 | done | device check pending |
| H20 | File integrity | #32 | done | device check pending ("needs a device check of Play While Downloading") |
| H21 | Private downloads | #27 | done | device check pending |
| H22 | Home-screen widget | #33 | done | client sign-off (owner); device check pending |
| H23 | Edit after download | #28 | done | **Play Console declaration of the new foreground service not written**; device check pending |

Also in the integration: `fix/engine-paused-slot` #5, `fix/app-lock-grace` #6, `feat/biometric-unlock` #7,
`fix/i18n-hardcoded` #8, `fix/queue-v2` #9, `fix/notifications-toggle-v2` #10 (Hamza's merge order 1–6), and PR #4.

## 2. Completed in this check

| Commit | What |
| --- | --- |
| `fea4a2d` | Merge of PR #4 (test build 2) into the integration: 3 conflicts resolved, both sides kept (first-launch tour + sign-in/organize/clipboard hosts; tour target + web-fullscreen state; parity test) |
| `d773e16` | F4: the program-stream test imports `DownloadQualityOption` from `@/downloads/quality` (`npm run typecheck` failed on `tsconfig.test.json`) |
| `ab27a2e` | **H7 #484 Page Link Grabber**: browser menu → "Download links on this page" → Add several links, filled in |
| `f44ff15` | F1 found-not-fixed: "Waiting for Wi-Fi" / "Waiting for network" instead of "Queued" |
| `a4b7c69` | **H8 #381 Preview Before Download**: a small player in the quality sheet's Options |
| `bc052b1` | F1/F2 found-not-fixed: a direct video file keeps its own name; Download details no longer jumps a line |
| `bbbdbcb` | H23: Play Console declaration B3 (`mediaProcessing`) in `docs/play-console/PLAY_SUBMISSION.md` |
| `08c2b2d` | "Automatically resume interrupted downloads" works for the native engine (F12 found-not-fixed: the switch did nothing): sent to and persisted by the engine; off → an interrupted download waits paused after a restart |

Found on the device (section 4) and fixed:

| Commit | What |
| --- | --- |
| `e101032` | H7: Stop in Add several links leaves the link being checked as Waiting, not "Needs review" |
| `1d876e1` | H8/H10: the Options name prefill uses the same title the download gets |
| `5f30fe8` | H7: Add several links re-checks a link after a transient failure (two more tries) — with a download filling the slow link, most links had ended as "Needs review" |
| `4942e87` | H15: "Automatic" no longer breaks mid-word in Timeout / Retry limit ("Auto", "Auto (5)"; screen readers hear "Automatic"); segmented labels stay on one line |
| `ff11803` | H5: the total speed line keeps its place while a download runs (the list jumped ~26 px between ticks) |
| `ceb1981` | Runner: a progress post racing the completion could leave an ongoing "Finishing up" notification; planning and posting now happen in one locked step (race test fails on the old order) |
| `a2494c1` | H12: "Ask" → Keep both / Replace always failed (the re-run was refused as a stale offer); the prompt named the video "Download" |
| `34d725b` | H3: with "Tap to pause or resume" on, touch and hold opens a download's details (nothing opened them before) |
| `75c3593` | H20: Play while downloading for multi-connection downloads — PlayablePrefix still had the placeholder that refused any F1 `.part` (so no MP4 ≥ 16 MB was ever offered); it now uses the parts checkpoint's contiguous prefix |
| `9463a87` | H7/H22: Paste link from the shortcut or widget waits for App Lock's PIN (it ran under the lock screen and was lost) |
| `1aaa9de` | H3/H5/H7/H8/H10/H13/H15/H20: rows added by the downloader work follow Urdu's right-to-left order |

## 3. Gate

| Check | Result |
| --- | --- |
| `npm ci` | OK (adds `expo-local-authentication` 57.0.3 from PR #7) |
| `npm test` (on `1aaa9de`) | **1380 / 1380 pass** (main's test1 baseline 654; the integration before this check 1364) |
| `npm run typecheck` | 0 errors (after `.expo/types/router.d.ts` was regenerated by a Metro start — the new routes `/batch-add`, `/private`, `/data-usage`… are git-ignored generated types — and `d773e16`) |
| `npm run lint` | 0 errors, 84 warnings (the long-standing baseline) |
| `gradle :vidorax-media:testDebugUnitTest --rerun :vidorax-web:testDebugUnitTest --rerun` (on `75c3593`; later commits are JavaScript only) | BUILD SUCCESSFUL — **vidorax-media 971 / 0** (Faran §7 668, Hamza +298, this check +5), **vidorax-web 34 / 0**. `StoragePathsTest`, which Hamza's PRs report failing on Windows, passes on macOS |
| `:app:assembleRelease` (arm64) | OK, signed with the upload key (certificate SHA-256 `36b9c622…dd7b5af`); permissions: no restricted ones (adds USE_BIOMETRIC, FOREGROUND_SERVICE_MEDIA_PROCESSING / DATA_SYNC) |

## 4. Device check (release build, upload key, over test build 2 with data)

AVD `VidoraX_Test2` (Android 15, 4 GB, `-gpu host -feature -Vulkan`), release build of each fix commit installed with
`adb install -r` over test build 2 (1.0.1, versionCode 2) and its data. Upgrade: library (5 videos), the "Resume from
05:38" position and settings survived; cold start with the splash; no crash or ANR in the whole pass.

| Package | Result |
| --- | --- |
| H1 | PASS — Copy link (toast + clipboard), Re-download, Check for updates → Play listing (test2) |
| H2 | PASS — `Pictures/VidoraX/Big_Buck_Bunny_1080_10s_30MB.jpg` |
| H3 | PASS — Pause all, Resume all, Cancel all (confirm "3 downloads"), tap to pause/resume; long-press after `34d725b` |
| H4 | PASS — Reorder: the item moved to the top started next when the running one was paused |
| H5 | PASS — remaining, average speed, active time, last-minute graph, total speed (header) |
| H6 | PASS — today/month/total counters; a 237 MB daily limit → in-app alert + notification "Daily data limit reached" |
| H7 | PASS — Page Link Grabber: 18 links on test-videos.co.uk, 8 added, duplicates reported; Import from file (4 lines → 3 links); shortcut "Paste link" in the launcher |
| H8 | PASS — Always show options, rename, Preview plays inline |
| H9 | PASS — copy in `Documents/test-videos.co.uk/` (folder per site), "Copy in Documents/…" + Show in folder |
| H10 | PASS — `{title} {site}` + `.m4v` → `Big_Buck_Bunny_720_10s_5MB test-videos.co.uk.m4v` |
| H11 | PASS — "Open details" opened the finished download |
| H12 | PASS after `a2494c1` — Ask → Keep both made "Sintel_360_10s_2MB (2)"; tags, note, tag filter |
| H13 | PASS — CSV export to Documents (23 rows), error log, debug logs switch |
| H14 | Screen present; nothing queued to export at the time — export/import covered by unit tests |
| H15 | PASS — options UI (after `4942e87`); sign-in BLOCKED (no public password-protected HTTPS video) |
| H16 | PASS — Vibrate on → channel `vidorax_downloads_status_sound_vibrate` (vibration on) |
| H17 | PASS — F-Droid.apk: "This file could harm your device" |
| H18 | Screen present (default tab, export, import, reset) |
| H19 | PASS — Tears of Steel (segmented WebVTT) with subtitles on: de/en/fr/… saved beside the video, each with Export .srt / .vtt. Slow on this host (~1.5 s per 57-byte segment, 710 fetched one by one ≈ 15 min); resumed by itself after the app was reinstalled mid-way |
| H20 | PASS — SHA-256 equals the host's `5b603ec1…`; Play while downloading after `75c3593` (30 MB 1080p, playing at 44%) |
| H21 | PASS — needs App Lock, PIN every time, encrypted, plays from the vault |
| H22 | PASS — widget placed ("No active downloads", Paste link); Paste link after the PIN after `9463a87` |
| H23 | PASS — Trim (keyframe, new item), Title & artist ("Artist: Blender"), Convert explains why silent clips can't |
| Urdu | PASS after `1aaa9de` — Downloads, Batch Add, Settings, Download Settings, Details mirrored |
| F2 / F1 | 256 KB/s cap held at 255–256 KB/s; auto-resume off → a force-stopped download came back paused |

BLOCKED here: fingerprint unlock (no enrolled fingerprint; the row is hidden as designed), real phone.
