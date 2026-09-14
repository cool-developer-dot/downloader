# Pause / Resume — Real Android Acceptance

**Status:** all cases marked `NOT_TESTED` until exercised on a physical Android device / current VidoraX build.

**APK:** `APK_NOT_BUILT_BY_REQUEST`

Do not use automation (Maestro / Appium / Detox / OCR / polling scripts).

---

## A. DIRECT MP4 BASIC — `NOT_TESTED`

1. Start direct MP4.
2. Wait until DOWNLOADING.
3. Verify Pause visible.
4. Tap Pause.

Expected: transfer stops → PAUSED → Resume visible → progress/bytes stable → `.part` preserved.

5. Tap Resume.

Expected: STARTING/DOWNLOADING → Pause visible → progress continues → completes successfully.

## B. MULTIPLE PAUSE / RESUME — `NOT_TESTED`

Pause/Resume ×3.

Expected: no disappearing button, no duplicate worker, no corruption, valid completion.

## C. APP UI SWITCH — `NOT_TESTED`

During download: switch tabs/screens → return Downloads.

Expected: correct current action still visible.

## D. APP BACKGROUND / FOREGROUND — `NOT_TESTED`

Background then foreground while downloading / while paused.

Expected: UI reflects actual state; Resume still visible if paused.

## E. PROGRESSIVE RANGE — `NOT_TESTED`

Pause ~20–40%, Resume.

Expected: continues safely; no corrupt append.

## F. SERVER RETURNS 200 ON RESUME — `NOT_TESTED`

If reproducible: safe restart, NOT append to old partial.

## G. HLS — `NOT_TESTED`

Valid unencrypted HLS: Pause → Resume.

Expected: no duplicated segments, no premature finalization, valid completion.

## H. WIFI POLICY — `NOT_TESTED`

Wi-Fi-only on → Pause → lose Wi-Fi → Resume → `WAITING_FOR_WIFI` → restore Wi-Fi → continuation.

## I. RETRY RACE — `NOT_TESTED`

Induce temporary failure; Pause while RETRYING where practical.

Expected: remains paused; no hidden retry transfer.

## J. SESSION-BOUND — `NOT_TESTED`

Logged-in supported site → download → Pause → Resume same process.

Expected: works with ephemeral session; no Cookie persisted.

## K. PROCESS DEATH SESSION CASE — `NOT_TESTED`

Pause session-bound → force-stop → reopen.

Expected: Phase 6C process-death safety; no foreign account session adoption.

## L. MULTIPLE DOWNLOADS — `NOT_TESTED`

A + B downloading → Pause A → A pauses, B continues → Resume A → B unaffected.

## M. DOUBLE TAP — `NOT_TESTED`

Rapid Pause ×2 → idempotent. Rapid Resume ×2 → one worker.

## N. COMPLETION RACE — `NOT_TESTED`

Pause near 100%.

Expected: PAUSED before finalization **or** FINALIZING/COMPLETED wins. Never COMPLETED→PAUSED.

## O. PHASE 7 UI REGRESSION — `NOT_TESTED`

One DOWNLOADING, one PAUSED, one COMPLETED.

Expected:

- DOWNLOADING: Pause
- PAUSED: Resume
- COMPLETED: Play/Open/Share/Save/Delete as applicable — **no** Pause/Resume

## P. RESTART PERSISTENCE — `NOT_TESTED`

Pause public resumable → force-stop/reopen (if architecture persists pause).

Expected: still PAUSED, Resume visible, no unintended auto-start.

## Q. PRIVACY — `NOT_TESTED`

Inspect Logcat around Pause/Resume.

Must not reveal Cookie, Authorization, requestContext, signed URL query, password/OTP.

---

## PAUSE / RESUME RUNTIME REGRESSION

**Status:** every case below is `NOT_TESTED` until exercised on a physical Android device with a current VidoraX build.

**APK:** `APK_NOT_BUILT_BY_REQUEST`

Root cause addressed in engine (not UI): after `DownloadTask.pause()` the AbortSignal was still aborted, which called `DownloadTask.cancel()`. Native then took the `isCancelling` path and could leave `downloadAsync()` unsettled. Bytes stopped, UI mutating spinner stuck, PAUSED never committed, Resume could not reclaim the job.

### MANUAL P1 — BASIC PAUSE — `NOT_TESTED`

Start a normal MP4 download. Wait until at least several MB are downloaded. Tap Pause.

Expected within a short bounded time:

DOWNLOADING → PAUSED

UI: Pause control stops spinning; Resume becomes available.

File: `.part` remains.

Bytes: do not continue increasing after pause acknowledgment.

### MANUAL P2 — BASIC RESUME — `NOT_TESTED`

From PAUSED: tap Resume.

Expected: PAUSED → STARTING → DOWNLOADING.

Bytes continue from the correct Range point when the server supports it.

Exactly one transfer runs.

### MANUAL P3 — PAUSE / RESUME MULTIPLE TIMES — `NOT_TESTED`

During one large download: Pause → Resume at least 5 times.

Expected: no stuck state, no duplicate jobs, no corrupted file, no `.part` deletion; final file completes and plays.

### MANUAL P4 — RAPID TAPS — `NOT_TESTED`

Rapidly tap Pause several times, then Resume several times.

Expected: one state transition, one worker, one job, no duplicate downloads.

### MANUAL P5 — APP BACKGROUND — `NOT_TESTED`

Download → Pause → background app → foreground.

Expected: still PAUSED; Resume works.

### MANUAL P6 — PROCESS RESTART — `NOT_TESTED`

Download → Pause → force-stop app → reopen.

Expected: job still PAUSED; partial retained; Resume works.

### MANUAL P7 — WIFI POLICY — `NOT_TESTED`

If Wi-Fi-only is enabled: Pause → remove Wi-Fi → Resume.

Expected: WAITING_FOR_WIFI.

Restore Wi-Fi. Expected existing scheduler behavior resumes appropriately.

### MANUAL P8 — RANGE-IGNORING SERVER — `NOT_TESTED`

Use a test source/server that ignores Range if available. Pause after partial data. Resume.

Expected: safe restart-from-zero if that is the resolver contract.

Never append HTTP 200 full response to partial.

### MANUAL P9 — NEAR COMPLETION — `NOT_TESTED`

Pause around 95–99%.

Expected: either clean PAUSED, or legitimate COMPLETED if finalization already won.

Never stuck.

### MANUAL P10 — FINAL FILE VALIDATION — `NOT_TESTED`

After several pause/resume cycles: complete download. Open/play resulting file.

Expected: correct media, correct duration, no corruption, no duplicate data, no truncated ending.

