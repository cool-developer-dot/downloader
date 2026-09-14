# Browser containment + current-video CTA — real Android acceptance

**Status:** every case `NOT_TESTED` until exercised on a physical Android device.

**APK:** `APK_NOT_BUILT_BY_REQUEST`

No Maestro / Appium / Detox / OCR / polling automation.

---

## A. TikTok initial page — `NOT_TESTED`

Open TikTok in VidoraX. Stays inside VidoraX. No TikTok app / Play Store / Chrome. No `Can't open url: snssdk…`.

## B. First TikTok video — `NOT_TESTED`

First visible video: compact Download CTA appears without a second scroll or pause/play.

## C. TikTok dwell — `NOT_TESTED`

Same video 10s / 30s / 60s / 120s: CTA remains. No native-app redirect.

## D. TikTok long scroll — `NOT_TESTED`

≥30 videos: each supported current video shows the same shell rebound. No app launch.

## E. TikTok fast scroll — `NOT_TESTED`

A→B→C→D, stop D, tap Download: **D** enqueues, never A/B/C.

## F. TikTok Open-app UI — `NOT_TESTED`

Website “Open app” does not launch TikTok, chooser, or Play Store. CTA remains.

## G. Instagram first Reel — `NOT_TESTED`

Instagram stays in VidoraX. Reel A CTA appears promptly. No Instagram native launch.

## H. Instagram long scroll — `NOT_TESTED`

30 Reels: current-video CTA each time. No native redirects.

## I. Snapchat — `NOT_TESTED`

Snapchat web stays in VidoraX. Native Snapchat awakening blocked. Accessible current video uses existing detection (honest site limitations).

## J. General video website — `NOT_TESTED`

Non-social HTTPS stays in VidoraX. Video A CTA; player swap to B rebinds CTA.

## K. Same player reuse — `NOT_TESTED`

Same `<video>` A→B: CTA B; download B.

## L. Quality cancel — `NOT_TESTED`

A → Download → quality → Cancel: CTA A remains.

## M. Download handoff — `NOT_TESTED`

A enqueue → A consumed; scroll B → CTA B.

## N. Tabs — `NOT_TESTED`

TikTok tab A vs Instagram tab B: only active tab CTA. No cross-tab steal.

## O. Console — `NOT_TESTED`

Must **not** show `Can't open url: snssdk1233://`, `snssdk1340://`, `instagram://`, `snapchat://`.

## P. Loading spinner — `NOT_TESTED`

Blocked app-awaken: no infinite spinner; URL unchanged.

## Q. Back / Forward / Home — `NOT_TESTED`

Browser chrome still works.

## R. Desktop mode — `NOT_TESTED`

Desktop toggle unchanged.

## S. Session website — `NOT_TESTED`

Logged-in site: CTA + Phase 6 session verify. No Cookie persistence.

## T. Protected media — `NOT_TESTED`

DRM/encrypted: no Phase 1 enqueue. Safe message on tap if unresolved.

## U. Privacy — `NOT_TESTED`

Logs must not contain Cookie, Authorization, full signed media URL, requestContext, password, OTP.

## V. 50+ video stress — `NOT_TESTED`

No unbounded lag, verification storm, stale CTA, or native-app redirect.
