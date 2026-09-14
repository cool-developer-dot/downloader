# General Embedded Current-Video CTA — Real Android Acceptance

**Status:** NOT_TESTED (code/static gate only)  
**Reproduction:** `https://dai.ly/xb6huwu`  
**APK:** APK_NOT_BUILT_BY_REQUEST

All runtime items below are **NOT_TESTED** on a real Android device / emulator in this pass.

---

## TEST A — Dailymotion repro — NOT_TESTED

Open `https://dai.ly/xb6huwu`.

Expected:

- redirect stays inside VidoraX
- final Dailymotion video page loads
- visible video plays normally
- small VidoraX Download CTA appears
- no second scroll needed
- no page reload needed

## TEST B — First video CTA — NOT_TESTED

Stay on first Dailymotion video.

Expected: CTA remains visible while current video remains current.

## TEST C — Download — NOT_TESTED

Tap Download.

Expected:

- current video identity captured
- source resolves
- supported source verifies
- quality if applicable
- Phase 1 enqueue
- CTA consumed for that video

## TEST D — Next Dailymotion video — NOT_TESTED

Select a recommended video below.

Expected:

- new video becomes owner
- old owner discarded
- CTA appears for new video
- old source cannot download

## TEST E — Fast player change — NOT_TESTED

Switch A → B → C quickly. Stop on C. Tap Download.

Expected: C only.

## TEST F — HLS — NOT_TESTED

If page exposes supported unencrypted VOD HLS:

Expected: verify + download through existing HLS path.

## TEST G — True unsupported — NOT_TESTED

If video is DRM / encrypted / unsupported DASH:

Expected: CTA may identify current player; execution reports unsupported. No fake file.

## TEST H — General HTML5 site — NOT_TESTED

Open ordinary MP4 website.

Expected: current visible video → CTA.

## TEST I — Embedded iframe site — NOT_TESTED

Open a site with an embedded player where technically observable.

Expected: visible current player gets CTA using generic architecture. No cross-origin DOM bypass.

## TEST J — Multiple video elements — NOT_TESTED

Page with main player + previews.

Expected: main current player wins.

## TEST K — Tab isolation — NOT_TESTED

Tab A: Dailymotion video. Tab B: general website.

Expected: active tab CTA only.

## TEST L — Navigation — NOT_TESTED

Back / Forward / Home after Dailymotion.

Expected: browser navigation unchanged.

## TEST M — TikTok / Instagram regression smoke — NOT_TESTED

TikTok → existing current-video CTA still works.  
Instagram → existing current-video CTA still works.

Do not alter social architecture.

## TEST N — Privacy — NOT_TESTED

Logs must not expose Cookie, Authorization, signed query, password, OTP, requestContext.
