# VidoraX Performance Hardening Architecture

Android-only. React Native + Expo SDK 57. This pass finds wasted work, leaks, event storms, excessive renders, blocking persistence, stale locks, and invisible touch overlays. It does **not** remove product capability.

Tab caps are unchanged:

- `MAX_OPEN_TABS = 8`
- `MAX_MOUNTED_WEBVIEWS = 2`

## 1. Measured bottlenecks (static architecture)

Runtime FPS/RAM was not claimed from this pass. The bottlenecks below are proven from the running architecture:

1. **Android transparent Modal leftover windows** after overflow / quality / tab-switcher / Video available / confirm sheets.
2. **Full-screen elevated CTA wrapper** (`StyleSheet.absoluteFill` + `elevation: 12`) covering the WebView while “Video available” was showing.
3. **Download progress → `patchItem(workerState)` → SQLite upsert** on every UI tick even when worker state did not change.
4. **Downloads list host subscribed to the entire `itemsById` map**, so every catalog clone re-rendered the screen.
5. **Social/general owner listeners notified on every active-video evidence write**, including paused/intersection noise.
6. **WebView message** storms: `postMessage` budget reset on SPA `pushState` with no per-second cap (up to 400 posts/document, then another 400).
7. **DEV `GENERAL_NETWORK_TRACE` / `media_element_*` console volume** starving the JS thread under Metro on a real device.
8. **List thumbnail `memory-disk` caches** retaining decoded bitmaps for off-screen rows on ~4 GB devices.

## 2. Root causes

| Symptom | Cause class | Code path |
|---|---|---|
| Buttons dead after using menus/sheets | **C** invisible overlay + **D** zIndex/elevation | Root `QualitySelectionSheet` Modal always mounted; overflow/tab/action Modals `visible={false}` still native-Dialog on Android |
| Buttons dead after Video available | **C/D** | `BrowserMediaDownloadBar` full-screen elevated layer intercepting WebView/chrome taps |
| Progressive lag while downloading | **A/I/N** | `bindDownloadEngineToStore` progress → `patchItem` + `persistDownloadCatalogItem` + `useDownloads(itemsById)` |
| Lag on media-heavy pages | **A/F/H** | injected posts + `notifyOwnerListeners()` + DEV traces |
| Feels dead without a crash | **A+K** | JS event-loop flood + GC from catalog clones + image memory |

## 3. Render optimizations

- Downloads list host no longer subscribes to `itemsById`. Rows still subscribe per id (`itemsById[id]`, `transferById[id]`).
- `patchItem` returns previous state when catalog fields are unchanged.
- Social/general CTA subscribers update only on ownership-relevant evidence.
- JS engine skips identical `active_video` keys before ownership work.

Memoization was **not** sprayed across the tree.

## 4. Store subscription improvements

- `useDownloads` reads `itemsById` from `getState()` (snapshot on host render).
- Library remains gated on `selectDownloadCatalogIdentitySignature` + `selectLibraryTransferSignature`.
- Home activity signature still buckets progress at 5%.
- Browser screen still does not subscribe to the download store.

## 5. WebView event controls

Injected observer still:

- single-instance `__VIDORAX_MEDIA_DETECTION__`
- candidate `seen` map
- `active_video` last-key dedupe
- `MAX_POSTS = 400`

Added a **per-second post window** (`MAX_POSTS_PER_WINDOW`) so SPA `postCount = 0` resets cannot flood the bridge.

## 6. Media event controls

- JS `lastActiveVideoKey` skip
- native URL time-dedupe (`nativeEventDedupeMs`) + bounded `lastKeys` map (300)
- owner-listener notify only when identity/generation/src/paused/recentlyPlayed/ownerStrength change
- `mutation_batch` still skipped while `appActive === false`

Automatic detection, social correlation, and general media ownership remain enabled.

## 7. Progress event controls

Authoritative bytes stay on `transferById`. Catalog `progress` is still not written every tick.

Presentation:

- engine `uiProgressIntervalMs: 250`
- workerState catalog patch only when the mapped worker **changes**
- transfer snapshot equality includes `executionState`
- FGS notification summaries remain throttled

Pause/resume/Range/HLS/`.part`/retry are unchanged.

## 8. Timer / listener cleanup

Audited AppState, BackHandler, native emitter, and injected `pagehide` cleanup. Host still `start()` on mount and `stop()` on unmount. Native observation `stop` removes subscriptions before a later `start`.

## 9. Memory-retention fixes

- Closed tabs already dropped CTA/social/general/verification state; they now also call `mediaDetectionEngine.clearTab`.
- Mount pool still evicts closed ids and keeps at most 2 WebViews.
- Social/general tab maps remain capped at 8.
- List thumbs use `cachePolicy="disk"` + `recyclingKey` (decoded quality unchanged; in-memory decoded cache reduced).
- Splash/logo artwork still `memory-disk`.

## 10. List optimization

Downloads `FlatList`/`SectionList` and Library `FlatList` stay virtualized with stable keys. Render windows tightened (`windowSize={5}`) without changing visible data.

## 11. Touch-interception fixes

Dismissed sheets **unmount** the RN `Modal` (`if (!visible) return null`) for:

- overflow menu
- tab switcher
- quality sheet (tab-root provider — the worst offender)
- action sheet (Video available / settings)
- AppModal / confirm
- resume playback sheet

Suggestion overlay already unmounted.

Video available / discovery cards are **bottom-anchored** with `pointerEvents="box-none"` and no full-screen Android elevation layer.

## 12. Lock / busy-state fixes

- Pause/resume/cancel/retry already used `try/finally` for `mutatingIds`.
- `remove` now uses `finally` so a thrown path cannot leave mutating stuck.
- Quality `creatingRef` and CTA `verifyingRef` remain cleared in `finally`.
- App Lock still disables children only while `status === 'LOCKED'`.
- No app-wide busy overlay was introduced.

## 13. Persistence optimization

Downloads Zustand store is **not** persisted. Live bytes never go through MMKV JSON persist.

SQLite catalog upserts run only when durable catalog fields actually change (`isSameDownloadCatalogItem` bailout). Crash/restart recovery for status/worker/file metadata is preserved.

## 14. Low-RAM strategy

On ~4 GB Android:

- at most 2 mounted WebViews
- closed tab heavy state is released
- off-screen list rows are clipped
- thumbnail decoded-memory cache is disk-backed
- JS work from progress/media/WebView is coalesced before React

The OS is not fought with permanent WebView retention.

## 15. Feature-isolation guarantees

Not removed or weakened:

- automatic media detection / Video available
- 8 tabs / 2 mounted WebViews
- 3×3 Quick Access
- overflow History / Bookmarks / Continue Watching / Recently Watched / Storage
- App Lock
- LIGHT / LOGO / DARK (`#DC3C2C` unchanged)
- player
- pause/resume, Range, HLS, `.part`, retry, background downloads

## 16. Android runtime test plan

See `docs/testing/PERFORMANCE-LOW-RAM-ANDROID-ACCEPTANCE.md`. All runtime cases start **NOT_TESTED**. Static verifier: `npm run verify:performance-hardening`.
