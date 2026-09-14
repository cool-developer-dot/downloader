# Automatic Media Handoff — Real Android Acceptance

Phase 2. Static gate: `npm run verify:automatic-media-handoff`

All runtime cases start **NOT_TESTED**. Do not mark passed from code review alone.

Device: _______________  
Build: _______________  
Date: _______________  
Tester: _______________

---

## MANUAL A — PASTE VIDEO PAGE

Paste/open a supported video page in Browser (omnibox or start-page paste).

Expected:

- Website opens normally
- No Analyze Link / Analyze Video / Analyze URL button
- Detection happens automatically in the background

Result: **NOT_TESTED**

Notes:

---

## MANUAL B — VERIFIED MEDIA

Wait until the engine actually verifies a supported source.

Expected:

- **Video available** bar appears **after** verification
- Bar does not appear for a mere `<video>` / blob / segment clue
- No automatic blocking modal

Result: **NOT_TESTED**

Notes:

---

## MANUAL C — PLAY

Tap **Video available** → **Play**.

Expected:

- Existing webpage playback continues (or returns to the page)
- No download starts
- Page does not reload
- Tab / history / cookies unchanged

Result: **NOT_TESTED**

Notes:

---

## MANUAL D — SINGLE SOURCE DOWNLOAD

On a page with one verified source: **Video available** → **Download**.

Expected:

- One download enqueued
- Bar consumed/hidden for that content
- No Analyze / Continue / second confirmation
- Downloads list shows the new job

Result: **NOT_TESTED**

Notes:

---

## MANUAL E — MULTIPLE QUALITY

On a page with multiple genuine verified variants (e.g. 1080p / 720p / 480p).

Expected:

- Download opens quality choices (not fake fragment labels)
- Choosing one enqueues exactly one job
- Canceling quality selection keeps the bar AVAILABLE (not consumed)

Result: **NOT_TESTED**

Notes:

---

## MANUAL F — RAPID TAP

Tap Download rapidly (bar and/or sheet).

Expected:

- Exactly one job
- HANDOFF disables repeat taps

Result: **NOT_TESTED**

Notes:

---

## MANUAL G — CONTENT CHANGE

Content A shows Video available → navigate/recycle to Content B.

Expected:

- A bar disappears
- B resolves independently
- Late A result does not make B downloadable
- Consumed A does not hide a later valid B

Result: **NOT_TESTED**

Notes:

---

## MANUAL H — UNSUPPORTED

Test known unsupported media (DRM, encrypted HLS, mux-required DASH, blob/MSE-only).

Expected:

- No fake Video available / Download-ready CTA
- No fake successful download
- If an explicit unsupported action path is reached: **This video can't be downloaded by VidoraX.**

Result: **NOT_TESTED**

Notes:

---

## MANUAL I — WEBVIEW SURVIVAL

When media becomes available:

Expected:

- Page remains loaded
- In-page video/page state remains
- History remains
- Tab remains
- Cookies/session remain

Result: **NOT_TESTED**

Notes:

---

## MANUAL J — THEMES

Check media bar + Play/Download sheet in:

- LIGHT
- LOGO (brand red `#DC3C2C` unchanged)
- DARK

Expected: theme-correct chrome, readable contrast, no hardcoded wrong palette.

Result: **NOT_TESTED**

Notes:

---

---

## DYNAMIC WEBSITE AUTO-DETECTION REGRESSION

Static gate: `npm run verify:automatic-media-handoff` (159 assertions).
All runtime cases below start **NOT_TESTED**.

Regression example: Dailymotion (`https://www.dailymotion.com/video/<id>`)
is used as one runtime example. The fix is generic — no site name is
hardcoded in the detection or verification code.

### TEST A — DAILYMOTION REGRESSION (generic HLS auth-retry)

1. Fresh cold start of Browser.
2. Open a supported Dailymotion VOD page.
3. Tap play on the in-page player if it does not autoplay.

Expected:
- No **Analyze** button anywhere.
- No refresh required.
- No manual media-URL copy required.
- Within seconds of playback starting, the **Video available** bar appears.
- `adb logcat | grep VidoraHandoff` shows in order:
  `MEDIA_CANDIDATE_OBSERVED` → `MEDIA_CANDIDATE_CORRELATED` →
  `MEDIA_VERIFY_AUTO_STARTED` → (optionally `hls_auth_required` in the
  general-source diag stream, then the auth-retry) →
  `MEDIA_VERIFY_SUPPORTED` → `MEDIA_CTA_AVAILABLE`.

Result: **NOT_TESTED**

### TEST B — SIMPLE MP4

Open a page whose video is a plain progressive MP4
(e.g., `https://example.com/anything/video.mp4`).

Expected:
- **Video available** appears after verification.
- **Download** → enqueues immediately (single-variant path).

Result: **NOT_TESTED**

### TEST C — DYNAMIC JAVASCRIPT PLAYER

Open a page whose player initializes after `DOMContentLoaded` (media
URL fetched later via `fetch` / `XHR`).

Expected:
- The late media candidate is observed automatically via the injected
  fetch/XHR hooks and/or `PerformanceObserver`.
- Verification runs without user interaction.

Result: **NOT_TESTED**

### TEST D — CROSS-ORIGIN EMBED

Open a page hosting a supported player inside a cross-origin iframe
(e.g., `player.<cdn>.com` served from `example.com/watch/...`).

Expected:
- `active_iframe_player` fires; ownership is `MEDIUM` (iframe).
- Any correlated non-iframe HTTP(S) candidate is verified.
- If a supported source is observable, **Video available** appears.

Result: **NOT_TESTED**

### TEST E — SPA CONTENT CHANGE

Video A becomes AVAILABLE, then navigate within the SPA to a different
video B without a full page reload.

Expected:
- A is invalidated (`shouldInvalidateCurrentMedia`).
- B is detected independently.
- Late verification results for A do **not** publish on B
  (`MEDIA_VERIFY_STALE_RESULT_IGNORED`).

Result: **NOT_TESTED**

### TEST F — SUPPORTED HLS

Open a supported unencrypted VOD HLS page.

Expected:
- Manifest is fetched and parsed.
- Individual `.ts` / `.m4s` segments never appear as standalone
  candidates.
- **Video available** appears after verification.

Result: **NOT_TESTED**

### TEST G — BLOB PLAYER WITH RECOVERABLE SOURCE

Open a page whose `<video>` uses a `blob:` src but where an underlying
supported source / VOD manifest is observable on the network.

Expected:
- `activeVideoIsBlob = true` upgrades ownership floor to `MEDIUM`.
- `blob:` URL itself never becomes an AVAILABLE download target.
- The underlying HTTP(S) source is verified → **Video available**.

Result: **NOT_TESTED**

### TEST H — UNSUPPORTED FORMAT

Open a page whose current video is DRM / encrypted HLS / mux-required
DASH / unsupported live.

Expected:
- No fake AVAILABLE.
- Once evidence is decisive, `MEDIA_VERIFY_UNSUPPORTED` fires and the
  shell resolves to `UNSUPPORTED_CURRENT_CONTENT`, showing
  **This video can't be downloaded by VidoraX.**
- `MEDIA_UNSUPPORTED_PRESENTED` fires **once** per content identity — no
  spam.

Result: **NOT_TESTED**

### TEST I — NORMAL NON-VIDEO PAGE

Open an ordinary informational webpage.

Expected:
- No **Video available** bar.
- No **This video can't be downloaded** warning.
- `MEDIA_UNSUPPORTED_PRESENTED` does **not** fire.

Result: **NOT_TESTED**

### TEST J — PERFORMANCE

Browse a media-heavy / dynamic page (feed with many players / iframes /
segments) for several minutes.

Expected:
- No candidate storm — dedupe absorbs repeated resource entries.
- No repeated HEAD/GET/Range probes for the same URL (verification cache
  hit).
- No progressive lag or frozen buttons.
- `MEDIA_VERIFY_JOINED_INFLIGHT` observed for duplicate requests.

Result: **NOT_TESTED**

---

## Sign-off

Overall: **NOT_TESTED**

APK_NOT_BUILT_BY_REQUEST
