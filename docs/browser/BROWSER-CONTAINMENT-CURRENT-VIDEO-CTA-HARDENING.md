# Browser containment + current-video CTA

## 1. Real Android failure

Website-originated custom schemes (`snssdk1340://`, Instagram `intent://` applink bounce) could leave VidoraX. The Download CTA waited for a verified offer (`idle`/`detecting` hid the control), and first-video ownership often did not re-render React.

## 2. Pre-fix navigation

`onShouldStartLoadWithRequest` classified after react-native-webview’s whitelist gate. `originWhitelist` was only `http://*`, `https://*`, `intent://*`, `intent:*`. Non-listed schemes never reached VidoraX.

## 3. Installed react-native-webview 13.16.1

`WebViewShared.tsx` `createOnShouldStartLoadWithRequest`:

- If URL origin **fails** `originWhitelist` → **`Linking.canOpenURL` immediately**, then warn `"Can't open url: …"`. `onShouldStartLoadWithRequest` is **not** called.
- If URL **passes** whitelist → VidoraX callback runs; `false` cancels load via `shouldStartLoadWithLockIdentifier`.
- `onOpenWindow` is a separate path (no Linking).

## 4. Why custom schemes reached Linking

`snssdk1340://aweme/detail/…` origin does not match `http(s)://*`. WebViewShared invoked Linking **before** VidoraX `return false`.

## 5. Final classifier

`classifyBrowserNavigation` in `browser-navigation-policy.ts` is the single policy.

`buildBrowserOriginWhitelist()` lists http(s) **and** classifier-owned custom schemes (social, intent, mailto/tel/sms, market, javascript/data/file, …) so they **reach** the callback and are then blocked or handled. **No `*`.**

## 6–10. Policies

- HTTP(S) → `INTERNAL_WEB`
- Unknown custom scheme → `BLOCK_UNKNOWN_SCHEME`
- TikTok/Instagram/Snapchat/FB/X/YouTube native schemes → `BLOCK_NATIVE_APP`
- `intent://` with safe HTTPS fallback → load inside VidoraX
- Social/external-app intent without web fallback → **block** (no `VidoraIntentLauncher`)
- Applink bounce: **contained**, not native launch
- `market://` → `BLOCK_MARKET`
- mailto/tel/sms → `SAFE_SYSTEM_ACTION` (VidoraX Linking only)

## 11. Blocked navigation side effects

Classifier `return false` only. No epoch, loading, CTA clear, or history.

## 12–16. Current video + CTA

- Owner subscribe on social/general stores (React re-renders on `active_video`)
- Observer install: `scanDom()` + **immediate** `flushActiveVideo()`
- Shell states wrap Phase 3: TRACKING / READY / HANDOFF / CONSUMED
- Strong owner → compact native pill **before** verification completes
- Tap joins verification; Phase 1 still requires a verified source
- Compact pill, zIndex 40, no A→B fade-out unmount of a second detector

## 17. Security

No DRM bypass, no Cookie/Authorization persistence, no backend, no FFmpeg.
