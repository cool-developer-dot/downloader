# Final social containment + CTA consumption hardening

## 1. Remaining TikTok native escape

After the previous classifier + originWhitelist pass, TikTok still occasionally launched the native app on real Android. That was not a missing `return false` inside `onShouldStartLoadWithRequest` for `snssdk1233` / `snssdk1340`. Those paths were already classified.

## 2. Exact proven root cause

**Label: `WEBVIEW_WHITELIST_BYPASS` (plus native timeout allow for unhandled schemes).**

Installed `react-native-webview` 13.16.1 `WebViewShared.tsx`:

- If the URL origin **fails** `originWhitelist`, WebViewShared calls `Linking.canOpenURL` / `Linking.openURL` **before** VidoraX’s callback.
- TikTok emits **many** numeric `snssdk{id}:` schemes (not only 1233 and 1340). An unlisted id never reached the classifier.
- Separately, Android `RNCWebViewClient.shouldOverrideUrlLoading` waits 250ms for JS. On timeout it **default-allowed** the load (`return false`). For a custom scheme that lets the system WebView / Android resolve the native app during a busy feed scroll.

## 3. Entry point that bypassed previous containment

1. Website / iframe / JS location → `snssdk1180://…` (or similar).
2. Origin not in `http(s)` / `snssdk1233` / `snssdk1340` whitelist.
3. `WebViewShared` → `Linking.canOpenURL` → installed TikTok → `openURL`.
4. Or JS lock timeout → native allow → unhandled scheme.

## 4. Final containment rule

Website-originated TikTok navigation:

- `http` / `https` → stay inside VidoraX.
- `snssdk*`, `tiktok:`, `musically:`, `aweme:`, `sslocal:`, `bytedance:`, `android-app:` → `BLOCK_NATIVE_APP`.
- TikTok package intents without a safe TikTok HTTPS fallback → block (no `VidoraIntentLauncher`).
- Play Store / `market:` fallbacks → `BLOCK_MARKET`.
- Unknown custom schemes remain default-deny.

## 5. WebView whitelist interaction

`originWhitelist` now includes `snssdk*://*` / `snssdk*:*` (glob, not a bare `*`) plus explicit social schemes so they **reach** `onShouldStartLoadWithRequest`, which returns **false**. That prevents RN Linking.

## 6. Intent handling

`classifyIntent` + `handleIntentNavigation`: social `EXTERNAL_APP` contained. HTTPS fallback loads inside VidoraX. Play Store web fallback is **not** loaded and **not** launched.

## 7. App-link handling

Instagram/TikTok `intent://` with `scheme=https` still reconstructs HTTPS. Applink bounce stays in-page (`intent_applink_contained`). Ordinary `https://www.tiktok.com/…` is never sent to `Linking.openURL` by the WebView path.

## 8. Popup / new-window

`resolvePopupNavigation` uses the same classifier. Native schemes → ignore. HTTPS → current-tab load.

## 9. Zero-side-effect blocked navigation

Blocked awaken: `return false` + nav log only. No epoch / media generation / CTA / loading / Linking.

## 10. CTA consumption root cause

Two cooperating bugs:

1. `commitConsumed` used `clearOfferFields()`, which **nulled `contentIdentity`**. `resolveCtaShellPresentation` then saw `CONSUMED` + strong live owner + **no** identity and fell through to **`TRACKING_CURRENT_VIDEO`** (button stayed up).
2. Same-content re-verify called `setStatus('idle')` when the identity was already consumed, which made presentation treat the owner as a fresh video.

## 11. Authoritative content identity

Consumption keys remain `content:${tabId}:${contentIdentity}` plus media fingerprint. Not signed CDN URLs.

## 12. Exact consumption point

`commitConsumed` after Phase 1 enqueue acceptance (`enqueueBrowserMediaDownload` ok). Not tap, not quality-sheet open.

## 13. Successful enqueue

Status `consumed`, identity retained, CTA shell `CONSUMED_CURRENT_CONTENT`, `showCard` false.

## 14. Failed handoff rollback

`releaseHandoff` restores `verified` / AVAILABLE. Quality cancel `endQualitySelection`. No consume.

## 15. Same-content refresh

`retainConsumedPresentation` + `liveIdentityConsumed` outrank owner visibility. CDN / re-verify cannot resurrect A.

## 16. New-content behavior

Strong owner B with a different identity → `TRACKING_CURRENT_VIDEO` even if A is consumed on the tab.

## 17. Wrong-video protection

Existing `shouldAcceptVerificationResult` / handoff generation guards unchanged.

## 18. Tab isolation

Consumed sets are per-tab slices. Active tab only renders the overlay CTA.

## 19. General-site behavior

Same CTA service + `liveIdentityConsumed` for Phase 5 identities.

## 20. Runtime acceptance

See `mobile/docs/testing/FINAL-SOCIAL-CONTAINMENT-CTA-CONSUMPTION-REAL-ANDROID-ACCEPTANCE.md`. All items `NOT_TESTED` until a device pass.
