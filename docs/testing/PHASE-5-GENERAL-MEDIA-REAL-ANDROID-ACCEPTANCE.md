# Phase 5 — General Media Real Android Acceptance

**Product:** VidoraX Browser & Video Downloader (Android)  
**Package:** `com.anonymous.vidorax`  
**Scope:** End-to-end general-website media from page → playable completed file  

**Rule:** Mark **NOT_TESTED** unless genuinely run on a physical/real Android device.  
COMPLETED catalog status alone is **not** acceptance — file must open, play, and match the intended media.

---

## Build under test

| Field | Value |
|---|---|
| APK variant | debug + release assembled (device acceptance NOT_TESTED) |
| Debug APK | `mobile/android/app/build/outputs/apk/debug/app-debug.apk` (~256M) |
| Release APK | `mobile/android/app/build/outputs/apk/release/app-release.apk` (~133M) |
| Git / build id | NOT_TESTED |
| Device | NOT_TESTED |
| Android version | NOT_TESTED |
| Tester | NOT_TESTED |
| Date | NOT_TESTED |

> All checklist steps below remain **NOT_TESTED** until run on a real Android device.

---

## DIRECT MP4

| # | Step | Expected | Status |
|---|---|---|---|
| 1 | Open ordinary MP4 page | Page loads in WebView | NOT_TESTED |
| 2 | Correct CTA | Download CTA for the visible main video | NOT_TESTED |
| 3 | Download | Enqueue succeeds | NOT_TESTED |
| 4 | CTA disappears | CONSUMED / hidden after enqueue | NOT_TESTED |
| 5 | One job | Exactly one download job | NOT_TESTED |
| 6 | Completed correct playable file | Opens and plays intended MP4 | NOT_TESTED |
| 7 | Audio correct | Audio present if advertised INCLUDED/UNKNOWN with sound | NOT_TESTED |

## WEBM

| # | Step | Expected | Status |
|---|---|---|---|
| 8 | WebM page | Page loads | NOT_TESTED |
| 9 | Correct CTA if supported | CTA only if Phase 1/WebM path supports | NOT_TESTED |
| 10 | Completed playable file | Valid WebM plays | NOT_TESTED |

## HLS

| # | Step | Expected | Status |
|---|---|---|---|
| 11 | HLS page | Page loads | NOT_TESTED |
| 12 | Top-level CTA only | One offer for the stream | NOT_TESTED |
| 13 | No segment CTAs | `.ts`/`.m4s` never offered | NOT_TESTED |
| 14 | Master quality sheet if applicable | Multiple real qualities listed once | NOT_TESTED |
| 15 | Chosen quality downloads | Selected variant enqueued | NOT_TESTED |
| 16 | Playable result | Completed media plays | NOT_TESTED |

## FALSE POSITIVES

| # | Step | Expected | Status |
|---|---|---|---|
| 17 | Poster ignored | No poster-as-video CTA | NOT_TESTED |
| 18 | Thumbnail ignored | No thumbnail-as-video CTA | NOT_TESTED |
| 19 | Background video does not steal main | Main player remains current | NOT_TESTED |
| 20 | Ad does not steal main | Ad markers / size alone cannot win | NOT_TESTED |
| 21 | Preload does not steal main | Offscreen preload suppressed | NOT_TESTED |
| 22 | `.ts`/`.m4s` not offered | Segments never CTA | NOT_TESTED |

## SPA

| # | Step | Expected | Status |
|---|---|---|---|
| 23 | Media A | CTA A available | NOT_TESTED |
| 24 | Route/player B | Ownership switches to B | NOT_TESTED |
| 25 | CTA B | Offer B available | NOT_TESTED |
| 26 | Old A never returns | Stale A handoff/quality confirm ignored | NOT_TESTED |

## TABS

| # | Step | Expected | Status |
|---|---|---|---|
| 27 | Tab A MP4 | Offer A | NOT_TESTED |
| 28 | Tab B HLS | Offer B | NOT_TESTED |
| 29 | No cross-leak | Identities/CTAs isolated | NOT_TESTED |
| 30 | Downloading A does not consume B | B remains AVAILABLE | NOT_TESTED |

## DOWNLOAD RELIABILITY

| # | Step | Expected | Status |
|---|---|---|---|
| 31 | Double tap one job | Single enqueue | NOT_TESTED |
| 32 | Pause | Phase 1 pause works | NOT_TESTED |
| 33 | Resume | Safe Range resume (no 200 append) | NOT_TESTED |
| 34 | Wi-Fi waiting | CTA stays consumed; job WAITING_FOR_WIFI | NOT_TESTED |
| 35 | Cancel | Phase 1 cleanup; CTA stays consumed | NOT_TESTED |
| 36 | Retry | Phase 1 retry path | NOT_TESTED |
| 37 | Unknown size | Indeterminate progress OK; no fake total | NOT_TESTED |
| 38 | Signed URL refresh if naturally encountered | Same media no CTA resurrection | NOT_TESTED |

## PERFORMANCE

| # | Step | Expected | Status |
|---|---|---|---|
| 39 | Browse site with many requests 30–60s | App remains responsive | NOT_TESTED |
| 40 | No 1-second verification storm | No periodic Phase 5 verify loops in logs | NOT_TESTED |

## SECURITY

| # | Step | Expected | Status |
|---|---|---|---|
| 41 | No sensitive request logging | No cookies / Authorization / signed query in logs | NOT_TESTED |

---

## Category coverage checklist

| Category | Covered by steps | Status |
|---|---|---|
| A. simple direct MP4 | 1–7 | NOT_TESTED |
| B. direct WebM | 8–10 | NOT_TESTED |
| C. HLS media playlist | 11–13, 16 | NOT_TESTED |
| D. HLS master playlist with qualities | 14–16 | NOT_TESTED |
| E. main + advertisement | 20 | NOT_TESTED |
| F. main + thumbnail/preview | 17–18 | NOT_TESTED |
| G. multiple video elements | 19 | NOT_TESTED |
| H. blob-backed player | (observe clue; http(s) download) | NOT_TESTED |
| I. SPA video navigation | 23–26 | NOT_TESTED |
| J. recycled carousel player | 23–26 | NOT_TESTED |
| K. many HLS segment requests | 12–13, 39–40 | NOT_TESTED |
| L. signed temporary media URL | 38 | NOT_TESTED |

---

## Sign-off

| Role | Name | Result | Date |
|---|---|---|---|
| Tester | | NOT_TESTED | |
| Reviewer | | NOT_TESTED | |

**Do not claim PHASE_5_FINALIZED / PRODUCTION_READY until this matrix is executed.**
