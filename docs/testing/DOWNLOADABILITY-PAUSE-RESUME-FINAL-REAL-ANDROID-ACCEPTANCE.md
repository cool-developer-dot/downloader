# Downloadability + Pause/Resume — Real Android Acceptance

**Status:** every case is `NOT_TESTED` until exercised on a physical Android device with a current VidoraX build.

**APK:** `APK_NOT_BUILT_BY_REQUEST`

Do not use Maestro / Appium / Detox / OCR / pytest / polling scripts.

Package: `com.anonymous.vidorax`

---

## MANUAL TEST 1 — TIKTOK FIRST VIDEO — `NOT_TESTED`

Open TikTok `/foryou`. First supported visible video → CTA → tap Download.

Expected: must not immediately say unavailable; current source resolves; current video enqueues.

## MANUAL TEST 2 — TIKTOK 20 VIDEOS — `NOT_TESTED`

Scroll at least 20 videos. For each supported accessible video: CTA → tap → current video resolves/downloads.

Record only videos proven truly unsupported separately.

## MANUAL TEST 3 — LONG DWELL — `NOT_TESTED`

Stay on one TikTok video: 10s, 30s, 60s. Tap Download at each timing.

Expected: same supported current video still resolves (must not fail solely because >2.5s elapsed).

## MANUAL TEST 4 — FAST SCROLL — `NOT_TESTED`

A → B → C → D. Stop on D. Download D.

Expected: D only.

## MANUAL TEST 5 — INSTAGRAM — `NOT_TESTED`

Multiple Reels. Supported current Reel → real download.

No false unavailable caused merely by first candidate failure.

## MANUAL TEST 6 — GENERAL WEBSITE — `NOT_TESTED`

Progressive MP4 site → real download.

Supported VOD HLS site → real HLS download.

## MANUAL TEST 7 — TRUE UNSUPPORTED — `NOT_TESTED`

DRM / encrypted / segment-only case where available.

Expected: professional unavailable message. No fake file.

## MANUAL TEST 8 — DIRECT MP4 PAUSE — `NOT_TESTED`

Start a sufficiently large progressive download. Wait until meaningful progress. Tap Pause.

Expected: bytes stop; progress stops; status PAUSED; Resume appears; partial remains.

Wait at least 20 seconds: no spontaneous progress/restart.

## MANUAL TEST 9 — DIRECT MP4 RESUME — `NOT_TESTED`

Tap Resume.

Expected: one worker; transfer continues safely; progress advances; COMPLETED; file plays.

Repeat Pause/Resume 3–5 times on the same download.

## MANUAL TEST 10 — HLS PAUSE / RESUME — `NOT_TESTED`

Supported VOD HLS. Pause → worker settles PAUSED. Resume → continues from checkpoint without duplicated/corrupt output. Complete and play.

## MANUAL TEST 11 — TWO DOWNLOADS — `NOT_TESTED`

A + B downloading. Pause A → B continues. Resume A → both independent.

## MANUAL TEST 12 — RAPID TAPS — `NOT_TESTED`

Pause × 3 → one pause. Resume × 3 → one worker.

## MANUAL TEST 13 — FINALIZING — `NOT_TESTED`

Near completion. When FINALIZING: Pause must not be available / accepted. Final file completes correctly.

## MANUAL TEST 14 — SCREEN NAVIGATION — `NOT_TESTED`

Download → Browser → Downloads → Library → Downloads.

Pause/Resume state remains correct (not mount-lifecycle).

## MANUAL TEST 15 — FORCE STOP PAUSED — `NOT_TESTED`

Pause a public/non-session progressive download. Force-stop app. Reopen.

Expected (existing Phase 1 process-death contract): remains safely paused; does not auto-transfer; manual Resume works where metadata supports it.

## MANUAL TEST 16 — WIFI POLICY — `NOT_TESTED`

Enable Wi-Fi-only. Pause/resume around network changes.

Expected: policy preserved. Resume does not bypass Wi-Fi-only.

## MANUAL TEST 17 — SESSION MEDIA — `NOT_TESTED`

Supported session-bound source: pause/resume while runtime context remains valid.

No secret logging/persistence.

## MANUAL TEST 18 — FINAL FILE INTEGRITY — `NOT_TESTED`

After repeated pause/resume: open/play completed file.

Validate: expected size; no truncation; no duplicated media; no corrupt tail; no `.part` marked completed.

## MANUAL TEST 19 — PRIVACY — `NOT_TESTED`

Metro/Logcat must not expose Cookie, Authorization, password, OTP, requestContext, or full signed CDN query.
