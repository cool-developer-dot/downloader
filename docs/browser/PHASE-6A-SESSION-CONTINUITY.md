# Phase 6A — Session Continuity, Cookies & Logged-In Browser State

**Status:** code/static complete — ready for manual Android device test  
**Owns:** normal WebView cookie/session continuity, same-site tab sharing, login redirects/popups/SPA, logout/account-switch page-media invalidation, privacy/diagnostics  
**Does not own:** authenticated media Cookie/Auth headers for downloads (Phase 6B), signed URL refresh (6C), custom login UI, credential stores

---

## 1. Architecture audit

### Existing pipeline (proven)

```
Website login UI (inside WebView)
  → site sets cookies / DOM storage
  → Android CookieManager (process-wide)
  → Tab A / Tab B WebViews share jar naturally
  → per-tab URL / epoch / pageGeneration / CTA / media remain isolated
```

| Area | Finding |
|---|---|
| Cookie jar | Shared `CookieManager.getInstance()` for all tab WebViews |
| App cookie DB | **None** for website sessions |
| Cookie clear on switch/nav/Home/background | **None** |
| `sharedCookiesEnabled` | Set `true`; **iOS/macOS prop — no-op on Android** |
| `thirdPartyCookiesEnabled` | `true` → `CookieManager.setAcceptThirdPartyCookies` |
| `domStorageEnabled` | `true` |
| `incognito` WebView prop | **Not passed** (store constant `false` only) |
| Popup / `window.open` | Same WebView `loadUrl` via `resolvePopupNavigation` |
| Intent / custom schemes | Existing safe Intent launcher — not generic Linking |
| Session MMKV | URL/title/scroll only — now strips OAuth/auth query secrets |
| SPA | `spa_navigation` → URL update → media `onNavigationStart` / `pageGeneration` bump |

### Proven gaps fixed in 6A

1. **Docs/config honesty** — Android cookie authority documented; `sharedCookiesEnabled` clarified as no-op on Android.  
2. **Incognito footgun** — Explicit config + comments: never pass WebView `incognito` (would wipe global jar).  
3. **Auth query persistence** — OAuth `code` / tokens stripped before MMKV session/tab URL persistence.  
4. **Diagnostics** — Broader blocked keys (`otp`, `idtoken`, …); `queryPresent` without dumping query values.

### Already correct (no change required)

- Same-site multi-tab cookie sharing via platform jar  
- No cookie clear on tab switch / close / Home / park / Desktop toggle  
- Login redirects stay in-WebView for http(s)  
- Parked tabs gated from media/CTA  
- Generation-scoped general/social media + CTA  
- Intent:// never raw `Linking.openURL`  

---

## 2. Current WebView cookie behavior

All browser WebViews apply:

- `javaScriptEnabled: true`
- `domStorageEnabled: true`
- `thirdPartyCookiesEnabled: true`
- `sharedCookiesEnabled: true` (Android no-op)
- `incognito`: never set on the component

Cookies are flushed by RN WebView’s normal page-finish path into `CookieManager`. VidoraX does not mirror them into Zustand/MMKV/SQLite.

---

## 3. Android-specific cookie semantics

| Topic | Behavior |
|---|---|
| Scope | Process-wide `CookieManager` |
| Tab isolation of cookies | **No** — normal browser SameSite/domain rules only |
| Evicted WebView remount | Native history lost; **cookies retained** in jar |
| Persistent vs session cookies | Follow website `Max-Age` / `Expires` / session attributes |
| App restart | Persistent cookies may survive; session cookies follow platform/site |

---

## 4. Native CookieManager changes

**None required for continuity.** Existing `VidoraCookieBridge` remains a **read-only** download handoff (Phase 1/5). Phase 6A does not expand authenticated downloader attachment.

---

## 5. Third-party cookie policy

**Setting:** `thirdPartyCookiesEnabled: true` (`accept_for_webview`)

**Why:** Legitimate SSO / auth embeds and some CDN login helpers still rely on third-party cookies inside Android WebView.

**Privacy:** Increases cross-site cookie acceptance vs a hard deny. Not an auth bypass — domain/SameSite still apply. Do not flip globally without a dedicated privacy phase that accepts login breakage.

---

## 6. DOM / website storage policy

`domStorageEnabled: true`. Websites may use localStorage / sessionStorage / IndexedDB as the WebView allows.

VidoraX must not inspect, copy, or dump these for credentials.

---

## 7. Session-sharing model

```
CookieManager
   ├─ Tab A WebView
   └─ Tab B WebView
```

Same-site login in A is visible to B when the site’s cookie attributes allow it. VidoraX never copies cookies between tabs.

---

## 8. Per-tab state model

| Shared (platform) | Per-tab (app) |
|---|---|
| Website cookies | URL, title, history flags |
| WebView DOM storage (origin) | navigationEpoch, loading, error |
| | pageGeneration / social contextGeneration |
| | media offer, CTA, quality sheet, consumption |
| | Desktop Site preference |

---

## 9. Redirects

http(s) login/auth/callback chains remain `onShouldStartLoadWithRequest` allow → WebView navigation. WebView owns history; chrome does not invent duplicate entries.

---

## 10. Popup / new-window login

`setSupportMultipleWindows` + `onOpenWindow` → `resolvePopupNavigation`:

- http(s) → `load_in_browser` (same tab)  
- intent → external Intent owner  
- blocked schemes → ignore  

No AuthWebView. No secret extraction from callbacks.

---

## 11. SPA login

Chrome inject posts `spa_navigation`. Active tab URL updates → media sync → `pageGeneration` bump on path change → stale pre-login CTA/media rejected.

---

## 12. Logout

Website clears its session. VidoraX invalidates page/media via navigation/generation. Does not restore stale cookies from app storage (none stored).

---

## 13. Account switching

Logout → login B: new navigations bump generations; A’s media/CTA cannot apply.

---

## 14. App restart semantics

MMKV restores last http(s) URL metadata (auth query stripped). Login continuity depends on WebView/site cookie attributes — not guaranteed permanent login.

---

## 15–16. Privacy & diagnostics redaction

Never log Cookie / Set-Cookie / Authorization / password / OTP / tokens / signed query values.  
`sanitizeBrowserUrl` → scheme, host, truncated path, `queryPresent`.

---

## 17. Loading lifecycle

Spinner tracks top-level document loads only. Redirect chains clear on load end / progress complete. Media/XHR must not own the spinner.

---

## 18. Intent / custom-scheme safety

Unchanged: whitelist + `VidoraIntentLauncher` / `handleIntentNavigation`. No generic auth `Linking.openURL`.

---

## 19–20. Performance / memory

No cookie/auth polling, no hidden auth WebViews, no unbounded session maps. Tabs capped at 8; mounted WebViews at 2.

---

## 21. No-backend / no-session-DB proof

Phase 6A adds no server, Firebase, Supabase, SQLite session table, or MMKV cookie jar. Policy export: `phase6aSessionContinuityPolicy`.

---

## 22. Known limitations

| Limitation | Classification |
|---|---|
| Identity providers that reject embedded WebViews | `SITE_OR_IDENTITY_PROVIDER_EMBEDDED_WEBVIEW_RESTRICTION` — not bypassed |
| Mount eviction loses Back stack (cookies kept) | Existing Phase 3 mount pool |
| `sharedCookiesEnabled` naming can mislead | Documented Android no-op |
| Telegram / WhatsApp / Snapchat Web | Best-effort only; not Phase 6A success criteria |
| Authenticated downloads | **Phase 6B** |

---

## 23. Manual acceptance plan

See `mobile/docs/testing/PHASE-6A-SESSION-CONTINUITY-REAL-ANDROID-ACCEPTANCE.md` — all runtime cases `NOT_TESTED` until human verification.

---

## 24. Phase 6B handoff boundary

6B may assume:

1. User can log in via website UI where provider allows embedded WebView.  
2. Android CookieManager continuity works.  
3. Same-site tabs share platform session per cookie rules.  
4. Page/media/CTA stay per-tab.  
5. Secrets are not in app state/logs.

6B must separately answer:  
**“Can a verified media request use the minimum legitimate session context safely?”**

Do not solve authenticated Cookie/Auth download construction in 6A.
