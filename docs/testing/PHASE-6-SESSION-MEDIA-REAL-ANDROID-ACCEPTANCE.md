# Phase 6 — Session Media Real Android Acceptance

**Product:** VidoraX Browser & Video Downloader  
**Platform:** Android only  
**Scope:** Phase 6A continuity + 6B access + 6C download pipeline  

All items remain **NOT_TESTED** until a human performs them on a real device/APK.

Do **not** mark Phase 6 finalized from static verification alone.

Telegram Web / WhatsApp Web / Snapchat Web may be used as best-effort examples.
Correct unsupported behavior is better than unsafe fake support.

---

## A. NORMAL LOGIN

| # | Case | Result |
|---|------|--------|
| 1 | Login through website UI | NOT_TESTED |
| 2 | Browse authenticated content | NOT_TESTED |
| 3 | Browser session works normally | NOT_TESTED |

## B. PUBLIC MEDIA WHILE LOGGED IN

| # | Case | Result |
|---|------|--------|
| 4 | Open public MP4 on logged-in site | NOT_TESTED |
| 5 | Download | NOT_TESTED |
| 6 | Public path still works | NOT_TESTED |
| 7 | Open completed file | NOT_TESTED |

## C. AUTHENTICATED MP4

| # | Case | Result |
|---|------|--------|
| 8 | Login | NOT_TESTED |
| 9 | Open legitimate session-bound MP4 | NOT_TESTED |
| 10 | CTA appears | NOT_TESTED |
| 11 | Download | NOT_TESTED |
| 12 | COMPLETED | NOT_TESTED |
| 13 | File plays | NOT_TESTED |
| 14 | Correct content | NOT_TESTED |
| 15 | Audio present if advertised | NOT_TESTED |

## D. AUTHENTICATED WEBM

| # | Case | Result |
|---|------|--------|
| 16 | Same test where supported | NOT_TESTED |

## E. AUTHENTICATED HLS

| # | Case | Result |
|---|------|--------|
| 17 | Login | NOT_TESTED |
| 18 | Open session-bound HLS | NOT_TESTED |
| 19 | CTA/quality | NOT_TESTED |
| 20 | Download | NOT_TESTED |
| 21 | No standalone `.ts`/`.m4s` jobs | NOT_TESTED |
| 22 | Complete final file | NOT_TESTED |
| 23 | Play video/audio | NOT_TESTED |

## F. HLS CROSS-HOST

| # | Case | Result |
|---|------|--------|
| 24 | Authenticated HLS with CDN hosts | NOT_TESTED |
| 25 | Download works | NOT_TESTED |
| 26 | Logs show no cookie leakage | NOT_TESTED |

## G. PAUSE / RESUME

| # | Case | Result |
|---|------|--------|
| 27 | Start authenticated progressive | NOT_TESTED |
| 28 | Pause | NOT_TESTED |
| 29 | Resume | NOT_TESTED |
| 30 | Complete + play | NOT_TESTED |

## H. WIFI POLICY

| # | Case | Result |
|---|------|--------|
| 32 | Enable Wi-Fi-only | NOT_TESTED |
| 33 | Enqueue session-bound job | NOT_TESTED |
| 34 | WAITING_FOR_WIFI if required | NOT_TESTED |
| 35 | No auth secrets in persistent metadata | NOT_TESTED |

## I. LOGOUT DURING DOWNLOAD

| # | Case | Result |
|---|------|--------|
| 36 | Start download | NOT_TESTED |
| 37 | Logout on website | NOT_TESTED |
| 38 | In-flight finishes OR next request fails | NOT_TESTED |
| 39 | No silent re-login/bypass | NOT_TESTED |

## J. SESSION EXPIRY

| # | Case | Result |
|---|------|--------|
| 40 | Expire session | NOT_TESTED |
| 41 | Retry media | NOT_TESTED |
| 42 | Safe session-expired failure | NOT_TESTED |
| 43 | No retry loop | NOT_TESTED |

## K. ACCOUNT SWITCH

| # | Case | Result |
|---|------|--------|
| 44 | Account A | NOT_TESTED |
| 45 | Start A media | NOT_TESTED |
| 46 | Logout | NOT_TESTED |
| 47 | Login B | NOT_TESTED |
| 48 | A job never silently adopts B session | NOT_TESTED |

## L. SAME-SITE TWO TABS

| # | Case | Result |
|---|------|--------|
| 49 | Tab A logged in | NOT_TESTED |
| 50 | Tab B same site | NOT_TESTED |
| 51 | Shared website session as normal | NOT_TESTED |
| 52 | Media CTA remains tab-specific | NOT_TESTED |

## M. CROSS-SITE

| # | Case | Result |
|---|------|--------|
| 53 | Site A authenticated | NOT_TESTED |
| 54 | Site B | NOT_TESTED |
| 55 | No A auth context leaks to B | NOT_TESTED |

## N. TAB CLOSE

| # | Case | Result |
|---|------|--------|
| 56 | Start download | NOT_TESTED |
| 57 | Close browser tab | NOT_TESTED |
| 58 | Download may continue safely | NOT_TESTED |
| 59 | No tab resurrection | NOT_TESTED |

## O. PROCESS DEATH

| # | Case | Result |
|---|------|--------|
| 60 | Start/pause authenticated job | NOT_TESTED |
| 61 | Force-stop app | NOT_TESTED |
| 62 | Relaunch | NOT_TESTED |
| 63 | Secret context was not persisted | NOT_TESTED |
| 64 | Job fails/pauses safely | NOT_TESTED |

## P. PROTECTED MEDIA

| # | Case | Result |
|---|------|--------|
| 65 | Blob/MSE-only — no false downloadable source | NOT_TESTED |
| 66 | (reserved) | NOT_TESTED |
| 67 | DRM/encrypted — no bypass | NOT_TESTED |
| 68 | (reserved) | NOT_TESTED |

## Q. PRIVACY

| # | Case | Result |
|---|------|--------|
| 69 | Logcat: no password/OTP/Cookie/Authorization/signed token | NOT_TESTED |
| 70 | Local persistence: no Cookie/Authorization/password/OTP | NOT_TESTED |

## R. PERFORMANCE

| # | Case | Result |
|---|------|--------|
| 71 | Browse logged-in media-heavy app 30–60s | NOT_TESTED |
| 72 | No auth polling | NOT_TESTED |
| 73 | No cookie polling | NOT_TESTED |
| 74 | No HEAD/Range storm | NOT_TESTED |
| 75 | No continuous resolver | NOT_TESTED |
