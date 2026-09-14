# Phase 2F — Browser APK Runtime Acceptance

**Product:** VidoraX (Android)  
**Package:** `com.anonymous.vidorax`  
**Phase:** 2F — Real-device browser acceptance (manual)  
**Prepared:** 2026-09-02  

> **Important:** Static/automated tests prove contracts only. This matrix is the source of truth for runtime acceptance. Do **not** mark cases PASS without real-device evidence.

---

## How to use

1. Install APK (see install commands in Phase 2F report).
2. Run logcat filter while testing (DEV builds only for verbose `[Browser*]` tags).
3. For each case: record URL/site, actual behavior, status, screenshot/video, relevant log excerpt.
4. Classify failures using triage categories: `BROWSER_RUNTIME`, `NAVIGATION`, `SESSION`, `SSL`, `ERROR_UI`, `MEDIA_DETECTION`, `MEDIA_CORRELATION`, `DOWNLOAD_HANDOFF`, `PHASE1_TRANSFER`, `WEBSITE_LIMITATION`, `DRM/UNSUPPORTED`.

---

## Test cases

### TEST-01 — Google / Search

| Field | Value |
|-------|-------|
| **Category** | Navigation / JS |
| **URL/site used** | _(fill on device)_ |
| **Expected** | Google/search results load; JavaScript works; address bar shows expected URL; no browser error overlay |
| **Actual** | |
| **Status** | NOT TESTED |
| **Screenshot/video** | |
| **Log excerpt/tag** | `[BrowserNav]`, `[BrowserLoad]` |
| **Notes** | |

---

### TEST-02 — Normal HTTPS Website

| Field | Value |
|-------|-------|
| **Category** | Navigation |
| **URL/site used** | _(fill on device)_ |
| **Expected** | Site opens normally; normal links work; no false error overlay |
| **Actual** | |
| **Status** | NOT TESTED |
| **Screenshot/video** | |
| **Log excerpt/tag** | |
| **Notes** | |

---

### TEST-03 — JavaScript-Heavy SPA

| Field | Value |
|-------|-------|
| **Category** | Navigation / SPA |
| **URL/site used** | _(fill on device — e.g. news/social feed)_ |
| **Expected** | Dynamic UI works; SPA route updates URL; no forced full reload for pushState; Back behaves correctly |
| **Actual** | |
| **Status** | NOT TESTED |
| **Screenshot/video** | |
| **Log excerpt/tag** | `[BrowserNav] commit`, `[BrowserHistory]` |
| **Notes** | |

---

### TEST-04 — Website Login / Session

| Field | Value |
|-------|-------|
| **Category** | Session |
| **URL/site used** | _(safe test account site only)_ |
| **Expected** | Login → navigate → reload → Home → return → revisit: session persists per WebView cookies; VidoraX does not store username/password |
| **Actual** | |
| **Status** | NOT TESTED |
| **Screenshot/video** | |
| **Log excerpt/tag** | `[BrowserSession]` |
| **Notes** | |

---

### TEST-05 — Redirect Chain

| Field | Value |
|-------|-------|
| **Category** | Navigation |
| **URL/site used** | _(short-link / redirect test URL)_ |
| **Expected** | Initial URL → redirects → correct final page; no permanent ERR_CONNECTION_ABORTED; no redirect loop |
| **Actual** | |
| **Status** | NOT TESTED |
| **Screenshot/video** | |
| **Log excerpt/tag** | `[BrowserNav] redirect` |
| **Notes** | |

---

### TEST-06 — Toolbar Back

| Field | Value |
|-------|-------|
| **Category** | Navigation |
| **URL/site used** | A → B → C navigation chain |
| **Expected** | Back: C → B, then B → A |
| **Actual** | |
| **Status** | NOT TESTED |
| **Screenshot/video** | |
| **Log excerpt/tag** | `[BrowserNav] back` |
| **Notes** | |

---

### TEST-07 — Toolbar Forward

| Field | Value |
|-------|-------|
| **Category** | Navigation |
| **URL/site used** | After TEST-06 Back from C |
| **Expected** | Forward restores correct forward page |
| **Actual** | |
| **Status** | NOT TESTED |
| **Screenshot/video** | |
| **Log excerpt/tag** | `[BrowserNav] forward` |
| **Notes** | |

---

### TEST-08 — Android Hardware Back

| Field | Value |
|-------|-------|
| **Category** | Navigation |
| **URL/site used** | A → B |
| **Expected** | Hardware Back: B → A; VidoraX stays in browser while WebView history exists |
| **Actual** | |
| **Status** | NOT TESTED |
| **Screenshot/video** | |
| **Log excerpt/tag** | `[BrowserNav] android_back` |
| **Notes** | |

---

### TEST-09 — Reload

| Field | Value |
|-------|-------|
| **Category** | Navigation |
| **URL/site used** | Any loaded HTTPS page |
| **Expected** | One controlled reload; session preserved; no double-navigation |
| **Actual** | |
| **Status** | NOT TESTED |
| **Screenshot/video** | |
| **Log excerpt/tag** | `[BrowserNav] reload`, `[BrowserLoad]` |
| **Notes** | |

---

### TEST-10 — Stop

| Field | Value |
|-------|-------|
| **Category** | Navigation / Error UI |
| **URL/site used** | Slow-loading page |
| **Expected** | Load stops; no automatic restart; no branded fatal error from intentional Stop alone |
| **Actual** | |
| **Status** | NOT TESTED |
| **Screenshot/video** | |
| **Log excerpt/tag** | `[BrowserNav] stop`, `[BrowserError] userInitiatedAbort` |
| **Notes** | |

---

### TEST-11 — window.open

| Field | Value |
|-------|-------|
| **Category** | Navigation / Window |
| **URL/site used** | _(safe page with window.open)_ |
| **Expected** | Handled predictably in same browser surface per Phase 2C; does not silently disappear |
| **Actual** | |
| **Status** | NOT TESTED |
| **Screenshot/video** | |
| **Log excerpt/tag** | `[BrowserWindow]` |
| **Notes** | |

---

### TEST-12 — target=_blank

| Field | Value |
|-------|-------|
| **Category** | Navigation / Window |
| **URL/site used** | _(safe page with target=_blank link)_ |
| **Expected** | Same predictable same-surface behavior as window.open |
| **Actual** | |
| **Status** | NOT TESTED |
| **Screenshot/video** | |
| **Log excerpt/tag** | `[BrowserWindow] target_blank` |
| **Notes** | |

---

### TEST-13 — Cookie / Session Persistence

| Field | Value |
|-------|-------|
| **Category** | Session |
| **URL/site used** | Site with preferences (theme, locale, etc.) |
| **Expected** | Appropriate persistence; no login loop caused by VidoraX |
| **Actual** | |
| **Status** | NOT TESTED |
| **Screenshot/video** | |
| **Log excerpt/tag** | `[BrowserSession]` |
| **Notes** | |

---

### TEST-14 — Offline

| Field | Value |
|-------|-------|
| **Category** | Error UI |
| **URL/site used** | Any HTTPS page with airplane mode / data off |
| **Expected** | Branded error: "Unable to open this page" + "No internet connection"; Retry + Go Home; no raw ERR_INTERNET_DISCONNECTED |
| **Actual** | |
| **Status** | NOT TESTED |
| **Screenshot/video** | |
| **Log excerpt/tag** | `[BrowserError] classification=offline` |
| **Notes** | |

---

### TEST-15 — Bad Domain

| Field | Value |
|-------|-------|
| **Category** | Error UI |
| **URL/site used** | `https://this-domain-does-not-exist-vidorax-test.invalid/` (or similar safe nonexistent host) |
| **Expected** | Branded error; no ERR_NAME_NOT_RESOLVED, Domain: undefined, or net::ERR_* in UI |
| **Actual** | |
| **Status** | NOT TESTED |
| **Screenshot/video** | |
| **Log excerpt/tag** | `[BrowserError] classification=dns` |
| **Notes** | |

---

### TEST-16 — Connection Interruption

| Field | Value |
|-------|-------|
| **Category** | Error UI |
| **URL/site used** | Active page load + disable network mid-load |
| **Expected** | Safe "Connection interrupted" or offline state; no raw Chromium error page |
| **Actual** | |
| **Status** | NOT TESTED |
| **Screenshot/video** | |
| **Log excerpt/tag** | `[BrowserError]` |
| **Notes** | |

---

### TEST-17 — Invalid SSL

| Field | Value |
|-------|-------|
| **Category** | SSL |
| **URL/site used** | Known bad-cert test host (e.g. `https://self-signed.badssl.com/` or equivalent) |
| **Expected** | "Secure connection failed"; navigation blocked; NO Continue/bypass; NO handler.proceed behavior |
| **Actual** | |
| **Status** | NOT TESTED |
| **Screenshot/video** | |
| **Log excerpt/tag** | `[BrowserSSL] blocked=true` |
| **Notes** | |

---

### TEST-18 — Retry

| Field | Value |
|-------|-------|
| **Category** | Error UI |
| **URL/site used** | After TEST-14 or TEST-15 with connectivity restored |
| **Expected** | Retry reloads intended URL exactly once |
| **Actual** | |
| **Status** | NOT TESTED |
| **Screenshot/video** | |
| **Log excerpt/tag** | `[BrowserNav] chrome_load`, `[BrowserLoad] start` |
| **Notes** | |

---

### TEST-19 — Go Home

| Field | Value |
|-------|-------|
| **Category** | Error UI / Navigation |
| **URL/site used** | From error screen (TEST-14/15) |
| **Expected** | Browser Home / Quick Access; no stale error; no stale media CTA |
| **Actual** | |
| **Status** | NOT TESTED |
| **Screenshot/video** | |
| **Log excerpt/tag** | `[BrowserNav] home`, `[BrowserMedia] cta_cleared` |
| **Notes** | |

---

### TEST-20 — Stale Error Race

| Field | Value |
|-------|-------|
| **Category** | Error UI |
| **URL/site used** | Slow-fail page A, then quickly open valid page B |
| **Expected** | Late error from A does NOT replace successful page B |
| **Actual** | |
| **Status** | NOT TESTED |
| **Screenshot/video** | |
| **Log excerpt/tag** | `[BrowserError] staleDropped=true` |
| **Notes** | May be hard to reproduce — mark BLOCKED if not reproducible |

---

### TEST-21 — Device VPN

| Field | Value |
|-------|-------|
| **Category** | Network |
| **URL/site used** | Site reachable via device VPN |
| **Expected** | VidoraX follows Android networking naturally; no special VidoraX VPN logic |
| **Actual** | |
| **Status** | NOT TESTED |
| **Screenshot/video** | |
| **Log excerpt/tag** | |
| **Notes** | |

---

### TEST-22 — Non-Media Page

| Field | Value |
|-------|-------|
| **Category** | Media Detection |
| **URL/site used** | Page with thumbnails/images but no video |
| **Expected** | NO false Download Video CTA |
| **Actual** | |
| **Status** | NOT TESTED |
| **Screenshot/video** | |
| **Log excerpt/tag** | `[BrowserMedia]` (no cta_available) |
| **Notes** | |

---

### TEST-23 — Direct MP4 Page

| Field | Value |
|-------|-------|
| **Category** | Media Detection |
| **URL/site used** | Public direct `.mp4` URL page |
| **Expected** | Candidate → verification → Download CTA; browser usable; NO auto-download |
| **Actual** | |
| **Status** | NOT TESTED |
| **Screenshot/video** | |
| **Log excerpt/tag** | `[BrowserMedia] cta_available` |
| **Notes** | |

---

### TEST-24 — HLS (non-DRM VOD)

| Field | Value |
|-------|-------|
| **Category** | Media Detection |
| **URL/site used** | Standard unencrypted HLS VOD page |
| **Expected** | One useful HLS candidate; no `.ts`/`.m4s` spam; user CTA; Phase 1 handoff on explicit tap |
| **Actual** | |
| **Status** | NOT TESTED |
| **Screenshot/video** | |
| **Log excerpt/tag** | `[BrowserMedia]` |
| **Notes** | |

---

### TEST-25 — Media Page Navigation

| Field | Value |
|-------|-------|
| **Category** | Media Correlation |
| **URL/site used** | Page A (with CTA) → Page B (no media) |
| **Expected** | Page A CTA disappears on B; no stale candidate |
| **Actual** | |
| **Status** | NOT TESTED |
| **Screenshot/video** | |
| **Log excerpt/tag** | `[BrowserMedia] cta_cleared` |
| **Notes** | |

---

### TEST-26 — Error After Media

| Field | Value |
|-------|-------|
| **Category** | Media Correlation / Error UI |
| **URL/site used** | Media page with CTA → navigate to failing page |
| **Expected** | Error screen visible; NO old Download CTA above error |
| **Actual** | |
| **Status** | NOT TESTED |
| **Screenshot/video** | |
| **Log excerpt/tag** | `[BrowserMedia] reason=browser_error` |
| **Notes** | |

---

### TEST-27 — TikTok Public Video

| Field | Value |
|-------|-------|
| **Category** | Media Detection / Download Handoff |
| **URL/site used** | Public TikTok video URL |
| **Expected** | Page works; candidate detected; CTA if supported; user tap → Phase 1 transfer → playable completed file |
| **Actual** | |
| **Status** | NOT TESTED |
| **Screenshot/video** | |
| **Log excerpt/tag** | `[BrowserMedia]`, Phase 1 download diagnostics |
| **Notes** | Detection failure ≠ auto-fix; collect diagnostics first |

---

### TEST-28 — Instagram Public/Session Media

| Field | Value |
|-------|-------|
| **Category** | Media Detection / Download Handoff |
| **URL/site used** | Public/session-accessible Instagram reel |
| **Expected** | Same flow: browser → candidate → CTA → explicit download → Phase 1 |
| **Actual** | |
| **Status** | NOT TESTED |
| **Screenshot/video** | |
| **Log excerpt/tag** | `[BrowserMedia]` |
| **Notes** | |

---

### TEST-29 — Facebook Public Video

| Field | Value |
|-------|-------|
| **Category** | Media Detection |
| **URL/site used** | Public Facebook video (if in supported scope) |
| **Expected** | Same architecture if supported |
| **Actual** | |
| **Status** | NOT TESTED |
| **Screenshot/video** | |
| **Log excerpt/tag** | |
| **Notes** | Mark WEBSITE_LIMITATION if unsupported, not APP BUG |

---

### TEST-30 — Login-Bound Media

| Field | Value |
|-------|-------|
| **Category** | Session / Download Handoff |
| **URL/site used** | Legitimate session-bound accessible media |
| **Expected** | Ephemeral host-scoped request context; no credentials persisted; no cookie values in logs |
| **Actual** | |
| **Status** | NOT TESTED |
| **Screenshot/video** | |
| **Log excerpt/tag** | `cookieContextAvailable=true` (never cookie values) |
| **Notes** | |

---

## P0 / P1 tracking

| ID | Test | Severity | Subsystem | Status | Notes |
|----|------|----------|-----------|--------|-------|
| | | P0/P1 | | | |

---

## Sign-off

| Role | Name | Date | Result |
|------|------|------|--------|
| QA / Release | | | |
| Engineering | | | |

**Release acceptance cannot be signed until critical P0 cases above are PASS on real device.**
