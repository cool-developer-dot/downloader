# Pause Ack / PAUSED State Commit — Real Android Acceptance

**Status:** every case is `NOT_TESTED` until exercised on a physical Android device with a current VidoraX build.

**APK:** `APK_NOT_BUILT_BY_REQUEST`

Do not use Maestro / Appium / Detox / OCR / pytest / polling scripts.

Package: `com.anonymous.vidorax`

This pass fixes the split-brain where Pause stops bytes but the UI stays DOWNLOADING with:

`Couldn't pause this download right now. Try again in a moment.`

---

## MANDATORY — INSTAGRAM MP4 / LARGE PROGRESSIVE — `NOT_TESTED`

Use Instagram MP4 or another sufficiently large progressive file.

1. Download to ~20–30%.
2. Tap **Pause download**.

Expected:

- bytes stop
- progress stops
- **NO** red `Couldn't pause this download right now. Try again in a moment.`
- status = **PAUSED**
- Pause button disappears
- **Resume download** appears

3. Wait 20 seconds.

Expected:

- no new bytes
- remains PAUSED
- Resume still visible

4. Tap **Resume download**.

Expected:

- QUEUED / STARTING
- one worker
- DOWNLOADING
- progress continues from the partial (no silent restart from 0 when Range is valid)

5. Pause / Resume 5 times on the same file.

Expected:

- always coherent (never DOWNLOADING + Pause + error toast after bytes have stopped)
- final file valid and playable

---

## MANUAL TEST 2 — DIRECT LARGE MP4 — `NOT_TESTED`

Same pause-ack sequence on a non-Instagram progressive MP4.

---

## MANUAL TEST 3 — RAPID PAUSE TAPS — `NOT_TESTED`

While DOWNLOADING, tap Pause twice quickly.

Expected: one pause operation; PAUSED; Resume; no error toast if transport stopped.

---

## MANUAL TEST 4 — WAIT AFTER PAUSE — `NOT_TESTED`

Pause at ~25%. Leave the Details screen open 20+ seconds.

Expected: no spontaneous restart, no late progress, Resume remains.

---

## MANUAL TEST 5 — RESUME AFTER BACKGROUND — `NOT_TESTED`

Pause, leave app, return, tap Resume.

Expected: one worker continues; no duplicate transfer.

---

## MANUAL TEST 6 — HLS UNAFFECTED — `NOT_TESTED`

Supported VOD HLS: Pause → PAUSED + Resume → continue one worker → complete.

---

## MANUAL TEST 7 — TWO DOWNLOADS ISOLATED — `NOT_TESTED`

A and B downloading. Pause A.

Expected: A PAUSED + Resume; B continues DOWNLOADING.

---

## MANUAL TEST 8 — FINALIZING REJECTS PAUSE — `NOT_TESTED`

If a download reaches finalization, Pause must not corrupt the file or show Resume for a completed item.

---

## KNOWN LIMITATIONS

- APK was not built in this pass (`APK_NOT_BUILT_BY_REQUEST`).
- Static verifiers cannot prove OkHttp/Expo DownloadTask native pause semantics on device.
- Instagram CDN Range support is origin-dependent; invalid 206 / 200 still refuse append.

---

## BUILD

Never run `expo prebuild`. Never assemble APK/AAB in this pass.
