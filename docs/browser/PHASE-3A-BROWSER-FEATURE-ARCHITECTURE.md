# Phase 3A — Browser Feature Architecture Audit + Freeze

**Status:** FROZEN (audit only — no feature implementation)  
**Product:** VidoraX (Android only)  
**Date:** 2026-09-04  
**Scope:** Desktop Site · Browser Tabs · New Tab UX · Tab Count · Download CTA presentation · Download CTA lifecycle  

This document is the **source of truth** for Phases 3B–3G.  
Do not implement tabs, Desktop Site rewrites, or CTA redesigns until architecture review accepts this freeze.

---

## 0. Acceptance answers (must remain true)

| Question | Answer |
|---|---|
| Does a real browser tab model exist today? | **NO** (placeholders only) |
| Does BrowserScreen assume one WebView? | **YES** |
| What owns `currentUrl`? | `browserStore` (Zustand) |
| What owns `sourceUri`? | `useBrowserEngine` React state |
| What owns `title`? | `browserStore.pageTitle` |
| What owns Desktop Site? | `browserStore.desktopMode` + MMKV prefs |
| Is Desktop Site global or page/session-specific today? | **Session-global** preference (one WebView); platform can recommend per navigation until user is explicit |
| What owns the media candidate? | `mediaDetectionStore` + detection engine |
| What owns Download CTA visibility? | Derived in `useBrowserMediaAction` from `browserMediaActionService` |
| CTA after successful enqueue today? | `markConsumed(fingerprint)` → status `consumed` → CTA hidden |
| Media state with multiple tabs today? | Would **leak** — stores are global/singleton |
| Best MVP tab strategy? | **OPTION C — Bounded/Hybrid WebViews** |
| Why for low-end Android? | Hard mount cap + eviction prevents unbounded WebView RAM |
| Per-tab Back/Forward? | Native history on **mounted** tabs; cold/evicted tabs rebuild from URL |
| Cookies across tabs? | Shared Android WebView cookie jar (do not fork) |
| Desktop Site across tabs? | **Per-tab** `desktopMode` (new tabs inherit default preference) |
| CTA isolation? | Per-tab media/CTA slice keyed by `tabId` |
| CTA consumption vs reobservation? | Persist consumed key: `tabId + mediaFingerprint` |
| Global vs per-tab? | See §G / §23–24 |
| Persist / not persist / restart? | See §26–27 |
| Close active / last / media tab? | See §28 |

---

## A. Current browser architecture map

```
app/(app)/(tabs)/browser.tsx
  → BrowserScreen
      → useBrowserEngine()                    // WebView ref, sourceUri, chrome stack, epoch
      → BrowserEngineProvider
      → BrowserScreenBody
          → useBrowserSessionContinuity()
          → useBrowserHardwareBack()
          → MediaDetectionHost                // syncs detection engine ↔ navigation
          → BrowserHeader
              → BrowserTabBadge (static count=1)
              → AddressBar (useAddressBar draft)
              → BrowserOverflowControls / menu
          → BrowserProgressBar
          → BrowserContainer
              → BrowserWebView (exactly one)
              → BrowserHomeView (when vidorax://home)
              → BrowserErrorView (when error)
              → BrowserLinkActionSheet
          → BrowserMediaDownloadBar
              → useBrowserMediaAction
                  → mediaDetectionStore / discovery
                  → browserMediaActionService
                  → enqueueBrowserMediaDownload → Phase 1 downloads store
          → BrowserToolbar (back/forward/home)
```

### Layer inventory

| Layer | File | Responsibility | State owned | Persistence | WebView coupling |
|---|---|---|---|---|---|
| Route | `src/app/(app)/(tabs)/browser.tsx` | Mount screen | none | none | none |
| Screen | `src/browser/BrowserScreen.tsx` | Compose chrome + engine | pending-nav consume | none | via engine |
| Engine hook | `src/browser/hooks/useBrowserEngine.ts` | Commands + `sourceUri` + chrome nav stack + epoch refs | `sourceUri`, refs | none | **owns ref** |
| Engine ctx | `src/browser/engine/BrowserEngineContext.tsx` | DI for chrome | none | none | high |
| Store | `src/browser/stores/browserStore/*` | Chrome session + Desktop | `currentUrl`, title, loading, error, desktop… | session via MMKV; desktop prefs MMKV | low (updated by events) |
| Container | `src/browser/components/BrowserContainer/BrowserContainer.tsx` | Home / error / WebView surface | none | none | mounts WebView |
| WebView | `.../BrowserWebView.tsx` | Render + report events + UA | cacheMode, appliedDesktopMode | none | **the instance** |
| Preferences | `browser-preferences.service.ts` | Desktop MMKV | desktop flags | MMKV | none |
| Desktop svc | `session/desktop-mode.service.ts` | Resolve effective mode | none | via prefs | none |
| UA | `constants/user-agent.ts` | Mobile omit / desktop explicit | none | none | prop |
| Session | `session/session-persistence.service.ts` | Single-URL continuity | url/title/scroll | MMKV + adapter | restore into engine |
| History | SQLite history + recording service | Visit log | visits | SQLite | observer |
| Bookmarks | `store/bookmarks` | Bookmark list | bookmarks | existing store | none |
| Media host | `MediaDetectionHost` | Navigation sync | none | none | via sync hook |
| Media store | `mediaDetectionStore` | Candidates / epoch / lastNavigation | global detection | none | injected observers |
| CTA svc | `browser-media-action.service.ts` | Verified offer + consumed set | singleton | in-memory | none |
| CTA UI | `BrowserMediaDownloadBar.tsx` | Presentation | none | none | none |
| Phase 1 | `enqueueBrowserMediaDownload` → downloads store/scheduler | Execution | download items | existing Phase 1 | none |

---

## B. Audited surfaces (located)

| Area | Actual location | Notes |
|---|---|---|
| BrowserScreen | `src/browser/BrowserScreen.tsx` | Thin orchestrator |
| BrowserHeader | `components/BrowserHeader/BrowserHeader.tsx` | leadingSlot = tab badge |
| AddressBar | `components/BrowserHeader/AddressBar.tsx` + `hooks/useAddressBar.ts` | Draft local to hook |
| BrowserOverflowMenu | `components/BrowserOverflowMenu/*` | Actions in `browser-menu-actions.ts` |
| BrowserContainer | `components/BrowserContainer/BrowserContainer.tsx` | One WebView always mounted |
| BrowserWebView | `components/BrowserContainer/BrowserWebView.tsx` | Single instance |
| useBrowserEngine | `hooks/useBrowserEngine.ts` | |
| BrowserEngineProvider | `engine/BrowserEngineContext.tsx` | |
| browserStore | `stores/browserStore/*` | |
| selectors/actions | `selectors.ts` / `actions.ts` | |
| preferences | `services/browser-preferences.service.ts` | |
| Desktop Site | store + desktop-mode.service + WebView effect | |
| UA | `constants/user-agent.ts` | |
| History | SQLite + `history-recording.service.ts` | |
| Bookmarks | `@/store/bookmarks` | |
| Pending nav | `pending-navigation.service.ts` | |
| window.open | `popup-navigation.service.ts` → `loadUrl` same WebView | |
| Error | `browserStore.error` + `BrowserErrorView` | |
| Media detection | `src/media-detection/**` | |
| Correlation | navigation epoch in engine + media store | |
| CTA bar/hook | `media-actions/BrowserMediaDownloadBar.tsx`, `useBrowserMediaAction.ts` | |
| Enqueue | `browser-media-download.service.ts` | |
| CTA lifecycle | `browser-media-action.service.ts` | |

---

## C. True browser tab model status

**Verdict: NONE (placeholders / PARTIAL scaffolding only)**

| Artifact | Reality |
|---|---|
| `browserStore.tabs: never[]` | Reserved empty type — no tab engine |
| `BrowserTabBadge` | Hard-coded `count = 1` — **static / fake** |
| Menu `new_tab` | Calls `engine.goHome()` — **not** create-tab |
| Long-press `open_in_new_tab` | Registered **disabled** |
| Toolbar `tabs` item | `enabled: false` |
| `BrowserHomeTabs` | Quick Access / Bookmarks **UI segment** — not webpage tabs |
| Expo Router `(tabs)` | App bottom nav — **not** browser tabs |
| WebView instance map | **Does not exist** |

**Does a true browser tab model already exist?** → **NO**

---

## D. Current WebView ownership

| Question | Answer |
|---|---|
| How many `BrowserWebView` instances? | **Exactly one** |
| Designed for one WebView? | **Yes** — single ref in `useBrowserEngine` |
| Persistent vs conditional? | **Persistent mount**; opacity/pointerEvents hide on Home / Error |
| Popup WebView? | **No** — `onOpenWindow` → `loadUrl` in same WebView |
| Native child WebView? | Not used for browsing surface |

### Lifecycle (single WebView)

| Event | Behavior |
|---|---|
| Mount | Logged; cookies/session flags recorded |
| Home | `sourceUri = about:blank`; store `vidorax://home`; WebView hidden; Home UI shown |
| Navigate | Chrome bumps epoch, sets `sourceUri`, updates store |
| Error | Store error; WebView opacity 0; branded `BrowserErrorView` |
| Background | Session flush via continuity hooks |
| Return | Restore continuity; pending nav may load |
| Unmount | Rare (leave tab route); engine refs die with screen |

**Relied upon as singular:** cookies, session, navigation stack, DOM, video, media observation, WebView history.

---

## E. Current browser state ownership

| State | Current owner | Scope today | Persisted? | Where | Future |
|---|---|---|---|---|---|
| currentUrl | browserStore | session-global | yes | MMKV session | PER-TAB |
| sourceUri | useBrowserEngine | session-global | no | — | PER-TAB (active mount) |
| title / pageTitle | browserStore | session-global | yes | MMKV session | PER-TAB |
| favicon | bookmarks only | global | bookmarks | existing | PER-TAB optional / DERIVED |
| isLoading | browserStore | session-global | no | — | PER-TAB |
| loadProgress | browserStore.progress | session-global | no | — | PER-TAB |
| canGoBack/Forward | browserStore (+ chrome/native refs) | session-global | no | — | PER-TAB (native when mounted) |
| navigationEpoch | engine + media engine refs | session-global | no | — | PER-TAB |
| error / retryUrl | browserStore.error | session-global | no | — | PER-TAB |
| Desktop mode | browserStore | **global preference** | yes | MMKV prefs | PER-TAB (+ global default) |
| user Desktop explicit | browserStore + MMKV | global | yes | MMKV | GLOBAL default + PER-TAB override |
| platform Desktop recommendation | loadUrl / describePlatformPage | per-navigation | no | — | PER-TAB ephemeral |
| browser history | SQLite | global | yes | SQLite | GLOBAL |
| bookmarks | bookmarks store | global | yes | existing | GLOBAL |
| address draft | useAddressBar local state | ephemeral | no | — | EPHEMERAL (discard on switch) |
| search / suggestions | suggestion services + recent searches | mixed | recent yes | existing | GLOBAL recent; draft EPHEMERAL |
| Home state | currentUrl === vidorax://home | session | yes as url | MMKV | PER-TAB |
| UA mode | derived from desktopMode | session-global | via desktop | MMKV | PER-TAB |
| popup state | none (immediate load) | — | no | — | EPHEMERAL |
| media candidate | mediaDetectionStore | global | no | — | PER-TAB |
| verified media / CTA | browserMediaActionService | singleton | no | — | PER-TAB |
| CTA consumed | consumedFingerprints Set | page-scoped clear on nav | no | — | PER-TAB (+ optional durable set) |
| requestContext | CTA service | ephemeral | **never** | — | EPHEMERAL |
| scroll | scrollPositionService + session | URL-keyed | yes | MMKV | PER-TAB / URL-keyed |

---

## F. Required future per-tab state

| Field | Where it SHOULD live | Notes |
|---|---|---|
| id | Zustand tab registry | Stable local UUID |
| url / displayUrl | Zustand tab metadata | Mirror of committed URL |
| title | Zustand tab metadata | |
| favicon | optional metadata / derived | MVP: omit or hostname favicon URL |
| sourceUri | Active WebView controller only | Not all tabs need live sourceUri |
| desktopMode | Zustand per-tab | |
| desktopModeSource | Zustand per-tab (`user`/`platform`/`default`) | |
| canGoBack/Forward | Native WebView when mounted; else false / unknown | Do not fake from SQLite |
| isLoading / loadProgress | Active mount → store/tab slice | Evicted: false |
| browser failure / retry URL | Per-tab slice | |
| navigationEpoch | Per mounted WebView controller | |
| createdAt / lastActiveAt | Zustand | Persistence + close/switch heuristics |
| media candidate context | Per-tab media slice | |
| CTA consumption context | Per-tab consumed set | Key includes fingerprint |

**Do not put everything in Zustand.** Native history, DOM, and live `sourceUri` belong to mounted WebView controllers.

---

## G. Global state (remain shared)

### GLOBAL SETTINGS / DATA

- Bookmarks  
- Persistent SQLite browser history (visit log)  
- Default search engine / omnibox config  
- User settings  
- Download list + Phase 1 scheduler (execution SoT)  
- Shared Android WebView **cookie jar**  
- Browser diagnostics configuration  
- Global **default** Desktop preference for **new tabs** (MMKV)  
- Recent searches  

### TAB SESSION STATE

- Open tabs collection, `activeTabId`  
- Per-tab URL/title/desktop/error/loading/media/CTA  
- Mounted WebView pool  

---

## H. Desktop Site — current ownership

```
Menu toggle (user)
  → setDesktopMode(enabled, { source: 'user' })
  → browserPreferencesService.persistDesktopMode + UserExplicit
  → browserStore.desktopMode
  → BrowserWebView effect
  → resolveWebViewUserAgent(appliedDesktopMode)
  → cacheMode = LOAD_NO_CACHE + reload() (if not home, not mid-load)
```

Platform path: `loadUrl` → `describePlatformPage` → `setDesktopMode(..., { source: 'platform' })` **before** `sourceUri` (unless user explicit).

| Question | Answer |
|---|---|
| GLOBAL? | **Yes for the single session** (one mode for the one WebView) |
| PAGE-SPECIFIC? | Platform recommendation can flip on navigation if not user-explicit |
| Survives navigation? | User-explicit: yes. Platform: may clear on non-desktop pages |
| Survives restart? | Yes (MMKV) |
| Affects one WebView only? | Yes (only one exists) |
| Media detection influence? | Indirect — platforms like TikTok prefer desktop WebView for content URLs |

---

## I. Desktop Site — future ownership (DECISION)

**FINAL: PER-TAB `desktopMode`**

- Tab A Desktop ON / Tab B OFF must both be correct after switch.  
- New tabs inherit **global default preference** (`browserPreferencesService` / last user default).  
- Toggling Desktop Site updates **active tab only** + reloads **that** tab’s mounted WebView once.  
- Persist per-tab `desktopMode` with tab metadata; keep MMKV default for new tabs / cold start seed.

Rationale: matches product expectation; Option C mount pool can apply UA per mounted instance; avoids cross-tab UA bleed.

---

## J. Download CTA — current ownership

```
WebView inject observers
  → media detection engine
  → mediaDetectionStore (candidates, lastNavigation, epoch)
  → useMediaDiscovery
  → useBrowserMediaAction.verifyCandidate
  → browserMediaActionService (verified / consumed)
  → BrowserMediaDownloadBar visible?
  → download() → enqueueBrowserMediaDownload → Phase 1
```

| Question | Answer |
|---|---|
| Visibility stored directly? | **No** — derived |
| Candidate / page / epoch driven? | Yes (discovery + nav reset + home/error gates) |
| Knows about tabs? | **No** |
| Successful enqueue consumes? | **Yes** — `markConsumed(fingerprint)` |
| Reobservation resurrect? | **No** while fingerprint in `consumedFingerprints`; cleared on navigation reset |

---

## K. Download CTA — future tab scoping (DECISION)

**FINAL: Hybrid D — per-tab media/CTA slice + activeTabId gate + navigationEpoch**

Compare:

| Option | Verdict |
|---|---|
| A. Global store filtered by activeTabId | Risky stale writes into shared arrays |
| B. Fully isolated per-tab engines | Correct but heavy |
| C. Page/epoch only | Insufficient without tabId |
| **D. Hybrid** | **Recommended** — tab-keyed slices; only active tab drives UI; inactive observers paused/suspended |

---

## L. CTA consumption key (DECISION)

**Stable key:** `tabId + mediaFingerprint`  
where `mediaFingerprint = platform|pageKey|mediaKey` (existing `buildBrowserMediaFingerprint`).

Do **not** rely on `candidateId` alone (unstable across reobservation).  
Do **not** use signed full URLs.  
Optional: also consult Phase 1 download identity (already done via `findDownloadForBrowserMedia`).

---

## M–O. Tab architectures + decision

### OPTION A — One WebView per tab

- Pros: perfect history/DOM/video; fastest switch  
- Cons: multiplies inject scripts, MutationObservers, media hooks, network; dangerous on 2–3 GB devices; 10–20 tabs unsafe  

### OPTION B — One WebView + logical tabs

- Pros: lowest RAM; closest to today’s Phase 2 ownership  
- Cons: tab switch ≈ reload; loses native Back/Forward/DOM/video; weak “real browser” feel  

### OPTION C — Bounded / hybrid WebViews (**SELECTED**)

- Active + up to **N−1** recent tabs remain mounted (LRU)  
- Older tabs: metadata only; restore by loading URL into a recycled/new WebView slot  
- Caps memory while preserving recent-tab fidelity  

### Decision matrix (1=poor … 5=excellent)

| Criterion | A | B | C |
|---|---|---|---|
| Android memory / low-end safety | 1 | 5 | 4 |
| Implementation complexity | 3 | 5 | 2 |
| Navigation history fidelity | 5 | 1 | 4 |
| Session / DOM preservation | 5 | 1 | 4 |
| Media/CTA correctness | 2* | 3 | 4 |
| Desktop per-tab | 5 | 3 | 5 |
| Fit with current BrowserEngine | 2 | 5 | 3 |
| Testing complexity | 2 | 4 | 3 |
| Future scalability | 2 | 3 | 5 |

\*A without suspension still risks background media storms.

### RECOMMENDED PHASE 3 MVP TAB ARCHITECTURE: **OPTION C**

**Why it fits VidoraX:** Android-only, low-end safety via hard mount bounds, preserves “normal browser” Back/Forward for recent tabs, keeps Phase 2 single-engine patterns as the **active** controller, and scales without rewriting Phase 1.

**MVP resource policy (frozen):**

| Limit | Value | Justification |
|---|---|---|
| `maxOpenTabs` | **8** | Enough for product; bounds metadata + restore work |
| `maxMountedWebViews` | **2** (active + 1 recent) | Low-end first; raise to 3 only after device memory soak |
| Inactive mounted | Pause media / stop loading where possible | Prevent hidden video + request storms |
| Tab previews | Favicon + title only | No screenshot capture in MVP |

Phase 3B may ship logical tab registry first with `maxMountedWebViews = 1` as a **temporary** mount pool size **under Option C**, then enable the second mount slot — still Option C, not Option B as the frozen end-state.

---

## P. Tab count

- Today: **static / fake** (`BrowserTabBadge` default `count=1`)  
- Future: **derived** `tabs.length` — never store separately  
- Placement: keep header leading slot (current layout)

---

## Q. New Tab flow (design only)

```
Menu → New Tab
  → create tab { url: vidorax://home, desktopMode: defaultPref, ... }
  → activeTabId = newTab.id
  → show Browser Home
  → address bar empty / ready
```

**Seed URL:** `vidorax://home` (existing `BROWSER_HOMEPAGE`) — **not** `about:blank` as chrome URL (blank is WebView filler only).

Today’s menu `new_tab` → `goHome()` is a **stub** to replace in 3B/3C.

---

## R. Closing tabs (design only)

| Case | Behavior |
|---|---|
| Close inactive | Remove tab; clean media/CTA slice; if mounted, unmount/evict |
| Close active | Activate **nearest previous index** (else next); then remove |
| Close last | Create replacement Home tab; never zero tabs |

Deterministic active selection after close: `index = clamp(closedIndex - 1, 0, tabs.length - 1)` after removal planning (prefer previous neighbor).

---

## S. Tab switch transition (design only)

Active A → select B:

1. Persist A metadata (url, title, desktopMode, error?, lastActiveAt)  
2. If A mounted and remains in pool: keep WebView hidden/frozen; pause media  
3. If A evicted: discard mount; keep metadata only  
4. Set `activeTabId = B`  
5. Address bar shows B.url (discard A draft)  
6. Desktop chrome reflects B.desktopMode  
7. Error UI reflects B.error only  
8. Media/CTA UI binds to B’s slice only  
9. If B mounted: show its WebView; else allocate mount slot (evict LRU) and `loadUrl(B.url)` with B’s UA  

---

## T. Cookies / session across tabs

**Shared cookie jar** via Android WebView (`sharedCookiesEnabled` + `thirdPartyCookiesEnabled` already true).  
Login in Tab A → Tab B same site: **same session** (expected).  
**Never** persist or duplicate cookie values in JS/MMKV/SQLite.

---

## U. History model

| Kind | Role |
|---|---|
| WebView native history | Per **mounted** tab Back/Forward |
| SQLite browser history | Global visit log |
| Tab state | Open sessions |

**Invariant:** SQLite history is **not** the per-tab Back stack.

---

## V. Error state per tab

BrowserFailure **must be per-tab**.  
Switching away from SSL-failed Tab A must show Tab B cleanly; returning to A may still show A’s error until retry/navigate.

---

## W. Media state per tab

- Candidate / verification / CTA / consumption: **per-tab slices**  
- Inactive tab must not drive CTA, auto-download, or overwrite active UI  
- Hidden mounted WebViews: suspend detection / pause media where feasible  

---

## X–Y. Performance / low-end

Cost multipliers today (per WebView): injected chrome + media scripts, MutationObserver, fetch/XHR hooks, PerformanceObserver, native intercept, JS runtime, video, cache.

**Principles:**

1. Bound open tabs and mounted WebViews  
2. Pause/suspend inactive mounts  
3. Bound candidate arrays per tab  
4. No screenshot bitmaps in MVP  
5. Lazy restore after process death (active first)  

---

## Z. Tab preview policy (MVP)

**Favicon + title (+ hostname) text cards only.**  
No live WebView thumbnails; no screenshot pipeline.

---

## Menu audit

| Action | Exists? | Works? | Handler | Scope | Phase 3 change |
|---|---|---|---|---|---|
| + New Tab | Yes | Stub → goHome | `handleNewTab` | should be tab create | **Yes — real create** |
| Add Bookmark | Yes | Yes | bookmarks store | active URL | Use active tab |
| Bookmarks | Yes | Yes | route | global | No |
| Copy Link | Yes | Yes | clipboard | active URL | Active tab |
| Share Page | Yes | Yes | Share | active URL | Active tab |
| History | Yes | Yes | route | global | No |
| Desktop Site | Yes | Yes | setDesktopMode | **global today** | **Per-tab** |
| Open External | Yes | Yes | navigationService | active URL | Active tab |
| Downloads | Yes | Yes | route | global | No |
| Settings | Yes | Yes | route | global | No |

---

## Address bar audit

| Concern | Today | Future |
|---|---|---|
| Display value | `currentUrl` when blurred | Active tab URL |
| Draft | Local `useAddressBar` state | Discard on tab switch; do not write into inactive tab |
| Loading | store `isLoading` | Active tab loading |

---

## Desktop Site + tabs edge cases (policy)

1. A mobile / B desktop — independent per-tab modes  
2. Toggle while loading — defer UA apply (existing mid-load guard) on **that** tab  
3. Switch during Desktop reload — reload belongs to source tab; do not apply to destination  
4. Close during reload — abort/cleanup that tab’s mount  
5. Desktop + login — cookies shared; UA per-tab  
6. Desktop + media — detection uses active tab’s page + request context  
7. Platform recommendation vs user — per-tab: user-explicit wins; else platform may set on navigate  

---

## Download CTA + tabs edge cases (policy)

1. A has CTA → switch B → CTA gone  
2. Back to A → restore if still verified & not consumed  
3. A download success → A consumed  
4. Switch B while A downloading → no CTA leak  
5. Same candidate reobserved in A → stays hidden (consumed key)  
6. New candidate in A → new CTA  
7. Close A → drop A media/CTA/consumed memory for that tab  
8. Error in A → clear A CTA only  

---

## Persistence (Phase 3)

**Persist (MMKV, local only):** open tabs metadata (id, url, title, desktopMode, desktopModeSource, createdAt, lastActiveAt), `activeTabId`.

**Do NOT persist:** DOM/JS state, passwords, cookie values, requestContext/Authorization, media session headers, temporary failures (optional), signed URLs, WebView history stacks.

### Crash / restart

1. Restore tab **metadata** + `activeTabId`  
2. Lazily mount/load **active** tab only  
3. Inactive tabs load on demand (switch)  
4. Do not auto-load all tabs (traffic/memory spike)

---

## Diagnostics (future DEV tags)

`[BrowserTab]` `[BrowserDesktop]` `[BrowserCTA]`  

Safe fields: tabId, activeTabId, tabCount, event, navigationEpoch, desktopMode, candidateId/fingerprint hash, ctaState.  
Never log cookies, Authorization, passwords, signed URLs, tokens.

---

## Architectural invariants (FROZEN)

1. Exactly one **active** browser tab.  
2. Tab count is derived from `tabs.length`.  
3. Active tab owns address bar display URL.  
4. Desktop Site is **per-tab**; global MMKV is **default for new tabs**.  
5. WebView native history is never replaced by SQLite history.  
6. Media candidates never leak across tabs.  
7. Download CTA never leaks across tabs.  
8. Successful Phase 1 enqueue consumes CTA for `tabId + mediaFingerprint`.  
9. Closing a tab cleans its ephemeral media/CTA state.  
10. Website cookies remain owned by Android WebView (shared jar).  
11. No tab backend / cloud sync / remote persistence.  
12. No server persistence of browser/tab state.  
13. Phase 1 downloads scheduler remains execution source of truth.  
14. `maxMountedWebViews` and `maxOpenTabs` are enforced.  
15. New Tab seeds `vidorax://home`.  
16. Never allow zero tabs — last close recreates Home.  
17. Address draft is ephemeral and discarded on tab switch.  
18. Popup/`target=_blank` policy remains same-surface unless product later defines “open in new tab”.  
19. Phase 2 navigation epoch / fail-closed SSL / branded errors remain.  
20. Local-first only (Zustand / MMKV / SQLite as already used).

---

## Phase file touch forecasts

| Phase | Likely files |
|---|---|
| **3B Tab engine** | `browserStore/*`, new `tabs/*` or `session/tabs*`, `useBrowserEngine`, `BrowserEngineContext`, `BrowserScreen`, session persistence |
| **3C Tab UI** | `BrowserTabBadge`, new switcher, `BrowserHeader`, menu `new_tab`, toolbar tabs item, localization |
| **3D Desktop Site** | `desktop-mode.service`, menu toggle, `BrowserWebView` UA binding per tab, prefs default vs per-tab |
| **3E CTA presentation** | `BrowserMediaDownloadBar`, copy/meta formatting only (no pipeline rewrite) |
| **3F CTA lifecycle** | `browser-media-action.service`, `useBrowserMediaAction`, consumption keys + tab scoping |
| **3G polish** | diagnostics tags, limits, restore soak |

**Do not modify Phase 1 scheduler/worker/network policy files for tab work.**

---

## Regression / security / performance risks

### Phase 1

- Risk: duplicate enqueue if consumption not tab-scoped correctly  
- Mitigation: keep `enqueueBrowserMediaDownload` + fingerprint checks; don’t bypass Phase 1  

### Phase 2

- Risk: multi-WebView breaks epoch, hardware back, SSL fail-closed, popup handling  
- Mitigation: one **active** engine path; reuse existing event adapters per mount; hide inactive  

### Security

- Don’t persist cookies/tokens/requestContext  
- Don’t log signed URLs  
- Keep mixed-content never; SSL fail-closed per tab  

### Performance

- Unbounded mounts → OOM  
- Hidden video → CPU/network  
- Mitigation: mount cap + pause + lazy restore  

---

## What Phase 3A did / did not do

**Did:** audit, compare, decide, document, static verifier.  
**Did not:** implement tabs, Desktop rewrite, CTA redesign, media pipeline rewrite, WebView rewrite, prebuild, APK.

---

## Verification

```bash
cd mobile
npx tsx scripts/verify-browser-phase3-architecture-audit.ts
npx tsc --noEmit
```
