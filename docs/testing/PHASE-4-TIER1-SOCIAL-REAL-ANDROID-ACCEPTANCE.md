# Phase 4 Tier-1 Social — Real Android Acceptance

**Product:** VidoraX Browser & Video Downloader  
**Scope:** Instagram / TikTok end-to-end download reliability  
**Code gates:** Phase 4A/4B/4C + Tier-1 Hardening (static/code)

> Every case below is **`NOT_TESTED`** unless a human ran it on a real Android device/APK in this pass.  
> Do **not** mark PASS from emulator automation, OCR, Maestro, or inference.

**APK under test:** _(fill when testing)_  
**Device / OS:** _(fill when testing)_  
**Tester:** _(fill when testing)_  
**Date:** _(fill when testing)_

---

## MANDATORY REGRESSION — Instagram DcmMB5FAKt6

Reel: `https://www.instagram.com/reel/DcmMB5FAKt6/`

Previous failure: CTA → ~348 KB download → `The downloaded file was not a valid video.`

| Expected after hardening | Result |
|---|---|
| **A.** CTA uses a valid supported progressive/complete source → download → playable Reel (audio correct if advertised) | NOT_TESTED |
| **OR B.** No normal Download Video CTA if only unsupported init/fragment/adaptive video-only is available | NOT_TESTED |
| **NEVER** CTA → ~348 KB invalid file → FAILED invalid video | NOT_TESTED |

---

## Instagram

| # | Case | Result |
|---|---|---|
| 1 | Previously working Reel still downloads | NOT_TESTED |
| 2 | DcmMB5FAKt6 (see mandatory above) | NOT_TESTED |
| 3 | Second different Reel | NOT_TESTED |
| 4 | Swipe A→B | NOT_TESTED |
| 5 | Signed source refresh | NOT_TESTED |
| 6 | Audio correctness | NOT_TESTED |
| 7 | No duplicate quality rows | NOT_TESTED |
| 8 | Completed file playable | NOT_TESTED |
| 9 | Preload/neighbor does not steal CTA | NOT_TESTED |
| 10 | Ad/poster does not become CTA | NOT_TESTED |

## TikTok

| # | Case | Result |
|---|---|---|
| 11 | Known working public video | NOT_TESTED |
| 12 | Second different public video | NOT_TESTED |
| 13 | Next/feed video | NOT_TESTED |
| 14 | Audio correctness | NOT_TESTED |
| 15 | No preload wrong-video | NOT_TESTED |
| 16 | Completed file playable | NOT_TESTED |

## Common

| # | Case | Result |
|---|---|---|
| 17 | Double tap → one job | NOT_TESTED |
| 18 | Same media → CTA stays consumed | NOT_TESTED |
| 19 | New media → new CTA | NOT_TESTED |
| 20 | Pause/resume | NOT_TESTED |
| 21 | Retry | NOT_TESTED |
| 22 | Wi-Fi waiting | NOT_TESTED |
| 23 | Cancel | NOT_TESTED |
| 24 | Cross-tab isolation | NOT_TESTED |
| 25 | No network probe storm | NOT_TESTED |

---

## Notes

- Website owns authentication; private/login-walled media is not a product guarantee.  
- DRM/Widevine streams must remain unsupported.  
- After enqueue, CTA stays consumed even if Downloads shows WAITING_FOR_WIFI / FAILED / CANCELLED.
