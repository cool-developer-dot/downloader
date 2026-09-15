# Dynamic video format handoff — verification report

Date: 2026-09-15

Status: **DYNAMIC_VIDEO_FORMAT_HANDOFF_READY_FOR_MANUAL_TEST**

Continued the existing working tree. The initial audit found 98 tracked changed
paths and six untracked files, with nothing staged. Existing implementation,
navigation, Downloads, Library and theme work was preserved. The five deleted
`src/store/player/*` files were unused legacy state; the current player uses
`src/player` and `src/playback`. Their deletion is intentional and retained.

## Final results

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | PASS, exit 0, no diagnostics |
| `npm run verify:dynamic-video-format-handoff` | PASS, 142 passed, 0 failed |
| Existing relevant regression suites | PASS, all 51 script invocations listed below |
| `git diff --check` | PASS |
| Real Android acceptance | NOT_TESTED |
| APK | APK_NOT_BUILT_BY_REQUEST |
| Expo prebuild | EXPO_PREBUILD_NOT_RUN |
| AAB / commit / push | Not performed |

The focused script invokes production pure functions and isolated production
handoff/finalization modules with mocked native/network boundaries. It also checks
source wiring. Synthetic byte fixtures are structural evidence, not playable
media fixtures or proof of Android decoder support. No native compilation,
physical WebView execution, filesystem execution on Android, or device benchmark
was performed.

## Remaining work completed

The observation, normalization, ownership, format support, verification, completion
and UI integration phases already existed. This continuation completed exact
selected-variant handoff/deduplication, safe same-resource refresh, native wrapper
tag binding, the missing final-file validation import, and an external Open action
on local decoder failure. It tightened signature/identity edge cases and completed
the focused verifier, architecture document and Android acceptance matrix.

The pre-existing compact browser CTA remains: one verified source downloads on
tap; multiple verified sources open the existing quality sheet. Playback remains
available in the page, and completed local files retain Play/Open/Share/export.

## Focused failure resolved

The remaining focused failure was `__DEV__ is not defined` when the late-native-move
fixture reached the real logging code. The Node harness now supplies React Native's
`__DEV__` global. The move/error assertions remain: persisted identity must point
to the verified physical file even when a native move changes its URI before
throwing. Final result: 142 passed, zero failed.

## Regression failures and corrections

The first complete run finished 45/51 suites successfully. All six failures were
investigated; the affected suites were rerun to completion after these changes.

| Failure | Correction and retained contract |
| --- | --- |
| Phase 5A and Phase 4B credential rotation | Shared identity now recognizes `tok`, `oe`, and `oh` as rotating credential fields. Case-sensitive paths and unknown content/quality selectors remain distinct. |
| Phase 5B complete fMP4 fixture | Added the missing `moov` initialization box to the fixture claiming to be standalone. Fragment-only resources remain rejected. |
| Tier 1 partial MP4 and identity assertions | A bounded prefix with unknown remaining structure stays unresolved. Added a separate complete init-only rejection assertion. Kept `_nc_ht` routing selector while ignoring credential rotation. |
| Local-only aggregate navigation/localization assertions | Updated obsolete Home-first expectations to the already-established Browser-first routes. Allowed only the two existing website/download-source session-expiry strings; the app-account/auth restrictions remain. |
| Week 8.5 Phase 1A fixture and navigation assertions | Supplied the store's existing `transferById` field; checked the existing Storage screen route and player helper. Progress tests now prove sub-bucket stability and updates across the existing 5% threshold. |

The shared identity change was followed by reruns of dynamic-general-media-engine,
automatic-media-handoff, universal-video-detection and the focused verifier. The
local-only aggregate also executes its existing nested migration, resume, linking,
settings, localization and UI regression checks. Counts below are per script;
they must not be added as unique assertions because aggregate checks overlap.

## Evidence and reproduction

Run each table entry with `npm run <script>`. The exact sequential runner and
per-script stdout/stderr logs are retained in `/tmp/vidorax-dynamic-handoff`.
`final-results.json` merges the initial run and successful reruns without losing
previously completed suites. `initial-regressions.json`, `rerun-1.json` and
`rerun-2.json` preserve prior exit codes; `typescript.log` records the final
standalone compiler result. `dynamic-video-format-handoff.log` is the successful
focused run; the older `focused.log` records an unsuccessful npm network attempt.

The historical network failure was dependency-runner access, not a verifier
assertion. Successful scripts ran through the authorized existing npm runner.

## Runtime limits

All device cases remain **NOT_TESTED** in the
[Android acceptance matrix](DYNAMIC-VIDEO-FORMAT-HANDOFF-REAL-ANDROID-ACCEPTANCE.md).
Required checks include physical WebView tag/epoch ordering, iframe/referrer and
service-worker attribution, real dynamic sites, session refresh, double taps,
pause/resume, final-file rename/persistence, Library playback while offline,
external actions, notifications, App Lock, and 4 GB device responsiveness.

Byte probes are bounded; a large MP4 with required structure beyond the probe
window may remain unresolved. Structural recognition does not prove complete
demuxability or codec support. Opaque/blob-only media and ambiguous worker events
cannot be reliably attributed. Protected media, encrypted HLS and mux-required
DASH remain excluded. Existing standalone muxed DASH BaseURLs are retained only
when they pass the ordinary progressive-file checks. No YouTube-specific
extraction or deciphering path is provided.

See the [architecture and phase audit](../architecture/DYNAMIC-VIDEO-FORMAT-HANDOFF.md)
for the pipeline, format support, ownership, verification, handoff and completion
contracts.

## Executed regression inventory

| Script | Final result |
| --- | --- |
| `verify:dynamic-general-media-engine` | 143 passed, 0 failed |
| `verify:automatic-media-handoff` | Automatic media handoff: 159 passed, 0 failed |
| `verify:universal-video-detection` | 15 passed |
| `verify:video-detection` | Video detection verification: 44 passed, 0 failed |
| `verify:media-pipeline` | Media pipeline fixtures: 31 passed, 0 failed |
| `verify:phase5a-general-media-discovery` | Phase 5A results: 23 passed, 0 failed |
| `verify:phase5b-general-source-reliability` | Phase 5B results: 36 passed, 0 failed |
| `verify:phase5c-general-download-integration` | Phase 5C results: 33 passed, 0 failed |
| `verify:phase5-hls-handoff` | Phase 5 HLS handoff: 14 passed, 0 failed |
| `verify:embedded-native-media-observation` | 92 passed, 0 failed |
| `verify:general-embedded-current-video-cta` | 92 passed, 0 failed |
| `verify:general-embedded-media-execution` | Results: 105 passed, 0 failed |
| `verify:phase4b-social-source-reliability` | Phase 4B result: 34 passed, 0 failed |
| `verify:phase4c-social-download-integration` | Phase 4C results: 19 passed, 0 failed |
| `verify:phase4-tier1-social-hardening` | Hardening results: 21 passed, 0 failed |
| `verify:browser-media-cta` | Browser media CTA: 26 passed, 0 failed |
| `verify:browser-media-cta-presentation` | Browser media CTA presentation: 76 passed, 0 failed |
| `verify:browser-media-integration` | 33 passed, 0 failed |
| `verify:browser-cta-lifecycle` | Browser CTA lifecycle: 49 passed, 0 failed |
| `verify:download-cta-persistence-hardening` | 20 passed, 0 failed |
| `verify:browser-tab-engine` | Result: 14 passed, 0 failed |
| `verify:browser-desktop-site-runtime` | Desktop runtime: 12 passed, 0 failed |
| `verify:browser-webview-compatibility` | Results: 19 passed, 0 failed |
| `verify:download-validation` | Download validation: 14 passed, 0 failed |
| `verify:download-state-machine` | 28 passed, 0 failed |
| `verify:transfer-reliability` | 25 passed, 0 failed |
| `verify:lifecycle-file-integrity` | Phase 1E lifecycle/file-integrity: 69 passed, 0 failed |
| `verify:critical-download-flows` | 11 passed, 0 failed |
| `verify:pause-resume-runtime-hardening` | 46 passed, 0 failed |
| `verify:pause-ack-state-commit` | 76 passed, 0 failed |
| `verify:resume-durable-state` | 65 passed, 0 failed |
| `verify:downloadability-pause-resume-final-hardening` | 169 passed, 0 failed |
| `verify:phase7a-completed-file-identity` | Phase 7A completed-file identity: 61 passed, 0 failed |
| `verify:phase7b-android-file-actions` | Phase 7B android file actions: 59 passed, 0 failed |
| `verify:phase7c-export-delete-reliability` | Phase 7C export/delete reliability: 85 passed, 0 failed |
| `verify:external-file-open` | External file open: 75 passed, 0 failed |
| `verify:share-completed-media` | Share completed media: 70 passed, 0 failed |
| `verify:android-download-notifications` | Android download notifications: 45 passed, 0 failed |
| `verify:library-completion-sync` | 10 passed, 0 failed |
| `verify:local-only-final` | Local-Only Migration Final — 22 passed, 0 failed. |
| `verify:player-first-frame-stability` | Player first-frame stability: 67 passed, 0 failed |
| `verify:player-level-controls` | Player adjustment HUD: 23 passed, 0 failed |
| `verify:player-chrome-features` | Player chrome features: 32 passed, 0 failed |
| `verify:playback-sync-final` | 6 passed, 0 failed |
| `verify:media-module-cycle-hardening` | Media module cycle hardening: 16 passed, 0 failed |
| `verify:performance-hardening` | 182 passed, 0 failed |
| `verify:app-lock-phase1` | App Lock Phase 1: 110 passed, 0 failed |
| `verify:app-lock-phase2` | App Lock Phase 2: 140 passed, 0 failed |
| `verify:theme-system` | Theme system verifier: 458 passed, 0 failed |
| `verify:secondary-content-relocation` | Result: 113 passed, 0 failed |
| `verify:week8.5-phase1a` | Week 8.5 Phase 1A: 13 passed, 0 failed |
| `verify:dynamic-video-format-handoff` | 142 passed, 0 failed |

## Working-tree file inventory

This inventory covers the complete preserved working tree, including changes
already present at continuation. It does not attribute every file to this turn.

### Files created during continuation

- `docs/testing/DYNAMIC-VIDEO-FORMAT-HANDOFF-REAL-ANDROID-ACCEPTANCE.md`
- `docs/testing/DYNAMIC-VIDEO-FORMAT-HANDOFF-VERIFICATION.md`
- `scripts/verify-dynamic-video-format-handoff.ts`

### Existing untracked files retained

- `docs/architecture/DYNAMIC-VIDEO-FORMAT-HANDOFF.md`
- `scripts/verify-universal-video-detection.ts`
- `src/media-detection/adapters/native-observation-scope.ts`
- `src/media-detection/general-media/playback-media-evidence.ts`
- `src/media-detection/resource/video-resource.ts`
- `src/navigation/helpers/open-player.ts`

### Modified tracked files (105)

- `android/app/src/main/java/com/anonymous/vidorax/mediadetection/MediaNetworkBridge.kt`
- `package.json`
- `scripts/verify-automatic-media-handoff.ts`
- `scripts/verify-external-file-open.ts`
- `scripts/verify-local-only-final.ts`
- `scripts/verify-performance-hardening.ts`
- `scripts/verify-phase2-local-identity.ts`
- `scripts/verify-phase4-tier1-social-hardening.ts`
- `scripts/verify-phase5b-general-source-reliability.ts`
- `scripts/verify-secondary-content-relocation.ts`
- `scripts/verify-theme-system.ts`
- `scripts/verify-week8-5-phase2.ts`
- `scripts/verify-week8.5-phase1a.ts`
- `src/api/types.ts`
- `src/app/_layout.tsx`
- `src/browser/components/BrowserContainer/BrowserWebView.tsx`
- `src/browser/components/BrowserOverflowMenu/BrowserOverflowControls.tsx`
- `src/browser/media-actions/BrowserMediaDownloadBar.tsx`
- `src/browser/media-actions/browser-media-download.service.ts`
- `src/browser/media-actions/media-fingerprint.ts`
- `src/browser/media-actions/useBrowserMediaAction.ts`
- `src/browser/media-actions/verified-quality-options.ts`
- `src/downloads/analyze/format.ts`
- `src/downloads/completed-file/action-service.ts`
- `src/downloads/completed-file/apply-identity.ts`
- `src/downloads/completed-file/extension.ts`
- `src/downloads/completed-file/types.ts`
- `src/downloads/engine/errors.ts`
- `src/downloads/engine/finalize-download.ts`
- `src/downloads/engine/hls/worker.ts`
- `src/downloads/engine/media-signature.ts`
- `src/downloads/engine/media-validation.ts`
- `src/downloads/engine/mp4-box-classify.ts`
- `src/downloads/engine/multi-range/part-worker.ts`
- `src/downloads/engine/pause-state.ts`
- `src/downloads/engine/range-validation.ts`
- `src/downloads/engine/types.ts`
- `src/downloads/engine/worker.ts`
- `src/downloads/runtime-actions.ts`
- `src/library/eligibility.ts`
- `src/library/index.ts`
- `src/library/repository.ts`
- `src/localization/en.ts`
- `src/localization/ur.ts`
- `src/media-detection/adapters/native-network.contract.ts`
- `src/media-detection/adapters/webview-bridge.adapter.ts`
- `src/media-detection/engine/media-detection.engine.ts`
- `src/media-detection/extractors/dom.extractor.ts`
- `src/media-detection/extractors/metadata.extractor.ts`
- `src/media-detection/general-media/general-content-identity.ts`
- `src/media-detection/general-media/general-content-navigation.ts`
- `src/media-detection/general-media/general-correlation.service.ts`
- `src/media-detection/general-media/general-network-resource.ts`
- `src/media-detection/general-media/general-page-context.ts`
- `src/media-detection/general-media/index.ts`
- `src/media-detection/general-source/general-source-reliability.service.ts`
- `src/media-detection/hooks/useMediaDiscovery.ts`
- `src/media-detection/observers/injected-script.ts`
- `src/media-detection/parsers/dash.parser.ts`
- `src/media-detection/parsers/extension.parser.ts`
- `src/media-detection/parsers/hls.parser.ts`
- `src/media-detection/parsers/index.ts`
- `src/media-detection/parsers/progressive.parser.ts`
- `src/media-detection/platform/generic.adapter.ts`
- `src/media-detection/platform/instagram.adapter.ts`
- `src/media-detection/services/candidate-verifier.service.ts`
- `src/media-detection/services/deduplication.service.ts`
- `src/media-detection/services/false-positive.filter.ts`
- `src/media-detection/services/manifest.service.ts`
- `src/media-detection/services/mime-probe.service.ts`
- `src/media-detection/social-source/resource-identity.ts`
- `src/media-detection/social-source/social-source-reliability.service.ts`
- `src/media-detection/social-source/types.ts`
- `src/media-detection/social-source/variant-policy.ts`
- `src/media-detection/social-source/verification-session.ts`
- `src/media-detection/types/bridge.types.ts`
- `src/media-detection/types/media.types.ts`
- `src/media-detection/ui/badges.ts`
- `src/media-detection/utils/media-id.ts`
- `src/navigation/constants/index.ts`
- `src/navigation/constants/route-paths.ts`
- `src/navigation/helpers/index.ts`
- `src/providers/app-provider.tsx`
- `src/providers/status-bar.tsx`
- `src/screens/downloads/DownloadDetailsScreen.tsx`
- `src/screens/downloads/components/DownloadCard.tsx`
- `src/screens/downloads/components/QueueActiveRow.tsx`
- `src/screens/downloads/hooks/useDownloadDetailsScreen.ts`
- `src/screens/downloads/quality/useQualitySelection.ts`
- `src/screens/downloads/utils/download-format.ts`
- `src/screens/home/components/HomeContinueWatching.tsx`
- `src/screens/home/components/HomeRecentDownloads.tsx`
- `src/screens/home/components/HomeRecentlyWatched.tsx`
- `src/screens/library/LibraryScreen.tsx`
- `src/screens/library/components/ContinueWatchingSection.tsx`
- `src/screens/library/components/LibraryCard.tsx`
- `src/screens/library/components/LibraryGridTile.tsx`
- `src/screens/library/hooks/useLibraryScreen.ts`
- `src/screens/player/PlayerScreen.tsx`
- `src/screens/watch-history/WatchHistoryScreen.tsx`
- `src/storage/mmkv/theme.ts`
- `src/store/index.ts`
- `src/store/theme/state.ts`
- `src/theme/startup-theme.ts`
- `src/theme/theme-preference.ts`

### Intentional deletions retained

- `src/store/player/actions.ts`
- `src/store/player/index.ts`
- `src/store/player/selectors.ts`
- `src/store/player/state.ts`
- `src/store/player/types.ts`
