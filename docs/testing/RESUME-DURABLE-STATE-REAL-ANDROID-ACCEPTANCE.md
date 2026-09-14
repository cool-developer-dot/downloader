# Resume Durable State — Real Android Acceptance

**Status:** every case is `NOT_TESTED` until exercised on a physical Android device with a current VidoraX build.

**APK:** `APK_NOT_BUILT_BY_REQUEST`

Do not use Maestro / Appium / Detox / OCR / pytest / polling scripts.

Package: `com.anonymous.vidorax`

Pause acknowledgement is already proven on device. This pass fixes Resume durable state so `RESUME_STATE_MISSING` with `actualPartialSize=0` is not thrown solely because native `resumeData` is absent.

---

## TEST A — PAUSE AFTER MEANINGFUL PROGRESS — `NOT_TESTED`

Start a large progressive download (Instagram MP4 or equivalent). Pause at 20–30%.

Expected:

- bytes stop
- PAUSED commits
- Resume appears
- DEV `PAUSE_DURABILITY` shows filesystemBytes (may be >0 after fix; record value)

---

## TEST B — RESUME STRATEGY — `NOT_TESTED`

Tap Resume.

Expected:

- if filesystemBytes / partial > 0 → `RANGE_RESUME` / exact offset / progress continues
- if partial == 0 → explicit `RESTART_FROM_ZERO` / progress resets to 0 / fresh transfer
- **NEVER** `RESUME_STATE_MISSING` solely because `resumeData` is absent

---

## TEST C — PAUSE / RESUME × 5 — `NOT_TESTED`

Repeat Pause/Resume five times.

Expected: one coherent worker each time; no duplicate transfers.

---

## TEST D — COMPLETE — `NOT_TESTED`

Let the download finish.

Expected: FINALIZING → valid playable media.

---

## TEST E — EARLY PAUSE (0-BYTE / PRE-FLUSH) — `NOT_TESTED`

Pause very early before first meaningful flush. Tap Resume.

Expected: safe byte-0 restart (not stranded in PAUSED).

---

## TEST F — HLS — `NOT_TESTED`

Supported VOD HLS Pause → Resume.

Expected: HLS checkpoint path (`HLS_CHECKPOINT_RESUME`), no progressive Range against HLS workspace.

---

## TEST G — PROCESS DEATH WHILE PAUSED — `NOT_TESTED`

Force-stop while PAUSED. Reopen. Resume per existing process-death contract.

Expected:

- public progressive with reconstructable source → appropriate strategy
- session-bound without live context → `SESSION_CONTEXT_LOST` (not mysterious missing state)

---

## KNOWN LIMITATIONS

- APK was not built in this pass (`APK_NOT_BUILT_BY_REQUEST`).
- Social CDNs may reject Range (HTTP 200) — that remains `RESUME_UNSUPPORTED` / clean restart paths, never silent append.
- Opaque iOS-style native resume blobs are not the Android Instagram path.

---

## BUILD

Never run `expo prebuild`. Never assemble APK/AAB in this pass.
