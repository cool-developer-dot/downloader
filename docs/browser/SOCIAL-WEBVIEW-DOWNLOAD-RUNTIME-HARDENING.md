# Social WebView Download Runtime Hardening

## 1. Exact snssdk warning root cause

`onShouldStartLoadWithRequest` received `snssdk1340://aweme/detail/...`. The URL was NOT in `BROWSER_BLOCKED_SCHEMES` (only dangerous schemes like javascript:/data:/intent:). It was also NOT in `BROWSER_EXTERNAL_SCHEMES` (only mailto:/tel:/sms:). So `shouldHandleInBrowser(url)` returned false, `classify(url)` returned `{ kind: 'invalid' }`, and since `invalid !== 'blocked'` the code called `navigationService.openExternal(url)` → `Linking.canOpenURL("snssdk1340://...")` → RN warning.

## 2. All WebView navigation surfaces

- `onShouldStartLoadWithRequest` — main-frame + sub-frame navigation policy
- `onOpenWindow` / `handleOpenWindow` — popup / `target=_blank` / `window.open`
- `openIntentOrExternal` — intent:// + external scheme dispatch
- `navigationService.openExternal` — mailto/tel and other OS-handled schemes

All four surfaces now guard `isSocialNativeAppScheme` before any Linking call.

## 3. Centralized navigation classifier

`isSocialNativeAppScheme(url)` in `browser/utils/url.ts` checks against `BROWSER_SOCIAL_NATIVE_APP_SCHEMES`. Used by all navigation entry points.

## 4. TikTok scheme policy

`snssdk1233://`, `snssdk1340://`, `musically://`, `tiktok://` → silently blocked. Return false immediately. No Linking call, no navigation epoch, no loading state, no CTA clear.

## 5. Instagram native-awaken policy

`instagram://`, `fb://`, `fbapi://`, `fb-messenger://` → same silent block.

## 6. Popup / window.open behavior

`resolvePopupNavigation` returns `{ action: 'ignore', reason: 'social_native_app_scheme' }` for all social native schemes. Never reaches `openIntentOrExternal`.

## 7. Why native-awaken is not navigation

Social native-app awakening is a website's attempt to launch the native app. It is NOT a legitimate page navigation. Blocking it:
- Does not change the current page URL
- Does not increment navigation epoch
- Does not set loading state
- Does not clear media context or CTA
- Does not produce user-visible error

## 8. CTA pipeline pre-AVAILABLE

active video observation → social/general context → content identity → candidate correlation → Phase 4B/5B verification → `handoffVerified` → AVAILABLE → floating CTA.

## 9. First-video detection

Injected script runs initial `scanDom()` + `scheduleActiveVideo()` + `readMeta()` on injection. `beforeContentLoaded` script captures early PerformanceObserver entries. Native `VidoraMediaNetworkObserver` captures all WebView requests with MIME hints.

## 10. Feed / recycled-player behavior

Same `<video>` element with changed `src` bumps content generation. IntersectionObserver + play/playing events establish active video ownership. Feed scroll with new strong owner invalidates prior CTA.

## 11. Sticky AVAILABLE behavior

`shouldRetainAvailableCta` keeps CTA while: next identity is null (transient), same as offer, or only WEAK ownership. `shouldInvalidateCurrentMedia` clears only on STRONG/MEDIUM different identity.

## 12. CTA presentation

Native React Native floating bar above WebView. Not DOM-injected. Active-tab only.

## 13. Quality / download handoff

Tap → atomic claim → quality sheet if multi-variant → enqueue → CONSUMED. Cancel restores AVAILABLE.

## 14. No-polling architecture

No setInterval for CTA visibility. Event-driven observers only. PerformanceObserver fallback interval exists only for browsers lacking the observer API.

## 15. Runtime acceptance plan

`mobile/docs/testing/SOCIAL-WEBVIEW-DOWNLOAD-RUNTIME-ACCEPTANCE.md` — all cases NOT_TESTED until real Android.

## 16. Website native-app promotion handling

CSS-only suppression via injected `<style>` element targeting `a[href^="snssdk1233:"]`, `a[href^="snssdk1340:"]`, etc. One-shot injection, no polling, no timer. Only hides anchor elements linking to native-app schemes — does NOT hide video controls, comments, captions, or share buttons.
