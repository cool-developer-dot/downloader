# Work log — Hamza · Browser packages (B1–B24)

Prompt: `docs/work-plans/hamza-browser-prompt.md` (Prompt D). Packages in order: B1, B5, B4, B6, B8, B10, B21, B9, B15,
B16, B18, B22, B2, B19, B23, B24.

## 0. Setup

- **BASE = `integration/final-check`** (`dd6eee0`, not an ancestor of `origin/main` = `0c0af1d`). It is not on GitHub,
  so per §5 every commit stays **local; nothing is pushed** and no PR is opened. The owner pushes after merging the
  1.1.0 work.
- Branch `hamza/browser`, created from BASE. Worktree: the Claude app made this session's worktree at
  `/Users/mac/Downloads/vidorax-mobile/.claude/worktrees/vidorax-browser-hamza-16952f` (instead of
  `/Users/mac/Downloads/vidorax-browser-hamza`); `hamza/browser` is checked out there. The owner's folder stays on
  `integration/final-check`; the prompt file was moved out of it (commit `B0`).
- Emulator: own AVD **`VidoraX_Browser_H`** (Pixel 8 profile, API 35 Google Play image, 4 GB, `PlayStore.enabled=false`,
  `hw.keyboard=yes`, 8 GB data), serial **`emulator-5556`** (`-port 5556`). `VidoraX_Test2` (owner, emulator-5554) is
  never touched. Every adb command runs with `ANDROID_SERIAL=emulator-5556`.
- Metro on port 8081 (free), without `--localhost`, watching files.
- Expo v57 docs: `docs.expo.dev` is blocked from this machine's fetch tool ("Unable to verify if domain docs.expo.dev is
  safe to fetch"), so the installed v57 packages' own type declarations and config plugins in `node_modules/` were used
  as the API reference for every Expo API.
- System fonts on the AVD: Noto Naskh Arabic only — **no Nastaliq** (`ls /system/fonts`), so B16 bundles one.

### Baseline gate (on `cf8647e` = BASE + B0)

| Check | Result |
| --- | --- |
| `npm test` | 1382 / 1382 pass |
| `npm run typecheck` | 0 errors (after Metro generated `.expo/types/router.d.ts`) |
| `npm run lint` | 0 errors, 84 warnings |
| `gradle :vidorax-media:testDebugUnitTest --rerun :vidorax-web:testDebugUnitTest --rerun` | BUILD SUCCESSFUL — vidorax-media 971 / 0, vidorax-web 34 / 0 (counted from the result XML files) |

Pre-existing failures: none.

## B1 — Tab management (#3, #5, #7, #9, #10, #11, #13, #14, #17)

### Design and decisions

| # | What the user sees | Where it lives | Notes / decisions |
| --- | --- | --- | --- |
| #3 Reopen closed tab | "Reopen closed tab" in the switcher's ⋮ menu and the browser menu; an Undo bar ("Tab closed · Undo", "3 tabs closed · Undo") for 5 s after every close, in the browser and inside the switcher | `tabs/closed-tabs.ts` (pure stack), `closed-tabs.service.ts` (MMKV `vidorax.mmkv.browser.closedTabs.v1`), `tabs/tab-undo.ts`, `components/TabUndoSnackbar` | Last 10 closed tabs: URL, title, position, pinned, desktop mode. A close of several tabs is one batch, so Undo restores the group. "Reopen closed tab" restores the most recent single tab, in front, at its old position. **Back/forward history is not kept** (a reopened tab loads its last URL fresh — the WebView's history went with it). Entries pass `shouldPersistForTab`; refused ones stay in memory only (Undo still works). At the 10-tab limit, what doesn't fit stays in the stack and the limit notice shows. Undo after closing the last tab (or Close all) also removes the fresh start page the close created, if it is still untouched |
| #5 Pin | Pin / Unpin in the tab's long-press menu; a pin icon on the card | `tabs/tab-list-ops.ts` | Pinned tabs form one block at the start (pin → end of the block, unpin → start of the rest). Persisted (`pinned` in the tab envelope). Close other / Close all keep them unless "Also close pinned tabs" is ticked |
| #7 Duplicate | "Duplicate tab" in the tab menu and the browser menu | `duplicateTab` | Same URL, title and desktop mode in a new tab right after it (a copy of a pinned tab is pinned, staying in the block), made active (Chrome's behaviour). Respects the 10-tab limit with its notice |
| #9 / #10 Close other / all | Switcher ⋮ menu and the tab's long-press menu → dialog "Close other tabs? 4 tabs will close." with "Also close pinned tabs (2)" | `CloseTabsDialog.tsx`, `closeOtherTabs` / `closeAllTabs` | Close all always leaves one fresh start-page tab in front (the REPLACED_HOME path when nothing remains; added next to kept pinned tabs otherwise). Both are one Undo group |
| #11 Drag to reorder | Touch and hold a card: it lifts, follows the finger, the others make room; the list auto-scrolls near its edges | `SortableTabList.tsx` (gesture-handler Pan `activateAfterLongPress` + reanimated, all on the UI thread) | A pinned tab moves only inside the pinned block and vice versa. Hold without moving opens the tab's menu instead. Screen readers: Move up / Move down accessibility actions on every card (and in the menu). Drag only in Manual order without a search. The list is vertical, so right-to-left changes nothing about drag direction; the card mirrors |
| #13 Search tabs | A search field at the top of the switcher | `src/utils/search-text.ts` (shared, reused by later packages) | Title + URL + site, case-insensitive, every word must match. Urdu folding: Arabic vs Urdu letter forms (ي/ی, ك/ک, ه/ہ, hamza/alef variants), diacritics and tatweel ignored, Eastern digits = ASCII digits |
| #14 Tab preview | Each card shows a small picture of its page; touch and hold opens a larger preview with title and address, above the tab's actions | native `VidoraWeb.snapshotWebView(viewTag, maxWidth, key)` → `<cache>/tab-previews/<tabId>.jpg`; `tabs/tab-snapshots.ts`; `webview/webview-view-tags.ts` | Taken when the user leaves a tab (switch, new tab, duplicate) and when the switcher opens (the active tab). 540 px wide JPEG q72 . Draw on the main thread, encode off it. Start pages and `shouldPersistForTab`-refused tabs get none. **Decision:** a snapshot is kept while its tab is open *or still in the closed-tab stack* (so Undo/Reopen bring the preview back) and deleted when it leaves both (`prune`); files of long-gone tabs are cleaned the first time the switcher opens |
| #17 Auto sort | Sort button (and ⋮ → "Sort by: …") → Manual / Site / Last used / Opened | setting `tabSortOrder` (default `manual`) | Sorting is a *view*: the manual (drag) order is kept underneath, so Manual brings it back. Pinned tabs always first. "Site" groups by host without `www.`/`m.` until B4's registrable-domain helper replaces it |

- **Tab envelope v2** (`BROWSER_TABS_SCHEMA_VERSION` 2, `tabs/tab-envelope.ts`): each tab adds `pinned` and `position`. Envelopes are
  read by their fields, not their version number: tabs with `position` keep that order; v1 tabs (no `position`) come back
  most-recently-used first exactly as before; `pinned` defaults to false. An unknown higher version is no longer refused
  (it used to drop every tab) — its known fields are read. **For the owner:** Faran may also bump this version; the
  reader does not care which number wins.
- `shouldPersistForTab(tab)` (`tabs/tab-privacy.ts`) returns true for now; the tab envelope, closed tabs and snapshots go
  through it (later packages add history, highlights, notes, page watches, reading list).
- Settings Backup now refuses an unknown value for a choice setting (`STRING_CHOICES` in `backup.ts`, fed by
  `browser/settings/browser-setting-choices.ts`). `browser-settings.audit.test.ts` checks every browser setting is
  persisted, backed up and reset.

### Files

New: `src/browser/tabs/{tab-list-ops,closed-tabs,closed-tabs.service,tab-envelope,tab-privacy,tab-snapshots,tab-undo}.ts`,
`src/browser/stores/browserStore/tab-management-actions.ts`, `src/browser/webview/webview-view-tags.ts`,
`src/browser/components/BrowserTabSwitcher/{SortableTabList,TabCard,TabActionsSheet,CloseTabsDialog,tab-display}.tsx|ts`,
`src/browser/components/TabUndoSnackbar/TabUndoSnackbar.tsx`, `src/browser/settings/browser-setting-{choices,keys}.ts`,
`src/utils/search-text.ts`, `src/localization/catalogs/browserTabs.{en,ur}.ts`,
`modules/vidorax-web/android/src/main/java/com/vidorax/web/snapshot/WebViewSnapshots.kt` (+ test).
Changed: `BrowserTabSwitcher.tsx` (rewritten), `tabs/{types,constants,tab-factory,tab-persistence.service}.ts`,
store `actions.ts` / `types.ts` / `index.ts`, `BrowserWebView.tsx` (view tag), `BrowserScreen.tsx` (Undo bar),
overflow menu (Reopen closed tab, Duplicate tab), settings `types/state/index/backup.ts`, `VidoraWeb.types.ts`,
`VidoraWebModule.kt`, `vidorax-web/android/build.gradle` (Robolectric for tests), `en.ts`/`ur.ts`.


### Automated tests

- New: `tab-list-ops.test.ts` (pins, reorder incl. block edges, Move up/down, duplicate position, closing several,
  reopen at old position, the 10-tab limit, sort orders), `closed-tabs.test.ts` (stack of 10, batches, latest, storage
  round trip, broken entries), `tab-envelope.test.ts` (v1 → v2, v2 order + pins, unknown higher version read by fields,
  missing active, limit, unsafe rows), `tab-management-plans.test.ts` (duplicate at the limit, Close other keeps pinned,
  Close all → one start tab, Undo as one group incl. the replacement start page, limit), `search-text.test.ts` (Urdu
  folding, digits, diacritics), `browser-settings.audit.test.ts` (every browser setting persisted, backed up, reset;
  unknown choice ignored); Kotlin `WebViewSnapshotsTest` (8: scaling, clamps, keys, JPEG write/replace).
- Gate (run on the B1 code just before the plans refactor went into the same commit `e487d45`): `npm test` **1428 / 1428**, typecheck 0 errors, lint **0 errors / 82 warnings** (2 fewer: duplicate
  imports merged in `tab-persistence.service.ts`), `patch-react-native-webview.test.mjs` 5 / 5, `git diff --check` clean,
  vidorax-web **42 / 0** (34 + 8), vidorax-media 971 / 0 (unchanged module; baseline run). After the plans refactor
  the tab tests are 52 / 52 and both typechecks are clean; the full suite runs again in B5's gate.

### Manual cases (AVD `VidoraX_Browser_H`, API 35)

Screenshots: `.claude/pr-evidence/hamza-browser/B1-*.png` (copied from the scratchpad `qa/shots/b1-*`).

| # | Case | Build | Result | Note / screenshot |
| --- | --- | --- | --- | --- |
| 1 | 10 tabs, pin 2 | debug | PASS | Pin badge, pinned block first (`b1-dbg-08`) |
| 2 | Reorder by drag | debug | PASS | Lift, others make room, drop (`b1-dbg-09`, `-10`); unpinned tab stops below the pinned block (`-11`); auto-scroll to the end (`-13`) |
| 3 | Force-stop → order, pins, previews restored | debug | PASS | `b1-dbg-14` |
| 4 | Close a tab → Undo | debug | PASS | Undo bar over New tab, tab back at its place (`b1-dbg-40`); store log `RESTORED 1` |
| 5 | Close all (incl. pinned) → one start tab → Undo | debug | PASS | Dialog count 3 → 5 with the box (`b1-dbg-43`, `-44`); 1/10 start page; Undo restored all 5 in order with pins, start page removed (`b1-dbg-47`) |
| 6 | Close other tabs (keeps pinned) → Undo | debug | PASS | "2 tabs will close", "2 tabs closed · Undo" (`b1-dbg-48`, `-49`, `-50`) |
| 7 | Reopen a closed tab after a restart | debug | PASS | example.com back at position 5 with its preview, in front (`b1-dbg-75`) |
| 8 | Duplicate at 9 → 10, at 10 → limit notice | debug | PASS | Copy right after the original (5, 6); toast "Maximum 10 tabs open" (`b1-dbg-67`) |
| 9 | Search "wiki" | debug | PASS | 3 matches, sheet above the keyboard (`b1-dbg-69`) |
| 10 | Search an Urdu title (Gboard Urdu keyboard) | debug | PASS | "لاہور" finds the Urdu Wikipedia tab (`b1-dbg-71`) |
| 11 | Previews match their pages after switching | debug + release | PASS | `b1-dbg-05`, `b1-fresh-02` |
| 12 | Long-press → larger preview + actions | debug | PASS | `b1-dbg-06`; Urdu `b1-ur-02` |
| 13 | Sort: Site / Last used / Opened / Manual | debug | PASS | `b1-dbg-72` (Site); order read back for each |
| 14 | Urdu right-to-left: switcher, sheet, dialog, drag | debug | PASS | Mirrored (`b1-ur-01`, `-02`, `b1-dark-03`); drag 4 → 6 in RTL (`b1-ur-03`) |
| 15 | TalkBack Move up / Move down | debug | **BLOCKED** | TalkBack can't be driven through adb on this AVD: injected taps only focused the whole header/window and the keyboard shortcuts did not move focus. The actions are implemented (`accessibilityActions` Move up / Move down / options / close, labels in en + ur) and the same Move up / Move down work from the tab's menu (verified) |
| 16 | Themes System / Red / Dark | debug | PASS | `b1-system-01`, `b1-dbg-05` (Red), `b1-dark-combo` |
| 17 | Font scale 1.3 | debug | PASS | Cards keep their height, titles ellipsize (`b1-font13-combo`) |
| 18 | Fresh release install: tabs, close → Undo, previews | release | PASS | `b1-fresh-02` |
| 19 | Release over the seeded 1.1.0 (see below) | release | PASS | `b1-up-01`…`-06` |
| 20 | Release: pin + drag → force-stop → restored | release | PASS | `b1-rel-01` |

Fixed while testing (in `e487d45` before commit, or noted): the switcher sheet now sits above the keyboard (the tab
search results were hidden behind it); the Undo bar shows ≥ 6 s (Android's accessibility timeout can make it longer)
and, inside the switcher, floats over the New tab button so a tap that comes just after it timed out opens a tab
instead of closing one; a tab left early in loading keeps its previous preview (no blank snapshot); percent-encoded
addresses are shown and searched decoded.

### Upgrade check (1.1.0 vc4 → B1 release, `adb install -r` over snapshot `seeded110`)

Seed (made on 1.1.0 through its UI, saved as the AVD snapshot `seeded110` for every later upgrade check): 15
bookmarks, history from ~20 pages, 6 tabs (one in desktop mode), recent search "cats", App Lock on (PIN 1357), Urdu,
one finished download (Big Buck Bunny 360p 1 MB).

| Data | After the upgrade |
| --- | --- |
| App Lock | PIN asked at start, 1357 unlocks (`b1-up-01`) |
| Language | Urdu (`b1-up-01`, `-03`) |
| Tabs | All 6, same order as 1.1.0 restored them (most recent first), active tab kept; v1 envelope read, v2 written on the next change (`b1-up-03`) |
| Desktop mode | The desktop tab still desktop (`b1-up-04`) |
| Bookmarks | All 15 |
| History | Present ("cats", httpbin…, "1h ago") |
| Recent search | "cats" offered as a recent search |
| Download | Big_Buck_Bunny_360_10s_1MB, completed |
| New data | No pins, sort Manual, empty closed-tab stack — sensible defaults |

### Quick release check

Regression: quick check; full R1–R16 at §7. Release `e487d45` (arm64): cold starts without crash or ANR
(`logcat -b crash` and `ANR in` empty), pages open, "Video available" on w3schools HTML5 video → download completed
(HTML Video, 770 KB, 176p) (`b1-rel-03`…`-05`), `apkanalyzer manifest permissions` identical to 1.1.0 (37 lines).

## Lists kept for the owner

### Native changes for Faran to review

| Package | Change | Files |
| --- | --- | --- |
| B1 | `snapshotWebView(viewTag, maxWidth, key)`: finds the WebView by view tag (like `setWebViewActive`), draws it into a bitmap on the main thread (scroll offset applied), encodes JPEG q72 on a single background executor, writes `<cacheDir>/tab-previews/<key>.jpg` atomically (temp + rename). `key` must match `[A-Za-z0-9_-]{1,64}`. Kotlin test `WebViewSnapshotsTest` (Robolectric NATIVE graphics, added as a test-only dependency of vidorax-web, same 4.16.1 as vidorax-media) | `VidoraWeb.types.ts`, `VidoraWebModule.kt`, `snapshot/WebViewSnapshots.kt`, `build.gradle` |

### New dependencies

(none yet)

### New settings and defaults

| Setting (`SettingsState`) | Package | Default | Values |
| --- | --- | --- | --- |
| `tabSortOrder` | B1 | `manual` (today's order) | `manual`, `site`, `lastUsed`, `opened` |

### Found, not fixed

| Where | What |
| --- | --- |
| Browser tabs | A tab left while its page is still loading keeps the WebView's interim title (the URL) until it is shown again (seen after reopening several closed tabs in a row) |
| Browser, Back | Back on a tab's first page goes to the start page in that tab (so a restored tab can become a start page) — existing behaviour, noted because it changes what the switcher shows |
| Address bar suggestions | Badges and lines are English in Urdu: "Bookmark", "History", "Frequent", "Recent", "Search", "Site", "N visits", "Recent search", "Suggested site", "Go to website. Go" (to be localized in B4/B5, which change these rows) |
| History / Bookmarks screens | Relative times "6m ago" / "1h ago" are English in Urdu (B9/B10 change these screens) |
| Dev only | After a JS reload (debug), expo-image can fail to create its view ("The current activity is no longer available"); a cold start clears it. Not seen on release |

### Decisions (all packages)

- Regression: per package only the quick release check (§3 step 6); the full R1–R16 runs once at §7.
