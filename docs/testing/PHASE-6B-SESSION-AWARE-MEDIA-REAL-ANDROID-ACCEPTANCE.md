# Phase 6B — Session-Aware Media Real Android Acceptance

**Product:** VidoraX (Android only)  
**Scope:** Minimum legitimate session context for media **verification**  
**Not in scope:** Authenticated download execution (Phase 6C)

Mark every runtime case `NOT_TESTED` until a human verifies on a real device.

---

## Build under test

| Field | Value |
|---|---|
| APK / build | |
| Commit / branch | |
| Device / Android version | |
| Tester | |
| Date | |

---

## A. Public media

| # | Step | Expected | Result |
|---|---|---|---|
| 1 | Logged-in page exposes public MP4 | Verifies without cookies | NOT_TESTED |
| 2 | Public HLS | No unnecessary session context | NOT_TESTED |

---

## B. Session-bound direct video

| # | Step | Expected | Result |
|---|---|---|---|
| 3 | Login inside website UI | Website owns auth | NOT_TESTED |
| 4 | Open session-protected MP4/WebM | Media detected (5A) | NOT_TESTED |
| 5 | Media is detected | Ownership correct | NOT_TESTED |
| 6 | Verification succeeds only with legitimate session context | SESSION_BOUND path | NOT_TESTED |
| 7 | Logcat has no raw Cookie/Auth | Redacted diagnostics | NOT_TESTED |

---

## C. Authenticated HLS

| # | Step | Expected | Result |
|---|---|---|---|
| 8 | Login | — | NOT_TESTED |
| 9 | Open authenticated HLS | Detected | NOT_TESTED |
| 10 | Master/media playlist verifies | Actionable variants | NOT_TESTED |
| 11 | No segment CTAs | `.ts`/`.m4s` rejected | NOT_TESTED |
| 12 | DRM/encrypted HLS rejected | No bypass | NOT_TESTED |

---

## D. Session expiry

| # | Step | Expected | Result |
|---|---|---|---|
| 13 | Expire/logout session | Website logged out | NOT_TESTED |
| 14 | Reverify media | — | NOT_TESTED |
| 15 | Fail safely SESSION_EXPIRED / AUTH_CONTEXT_UNAVAILABLE | No retry loop | NOT_TESTED |

---

## E. Tab isolation

| # | Step | Expected | Result |
|---|---|---|---|
| 16 | Tab A logged-in media A | — | NOT_TESTED |
| 17 | Tab B media B | — | NOT_TESTED |
| 18 | No request-context mix | Generation/tab scoped | NOT_TESTED |

---

## F. Account switch

| # | Step | Expected | Result |
|---|---|---|---|
| 19 | Account A media | — | NOT_TESTED |
| 20 | Logout | — | NOT_TESTED |
| 21 | Account B | — | NOT_TESTED |
| 22 | Old A context cannot verify B | Stale generation | NOT_TESTED |

---

## G. CDN

| # | Step | Expected | Result |
|---|---|---|---|
| 23 | Media on CDN host | May verify | NOT_TESTED |
| 24 | No page cookie manually leaked to unrelated host | CookieManager(mediaUrl) only | NOT_TESTED |

---

## H. Privacy

| # | Step | Expected | Result |
|---|---|---|---|
| 25 | Logcat: no Cookie/Authorization/token/signed query values | Pass | NOT_TESTED |
| 26 | App persistence: no raw auth session values | Pass | NOT_TESTED |

---

## I. Performance

| # | Step | Expected | Result |
|---|---|---|---|
| 27 | Browse logged-in media app 30–60s | — | NOT_TESTED |
| 28 | No cookie/auth polling or verify storm | Pass | NOT_TESTED |

---

## Sign-off

| Gate | Status |
|---|---|
| `verify:phase6b-session-aware-media-access` | |
| Manual acceptance (this doc) | NOT_TESTED |
| Phase 6B final | Pending human Android test |
