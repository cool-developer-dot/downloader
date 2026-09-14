# Phase 3G — Code Regression Gate

**Product:** VidoraX (Android)  
**Date:** 2026-09-07  
**Scope:** Static / TypeScript / npm verifiers / Expo export / Gradle builds only  
**Not in scope:** Real-device, Maestro, emulator, Python automation

---

## Architecture gate

| Invariant | Result |
|---|---|
| Exactly one `activeTabId` referencing an existing tab | PASS |
| `tabs.length` ∈ [1, 8] | PASS |
| `maxMountedWebViews` ≤ 2 | PASS |
| Active tab owns visible WebView + chrome + Desktop + error + CTA | PASS |
| Controller generation invalidated on unmount (`= 0`) | PASS (3G fix) |
| Tab persistence: safe metadata only (no cookies/CTA/media/errors) | PASS |
| Back / Forward / Home → active-tab navigation service | PASS |
| Hardware Back shares `goBackForTab` | PASS |
| Desktop per-tab; stock mobile UA omit; one reload owner | PASS |
| `intent://` never raw `Linking.openURL` | PASS |
| CTA verified-only; consume on Phase 1 enqueue | PASS |
| Atomic `claimForHandoff`; no CTA Phase 1 status polling | PASS |
| Parked WebView cannot overwrite session / feed media store | PASS (3G fix) |
| CTA diagnostics host-only (no path/query) | PASS (3G fix) |
| No backend / proxy / VPN / SSL bypass | PASS |
| Phase 1 scheduler/worker not rewritten | PASS |

---

## TypeScript

```
npx tsc --noEmit
```

**Result:** PASS (exit 0)

---

## Browser suite results (once each)

| Script | Result |
|---|---|
| `verify:browser-phase3-architecture-audit` | PASS |
| `verify:browser-tab-engine` | PASS |
| `verify:browser-tab-ui` | PASS |
| `verify:browser-desktop-site` | PASS |
| `verify:browser-navigation-responsive` | PASS |
| `verify:browser-navigation-runtime` | PASS |
| `verify:browser-runtime-audit` | PASS |
| `verify:browser-webview-compatibility` | PASS |
| `verify:browser-error-safety` | PASS |
| `verify:browser-media-cta-presentation` | PASS |
| `verify:browser-media-cta` | PASS |
| `verify:browser-cta-lifecycle` | PASS |
| `verify:browser-media-integration` | PASS |
| `verify:browser-tiktok-load` | PASS (verifier aligned to tab-scoped strings) |
| `verify:browser-intent-navigation` | PASS |
| `verify:phase3a-no-backend-runtime` | PASS |
| `verify:phase3` | PASS |

---

## Phase 1 suite results (once each)

| Script | Result |
|---|---|
| `verify:download-runtime-audit` | PASS |
| `verify:scheduler-network-policy` | PASS |
| `verify:download-state-machine` | PASS |
| `verify:transfer-reliability` | PASS |
| `verify:lifecycle-file-integrity` | PASS |
| `verify:media-pipeline` | PASS |
| `verify:phase1-local-core` | PASS |
| `verify:phase1a-local-catalog` | PASS |
| `verify:phase1b-local-analyze` | PASS |
| `verify:download-validation` | PASS |
| `verify:downloader-state-progress` | PASS |
| `verify:critical-download-flows` | PASS |
| `verify:local-performance-contracts` | PASS (comment + assertion aligned to execution mapping) |

---

## Expo export

```
npx expo export --platform android
```

**Result:** PASS — exported `dist/` (`entry-*.hbc` ~10MB)

---

## Build results

| Build | Result |
|---|---|
| `./gradlew assembleDebug` | BUILD SUCCESSFUL |
| `./gradlew assembleRelease` | BUILD SUCCESSFUL |

---

## APK artifacts

| Variant | Absolute path | Size | Timestamp |
|---|---|---|---|
| Debug | `/Users/mac/Downloads/Vidora/mobile/android/app/build/outputs/apk/debug/app-debug.apk` | 256M (268497550 bytes) | 2026-09-07 22:50:56 +0500 |
| Release | `/Users/mac/Downloads/Vidora/mobile/android/app/build/outputs/apk/release/app-release.apk` | 133M (139260515 bytes) | 2026-09-07 22:48:06 +0500 |

---

## Code fixes during 3G

1. **Controller generation:** unregister sets generation to `0` (was `+= 1`, leaving `isLiveGeneration()` true).
2. **Parked WebView isolation:** gate `browserSyncService` session writes, `onError`, and `mediaDetectionEngine.observeUrl` to active tab ownership.
3. **CTA diagnostics:** log hostname only for `navigationEpoch` (no path/query).
4. **Verifier alignment:** TikTok load + local-performance-contracts string checks updated to match tab-scoped / execution-mapped implementation (behavior already correct).

---

## 18 manual cases — code readiness (not runtime PASS)

| # | Case | Classification |
|---|---|---|
| 1 | Browser starts with 1 tab | CODE_READY |
| 2 | New Tab → count 2 | CODE_READY |
| 3 | Create 3 tabs → switch | CODE_READY |
| 4 | Close middle tab | CODE_READY |
| 5 | Close active tab | CODE_READY |
| 6 | Desktop ON in A | CODE_READY |
| 7 | B remains Mobile | CODE_READY |
| 8 | Desktop OFF A | CODE_READY |
| 9 | Video A → CTA | CODE_READY |
| 10 | Tab B no media → no CTA | CODE_READY |
| 11 | Return A → correct CTA | CODE_READY |
| 12 | Tap Download → CTA disappears | CODE_READY |
| 13 | Same video rediscovered → hidden | CODE_READY |
| 14 | New video → CTA | CODE_READY |
| 15 | Downloads continues | CODE_READY |
| 16 | Back/Forward/Reload per tab | CODE_READY |
| 17 | Session/login survives | MANUAL_ONLY |
| 18 | Error page no stale CTA | CODE_READY |

---

## Final gate status

**PHASE_3G_CODE_GATE_PASSED_READY_FOR_REAL_APK_ACCEPTANCE**

Real-device acceptance: see `PHASE-3G-REAL-APK-ACCEPTANCE.md` (all cases default NOT_TESTED).
