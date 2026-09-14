# Dynamic General Media Engine — Real Android Acceptance

Package: `com.anonymous.vidorax`  
Platform: Android only  
APK: `APK_NOT_BUILT_BY_REQUEST`  
Native: `NATIVE_REBUILD_REQUIRED_FOR_MANUAL_TEST`

This document verifies **generic** dynamic-site media detection. Do not treat a single hostname as the product contract.

Metro-only JS reload is **not** sufficient. Kotlin / WebView / service-worker observation changes require a rebuilt Android binary.

All items start as **NOT_TESTED**. Record PASS / FAIL / BLOCKED on a real device.

Do not log full media URLs, signed query, Cookie, Authorization, or tokens. Use host class, path class, fingerprint, and boolean flags.

Sanitized Metro stages to look for:

- `RESOURCE_SEEN`
- `RESOURCE_PREFILTER_CLASSIFIED`
- `NATIVE_EMITTED` / `RESOURCE_EMITTED`
- `JS_RECEIVED`
- `RESOURCE_CLASSIFIED`
- `CANDIDATE_INGESTED`
- `GENERAL_OWNER_ACQUIRED`
- `VERIFY_STARTED` / `VERIFY_SUCCEEDED` / `VERIFY_REJECTED`
- `OFFER_READY`
- `TAP` / `ENQUEUE_ACCEPTED`

---

## A. Dailymotion-like iframe

Open a public page whose current video plays in a **cross-origin iframe player** (example reproduction URL only: `https://dai.ly/xb6huwu`).

Expected:

- Visible current video
- Iframe owner acquired (not child DOM read)
- Download CTA appears
- Child-frame media/manifest traffic can ingest without requiring candidate URL == iframe src
- First Download tap verifies and enqueues when a supported source is observable
- No Dailymotion-specific resolver in logs

Status: **NOT_TESTED**

---

## B. Normal MP4 page

Open a page with a top-level HTML5 `<video>` whose `src`/`currentSrc` is a progressive `.mp4`.

Expected: owner → CTA → candidate → verification → Download → Phase 1. No reload. No second tap when the candidate is already observable.

Status: **NOT_TESTED**

---

## C. Normal WebM page

Open a page with progressive `.webm` (or `video/webm`).

Expected: same pipeline as MP4. WebM is a supported progressive format.

Status: **NOT_TESTED**

---

## D. HLS page

Open a page that plays **standard unencrypted VOD HLS** (`.m3u8` / MPEGURL).

Expected: manifest classified as HLS, segments never become the downloadable file, Phase 1 HLS handoff still works.

Status: **NOT_TESTED**

---

## E. Extensionless progressive page

Open a page whose media URL has **no** `.mp4`/`.webm` suffix but Range / `video/*` / media-family path evidence exists.

Expected: candidate reaches verification. Arbitrary extensionless API traffic does **not** become media.

Status: **NOT_TESTED**

---

## F. Dynamic SPA A→B

On an SPA, play video A, then navigate in-app to video B without a full document reload.

Expected:

- Same A + query/hash/player chrome does **not** bump generation
- A→B bumps generation
- Stale A candidates cannot enqueue B
- No reload workaround

Status: **NOT_TESTED**

---

## G. MSE/blob with underlying HTTP

Open a page where `video.currentSrc` is `blob:` but HTTP media/manifest traffic is visible to WebView.

Expected:

- Blob is owner evidence only
- Blob is never enqueued
- Underlying HTTP candidate correlates and can verify

If no HTTP/media observation surface emits a candidate after playback, record `PLATFORM_UNOBSERVABLE` (not “unsupported format”).

Status: **NOT_TESTED**

---

## H. Cross-origin embedded player

Embed a third-party player iframe on a news/blog page.

Expected: owner from iframe geometry/src/allow clues; source from native/SW/top-observable resources; no `contentDocument` access.

Status: **NOT_TESTED**

---

## I. Multiple videos

Page with a main player plus related/next tiles.

Expected: current visible/playing owner wins. Bounded ranked set. Related preload cannot own the main CTA.

Status: **NOT_TESTED**

---

## J. Ads / preloads

Page with VAST/ad path or muted tiny preview plus a real player.

Expected: ads/thumbnails rejected or demoted. Active content candidate wins.

Status: **NOT_TESTED**

---

## K. Logged-in general site (Phase 6)

Public-first probe, then ephemeral session retry only when auth-like failure occurs.

Expected: no Cookie/Authorization persistence. Session-required message if cookies are unavailable.

Status: **NOT_TESTED**

---

## L. True unsupported DASH

Page that only offers separate DASH audio/video (mux required).

Expected: `DASH_UNSUPPORTED` / proven unsupported. If a progressive or HLS alternative exists, that source can win.

Status: **NOT_TESTED**

---

## M. Encrypted HLS

Page with AES/SAMPLE-AES/DRM HLS.

Expected: proven unsupported. No encryption bypass.

Status: **NOT_TESTED**

---

## N. Tabs

Two tabs with different videos.

Expected: tab isolation; wrong-tab candidates rejected; switching tabs does not enqueue the previous tab’s media.

Status: **NOT_TESTED**

---

## O. Process / navigation changes

Background/foreground, typed navigation, Back/Forward.

Expected: stale tokens cancel safely; same-content query churn does not wipe CTA; real navigation clears stale candidates.

Status: **NOT_TESTED**

---

## Success criteria (every supported site)

visible current video → owner → CTA → candidate → verification → Download → Phase 1

- No reload
- No second-tap requirement when the candidate is already observable
- No site-specific download code
- User-triggered Download never silently no-ops (`TRANSIENT_UNRESOLVED` / network / unsupported / stale / session)

---

## Known platform limits (do not fake support)

VidoraX cannot detect media that Android WebView never exposes to:

- DOM (`<video>` / `<source>` / events)
- same-frame fetch/XHR
- PerformanceObserver
- `WebViewClient.shouldInterceptRequest`
- `ServiceWorkerClient.shouldInterceptRequest` (API 24+)

That is **PLATFORM_UNOBSERVABLE**, not an unsupported container.

Unsupported by product: DRM, encrypted HLS, separate DASH A/V requiring mux, segment-only MSE with no complete representation.

---

## Build status

`APK_NOT_BUILT_BY_REQUEST`  
`NATIVE_REBUILD_REQUIRED_FOR_MANUAL_TEST`  
Never: `expo prebuild`, `assembleDebug`, `eas build`, `expo export`.
