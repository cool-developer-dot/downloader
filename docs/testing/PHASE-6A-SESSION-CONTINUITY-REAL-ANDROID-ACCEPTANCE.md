# Phase 6A — Session Continuity Real Android Acceptance

**Product:** VidoraX Browser & Video Downloader (Android only)  
**Scope:** Legitimate website login + WebView cookie/session continuity  
**Not in scope:** Authenticated downloads (6B), provider restriction bypasses

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

## A. Basic login

| # | Step | Expected | Result |
|---|---|---|---|
| 1 | Open a normal website with account login | Site loads | NOT_TESTED |
| 2 | Login using **website** UI only | No VidoraX credential UI | NOT_TESTED |
| 3 | Confirm login succeeds | Account pages accessible | NOT_TESTED |
| 4 | Navigate account pages | Normal browsing | NOT_TESTED |
| 5 | Spinner stops after navigation | No infinite spinner | NOT_TESTED |
| 6 | Back / Forward | History sane | NOT_TESTED |

---

## B. Same-site tab session

| # | Step | Expected | Result |
|---|---|---|---|
| 7 | Tab A: login to site.com | Logged in | NOT_TESTED |
| 8 | Create Tab B | New tab | NOT_TESTED |
| 9 | Open same site.com | Loads | NOT_TESTED |
| 10 | Website recognizes shared session if its cookie policy permits | Often no second login | NOT_TESTED |
| 11 | No VidoraX-caused isolation forcing re-login | Platform cookies shared | NOT_TESTED |

---

## C. Tab UI isolation

| # | Step | Expected | Result |
|---|---|---|---|
| 12 | Tab A authenticated page/media | A CTA/media only | NOT_TESTED |
| 13 | Tab B another page/media | B CTA/media only | NOT_TESTED |
| 14 | URLs / loading / media / CTA tab-specific | No cross-tab UI leak | NOT_TESTED |

---

## D. Tab switch

| # | Step | Expected | Result |
|---|---|---|---|
| 15 | Tab A logged in | — | NOT_TESTED |
| 16 | Switch to B | — | NOT_TESTED |
| 17 | Return to A | — | NOT_TESTED |
| 18 | A remains normally logged in | Cookies not cleared on blur | NOT_TESTED |

---

## E. Tab close

| # | Step | Expected | Result |
|---|---|---|---|
| 19 | Two same-site logged-in tabs | — | NOT_TESTED |
| 20 | Close one | Tab removed | NOT_TESTED |
| 21 | Remaining tab not globally logged out by VidoraX | Jar intact | NOT_TESTED |

---

## F. Login redirect

| # | Step | Expected | Result |
|---|---|---|---|
| 22 | Site redirects through login/auth endpoints | Chain completes in WebView | NOT_TESTED |
| 23 | Final authenticated page loads | Success | NOT_TESTED |
| 24 | No infinite spinner | Loading clears | NOT_TESTED |
| 25 | Back/navigation remains sane | WebView history | NOT_TESTED |

---

## G. Popup / new window

| # | Step | Expected | Result |
|---|---|---|---|
| 26 | Site uses popup / window.open for login if available | — | NOT_TESTED |
| 27 | Flow matches VidoraX model (same-tab load for https) | No AuthWebView | NOT_TESTED |
| 28 | No unsafe generic Linking for auth URLs | Intent policy intact | NOT_TESTED |

---

## H. SPA login

| # | Step | Expected | Result |
|---|---|---|---|
| 29 | Web app login without full document reload (if available) | Session continues | NOT_TESTED |
| 30 | No stale pre-login page/media UI | Generation refresh | NOT_TESTED |

---

## I. Logout

| # | Step | Expected | Result |
|---|---|---|---|
| 31 | Use **website** Logout | — | NOT_TESTED |
| 32 | Website returns to logged-out state | Session ended by site | NOT_TESTED |
| 33 | No stale authenticated CTA/media | Cleared/invalidated | NOT_TESTED |

---

## J. Account switch

| # | Step | Expected | Result |
|---|---|---|---|
| 34 | Login Account A | — | NOT_TESTED |
| 35 | Logout | — | NOT_TESTED |
| 36 | Login Account B | — | NOT_TESTED |
| 37 | No stale A media/browser state | — | NOT_TESTED |

---

## K. App restart

| # | Step | Expected | Result |
|---|---|---|---|
| 38 | Login | — | NOT_TESTED |
| 39 | Close / reopen app | — | NOT_TESTED |
| 40 | Observe site cookie/session semantics | Persistent vs session cookies | NOT_TESTED |

Do not mark failure merely because the site uses session-only cookies.

---

## L. Privacy (Logcat)

| # | Check | Expected | Result |
|---|---|---|---|
| 41 | During login, Logcat has no password / OTP / Cookie value / Authorization / OAuth access token / private signed URL query | Redacted diagnostics only | NOT_TESTED |

---

## M. Network / performance

| # | Check | Expected | Result |
|---|---|---|---|
| 42 | Browse logged-in web app 30–60s | No cookie polling / auth polling / session heartbeat / 1s login checks | NOT_TESTED |

---

## Optional best-effort web apps

Telegram Web / WhatsApp Web / Snapchat Web may be tried as examples only.

If a provider rejects embedded WebViews, classify:

`SITE_OR_IDENTITY_PROVIDER_EMBEDDED_WEBVIEW_RESTRICTION`

Do **not** treat that as a VidoraX cookie-continuity bug to bypass.

| App | Result | Notes |
|---|---|---|
| Telegram Web | NOT_TESTED | |
| WhatsApp Web | NOT_TESTED | |
| Snapchat Web | NOT_TESTED | |

---

## Sign-off

| Gate | Status |
|---|---|
| Static verifier `verify:phase6a-session-continuity` | |
| Manual acceptance (this doc) | NOT_TESTED |
| Phase 6A final | Pending human Android test |
