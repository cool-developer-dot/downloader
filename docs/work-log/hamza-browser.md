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

## B5 — Search settings (#56, #57, #61, #62, #63, #64) + the Browser settings screen

### Design and decisions

- **Browser settings screen**: route `src/app/(app)/browser-settings.tsx` → `src/screens/settings/browser-settings/`
  (`BrowserSettingsScreen` + one section file per area; header inside the screen like Data usage, so the shared
  stack layout is untouched). Entry: Settings → Browser → "Browser settings" (`components/BrowserSection.tsx`). Pickers
  use a scrollable `ChoiceSheet` (rows ≥ 52 dp, radio semantics) instead of segmented controls (whose options are
  44 dp).
- **#56 Search engine** (`src/browser/search/search-engines.ts`, pure): Google (default), Bing, DuckDuckGo, Yahoo,
  Ecosia, Brave Search, each a definition (origin, path, query parameter, Safe Search / language / region parameter
  builders, `support` flags, letter badge colour). `getSearchEngine()` is the only search-URL builder; it reads the
  settings through `bindSearchSettingsReader` (bound by the settings store, like `bindLanguageReader`) and takes an
  optional override (Faran's private tabs). `buildSearchUrl` in `browser/utils/url.ts` calls it, so the address bar,
  recent-search rows and the search row all follow the engine. Badges are bundled letters in the engine's colour
  (`EngineBadge.tsx`) — no remote icon, no brand asset.
- **Defaults keep today's URL**: Moderate adds no Google parameter, language "Engine default" and region
  "Automatic" add none → `https://www.google.com/search?q=…`, byte for byte (tested).
- **#62 Safe Search** Off / Moderate / Strict: Google `safe=off` / (none) / `safe=active` — Google has Off, Blur,
  Filter, so Moderate = its default (nearest; the screen says so); Bing `adlt=off|moderate|strict`; DuckDuckGo
  `kp=-2|-1|1`; Yahoo `vm=p|i|r`; Brave `safesearch=off|moderate|strict`; Ecosia keeps these in its own cookie settings
  → not settable from a link (rows show "—" and the screen says so).
- **#63 Language** (Engine default, App language, English, Urdu, Arabic, Hindi, Persian, Bengali, Turkish, French,
  German, Spanish, Chinese): Google `hl`, Bing `setlang`, DuckDuckGo `kad` (`xx_YY`; no Urdu interface → English,
  "nearest"), Yahoo `vl=lang_xx&fl=1` (results language; no interface parameter → "nearest"), Brave `ui_lang`.
- **#64 Region** (Automatic, Pakistan, India, UAE, Saudi Arabia, Bangladesh, UK, US, Canada, Australia, Germany,
  Türkiye): Google `gl`, Bing `cc`, DuckDuckGo `kl=<country>-<lang>` (e.g. `pk-en`; Bangladesh → `wt-wt`, nearest),
  Yahoo country sites (in., uk., ca., au., de.; none for PK/AE/SA/BD → global, nearest), Brave `country`.
- **#57 Site search**: menu → "Search this site" asks the address bar to open with `site:<host> ` (the existing
  focus request now carries a prefill). `site:host` and `site:host words` are classified as searches (they used to
  look like a `site:` scheme → invalid) and the operator goes to every engine as typed.
- **#61 Suggestions** (default on): off → `SuggestionService.getSuggestions(query, { include })` skips history,
  bookmark, frequent, site and recent-search rows, and the empty field suggests nothing; the typed-address and search
  rows stay. The `include` flags are per source so B10's "History off" can keep bookmarks. The cache key includes
  the sources and the engine.
- The search row reads "Search {engine} for “…”" (localized; it said "Search Google for" in English in Urdu too).
- **Found while testing and fixed here**: a single word in a non-Latin script (e.g. "بلی") was rejected as "invalid"
  by the address bar (the "symbols only" check knew ASCII letters only) — now letters and digits of any script count.
- Verification of the parameters on real results pages: curl from the Mac could not show the effect (the pages are
  script apps; Ecosia answers 403 to non-browsers), so each is checked on the device (table below).

### Files

New: `src/browser/search/search-engines.ts` (+ test), `src/browser/utils/url-search.test.ts`,
`src/app/(app)/browser-settings.tsx`, `src/screens/settings/browser-settings/{BrowserSettingsScreen,SearchSettingsSection,ChoiceSheet,EngineBadge,index}`,
`src/screens/settings/components/BrowserSection.tsx`, `src/localization/catalogs/browserSettings.{en,ur}.ts`.
Changed: `browser/utils/url.ts`, `suggestions/suggestion.service.ts` (+ test), `hooks/useOmniboxSuggestions.ts`,
`hooks/useAddressBar.ts`, `services/address-bar-focus.ts` (+ test), overflow menu, settings store
(`types/state/index`), `browser-setting-{choices,keys}.ts`, `SettingsScreen.tsx`, `route-paths.ts`, `en.ts`/`ur.ts`.

### Automated tests

`search-engines.test.ts` (16, incl. one table test per engine over every Safe Search × language × region = 468
combinations each, default URL identity, Urdu encoding, DuckDuckGo/Yahoo specifics, app language, `site:` for every
engine, `getSearchEngine()` binding and override, normalizing, results-page recognition), `url-search.test.ts` (5:
engine from settings, any-script words, `site:`), `suggestion.service.test.ts` (+3: switch off, history-only off,
engine name), `address-bar-focus.test.ts` (prefill), `browser-settings.audit.test.ts` (5 new keys persisted, backed
up, reset). Gate on `76f215f`: `npm test` **1464 / 1464**, typecheck 0 errors, lint **0 / 82**, `git diff --check`
clean; no native change (Kotlin suites unchanged since B1).

### Manual cases (AVD `VidoraX_Browser_H`)

Screenshots: `.claude/pr-evidence/hamza-browser/B5-*.png`.

| # | Case | Build | Result | Note / screenshot (parameter seen in the page URL) |
| --- | --- | --- | --- | --- |
| 1 | Browser settings screen from Settings → Browser | debug | PASS | `B5-dbg-04`; engine picker with letter badges `B5-dbg-05` |
| 2 | Google: "cats" and "بلی" | debug | PASS | `B5-google-strict-ur-pk` (`safe=active&hl=ur&gl=PK`: Urdu results page, footer "پاکستان"), `B5-google-billi` |
| 3 | Bing: "cats" and "بلی" | debug | PASS | `adlt=moderate`, later `adlt=strict&setlang=ur&cc=PK` (Urdu interface) (`B5-bing-cats`, `B5-bing-yahoo`) |
| 4 | DuckDuckGo: "cats" and "بلی" | debug | PASS | `kp=-1`; with Strict + Pakistan `kp=1&kl=pk-en` → DuckDuckGo's own bar shows "Pakistan (en)" and "Safe search: strict" (`B5-ddg-combo`, `B5-ddg-safe-menu`) |
| 5 | Yahoo: "cats" and "بلی" | debug | PASS | `vm=r&vl=lang_ur&fl=1` (`B5-bing-yahoo`) |
| 6 | Ecosia: "cats" and "بلی" | debug | PASS | Plain `?q=`; Ecosia's own "Search region" control shows its cookie setting, as the screen notes (`B5-ecosia`; the first load timed out on the emulator and loaded on retry) |
| 7 | Brave Search: "cats" and "بلی" | debug | **BLOCKED** | URL built as designed (`safesearch=strict&ui_lang=ur&country=pk`, `B5-brave`), but Brave answered **HTTP 429** (rate limit) to the emulator for every query (logcat `[BrowserError] errorCode: 429`); curl from the Mac with the same URL gets 200. Not an app error |
| 8 | Strict Safe Search visible on the results page | debug | PASS | DuckDuckGo "Safe search: strict" (`B5-ddg-safe-menu`); Google `safe=active` |
| 9 | Language and region visible | debug | PASS | Google results page in Urdu with "پاکستان" in the footer (`B5-google-footer`); DuckDuckGo "Pakistan (en)" |
| 10 | Suggestions off → only the typed search row | debug | PASS | `B5-suggestions-combo` |
| 11 | Search this site → `site:en.wikipedia.org ` + "cats" | debug | PASS | Only Wikipedia results (`B5-site-search-combo`); first run found the prefill selected so typing replaced it → fixed in `eefc63f` |
| 12 | Force-stop and emulator reboot → settings kept | debug | PASS | DuckDuckGo / Strict / Pakistan after a cold emulator boot (`B5-after-reboot`, values read back) |
| 13 | Urdu screens (right-to-left) | debug | PASS | Mirrored rows, Urdu picker labels (`B5-ur-combo`) |
| 14 | Themes Red / Dark | debug | PASS | `B5-dbg-04` (Red), `B5-dark-combo` (Dark + Urdu) |
| 15 | Upgrade 1.1.0 → B5 release (snapshot `seeded110`) | release | PASS | PIN, Urdu, 6 tabs + desktop tab kept; new settings start at Google / Moderate / Engine default / Automatic / suggestions on (`B5-up-02`); a search is exactly `https://www.google.com/search?q=lahore` (`B5-rel-combo`) |

Device notes: the Mac's load reached 160–235 during this package (other apps); the emulator's System UI and Gboard
stopped responding twice and its network dropped once (fixed by an emulator cold boot). Recorded, not app issues.

### Quick release check

Regression: quick check; full R1–R16 at §7. Release `eefc63f` (arm64) over the seeded 1.1.0: starts, PIN, pages
open, w3schools "Video available" → download completed (HTML Video 770 KB, 176p), no crash or ANR (`logcat -b
crash`, `ANR in` empty), `apkanalyzer` permissions identical to 1.1.0 (37). APK 50,002,358 bytes (B1: 49,967,014).

## B4 — Address bar (#24, #28, #29, #36, #37, #33, #268)

### Design and decisions

| # | What the user sees | Where it lives | Notes / decisions |
| --- | --- | --- | --- |
| #24 Inline autocomplete | Typing `wik` shows `wik`**`ipedia.org`** with the added part selected; Enter (or → / a tap at the end) accepts, Backspace removes only the completion | `address-bar/inline-autocomplete.ts` (pure), sources `SuggestionService.getAutocompleteSources()` (history, frequent, bookmarks — the same local index as the rows), loaded once per editing session | A single word only (no space, no path yet); never in the middle of a word or with the caret moved into the text; `www.` and `https://` kept as typed; candidates are hosts without `www.` plus their registrable domains (`en.wikipedia.org` also offers `wikipedia.org`), scored by visits + 2 per bookmark **summed over the site's pages**, then shorter. Off with the B5 suggestions switch. The field is controlled (`value` + `selection`); a deletion that removes only the completion keeps the typed text |
| #28 Position | Browser settings → Address bar → Address bar position: Top (default) / Bottom | setting `addressBarPosition`; `BrowserScreen` puts the header and progress bar above the toolbar dock at the bottom | At the bottom the editing field sits right above the keyboard (keyboard top measured from `screenY`: the reported height leaves out the navigation bar) and the list opens upward with the best match next to the field (`inverted`). The browser menu opens upward when its button is in the lower half |
| #29 Auto-hide | Browser settings → Address bar → Hide while scrolling (default off) | `address-bar/auto-hide.ts` (pure state machine), `address-bar-visibility.ts`, `BrowserHeader/AutoHideHeader.tsx` | Fed by the page's existing `scroll` bridge message (already throttled to 200 ms), so no new injected code. Hides after 72 px down, shows after 36 px up, always shown within 32 px of the top, while loading, while editing and while "Video available" is offered (verified / preparing). The header slides (reanimated, 160 ms) and the page is resized once per hide or show, not per frame. The download bar is not part of the header, so it never hides |
| #36 Engine icon | The engine's letter badge in the empty bar, in the editing field and on search rows | `components/EngineBadge.tsx` (moved from the settings screen), `hooks/useSearchEngineDefinition.ts` | A search row shows the badge of the engine its results host belongs to (so `d cats` shows DuckDuckGo); a shortcut to another site shows the search icon. **Found while testing:** the badge stayed on the old engine after a change in Browser settings — the React Compiler keeps a render-time `getSearchEngine()` call (no inputs) for the component's life; components now read the setting through `useSearchEngineDefinition()` |
| #37 Domain highlight | When not editing, the registrable domain in full colour and the rest dimmed (`www.`**`google.com`**`/search…`); an `xn--` host in the warning colour with a ⚠ icon | `address-bar/domain.ts`: `registrableDomain` (`tldts` `getDomain`, private suffixes on, so `user.github.io` stays whole), `splitForDomainHighlight`, RFC 3492 punycode encoder | Drawn as a Text over the field (the TextInput is invisible but still the touch target: Android ignores a transparent text colour). IDN: the host is shown in its `xn--` form, the domain in the warning colour, a ⚠ icon with a spoken warning, and the field's accessibility label says "Check the address". IPs and `localhost` have no registrable domain → no highlight |
| #33 Search shortcuts | `w Lahore` → Wikipedia; Browser settings → Search → Search shortcuts: list, add, edit, delete, restore defaults | `search/search-shortcuts.ts` (pure), setting `searchShortcuts` (JSON list), `SearchShortcutsSheet.tsx`, `classifyNavigationInput` | Defaults `g` Google, `b` Bing, `d` DuckDuckGo (engine shortcuts: their URL comes from `getSearchEngine()` with the user's Safe Search / language / region) and `w` Wikipedia (`https://en.wikipedia.org/w/index.php?search=%s`). Keyword: 1–16 letters, digits, `_` or `-` (any script), unique; name ≤ 40; template `http(s)://` with `%s`, ≤ 300. The query is URI-encoded into `%s`. An engine shortcut can change its keyword and name only. Delete has no confirmation (Restore default shortcuts brings the defaults back). The search row reads "Search Wikipedia for “Lahore”" |
| #268 Calculator | `12*(3+4)/2` → first row "= 42"; a tap copies the result ("Copied 42") | `address-bar/calculator.ts` (pure recursive-descent parser, **never `eval`**), `SuggestionService.collectCalculator` | `+ − * × / ÷ ^ ** % ( )`, `of` (`15% of 2000` = 300), unary minus, right-associative powers, Eastern digits (۰–۹, ٠–٩) and `٫`/`,` handled; at least two numbers and one operator; division by zero, unfinished or invalid input → no row; results to 12 significant digits, exponent form outside 1e-9…1e15. The calculator row stays when local suggestions are off (it reads no history) |

- Also localized here (they were English in Urdu): every suggestion badge and meta line, the empty / loading states, the
  security indicator's labels ("Secure HTTPS connection"…), Reload / Stop and the "Loading page" announcement. In the
  Urdu search row the typed query is wrapped in a first-strong isolate (`⁨…⁩`), so `2^10` no longer shows as
  `10^2` inside the right-to-left sentence (same for "No tabs match" and the shortcut example).
- Sort by "Site" (B1) now groups on the registrable domain.
- `useKeyboardHeight` (`src/hooks`) replaces the overlay's own keyboard listener and lifts the shortcut editor above
  the keyboard; the editor scrolls at font scale 1.3.
- The shortcut editor's examples were "yt" / "YouTube" in the first draft; changed to "dict" / "Dictionary" (a video
  downloader's UI should not suggest YouTube).

### Files

New: `src/browser/address-bar/{auto-hide,address-bar-settings,address-bar-visibility,calculator,domain,inline-autocomplete}.ts`
(+ `address-bar-logic`, `calculator`, `domain` tests), `src/browser/search/search-shortcuts.ts` (+ test),
`components/BrowserHeader/AutoHideHeader.tsx`, `hooks/useSearchEngineDefinition.ts`, `src/hooks/use-keyboard-height.ts`,
`screens/settings/browser-settings/{AddressBarSettingsSection,SearchShortcutsSheet}.tsx`,
`localization/catalogs/browserAddress.{en,ur}.ts`, `components/BrowserTabSwitcher/tab-display.test.ts`; moved
`EngineBadge.tsx` to `src/browser/components/`.
Changed: `AddressBar`, `BrowserHeader`, `SuggestionOverlay`, `SuggestionItem`, `SecurityIndicator`,
`ReloadStopButton`, `BrowserScreen`, `BrowserOverflowMenu`, `useAddressBar`, `useBrowserChromeBridge`,
`suggestions/{types,constants,ranking.engine,suggestion.service}` (+ test), `types/navigation.types.ts`,
`utils/url.ts`, `tab-display.ts`, settings store (`types/state/index`, `backup.ts`), `browser-setting-{choices,keys}.ts`
(+ audit test), `SearchSettingsSection`, `BrowserSettingsScreen`, `en.ts`/`ur.ts`, Urdu catalogs of B1/B5 (isolates),
`package.json` / `package-lock.json` (`tldts`).

### Automated tests

`calculator.test.ts` (9: precedence and parentheses, right-associative powers, percent and `of`, Eastern digits and
symbols `۱۲+۳`, decimals and thousands separators, division by zero → none, unfinished / invalid / plain input → none,
never evaluates code, formatting), `domain.test.ts` (9: `co.uk` / `com.pk` suffixes, private suffixes, IDN in
punycode, IPs / localhost / bare suffixes → none, RFC 3492 sample strings, label-by-label conversion, highlight split,
IDN warning, no registrable domain → whole host), `address-bar-logic.test.ts` (15: completion prefix / `www.` / scheme
/ case / mid-word / path / caret, ranking incl. "used often beats bookmarked once", caret / selection moves (keep,
accept incl. Select all, drop), auto-hide state machine: hide distance, show distance, top, holds, direction changes,
garbage input), `search-shortcuts.test.ts` (8: `w Lahore`, engine shortcuts follow Safe Search and language, Urdu
encoding, what is not a shortcut, templates need `%s` and http(s), validation, stored list round-trips with broken
entries and duplicates dropped, unreadable storage → defaults while an empty list stays empty),
`suggestion.service.test.ts` (+3: calculator first / none for unfinished, calculator with suggestions off,
autocomplete sources per switch), `tab-display.test.ts` (1), `browser-settings.audit.test.ts` (3 new keys persisted,
backed up, reset; list setting refused over its size limit).
Gate on the B4 code commit: `npm test` **1510 / 1510**, typecheck 0 errors, lint **0 errors / 82 warnings**, `git diff
--check` clean. No native change (Kotlin suites unchanged since B1); no WebView code change (the patch test is not
affected).

### Manual cases (AVD `VidoraX_Browser_H`)

Screenshots: `.claude/pr-evidence/hamza-browser/B4-*.png`.

| # | Case | Build | Result | Note / screenshot |
| --- | --- | --- | --- | --- |
| 1 | "wik" completes `wikipedia.org`, Backspace removes the completion | debug, release | PASS | `B4-auto-combo`; on release over the seeded 1.1.0 it first picked `wikimedia.org` (one bookmark beat many Wikipedia pages: per-row maximum, alphabetical tie) → scores now add up per site (`B4-rel-auto`, re-checked on the final APK) |
| 2 | Enter accepts the completion | debug | PASS | opens `wikipedia.org` (`B4-auto-enter`) |
| 3 | Suggestions off → no inline completion | debug | PASS | only the search row (`B4-suggest-off-noauto`) |
| 4 | Domain highlight | debug, release | PASS | `example.com`, `en.wikipedia.org/wiki/…` (`B4-highlight-crop`), `www.google.com/search…` after the upgrade (`B4-up-01`) |
| 5 | An `xn--` domain | debug | PASS | `www.xn--80ak6aa92e.com` in the warning colour with ⚠ (`B4-idn-engine`); spoken: "This address uses non-Latin letters…" |
| 6 | The icon follows the B5 engine | debug | PASS after fix | first run: still "G" after choosing DuckDuckGo (React Compiler caching, see #36) → fixed; D → G live without a reload (`B4-engine-follow`) |
| 7 | Calculator `12*(3+4)/2`, tap copies | debug | PASS | "= 42" first, toast "Copied 42" (`B4-calc-combo`, `B4-calc-copy`) |
| 8 | Calculator with Eastern digits | debug | PASS | `۱۲+۳×۲` pasted from a local page → "= 18" (`B4-calc-eastern`) |
| 9 | Calculator `2^10` on release | release | PASS | "= 1024" (`B4-rel-combo`) |
| 10 | `w Lahore` shortcut | debug, release | PASS | Wikipedia "Lahore" (`B4-short-02`, `B4-rel-combo`) |
| 11 | Shortcut editor: add `wt` Wiktionary, use it, edit to `wk`, taken keyword `g` refused, delete, restore defaults | debug | PASS | `B4-shortcut-use` (row + en.wiktionary.org/wiki/cat), `B4-shortcut-taken`, `B4-shortcut-deleted`, `B4-shortcut-reset`; **found:** the editor sat behind the keyboard → fixed (`B4-hook`); closing the sheet mid-edit reopened a stale editor → fixed |
| 12 | Bottom position with the keyboard open, in Urdu | debug | PASS | field above the keyboard, suggestions upward, menu opens upward (`B4-bottom`) |
| 13 | Auto-hide on a long article | debug | PASS | hides scrolling down, shows scrolling up and at the top (`B4-autohide`) |
| 14 | Force-stop → settings kept | debug | PASS | 3 shortcuts (Bing deleted), Bottom, Hide while scrolling on, after `am force-stop` (`B4-persist-shortcuts`, values read back from the screen) |
| 15 | Dark theme, Urdu | debug | PASS | calculator row, bar highlight, shortcut sheet (`B4-dark-calc`, `B4-dark`) |
| 16 | Font scale 1.3 | debug | PASS | sheet and editor (Save reachable by scrolling) (`B4-font13`, `B4-font13-editor-scrolled`) |
| 17 | TalkBack | debug | BLOCKED (as B1) | TalkBack can't be driven through adb on this AVD; labels read from the accessibility tree instead: "Search engine: Google", the IDN warning, the calculator row ("2^10 = 1024. Result 1024. Double-tap to copy"), localized security / reload labels in Urdu |
| 18 | Upgrade 1.1.0 → B4 release (snapshot `seeded110`) | release | PASS | PIN, Urdu, 6 tabs; new settings start at Top / Hide while scrolling off / 4 default shortcuts (`B4-up-02`, `-03`) |
| 19 | Select all + Delete while a completion shows | release | PASS after fix | first run left `wik` (the controlled selection was put back after Select all, so Delete removed only the completion) → `completionOnSelection`; now the field empties (`B4-final-combo`) |
| 20 | Urdu search row with `2^10` | release | PASS after fix | showed “10^2” (the `^` reordered inside the right-to-left sentence) → isolate; now “2^10” (`B4-final-combo`) |
| 21 | Exact address row in Urdu | release | PASS after fix | "Go to website" was English → "ویب سائٹ کھولیں" |
| 22 | Settings Backup on device | release | PASS | Export (Documents) holds `addressBarPosition`, `addressBarAutoHide`, `searchShortcuts` (36 keys); importing a file with Bottom / Hide while scrolling on / 30 shortcuts applies all three |
| 23 | 30-shortcut limit | release | PASS after fix | a 31st used to be dropped silently on save → Add turns off with "Up to 30 shortcuts. Delete one to add another." (`B4-limit`) |
| 24 | Settings Reset | release | PASS | back to Top / off / 4 defaults, language kept (`B4-after-reset`) |
| 25 | Fresh release install | release | PASS | onboarding → tour step 1 spotlights the bar with its badge (`B4-fresh-02`); auto-hide on a long article: shown while loading and at the top, hidden scrolling down, back scrolling up (`B4-fresh-autohide`) |

### Quick release check

Regression: quick check; full R1–R16 at §7. Final release APK (arm64) over the seeded 1.1.0: starts, PIN, pages
open, w3schools "Video available" → download completed (HTML Video, 770 KB, 176p) (`B4-rel-01`, `B4-rel-03`), no
crash or ANR (`logcat -b crash`, `ANR in` empty, also after the fresh install), `apkanalyzer manifest permissions`
identical to 1.1.0 (37). APK 50,293,690 bytes (B5: 50,002,358; +291 KB, mostly `tldts`'s suffix list).

Device notes: in debug, typing fast through adb with the focus outside a text field sends "R R" → React Native's dev
reload (seen twice) — type slowly; App Lock asks for the PIN again after the system file picker (existing behaviour).


## B6 — Navigation and scrolling (#42, #44, #45, #46, #47, #53, #54, #240, #51, #55)

### Design and decisions

| # | What the user sees | Where it lives | Notes / decisions |
| --- | --- | --- | --- |
| #42 Hard reload | Long-press Reload, or Menu → Hard reload | `services/hard-reload.ts` → `BrowserWebView` | Reuses the desktop-mode switch's path: cache mode `LOAD_NO_CACHE`, `reload()` after that prop commits, the default cache mode back at the load's end. While loading, the load is stopped first. A counter lets a second hard reload run while the cache mode is still off |
| #44 Long-press Back | A sheet "Earlier pages" (title + address, newest first); a row goes back that many pages at once | native `VidoraWeb.getWebViewHistory` / `goBackOrForward`; `navigation/back-history.ts` (pure) | **Decision:** built from the WebView's own back/forward list (`copyBackForwardList`), not recorded from navigation events: the listed pages and what Back walks are then the same list (a recording drifts on `history.back()`, `replaceState`, frames). Redirects replace their entry and reloads add none in that list; each `pushState` is an entry. The blank page a tab starts on and the start page are skipped (their steps still count); the same address twice in a row is listed once; at most 20. **A parked tab** (WebView unmounted by the 2-WebView pool) has no list until it is shown again ("No earlier pages in this tab") |
| #45 Swipe navigation | Swipe sideways on the bottom toolbar: Back / Forward, with an arrow that grows and fills past the trigger; with 2- / 3-button navigation also from the page's left / right 24 dp | `components/SwipeNavigation/` (`useSwipeNavigation`, `SwipeArrow`, `PageEdgeSwipe`), `navigation/swipe-navigation.ts` (pure); native `getNavigationMode` | **Design (as the prompt asks):** with gesture navigation Android owns both screen edges and its Back gesture already goes back a page, so the swipe lives on the toolbar; page edges only with button navigation (`Settings.Secure navigation_mode`, re-read when the app comes back). Trigger 80 dp, or a fling over 900 dp/s past half of it. Right-to-left mirrors it (the finger toward the reading start = Back). Vertical movement fails the gesture, so taps and page scrolling are untouched; edge gestures only start inside the edge (`hitSlop`), nothing covers the page. Setting "Swipe to go back or forward", default on |
| #46 / #47 Scroll to top / bottom | Menu items, and a small ↑ / ↓ button (end side) after a fast scroll on a long page, fading 2.5 s after fast scrolling stops | `scroll/fast-scroll.ts` (pure), `page-activity.ts`, `PageScrollControls/ScrollJumpButton.tsx`, `page-scroll-script.ts` | Fast = 2 000 px/s between the page's scroll reports; long = ≥ 3 screens (the `scroll` bridge report now carries the page and window heights). ↑ when flinging up, ↓ when flinging down; none once the page is at that end. Scrolling targets the document, or the biggest scrolling element for web apps that scroll a container |
| #54 Auto scroll | Menu → Auto scroll; a floating control: pause / resume, slower, speed level, faster, stop | `scroll/auto-scroll.ts` (pure), `page-activity.ts`, `AutoScrollControl.tsx`, `autoScrollScript` | 7 levels 15–200 px/s, started at Scroll speed's level. The loop runs in the page on animation frames (smooth, no bridge traffic); the page reports `bottom` (then it ends) and `touched` (a touch or wheel pauses it). It stops on navigation (another page or tab in front) and when the app leaves the foreground. **Noted:** a page that rewrites its URL while scrolling (some news sites) counts as navigation and stops it |
| #53 Scroll speed | Browser settings → Navigation and scrolling → Scroll speed: Slow / Normal (default) / Fast | `scroll/scroll-speed.ts` | **Recorded:** Android sets the touch-fling speed itself (the WebView's scroller), so this controls what the app scrolls: Auto scroll's starting level (2 / 3 / 5 of 7) and one Volume-key step (½, 0.85, 0.95 of a screen) |
| #240 Volume keys | Setting "Volume keys scroll pages" (default off): Volume Down / Up scroll one step | native `VidoraKeyChannel` (+ `MainActivity.dispatchKeyEvent`), `services/key-capture.service.ts`, `scroll/volume-keys.ts` (pure), `hooks/useVolumeKeyScroll.ts` | The keys are taken only while JS asks (`setKeyCapture`) **and** listens; JS asks only while the setting is on, the Browser tab is in front with the app in the foreground, a web page shows (not the start page, no tab switcher / fullscreen video), no keyboard, and nothing audible plays in the page (new `media_state` bridge report: an unmuted playing `<video>`/`<audio>`) or in the app's player (also the mini player / background). Keys pressed in a dialog or sheet go to its own window and are never taken. **One key channel** for B21: shortcut combos (`ctrl+t`, `ctrl+shift+tab`, …) go through the same `setKeyCapture(volumeKeys, combos)` and `onCapturedKey` |
| #51 Open in background | Link long-press → "Open in background tab"; a bar "Opened in background · Switch" | `tab-management-plans.ts` `planBackgroundTab`, store `openTabInBackground`, `background-tab-notice.ts`, `BackgroundTabSnackbar.tsx`, `open-in-background.action.ts` | The new tab goes right after the tab in front (after the pinned block when that tab is pinned); the tab in front stays. It mounts (and loads, parked) now when one of the two WebView slots is free, otherwise it loads when first shown. Refused at the 10-tab limit with the usual notice. The newer of the Undo bar and this bar wins |
| #55 Page preloading | Browser settings → Preload pages: Off / Wi-Fi only (default) / Always | `preload/preload-policy.ts` (pure), `page-preload.service.ts`, `browser-savers.ts`; native `prefetchDns` | Two cheap preloads, never a hidden page: the top address-bar suggestion's host is looked up ahead (native DNS lookup, ≤ 1 / min / host; nothing goes to the page), and after the page in front loads, a `<link rel="next">` / `<a rel="next">` to the same site gets a `<link rel="prefetch">`. Wi-Fi only = Wi-Fi or Ethernet and not metered (NetInfo). Off while Data saver or Battery saver is on — **seam for B18**: `bindBrowserSaversReader` (nothing saves until B18) |

- **Found while testing and fixed here:** (1) the page's scroll reports are throttled to 200 ms and the last one was
  dropped, so the app never knew where a fling came to rest (the ↓ button stayed at the bottom of a page; B4's
  auto-hide had the same blind spot) → the page script now always reports the resting position (≤ 210 ms later);
  (2) a long press on Reload started the hard reload, the button turned into Stop and — with its long-press handler
  gone while loading — the release counted as a tap on Stop → the handler stays (a no-op while loading); (3) a tab
  opened in the background showed its address in the tab switcher (a parked WebView reports its title only when shown)
  → it starts with the link's text as its title.

### Files

New: `src/browser/navigation/{back-history,back-history.service,swipe-navigation}.ts` (+ tests),
`src/browser/scroll/{auto-scroll,fast-scroll,page-activity,page-scroll-script,page-scroll.service,scroll-speed,volume-keys}.ts`
(+ `scroll-features`, `page-scroll-script` tests), `src/browser/preload/{preload-policy,page-preload.service,browser-savers}.ts`,
`src/browser/services/{hard-reload,key-capture.service}.ts`, `src/browser/tabs/background-tab-notice.ts`,
`src/browser/hooks/useVolumeKeyScroll.ts`, components `BackHistorySheet`, `BackgroundTabSnackbar`,
`PageScrollControls/{ScrollJumpButton,AutoScrollControl}`, `SwipeNavigation/{useSwipeNavigation,SwipeArrow,PageEdgeSwipe}`,
`actions/builtins/open-in-background.action.ts`, `screens/settings/browser-settings/NavigationSettingsSection.tsx`,
`localization/catalogs/browserNav.{en,ur}.ts`; native `keys/VidoraKeyChannel.kt`,
`navigation/{WebHistoryWindow,NavigationMode}.kt`, `network/DnsPrefetcher.kt` (+ 4 Kotlin tests).
Changed: `BrowserScreen`, `BrowserToolbar`, `ToolbarButton`, `ReloadStopButton`, `IconButton` (optional long press +
accessibility action), `BrowserWebView` (hard reload, next-page prefetch), overflow menu (4 items), `useAddressBar`
(DNS ahead), `useBrowserChromeBridge`, `useBrowserLongPressActions`, bridge channel / parser / page script,
`tab-management-actions.ts`, `tab-management-plans.ts` (+ test), settings store, `browser-setting-{choices,keys}.ts`,
`BrowserSettingsScreen`, `en.ts`/`ur.ts`, `VidoraWeb.types.ts`, `VidoraWebModule.kt`, `MainActivity.kt`.

### Automated tests

`back-history.test.ts` (6: newest first with steps, blank / start page skipped but counted, `pushState` entries and
doubles, redirects / reloads add nothing, empty / parked / limit, web pages only), `swipe-navigation.test.ts` (4: RTL
mirroring, trigger and fling, nowhere to go, progress and nav modes), `scroll-features.test.ts` (11: scroll speed,
jump button: fling direction, short page / at the end, fade, garbage; Auto scroll: start levels, pause / speed, touch /
bottom / navigation / background / stop, nothing while off; volume-key decision table and directions),
`page-scroll-script.test.ts` (8: the injected scripts run in a `node:vm` page — smooth top / bottom, step size,
numbers only, Auto scroll to the bottom with the `bottom` report, touch pause and one loop, preload policy, prefetch
host, same-site next page prefetched once, other site / scheme / same page / none), `tab-management-plans.test.ts` (+4:
after the tab in front, slot free / full, from a pinned tab, limit), `browser-chrome.bridge.test.ts` (+3: heights,
`auto_scroll`, `media_state`), settings audit (4 new keys persisted, backed up, reset). Kotlin: `KeyCaptureTest` (4),
`WebHistoryWindowTest` (3), `NavigationModeTest` (1), `DnsPrefetcherTest` (2). Gate on the B6 code: `npm test`
**1546 / 1546**, typecheck 0 errors, lint **0 errors / 82 warnings**, vidorax-media **971 / 0**, vidorax-web **52 / 0**
(`--rerun`), `scripts/patch-react-native-webview.test.mjs` **5 / 5** (the page script changed), `git diff --check`
clean.

### Manual cases (AVD `VidoraX_Browser_H`)

Screenshots: `.claude/pr-evidence/hamza-browser/B6-*.png`. Debug first; most cases were repeated on release because
the Mac's load (15–30, other apps) made the debug build's Metro connection drop.

| # | Case | Build | Result | Note / screenshot |
| --- | --- | --- | --- | --- |
| 1 | Browser settings → Navigation and scrolling, defaults | debug | PASS | swipe on, Normal, volume keys off, Wi-Fi only (`B6-settings`) |
| 2 | Hard reload (long-press Reload) | release | PASS after fix | httpbin `/headers`: hard reload sends `Cache-Control: no-cache` + `Pragma: no-cache`, the next normal reload `max-age=0` again (`B6-hard-reload`); first run: the release counted as Stop (fixed) |
| 3 | Menu → Hard reload | release | PASS | `no-cache` in the echoed headers |
| 4 | Long-press Back | release | PASS | "Earlier pages": Punjab, Lahore, …; the httpbin redirect hop is not listed (`B6-back-history`); a row goes back two steps at once and Forward lights up (`B6-back-jumped`) |
| 5 | Swipe on the toolbar | release | PASS | Forward / Back with the arrow filling past 80 dp (`B6-swipe`, `B6-swipe-back-combo`); a 76 dp swipe does nothing (by design) |
| 6 | 3-button navigation: page-edge swipe | release | PASS | from the left edge → Back (`B6-edge-combo`); gesture navigation restored after |
| 7 | Swipe setting off | release | PASS | the page does not change (`B6-swipe-off`) |
| 8 | Urdu: swipe mirrored | release | PASS | finger to the left = Back, arrow on the right (`B6-ur-swipe`) |
| 9 | Scroll to top / bottom, jump button | debug | PASS after fix | menu items; ↑ after a fling up, fades after ~2.5 s, a tap goes to the top; none at the end of the page once the resting position is reported (`B6-jump-combo`, `B6-jump`) |
| 10 | Auto scroll | debug | PASS | Menu → Auto scroll; + to level 5; a touch pauses; resume; reaches the bottom → ends; leaving the app ends it (`B6-auto`, `B6-auto-bottom`) |
| 11 | Volume keys scroll; normal job when they should | debug, release | PASS | Down / Up ≈ 0.85 screen, volume stays (`B6-vol`); with the keyboard up the volume panel shows; while the page's video plays the volume changes, after it ends the keys scroll (`B6-vol-media`); while the app's mini player plays the volume changes 4 → 3 (`B6-vol-player`) |
| 12 | Open in background tab | release | PASS after fix | link menu item; "Opened in background · Switch"; new tab right after, loads now (shown fully at once, `B6-bg-shown`); named by the link's text (`B6-bg-title`) (`B6-background-tab`) |
| 13 | Preload pages timing | release (trace) | PASS | see the table below |
| 14 | Settings kept, backed up, reset | release | PASS | after force-stop: swipe off / Fast / volume keys on / Always (`B6-persist`); the exported file holds the 4 keys (40 keys); Reset → defaults (`B6-after-reset`) |
| 15 | Urdu screens | release | PASS | settings section, Earlier pages sheet, Auto scroll control mirrored (`B6-ur-settings`, `B6-ur-sheets`, `B6-ur-autoscroll`) |
| 16 | Dark theme + font scale 1.3 | release | PASS | Auto scroll control (`B6-dark-font13`) |
| 17 | TalkBack | — | BLOCKED (as B1) | not drivable through adb; Back has the action "Show earlier pages", Reload "Hard reload", every control a label (read from the accessibility tree) |

**Preload pages, measured** (release with `EXPO_PUBLIC_VIDORAX_PIPELINE_TRACE=1` for WebView debugging; Hacker News,
tapping "More" (`rel="next"`) and reading the next page's Navigation Timing over the DevTools socket):

| Preload pages | Next-page load (`loadEventEnd`) | First byte | Transferred |
| --- | --- | --- | --- |
| Off — run 1 / 2 / 3 | 735 ms / 453 ms / 436 ms | 565 / 387 / 391 ms | 6 KB each |
| Wi-Fi only — run 1 / 2 / 3 | 76 ms / 83 ms / 52 ms | 9 / 13 / 6 ms | 0 (from the prefetch) |

The DNS lookup ahead for the top suggestion was not timed (the emulator's resolver cache cannot be flushed without
root); it is covered by the Kotlin test and the call wiring.

### Quick release check

Regression: quick check; full R1–R16 at §7. Release (arm64) on a fresh install: starts, pages open, w3schools "Video
available" → download completed (HTML Video, 770 KB, 176p) (`B6-rel-01`, `B6-rel-03`), no crash or ANR,
`apkanalyzer manifest permissions` identical to 1.1.0 (37). APK 50,418,610 bytes (B4: 50,293,690). B6 changes no
stored data, so no upgrade run (its 4 settings start at their defaults through the store's merge, as the audit test
checks).

## B8 — Selected text (#72, #73, #74)

Built on Faran's patch hook `wrapSelectionMenu` (commit `e7c8ca4`, unchanged here). Testing rule for Mega 1: unit tests,
typecheck and lint here; every device check is in "Device test list for Faran" below (his final pass).

### Design and decisions

| # | What the user sees | Where it lives | Notes / decisions |
| --- | --- | --- | --- |
| #72 Search | Select text on a page → the menu shows **Search** (in the app's language); it opens the results of the search engine chosen in Browser settings in a new tab right after the current one, shown at once. Over 300 characters: the first 300 are searched (cut at a word when one ends in the last 40) and a toast says "Searched for the first 300 characters of your selection" | native `selection/SelectionMenuCallback.kt`, `SelectionMenu.kt`; `src/browser/selection/` (`selection-actions.ts`, `selection-search.ts`, `selection-menu.service.ts`), `hooks/useSelectionMenu.ts` | The tab goes in with B6's `openTabInBackground` (placed after the tab in front) and is then switched to. At the 10-tab limit the usual "Maximum 10 tabs open" notice, nothing else. Whitespace (line breaks across paragraphs) is collapsed like a typed search. The search URL carries text the user chose to search for — the typed-search exception of the URL rule |
| #73 Copy | Android's own **Copy** in the same menu | Chromium's item, kept | **Decision:** not re-built. Chromium's Copy already puts the exact selection (no 20,000-character cap) on the clipboard; a second Copy would duplicate it |
| #74 Share | Android's own **Share** → the share sheet | Chromium's item, kept | **Decision:** as Copy |
| Select all / Paste | Unchanged | Chromium's items, kept | The wrapper passes every call to Chromium's callback (create, prepare, click, destroy, content rect), so its items and the floating toolbar's position stay Chromium's |
| Web search | Chromium's "Web search" is gone while the app's items are set | `SelectionMenu.idsToRemove` | Found by its resource entry name `select_action_menu_web_search` (WebView's resources are reachable through the app's `Resources`). **Not checked on a device yet** — own checkbox below. If the name ever differs, the item simply stays (no harm) |

- **How the text is read.** Chromium does not hand the selected text to the menu's callback. When an app item is tapped,
  VidoraWeb runs `SELECTION_READ_SCRIPT` (`selection-read-script.ts`) in the page: a selection inside a `<textarea>` or
  an `<input>` of type text / search / url / tel is read from the field; otherwise `window.getSelection()`. Password
  fields and other input types are never read. At most 20,000 characters. The script returns a string and sends
  nothing; no app data goes into the page. **The menu is closed only after the page has answered** (Chromium clears the
  page's selection when its menu goes, so closing first could read nothing).
- **Extending the menu (B22, B23).** `selection-menu-items.ts` lists the app's items (id + catalog key); a new item
  needs an entry there and a `case` for its id in `selection-actions.ts`. Native takes any list (ids
  `[a-z][A-Za-z0-9_]{0,31}`, titles ≤ 40 characters, at most 4), so new items need no native change. An id without a
  handler is ignored.
- **When items show.** Only while the Browser screen is mounted and JS listens to `onSelectionAction`; the titles are
  set again when the app language changes. Otherwise (or on an older native build) the menu is exactly Chromium's.
- **Strings:** `browserSelection.*` (`catalogs/browserSelection.{en,ur}.ts`).

### Files

New: native `modules/vidorax-web/android/.../selection/{SelectionMenu,SelectionMenuCallback}.kt` (+
`SelectionMenuTest.kt`); `src/browser/selection/{selection-actions,selection-menu-items,selection-read-script,selection-search,selection-menu.service}.ts`
(+ `selection.test.ts`), `src/browser/hooks/useSelectionMenu.ts`, `src/localization/catalogs/browserSelection.{en,ur}.ts`.
Changed: `VidoraWebModule.kt` (hook listener `wrapSelectionMenu`, `setSelectionMenu`, event `onSelectionAction`),
`VidoraWeb.types.ts`, `BrowserScreen.tsx` (one hook), `en.ts` / `ur.ts` (the catalog).

### Automated tests

`selection.test.ts` (16): the read script in a `node:vm` page — page selection (English, Urdu), text-field selection
(textarea, search input), password / email fields never read, a field without a selection falls back, a throwing field
or `getSelection` gives `''`, the 20,000 cap, no `postMessage` / storage / cookie access; search text — whitespace,
blank, cut at a word with `truncated`, a 2,000-character Urdu selection → ≤ 300, hard cut without splitting a surrogate
pair; menu items — Search titled in the app language, empty titles left out, 40-character titles, at most 4; actions —
Search opens the engine's URL in a new tab, the note only when cut, nothing more at the tab limit, blank text and
unknown ids ignored. Kotlin `SelectionMenuTest` (6): item sanitising, caps, config cleared, only Web search removed,
JSON result decoding (strings only), the 20,000 cap without splitting a surrogate pair.

Gate (this machine, Windows): `npm test` **1604 / 1604**, typecheck 0 errors, lint **0 errors / 82 warnings**,
`git diff --check` clean. Patch script unchanged (its test: 5 / 5). Kotlin, run with `--rerun --continue`:
vidorax-web **73 / 74**. The one failure is `WebViewSnapshotsTest.replacesAnOlderSnapshot` (B1, `4af9355`):
`File.renameTo` does not replace an existing file on Windows; it passes on Android / macOS. vidorax-media **does not
compile its unit tests on Windows**: `DownloadRunnerTest` (`ceb1981`) has a test whose name contains a double quote,
which Windows can't put in a class-file name. B8 touches neither file. **Faran: please rerun both Kotlin suites on the
Mac.**

### Device test list for Faran

- [ ] English Wikipedia: select a word → the menu has Search; Search opens the chosen engine's results in a new tab
      right after the current one
- [ ] Urdu Wikipedia (ur.wikipedia.org): the same with an Urdu selection; the menu says تلاش in the Urdu app
- [ ] Change Browser settings → Search engine (e.g. DuckDuckGo): Search uses it
- [ ] A 2,000-character selection: Search runs with the first 300 characters and the toast appears
- [ ] Chromium's "Web search" is no longer in the menu (entry-name match, never seen on a device)
- [ ] Copy, then paste into the address bar: the selected text
- [ ] Share opens Android's share sheet with the text
- [ ] Select all and Paste still work (Paste in a page's text field)
- [ ] Search on a selection inside a page's text field (e.g. a search box); a password field is never read
- [ ] At 10 tabs: Search shows "Maximum 10 tabs open" and opens nothing
- [ ] TalkBack reads the menu items; Urdu (RTL) and Dark: the menu is Android's own

### Handoff note

```
B8 Selected text — done
Commits: 2f24e5b (native), 4504780 (code), <docs: this commit>
Native code to review: VidoraWeb implements your wrapSelectionMenu hook (patch script unchanged).
  selection/SelectionMenuCallback.kt wraps Chromium's callback (every call delegated), removes Chromium's
  "Web search" by resource entry name, adds the JS-given items; setSelectionMenu(ids, titles, readScript),
  event onSelectionAction. The menu closes only after the page answered the read script. Test: SelectionMenuTest.
New settings: none
New libraries: none
Tested: unit, typecheck, lint. Device: pending Faran's final pass.
  Kotlin on Windows: vidorax-web 73/74 (WebViewSnapshotsTest fails on Windows only); vidorax-media's tests
  don't compile on Windows (a DownloadRunnerTest name has a double quote). Please rerun both on the Mac.
Found, not fixed: text selected inside an iframe isn't read (the read script sees the main frame only).
```

## B10 — History (#95, #98, #99, #101, #103)

No native code, no database change (`DATABASE_VERSION` stays **2**: B10 only deletes and reads existing tables).
Testing rule for Mega 1: unit tests, typecheck and lint here; device, release and upgrade checks are in "Device test
list for Faran" (B10 is an upgrade-test package).

### Design and decisions

| # | What the user sees | Where it lives | Notes / decisions |
| --- | --- | --- | --- |
| #95 Search history | The History screen's search (already there) now highlights the matches in each row (semi-bold, accent colour); when a match is only in a page's path, the row's second line shows the full address instead of the host | `history-highlight.ts` (pure), `components/HighlightedText.tsx`; `HistoryItem` / `HistoryList` (new optional `highlightQuery`) | **Already present:** matching title, URL and host — `HistoryRepository.list` runs `title LIKE ? OR url LIKE ? OR hostname LIKE ?` (proof: `browsing-data.queries.test.ts` runs those statements on SQLite with the app schema: a title word, an Urdu word, a path-only word and a host all found). **Speed with 5,000 entries:** five full searches (each a COUNT and a 20-row page) over 5,000 rows took ~30 ms in total on this PC (test limit 250 ms); highlighting 5,000 titles ~7 ms. **Added:** the highlight. It follows LIKE's rule exactly (the trimmed query as one piece, case ignored for A–Z only), so what is marked is what matched |
| #98 Clear by time range | Browser settings → History → Clear browsing data, or the History screen's new clock-bin button: Last hour (selected first) / Last 24 hours / Last 7 days / Last 4 weeks / All time, the list of what is cleared, Cancel / Clear data | `browsing-data.service.ts` `clearBrowsingData`, `browsing-data-range.ts`, `components/ClearBrowsingDataSheet.tsx`; SQL `storage/repositories/browsing-data.queries.ts` (+ `browsing-data.repository.ts`) | Clears **history** (with the recent URLs the address bar suggests from), **recent searches**, **recently closed tabs** (B1's `closedTabsService.clearSince` / `clear`) and **tab previews** (`tabSnapshots.clearAll`). **Decision:** previews go whatever the range — they are a cache of what tabs showed, retaken when a tab is left. All in one transaction for the three tables; only the browser profile in use (B20), and the sheet says so. **The hook for B12:** `bindSiteDataClearer(fn)` in `browsing-data.service.ts` — the one place cookies, cache and site data join every clear (the sheet, Clear on exit, Exit). Nothing is bound, so they are kept and the sheet says "Cookies, cache and site data are kept." B12's `clearAllSiteData()` is in `src/browser/privacy/privacy.service.ts` |
| #99 Auto clear on exit | Setting "Clear history on exit" (default **off**). While on: at the next cold start the last session's browsing data is cleared, and the browser menu shows **Exit** (closes every tab, pinned too, clears, leaves the app) | `runStartupBrowsingDataClear` (called from `bootstrap/app-initializer.ts` after the browser profile and privacy set-up, before anything shows), `exitBrowser`; menu item `exit` | **Decision:** Exit is shown only while the setting is on (like Firefox's Quit with "Delete browsing data on quit"), so the menu is unchanged by default. Exit dismisses the Undo bar; `BackHandler.exitApp()` leaves. The startup clear runs once per process; a cold start = a new JS runtime |
| #101 Disable history | Setting "Save history" (default **on**). Off: no new history entries and no new recent searches; old ones stay; the History screen shows a "History is off" card with **Turn on** | `history-policy.ts` `shouldSaveVisit`, gate in `history-recording.service.ts` `recordSuccessfulVisit`; recent searches gated in `store/recent-searches/actions.ts`; `components/HistoryOffBanner.tsx` | Suggestions are not touched: bookmarks (and the history that is already there) still feed them. **Decision:** recent searches count as history here (a user who turns history off doesn't expect searches to be kept). Every visit now also passes `shouldPersistForTab(tab)` (the engine passes its tab), so B11's private tabs save nothing |
| #103 Export history | Browser settings → History → Export history, or the History screen's export button: a CSV saved in a folder the user picks (system picker, no permission; the share sheet if no folder can be picked) | `history-export.ts` (pure), `history-export.service.ts`; `listHistoryForExport` | One row per page: **title** (of its latest visit), **URL**, **last visit** (local time `YYYY-MM-DD HH:MM`), **visits**. UTF-8 with BOM and CRLF (Excel shows Urdu), cells escaped like B20's CSV (`csvCell`, formula-safe). Column titles in the app's language. File `vidorax-history-YYYY-MM-DD.csv`. "Visits" counts History's entries (it merges revisits within 5 minutes) |
| Seed helper | Debug builds only: Browser settings → History → "Debug: add 5,000 old history entries" (spread over 8 weeks, some in every range) | `debug/history-seed.ts`, `debug/HistorySeedRow.tsx` | Required behind `__DEV__` in `HistorySettingsSection`; Metro drops the branch and the module from release bundles. **Checked:** a production bundle (`npx expo export:embed --dev false --minify true`, into a temp folder, no APK) contains no seed code (`seed/` URLs, its test id: absent); only its two catalog strings ship |

- **Fix after review (`B10: fix`):** every clear now also drops the saved browser session (last page, last successful
  page and the per-page scroll positions — `clearPersistedBrowserSession`, `scrollPositionService.clear`). Without it a
  start page in front (after Exit, or the next cold start) was reloaded with the last page by the session restore, and
  those URLs survived the clear. Open tabs keep their own addresses (tabs aren't part of Clear browsing data; Exit closes
  them).
- **Strings:** `browserHistory.*` (`catalogs/browserHistory.{en,ur}.ts`).
- **Accessibility:** every new control has a label (the header buttons, the range radios with checked state, Turn
  on, Exit); rows ≥ 48 dp; the sheet and the banner use `rtl.rowDirection`; texts wrap (no fixed heights).

### Files

New: `src/browser/history/{browsing-data-range,browsing-data.service,history-export,history-export.service,history-highlight,history-policy}.ts`
(+ `history.test.ts`), `history/components/{ClearBrowsingDataSheet,HighlightedText,HistoryOffBanner}.tsx`,
`history/debug/{history-seed.ts,HistorySeedRow.tsx}`, `src/storage/repositories/browsing-data.{queries,repository}.ts`
(+ `browsing-data.queries.test.ts`), `screens/settings/browser-settings/HistorySettingsSection.tsx`,
`localization/catalogs/browserHistory.{en,ur}.ts`.
Changed: `HistoryScreen.tsx` (banner, two header buttons, the sheet, the query to the list), `HistoryList.tsx` /
`HistoryItem.tsx` (optional `highlightQuery`), `history-recording.service.ts` (+ optional `tab`, the gate),
`useBrowserEngineEvents.ts` (passes the tab), `store/recent-searches/actions.ts` (gate), overflow menu (Exit), settings
store (2 keys), `browser-setting-keys.ts`, `BrowserSettingsScreen.tsx`, `bootstrap/app-initializer.ts`,
`storage/repositories/index.ts`, `en.ts` / `ur.ts`.

### Automated tests

`browsing-data.queries.test.ts` (6, **real SQLite** via `node:sqlite` with `applyBrowserTables`): last hour clears
only the last hour in all three tables; 24 h / 7 d / 4 weeks keep older rows; all time empties them and is safe to run
twice; export rows (latest title, last visit, count, newest first; Urdu); empty export; the 5,000-entry search (title,
Urdu, path, host, none; timing). `history.test.ts` (12): range starts; highlight (all matches, A–Z case, Urdu, empty,
non-ASCII as LIKE, the second line); highlight speed on 5,000 titles; CSV (BOM, CRLF, Urdu, quotes, formula cell,
local time, file name); the save gate; the seed (5,000, every range, ≤ 8 weeks, unique URLs, Urdu titles).
Settings audit test: the two keys persisted, backed up, reset.

Gate (Windows): `npm test` **1622 / 1622**, typecheck 0 errors, lint **0 errors / 82 warnings**, `git diff --check`
clean. No Kotlin or patch change.

### Device test list for Faran

- [ ] Debug build: Browser settings → History → "Debug: add 5,000 old history entries"; then each range in Clear
      browsing data removes only its range (History screen count before / after)
- [ ] Clear browsing data also empties recent searches, Recently closed tabs (menu "Reopen closed tab" greys out) and
      the tab switcher's previews
- [ ] History screen: search a title word, an Urdu word and a word only in a URL's path — matches highlighted, path
      matches show the full address; scrolling stays smooth with 5,000 entries
- [ ] Clear history on exit on: browser menu shows Exit; Exit closes all tabs and leaves; reopening: History empty, one
      start page
- [ ] Clear history on exit on, browse, force-stop (`adb shell am force-stop`), reopen: History empty
- [ ] Save history off: visit pages and search — nothing new in History or recent searches; old entries still there;
      History screen shows "History is off"; Turn on works; address bar suggestions still show bookmarks
- [ ] Export history: pick a folder; open the CSV in a spreadsheet (Excel / Sheets) — Urdu titles correct, 4 columns
- [ ] Release build: the History section has no debug row
- [ ] Upgrade over seeded 1.1.0: history, recent searches, closed tabs all still there; Save history on, Clear on exit
      off
- [ ] Urdu (RTL), Dark, TalkBack (sheet radios, header buttons, banner), font scale 1.3 (sheet and banner wrap)

### Handoff note

```
B10 History — done
Commits: 3b8dc22 (code), <docs: this commit>
Native code to review: none
New settings: saveHistory = true (today's), clearHistoryOnExit = false (today's)
New libraries: none
Tested: unit, typecheck, lint. Device: pending Faran's final pass.
Hook for B12: bindSiteDataClearer(fn) in src/browser/history/browsing-data.service.ts is where cookies, cache
  and site data join Clear browsing data / Clear on exit / Exit. Nothing bound yet (they're kept, the sheet
  says so); your clearAllSiteData() in src/browser/privacy/privacy.service.ts fits it.
Database: no change, DATABASE_VERSION stays 2.
Found, not fixed: History search treats % and _ as wildcards (LIKE without ESCAPE, existing); "Visits" counts
  History's entries, which merge revisits within 5 minutes; clearing applies to the profile in use only.
```

## B21 — Startup and customization (#232, #233, #237, #238, #245, #246)

Browser settings → **Startup and customization** (one section, seven rows). No database change (`DATABASE_VERSION`
stays **2**); 8 new settings, all defaulting to today's behaviour. Testing rule for Mega 1: unit tests, typecheck and
lint here; device, release and upgrade checks are in "Device test list for Faran" (B21 is an upgrade-test package).

### Design and decisions

| # | What the user sees | Where it lives | Notes / decisions |
| --- | --- | --- | --- |
| #232 Homepage | "Homepage": The start page (default) or A web address (checked: `example.com` → `https://example.com/`; only http(s), no spaces, no user/password, ≤ 500 characters, must have a dot). "Home button" switch (on = today's) | `startup/startup-settings.ts` (`normalizeHomepageInput`, `readHomepage`), `components/HomepageSheet.tsx`, `browser-commands.ts` `home()`; `BrowserToolbar` | Home opens the homepage when one is set (disabled while that page is shown), else the start page exactly as before (`goHomeForTab`). **New tabs still open the start page** (`createTab` untouched). The Home button switch adds / removes `home` in the toolbar list (one source of truth with #238). A stored value is checked again on load (backup / old value) |
| #233 Startup options | "When VidoraX starts": Continue where you left off (default, today's) / Open the start page / Open the homepage | `startup-settings.ts` `planStartup` (pure), `startup.service.ts` `applyStartupOption` (app initializer, right after `ensureIncomingLinkHandling`) | Start page / homepage = **one new tab in front, every other tab kept**. Nothing happens when the tab in front already shows it, at the 10-tab limit, or when **a link from another app opened at this launch** — `incoming-link.service.ts` now records whether the launch link was opened (`didOpenLaunchLink`), so the link always wins. Runs once per cold start (a new JS runtime); warm returns change nothing |
| #237 Spell check | "Spell check" switch (default **on** = today's) | `startup/spell-check.ts`; `TextField` (+ `SearchField` through it); `BrowserWebView` document-start scripts | Off: the app's fields get `autoCorrect={false}` + `spellCheck={false}` (Android `TYPE_TEXT_FLAG_NO_SUGGESTIONS`; a field's own props still win), and pages get `SPELL_CHECK_OFF_PAGE_SCRIPT` (constant; `spellcheck="false"` on `<html>`, inherited by fields, plus `spellcheck`/`autocorrect="off"` on a field when it gets focus, so Chromium tells the keyboard). On: nothing is added. The address bar already has `autoCorrect={false}` and is untouched. **Which keyboards follow it** (Gboard, SwiftKey, Samsung) can only be seen on a device → checkbox for Faran |
| #238 Customize toolbar | "Customize toolbar": the toolbar's buttons in order (move earlier / later with arrows, remove), "Always in the address bar: Tabs, Menu" (locked), More buttons (add), Reset to default | `startup/toolbar-buttons.ts` (pure), `components/ToolbarCustomizeSheet.tsx`, `BrowserToolbar.tsx`, `browser-commands.ts` | Choices: Back, Forward, Home, New tab, Reload (Stop while loading), Share page, Bookmarks, History, Downloads, Search this site. 1–6 buttons (6 × 48 dp fit the narrowest phone). **Decision:** Tabs and Menu stay where they are today (the address bar) and are listed as locked, so they can't be removed and the default layout is unchanged. Stored as `toolbarButtons` = `back,forward,home` (today's); a saved list is read by its known ids (unknown ids — older/newer apps — and repeats skipped; nothing usable → default). **Decision:** arrows instead of drag, so ordering works with TalkBack and mirrors in RTL. Back / Forward / Home keep their existing icons, labels and handlers |
| #245 Start page background | "Start page background": Theme (default) / Colour (6) / Gradient (4) / Photo (Choose / Change / Remove) | `startup/start-page-background.ts` (pure), `start-page-photo.service.ts`, `components/StartPageBackdrop.tsx`, `StartPageBackgroundSheet.tsx`; `BrowserHomeView.tsx`; `hooks/use-theme.ts` (`ThemeModeOverrideContext`); native `startpage/` (B21 native) | The photo comes from **Android's Photo Picker** (`ACTION_PICK_IMAGES` on Android 13+, and 11–12 with SDK extension 2); on Android 8–10 (and 11–12 without it) the system **document picker** for images — neither needs a permission, so nothing is BLOCKED. VidoraWeb copies it into `<filesDir>/start-page/background-<time>.jpg`, upright (EXIF) and ≤ 1920 px on the longer side; the app keeps no access to the original. A black 45 % layer goes over the colour / gradient / photo, and the start page then uses the **dark palette** (`ThemeModeOverrideContext`, a new context read by `useTheme`; unset everywhere else, so nothing else changes) — **decision:** a dark layer under the light theme's dark text would be unreadable. Only a photo in the app's own start-page folder is shown (a restored backup can't point elsewhere); a missing photo shows the theme. The picker is a system screen of the action (App Lock doesn't relock) |
| #246 Keyboard shortcuts | Ctrl+T, Ctrl+W, Ctrl+Shift+T, Ctrl+Tab / Ctrl+Shift+Tab, Ctrl+L, Ctrl+R / F5, Ctrl+Shift+R, Alt+← / Alt+→, Ctrl+D, Ctrl+H, Esc, and Ctrl+F (find in page, added after B7: opens the bar or puts the cursor back in its field); the list in "Keyboard shortcuts" | `startup/keyboard-shortcuts.ts` (pure), `hooks/useKeyboardShortcuts.ts`, `escape-panels.ts`, `browser-commands.ts`; B6's `keyCapture.setCombos('b21-shortcuts', …)` | **No native change:** B6's channel already names every combo. Taken only while the Browser tab is focused and the app in the foreground. **Esc** is taken only while a panel in the browser's window is open (the address bar while editing; B7's find bar), otherwise it stays the page's key; sheets and dialogs are their own windows and Android closes them on Esc. Held keys repeat only next / previous tab. **Decision:** no on/off setting (the card asks for the list only; nothing changes without a physical keyboard) |

- **Fix after review (`B21: fix`):** the cold-start session restore (`useBrowserSessionContinuity`) loads the last
  page into a start page in front — which undid "Open the start page". `startup.service.ts` now records that the option
  put (or found) the tab in front (`startupOpenedTab`), and the restore skips then, next to its pending-navigation
  guard. "Continue where you left off" is unchanged.
- **Strings:** `browserStartup.*` (`catalogs/browserStartup.{en,ur}.ts`). The keys (`Ctrl+T`…) are shown left-to-right in
  both languages.
- **Accessibility:** every control labelled (move / remove / add buttons name the button they act on; swatches are radios
  named by colour; shortcut rows read "action: keys"); targets ≥ 48 dp (icon buttons `large` = 52 dp, swatches 52 dp,
  rows ≥ 48 dp); `rtl.rowDirection` everywhere; no fixed text heights; the backdrop is hidden from TalkBack.

### Files

New: `src/browser/startup/{startup-settings,toolbar-buttons,keyboard-shortcuts,start-page-background,spell-check,escape-panels,browser-commands,startup.service,start-page-photo.service}.ts`
(+ `startup.test.ts`), `startup/components/{SheetFrame,RadioRow,HomepageSheet,ToolbarCustomizeSheet,StartPageBackgroundSheet,KeyboardShortcutsSheet,StartPageBackdrop}.tsx`,
`hooks/useKeyboardShortcuts.ts`, `screens/settings/browser-settings/StartupSettingsSection.tsx`,
`localization/catalogs/browserStartup.{en,ur}.ts`; native `modules/vidorax-web/.../startpage/{StartPageImages,StartPagePhotoPicker}.kt`
(+ `StartPageImagesTest.kt`).
Changed: `BrowserToolbar.tsx` (reads the list), `BrowserHomeView.tsx` (backdrop), `BrowserWebView.tsx` (spell-check
script when off), `TextField.tsx` (spell-check props), `hooks/use-theme.ts` (override context), `useAddressBar.ts`
(registers as an Esc panel), `incoming-link.service.ts` (`didOpenLaunchLink`), `BrowserScreen.tsx` (one hook),
`bootstrap/app-initializer.ts` (startup option), settings store (8 keys), `browser-setting-{keys,choices}.ts`,
`BrowserSettingsScreen.tsx`, `VidoraWebModule.kt`, `VidoraWeb.types.ts`, `en.ts` / `ur.ts`.

### Automated tests

`startup.test.ts` (19): homepage input (site name, Urdu path, http, empty; refused: `javascript:`, `file:`, `intent:`,
`data:`, spaces, no dot, credentials, `vidorax://`, too long; stored value re-checked); startup plan (continue, start
page, homepage, no homepage, **launch link wins**, no duplicate in front, tab limit); toolbar (default = today's,
unknown / repeated ids from old saves skipped, empty → default, add / move / remove, max 6, min 1); shortcuts (every
combo on the card with the channel's names, no duplicates, case, nothing while not in front, Esc only with a panel,
tab cycling wraps, Esc closes the newest panel); background (theme default, preset fallback, only the app's own photo
path — `/sdcard`, `https:`, `..`, `content:` refused); spell check (props; the page script in `node:vm`: marks the
document, marks focused fields only, idempotent, sends nothing). Kotlin `StartPageImagesTest` (8): sample size, fit,
EXIF rotation, copy + scale + replace (old file deleted), a sideways photo turned upright, nothing readable → nothing
written, clear, Photo Picker vs document picker by Android version. Settings audit: the 8 keys persisted, backed up
(choices validated), reset.

Gate (Windows): `npm test` **1641 / 1641**, typecheck 0 errors, lint **0 errors / 82 warnings**, `git diff --check`
clean. Kotlin (`--rerun --continue`): vidorax-web **81 / 82** — the one failure is the Windows-only
`WebViewSnapshotsTest.replacesAnOlderSnapshot` (see B8); vidorax-media's tests don't compile on Windows (see B8).
Robolectric here decodes any bytes as a placeholder image and lacks `ExifInterface(InputStream)`, so the test passes the
orientation in and checks "nothing readable" with an empty / failing stream; a real non-image file is refused by
Android's `BitmapFactory` (device checkbox).

### Device test list for Faran

- [ ] Each startup option after a force-stop: Continue (tabs as left), Open the start page (tabs kept, a start page in
      front), Open the homepage (tabs kept, the homepage in front); with a homepage unset, "Open the homepage" opens a
      start page
- [ ] Each option with a link opened from another app (`adb shell am start -a android.intent.action.VIEW -d https://example.com`
      after a force-stop): the link is in front, no extra start page / homepage tab
- [ ] Homepage: set `example.com` → Home opens https://example.com/; Home is disabled on it; New tab still opens the
      start page; an invalid entry shows the message; back to The start page
- [ ] Home button switch hides / shows Home on the toolbar
- [ ] Customize toolbar: add New tab, Reload, Share, Bookmarks, History, Downloads, Search this site; reorder with the
      arrows; remove; the 6-button limit message; Reset; changes survive a force-stop; Tabs and Menu stay in the address
      bar; Urdu (RTL) order mirrored
- [ ] Spell check off: no red underlines / suggestions in a page's textarea (e.g. a search box) and in an app field
      (History search); the address bar never checks. **Write down which keyboards follow it** (Gboard, SwiftKey,
      Samsung Keyboard)
- [ ] Start page background: each colour and gradient, then Photo → the system Photo Picker opens (Android 13+ emulator)
      with no permission prompt; the photo shows with the dark layer; text readable in Light and Dark app themes and
      in Urdu; Remove → theme; a portrait camera photo is upright
- [ ] Merged manifest unchanged: no READ_MEDIA_IMAGES, no CAMERA (`apkanalyzer manifest permissions`)
- [ ] Shortcuts with `adb shell input keycombination` (e.g. `113 48` = Ctrl+T, `113 51` = Ctrl+W, `113 59 48` =
      Ctrl+Shift+T, `113 61` = Ctrl+Tab, `113 40` = Ctrl+L, `135` = F5, `57 21` = Alt+←, `113 32` = Ctrl+D, `113 36` =
      Ctrl+H, `113 34` = Ctrl+F (find bar; again = cursor back in its field), `111` = Esc while editing the address bar
      or with the find bar open); Volume-key scrolling (B6) still works alongside
- [ ] Upgrade over seeded 1.1.0: tabs restored as before (Continue), toolbar Back / Forward / Home, theme background,
      spell check on
- [ ] TalkBack on the toolbar sheet (move / remove labels), swatches, shortcut rows; font scale 1.3

### Handoff note

```
B21 Startup and customization — done
Commits: d1806e7 (native), d2eb4b8 (code), <docs: this commit>; Ctrl+F follows after B7
Native code to review: VidoraWeb pickStartPageImage(maxSize) / clearStartPageImage():
  startpage/StartPagePhotoPicker.kt — ACTION_PICK_IMAGES (13+, or 11–12 with SDK ext 2) else
  ACTION_OPEN_DOCUMENT image/*, launched via Expo RegisterActivityContracts; no permission, no manifest change.
  startpage/StartPageImages.kt — copies into <filesDir>/start-page/, EXIF-upright, <= 1920 px, JPEG 85, new name,
  old ones deleted. Test: StartPageImagesTest. Key channel unchanged (shortcuts use B6's setCombos).
New settings: homepageUrl = '' (start page), startupOption = continue, spellCheck = true,
  toolbarButtons = back,forward,home, startPageBackground = theme, startPageBackgroundColor = night,
  startPageBackgroundGradient = dusk, startPageBackgroundPhoto = '' — all today's behaviour
New libraries: none (gradient with the existing react-native-svg)
Tested: unit, typecheck, lint. Device: pending Faran's final pass.
  Kotlin on Windows: vidorax-web 81/82 (the Windows-only WebViewSnapshotsTest), vidorax-media won't compile
  its tests on Windows — please rerun both on the Mac.
Shared code touched: useTheme reads a new ThemeModeOverrideContext (null everywhere except the start page
  with a custom background); TextField gets spell-check props only when Spell check is off.
Found, not fixed: Android 8–10 get the document picker, not the Photo Picker (no permission either way);
  which keyboards honour Spell check off is unknown until tested.
```

## B7 — Find in page (#66, #67, #68, #69, #70, #71)

No native code, no setting, no database change. Testing rule for Mega 1: unit tests, typecheck and lint here; every
device check is in "Device test list for Faran".

### Design and decisions

| # | What the user sees | Where it lives | Notes / decisions |
| --- | --- | --- | --- |
| #66 Find in page | Menu → **Find in page** (on web pages) opens a bar over the top of the page: the field (focused), the count and ✕, then ↑ ↓, Match case (Aa) and Whole word | `src/browser/find/FindInPageBar.tsx`, `find-in-page.service.ts`; menu item `find_in_page`; `BrowserScreen` | The bar belongs to the tab in front and closes on ✕, **Back** (through the one Back owner `useBrowserHardwareBack`: a fullscreen video first, then the bar, then page history), **Esc** (B21's `escapePanels`), another tab in front, or navigation in that tab. Hidden while the tab switcher or a fullscreen video covers the page |
| #67 Match count | "3 of 12", "No matches" (in the error colour), "Searching…" while typing; past 1,000 matches "3 of 1000+" | `find-in-page-state.ts` `findCountLabel` | The count is a live region and is announced on each new answer |
| #68 Next / previous | ↑ / ↓, and Enter for next; wraps around; the match is scrolled to the middle of its scroller (`scrollIntoView`) | `findStepScript` | A step while a search is still pending runs the search first |
| #69 Match case | Aa toggle (a switch for TalkBack) | `findScript` flags | Off = case-insensitive (Unicode `iu`) |
| #70 Whole word | Toggle | `findScript` | **Unicode boundaries:** no letter, mark or digit (`\p{L}\p{M}\p{N}_`) right before or after, so Urdu words work (`پاکستان` doesn't match inside `پاکستانی`); JS `\b` is ASCII-only and wasn't used |
| #71 Highlights | Every match light amber, the current one deep amber; all gone when the bar closes | CSS Custom Highlight API | **No DOM change:** two `Highlight`s in `CSS.highlights` styled by a constructed sheet in `document.adoptedStyleSheets`; closing deletes both and the sheet. On a WebView without the API (Chromium < 105) only the current match shows, as the page selection |

- **Approach — decision: the injected search, not `WebView.findAllAsync`.** `findAllAsync` is native and fast but has no
  match case or whole word, so #69 and #70 could only have been BLOCKED although no rule blocks them; the injected
  search does all six. Not a hybrid (one code path). **Not tried on real pages here** (the Mega 1 testing rule): the
  choice is by capability, and comparing it on long real pages is a checkbox for Faran.
- **How the search works** (`find-in-page-script.ts`, plain string templates — Hermes keeps no function source): the
  body's text nodes are walked (skipping script, style, noscript, template, textarea, select/option and elements with no
  rendered box) and joined into one string with an offset map, so a match can span elements (`Lah<b>ore</b>`). The
  query is escaped (regex characters literal; white space matches any run of white space). At most 1,000 matches.
  Typing waits 150 ms; the toggles search at once.
- **What goes to and from the page:** in: the user's search text (as a JSON string literal, U+2028/2029 escaped, ≤ 200
  characters), two flags, a request id and numbers — no app data. Out: only `find_result` `{ requestId, current, total,
  capped }`; the bridge parser takes bounded whole numbers only (any page could post one) and answers to older requests
  are dropped. **Logged for the owner:** while the bar is open the page's own scripts could observe the search text
  (Chrome's native find doesn't expose it) — the price of match case / whole word.
- **Sites with JavaScript off** (B12's per-site setting): injected scripts don't run there, so the bar says "Find in page
  needs JavaScript, which is off for this site" instead of a false "No matches".
- **Strings:** `browserFind.*` (`catalogs/browserFind.{en,ur}.ts`); like B1–B6 (`browserNav`, `browserTabs`) the
  package's group is top-level, not `browser.find.*`.
- **Accessibility:** field, ✕, ↑, ↓ and the two toggles labelled (toggles as switches with their state and a hint);
  every button ≥ 48 dp; `rtl.rowDirection`, the field aligned and written by the app's direction; texts wrap.

### Files

New: `src/browser/find/{find-in-page-script,find-in-page-state,find-in-page.service}.ts`, `FindInPageBar.tsx`
(+ `find-in-page.test.ts`), `localization/catalogs/browserFind.{en,ur}.ts`.
Changed: `bridge/browser-chrome.{channel,bridge}.ts` (`find_result`), `hooks/useBrowserChromeBridge.ts` (hands it to
the bar), `hooks/useBrowserHardwareBack.ts` (Back closes the bar), overflow menu (Find in page), `BrowserScreen.tsx`
(the bar), `en.ts` / `ur.ts`.

### Automated tests

`find-in-page.test.ts` (15) — the scripts in a `node:vm` page (text nodes under elements, TreeWalker, Ranges, the
Highlight API or not): count and "1 of n", all + current highlights, the style sheet, scrolled into view; Match case;
Whole word in English and **Urdu**; a match across two elements; hidden / script text skipped; regex characters literal,
white space flexible; next / previous wrap; no match and empty search = 0; the 1,000 cap with `capped`; close clears
highlights and the sheet and posts nothing; the old-WebView selection fallback; only numbers posted, the query a quoted
literal (a `'); alert(1); ('` query stays a string). Bar state: only the latest answer of the bar's tab counts; labels
("3 of 12", "1000+", "No matches", searching, empty); closes on tab change / navigation. Bridge: `find_result` accepts
bounded whole numbers only.

Gate (Windows): `npm test` **1656 / 1656**, typecheck 0 errors, lint **0 errors / 82 warnings**, `git diff --check`
clean. No Kotlin or patch change.

### Device test list for Faran

- [ ] English Wikipedia (e.g. "Lahore"): Menu → Find in page; type "lahore" → "1 of N", all highlighted, the current
      one stronger; ↓ / ↑ / Enter move and scroll; wraps at the ends
- [ ] Urdu Wikipedia (ur.wikipedia.org "لاہور"): count, highlights, Whole word with "پاکستان" vs "پاکستانی"
- [ ] Match case: "Apple" vs "apple"; Whole word: "cat" vs "category"
- [ ] A very long page (e.g. a long Wikipedia list or a book on Project Gutenberg): typing stays smooth; a common letter
      shows "1000+"
- [ ] A word with no matches: "No matches"
- [ ] Back closes the bar and clears the highlights; Esc on a physical keyboard too; ✕ too
- [ ] Switch tab or follow a link while the bar is open: it closes
- [ ] Urdu app (RTL), Dark theme, after rotating (the bar stays usable), font scale 1.3 (count and field don't clip)
- [ ] TalkBack: field, count announcements, ↑ / ↓, Match case / Whole word announced as switches with their state
- [ ] A site with JavaScript off (Browser settings → Privacy → JavaScript exception): the bar shows the message
- [ ] Compare with Chrome's own find on the same long page (speed, matches in iframes — this search covers the main
      frame only) and write it down

### Handoff note

```
B7 Find in page — done
Commits: 8ecb1e0 (code), <docs: this commit>; then "B21: add Ctrl+F (find in page)"
Native code to review: none
New settings: none
New libraries: none
Tested: unit, typecheck, lint. Device: pending Faran's final pass.
Decision: injected search (CSS Custom Highlight API, no DOM change) instead of findAllAsync, because
  findAllAsync has no match case / whole word. Not compared on real pages yet (no device here).
Note for the owner: while the find bar is open, the page's scripts could observe the search text
  (native find wouldn't); only numbers come back to the app, validated in the bridge parser.
Found, not fixed: text inside iframes and closed shadow roots isn't searched; sites with JavaScript off
  can't be searched (the bar says so); WebView < 105 shows only the current match (selection).
```

## B3 — Tab sound and sleep (#283, #8, #220, #15, #190)

Mega 2. `webview-configuration.ts` read first: its parking rules hold — no remount, no cookie clearing on tab switch;
sleeping only unmounts a parked WebView the way the pool already evicts one, and its tab loads its address when opened.
No database change (`DATABASE_VERSION` stays 2). Testing rule: unit tests, typecheck and lint here; device checks in
"Device test list for Faran".

### Design and decisions

| # | What the user sees | Where it lives | Notes / decisions |
| --- | --- | --- | --- |
| #283 Audio indicator | A speaker on a tab card in the switcher while its page plays sound (also in the card's spoken label: "Playing sound" / "Muted") | `tab-sound/components/TabSoundButton.tsx`, `TabCard.tsx` | **Reuses B6's `media_state`** (the browser-chrome script already reports "playing" / "not playing" per tab: an unpaused, unmuted, audible `<audio>` / `<video>`). No new message from the page |
| #8 Mute tab | Tap the speaker, or tab menu → Mute / Unmute | `tab-audio.service.ts` | Per tab, in memory for this app run (the tab list is what persists; a sound choice is not) |
| #220 Tab volume | Tab menu → Tab volume: a 0–100 % slider with − / + and the mute button | `components/TabVolumeSheet.tsx`, `PercentSlider.tsx` | No slider library: `PercentSlider` (PanResponder track, 5 % steps, `adjustable` for TalkBack, mirrored in RTL, 48 dp); − / + move 10 % |
| How sound is changed | — | `tab-audio-script.ts` | In the page: `HTMLMediaElement.prototype.volume` / `muted` are wrapped so an element plays at page volume × tab volume and is muted when the page **or** the tab says so, while the page reads back its own values (its player UI — and B6's `media_state`, so the speaker stays to unmute — stay right). `play()` applies the tab values first, covering `new Audio()` outside the document. Values put in: a flag and a number; **nothing is sent back**. Installed only in tabs the user adjusted: injected at once, and added to that tab's document-start scripts for its next pages. Not covered: Web Audio API sound, players in cross-origin frames |
| #15 Tab sleeping | Browser settings → Tabs → "Sleep unused tabs": **Off (default)** / 15 min / 30 min / 1 h / 3 h | `tab-sleep.ts` (pure), `tab-sleep.service.ts`, `hooks/useTabSleep.ts`; store `sleepTabs` | **Default Off** — today's behaviour; a sleeping tab reloads its page and loses what was typed in it, so it's the user's choice. Only two tabs ever hold a live page (the WebView pool); sleeping gives up the second one early: checked every minute while the app is in front, a live tab unused for the time (since it was left, `lastActiveAt`) is unmounted (`sleepTabs` → `mountedTabIds`, `suspendUnmountedTabs`). **Never the tab in front or a tab playing sound.** Opening it mounts it and loads its address (the existing path for any unmounted tab). **Hook for B18:** `bindTabSleepShortener(fn)` in `tab-sleep.service.ts` — battery saver returns a shorter time |
| #190 Memory monitor | Browser settings → Tabs → Memory: "182 MB used · 2 tabs awake, 5 asleep" (+ "The phone is low on memory") | VidoraWeb `getAppMemory` (B3 native), `TabsSettingsSection.tsx` | Read on open and every 5 s while shown. The app process's total PSS (WebView's renderer is a separate process and isn't counted — the row says so). Awake = tabs with a live page; asleep = the rest |

- **Strings:** `browserTabSound.*`. **Accessibility:** speaker, menu items, slider, − / +, mute labelled; 48 dp; RTL.

### Files

New: `src/browser/tab-sound/{tab-audio-script,tab-audio.service,tab-sleep,tab-sleep.service}.ts` (+ `tab-sound.test.ts`),
`tab-sound/components/{PercentSlider,TabVolumeSheet,TabSoundButton}.tsx`, `hooks/useTabSleep.ts`,
`screens/settings/browser-settings/TabsSettingsSection.tsx`, `catalogs/browserTabSound.{en,ur}.ts`; native
`memory/AppMemory.kt` (+ `AppMemoryTest.kt`).
Changed: `TabCard.tsx` (speaker), `BrowserTabSwitcher.tsx` (Mute / Tab volume, the sheet), `BrowserWebView.tsx`
(document-start sound script for an adjusted tab), `tab-management-actions.ts` (`sleepTabs`), `BrowserScreen.tsx`,
settings store (`tabSleepAfter`), `browser-setting-{keys,choices}.ts`, `BrowserSettingsScreen.tsx`,
`VidoraWebModule.kt`, `VidoraWeb.types.ts`, `en.ts` / `ur.ts`.

### Automated tests

`tab-sound.test.ts` (9): the sound script in `node:vm` with a fake `HTMLMediaElement` (native accessors validating like
the browser's) — mute while the page reads its own `muted`; volume scales what the page sets and the page reads back its
value (an invalid value still throws for the page); the page's own mute survives the tab's unmute; `play()` covers
detached `new Audio()`; installing twice = one wrapper, latest values; only a flag and a number go in, nothing is
posted. Sleep: default Off, choices; only live, unused tabs sleep — never the front tab or one playing sound; awake /
asleep counts. Kotlin `AppMemoryTest` (3): summary stats in kB, fallback to total PSS, a real reading maps every field.

Gate (Windows): `npm test` **1665 / 1665**, typecheck 0, lint **0 / 82**, `git diff --check` clean. Kotlin vidorax-web
**84 / 85** (the Windows-only `WebViewSnapshotsTest`); vidorax-media doesn't compile its tests on Windows (see B8).

### Device test list for Faran

- [ ] A video page with sound in one tab, open the switcher: the speaker shows on that tab (and TalkBack says "Playing
      sound"); a silent page has none
- [ ] Tap the speaker: the tab goes silent, the icon shows muted; tap again: sound back. Tab menu → Mute / Unmute too
- [ ] Tab menu → Tab volume: slider, − / +, at 30 % the video is quieter; the page's own volume control still shows its
      own value; follow a link in that tab — the next page keeps the tab's volume
- [ ] A page with sound inside a cross-origin iframe (e.g. an embedded player): note that mute doesn't reach it
- [ ] Sleep unused tabs = 15 minutes: leave a tab (second live page) for 15+ minutes; Memory shows it asleep; opening it
      reloads the same address. The tab in front and a tab playing sound never sleep
- [ ] Memory row shows MB and tabs awake / asleep, updates while open; with many tabs the numbers change as tabs sleep
- [ ] `webview-configuration` rules: switching tabs doesn't reload or log out of a site (cookies kept)
- [ ] Urdu (RTL: slider mirrored), Dark, TalkBack on the slider (swipe up / down), font scale 1.3

### Handoff note

```
B3 Tab sound and sleep — done
Commits: dce1d32 (native), c8433de (code), <docs: this commit>
Native code to review: VidoraWeb getAppMemory() — memory/AppMemory.kt: Debug.getMemoryInfo summary (total PSS,
  Java / native heap, graphics) + ActivityManager.getMemoryInfo (device available / total / low). No permission.
  Test: AppMemoryTest.
New settings: tabSleepAfter = off (today's behaviour)
New libraries: none
Tested: unit, typecheck, lint. Device: pending Faran's final pass.
  Kotlin on Windows: vidorax-web 84/85 (WebViewSnapshotsTest, Windows-only); vidorax-media won't compile on
  Windows. Please rerun both on the Mac.
Hook for B18: bindTabSleepShortener(fn) in src/browser/tab-sound/tab-sleep.service.ts (battery saver shortens
  the sleep time).
Found, not fixed: mute / volume don't reach Web Audio sound or players in cross-origin frames; the memory figure
  is the app process only (WebView's renderer isn't counted); a tab's sound choice lasts for the app run.
```

## B13 — Site permissions (#116, #117, #118, #119, #120)

No native code, no permission, no database change (`DATABASE_VERSION` stays 2). Testing rule: unit tests, typecheck and
lint here; device checks in "Device test list for Faran".

### Merged manifest checked first (for the owner)

`bash scripts/dev/gradle.sh :app:processDebugMainManifest` (debug, no release build), 2026-11-08, on `92cb8a3`:
`android/app/build/intermediates/merged_manifest/debug/processDebugMainManifest/AndroidManifest.xml` has **42
`uses-permission` entries, 40 names**: ACCESS_NETWORK_STATE, ACCESS_WIFI_STATE, FOREGROUND_SERVICE,
FOREGROUND_SERVICE_DATA_SYNC, FOREGROUND_SERVICE_MEDIA_PLAYBACK, FOREGROUND_SERVICE_MEDIA_PROCESSING, INTERNET,
POST_NOTIFICATIONS, READ_APP_BADGE, READ_MEDIA_VIDEO, READ_MEDIA_VISUAL_USER_SELECTED, RECEIVE_BOOT_COMPLETED,
RUN_USER_INITIATED_JOBS, SYSTEM_ALERT_WINDOW, USE_BIOMETRIC, USE_FINGERPRINT, VIBRATE, WAKE_LOCK; launcher / badge
permissions (com.anddoes UPDATE_COUNT; com.android.launcher INSTALL_SHORTCUT, UNINSTALL_SHORTCUT, READ_SETTINGS,
WRITE_SETTINGS; htc READ_SETTINGS, UPDATE_SHORTCUT; huawei CHANGE_BADGE, READ_SETTINGS, WRITE_SETTINGS; majeur
UPDATE_BADGE; oppo READ_SETTINGS, WRITE_SETTINGS; sec badge READ, WRITE; sonyericsson BROADCAST_BADGE; sonymobile
PROVIDER_INSERT_BADGE; me.everything BADGE_COUNT_READ, BADGE_COUNT_WRITE); com.google.android.c2dm RECEIVE;
com.google.android.finsky BIND_GET_INSTALL_REFERRER_SERVICE; the app's DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION.
**No ACCESS_FINE / COARSE_LOCATION, CAMERA or RECORD_AUDIO** — so a site can never be given them, and B13 adds none.
Nothing in B13 needed a permission.

### Design and decisions

| # | What the user sees | Where it lives | Notes / decisions |
| --- | --- | --- | --- |
| #117 Location, #118 Camera and mic, #119 Notifications | When a page asks: a short bar "VidoraX blocked <site> from using your location" (camera / microphone / "from showing notifications") with Site settings and Dismiss; the site is listed with that request as **Blocked** | `site-permissions/site-permission-script.ts`, `site-permissions.service.ts`, `components/SiteNoticeBar.tsx` | **Refused in the page** by a document-start script in every page: `navigator.geolocation` answers PERMISSION_DENIED (WebView already has geolocation off), `getUserMedia` (and the old prefixed forms) rejects with NotAllowedError, `Notification.permission` is "denied" and `requestPermission()` resolves "denied" — a stub is defined where Android WebView has no Notification API, so a page that asks gets a clear answer. **Decision:** the page side, because the native answer (react-native-webview's chrome client) can't be hooked without a patch-script change (not allowed); and it would ask Android for undeclared permissions anyway. The script posts only the kind (`site_permission`), once per kind per page; the app knows the site from the tab. The bar shows for the page in front; a background tab's request is only listed |
| #116 Site permissions | Browser settings → Site permissions ("N sites"), and the lock icon's sheet → **Site settings** (that site): each site with its Blocked requests and an "Allow pop-ups" switch; **Reset** per site, **Reset all sites** | `components/SitePermissionsSheet.tsx` (+ `SitePermissionsHost`), `screens/settings/browser-settings/SitePermissionsSection.tsx`, `SiteInfoHost.tsx` (one button) | Stored as the setting `sitePermissions` (JSON; per profile because every browser setting is — B20; in Settings Backup, ≤ 16,000 characters, oldest sites dropped past 300). A site is its B12 `siteKey` (host without `www.`). The sheet says why location, camera, mic and notifications stay blocked |
| #120 Pop-up blocker | A page opening a window without a tap: nothing opens, and a bar "Pop-up blocked" offers **Allow once** and **Always for this site** | `site-permission-script.ts`, `site-permissions.service.ts` | In the page: `window.open` without the user's tap (`navigator.userActivation.isActive` false) returns null and posts `popup_blocked` with the address; a script's untrusted click on a `target=_blank` link is stopped the same way. **A tapped `window.open` and every real link tap are untouched**, so the existing `onOpenWindow` handling (and new-tab / link behaviour) runs as before. Allow once / an always-allowed site: the address goes through the same `resolvePopupNavigation` as any new window and loads in the same tab (today's behaviour for new windows). **Decision:** the allowed-site list never goes into the page — the app decides. `webview-configuration.ts` unchanged (the native `onCreateWindow` doesn't pass "user gesture" to JS) |

- **Strings:** `browserSitePermissions.*`. **Accessibility:** bar is a live region with labelled ≥ 48 dp buttons; rows read
  "Location: Blocked"; switch and Reset name the site; RTL rows.

### Files

New: `src/browser/site-permissions/{site-permissions,site-permission-script,site-permissions.service}.ts`
(+ `site-permissions.test.ts`), `components/{SiteNoticeBar,SitePermissionsSheet}.tsx`,
`screens/settings/browser-settings/SitePermissionsSection.tsx`, `catalogs/browserSitePermissions.{en,ur}.ts`.
Changed: `bridge/browser-chrome.{channel,bridge}.ts` (`site_permission`, `popup_blocked`), `useBrowserChromeBridge.ts`,
`BrowserWebView.tsx` (the script at document start), `BrowserScreen.tsx` (bar, host), `SiteInfoHost.tsx` (Site
settings button), settings store (`sitePermissions`), `browser-setting-{keys,choices}.ts`, `BrowserSettingsScreen.tsx`,
`en.ts` / `ur.ts`.

### Automated tests

`site-permissions.test.ts` (10): the list (request recorded once as Blocked, pop-ups always / off, reset one / all,
stored JSON read by fields with junk dropped, round trip, backup cap with newest kept, A–Z list); the page script in
`node:vm` — location refused with code 1 and reported once, getUserMedia rejects NotAllowedError and reports camera +
microphone, the Notification stub ("denied"), an existing Notification's requestPermission, `window.open` without a tap
blocked with its absolute address and opened with a tap, untrusted `_blank` click stopped / real click left alone,
installs once and touches no storage; bridge: four kinds only, pop-up address http(s) or null.

Gate (Windows): `npm test` **1675 / 1675**, typecheck 0, lint **0 / 82**, `git diff --check` clean. No Kotlin or patch
change.

### Device test list for Faran

- [ ] A test page asking for location (`navigator.geolocation.getCurrentPosition`): the page gets "denied", the bar
      "VidoraX blocked <site> from using your location"; Site settings shows Location: Blocked
- [ ] Camera and microphone (`getUserMedia({video:true,audio:true})`, e.g. webcamtests.com) and notifications
      (`Notification.requestPermission()`): refused, bar, listed
- [ ] The answers stay after a restart (the list is kept; the page is refused again)
- [ ] Pop-ups: a page calling `window.open` on a timer → nothing opens, "Pop-up blocked"; Allow once loads it;
      Always for this site → later pop-ups load; switch it off in Site permissions → blocked again
- [ ] A tapped `window.open` / `target=_blank` link still works as before; normal links unaffected; Google sign-in style
      pop-ups after a tap work
- [ ] Lock icon → Site settings opens that site; Browser settings → Site permissions lists all; Reset one / all
- [ ] Merged manifest still has no location, camera or microphone permission
- [ ] Urdu (RTL), Dark, TalkBack reading the bar and its buttons, font scale 1.3 (bar text wraps)

### Handoff note

```
B13 Site permissions — done
Commits: 1d4d57d (code), <docs: this commit>
Native code to review: none (patch script unchanged — requests are answered in the page)
New settings: sitePermissions = '{}' (no site)
New libraries: none
Tested: unit, typecheck, lint. Device: pending Faran's final pass.
Merged manifest (debug, gradle.sh :app:processDebugMainManifest): 40 permission names, no location, camera
  or microphone; B13 adds none (full list in the work log).
Found, not fixed: requests from cross-origin frames aren't seen by the page script (WebView refuses them anyway:
  no permission); pop-ups aren't blocked on WebView < 72 (no navigator.userActivation); an allowed pop-up loads in
  the same tab, as every new window does today.
```

## B9 — Bookmarks (#77, #78, #80, #81, #83, #84, #85, #87, #89, #91, #92, #93)

Mega 2. **`DATABASE_VERSION` 2 → 3.** B20's per-profile storage is in the base, so every new table lives in the active
profile's database. Favorites (`src/store/favorites`) untouched. Testing rule: unit tests, typecheck and lint here;
device and upgrade checks are in "Device test list for Faran" (B9 is an upgrade-test package).

### Database (v3)

- `applyBrowserTables` → `bookmark-organizer-schema.ts` (app database and every B20 profile database, on each open;
  migration step `currentVersion < 3` runs it and sets `user_version = 3`): `bookmark_folders` (id, parent_id → itself
  ON DELETE CASCADE, name, position, dates), `bookmark_tags` (bookmark_id → bookmarks ON DELETE / UPDATE CASCADE, tag;
  PK both), `reading_list` (url UNIQUE, title, hostname, created_at, read_at, **offline_uri — B17's hook**), and on
  `bookmarks` the columns `folder_id`, `note`, `position`, each only when `PRAGMA table_info` lacks it.
- **Old bookmarks** stay in the root folder (`folder_id` NULL); their order — the Bookmarks screen's newest first —
  becomes `position` 0…n in the same step that adds the column (`ROW_NUMBER() OVER (ORDER BY created_at DESC, id)`), so a
  second run changes nothing. Bookmarks added later without a position (the browser's star, B20's restore) sort first,
  newest first, as before.
- **Decision — the reading list is its own table, not `kind = 'reading'` rows in `bookmarks`** (the card's field list):
  `bookmarks.url` is UNIQUE and B20's restore dedupes on it (`INSERT OR IGNORE`), so a page couldn't be both bookmarked
  and on the reading list; dropping the constraint means rebuilding the table that holds every user's bookmarks. The
  card's `kind` / `readAt` are the reading-list table and its `read_at`.
- Because addresses are unique, import skips an address already bookmarked **in any folder**, not only the same one.

### Design and decisions

| # | What the user sees | Where it lives | Notes / decisions |
| --- | --- | --- | --- |
| #77 Folders | Bookmarks screen (`/bookmarks`, now `BookmarkManagerScreen`): breadcrumbs (Bookmarks › News › …), folders first then bookmarks; menu → New folder; a folder's options: Open, Rename, Move to folder (nest; never into itself), Move up / down, Delete → "keep its contents (move them up)" or "delete folder and everything in it", with counts | `browser/bookmarks/BookmarkManagerScreen.tsx`, `components/BookmarkSheets.tsx` (FolderNameSheet, FolderPickerSheet), `storage/repositories/bookmark-organizer.{queries,repository}.ts` | Delete runs in one transaction; "delete everything" removes the subtree's bookmarks (their tags go by cascade) |
| #78 Edit bookmark | Title, address (checked: http(s), not another bookmark's), folder, tags, note; from a row's options and from the browser menu's star on a bookmarked page ("Edit bookmark") | `BookmarkEditSheet`, `BookmarkEditHost` (browser and bookmarks screen; only the newest mounted host draws), `browser-menu-actions.ts` | **Changed:** the star item on a bookmarked page used to be a disabled "Already bookmarked"; it now opens Edit |
| #80 Reorder | Hold a row and drag it within its folder (folders among folders, bookmarks among bookmarks); also Move up / Move down in the options and as TalkBack actions | `components/SortableRows.tsx` (B1's drag pattern made generic; shared values written with `.set()` for the React Compiler), `setOrder` | Saved at once. Rows grow with the font scale (`bookmarkRowHeight`), so nothing is cut at 1.3 |
| #81 Bookmarks bar | Browser settings → Bookmarks → "Show bookmarks bar" (**off**): the "Bookmarks bar" folder as a sideways strip under the address bar | `components/BookmarksBar.tsx` inside `AutoHideHeader` | Hides with the address bar (it is in the same auto-hiding header); the folder is created on first use (fixed id `bookmarks-bar`); a hint when it's empty |
| #83 Bookmark all tabs | Tab switcher menu → Bookmark all tabs: a new folder "Tabs 2026-11-08 14:05" with every open web page | `bookmarks.service.ts` `bookmarkAllTabs` | Start pages skipped; addresses already bookmarked are counted ("3 were already bookmarked") |
| #84 Import / #85 Export | Bookmarks menu → Import / Export bookmarks | `bookmarks/netscape-import.ts`, `bookmarks.service.ts` | The standard bookmark HTML (Chrome / Firefox / Edge). Import: the system file picker (no permission), up to 40 MB (Chrome files carry base64 icons), **read as text** — a single regex pass over `<DL> <H3> <A> <DD>`, never rendered or run; folders by path (the file's toolbar folder → VidoraX's bookmarks bar), ADD_DATE, Firefox TAGS, `<DD>` notes, entities; non-http(s) entries counted as invalid. In transactions of 500 with "Importing… 1500 of 5000". Result toast: added / skipped / invalid. Export: the whole tree (folders, order, dates, TAGS, notes as `<DD>`, toolbar flag) through the folder picker |
| #89 Reading list | Browser menu → "Add to reading list", and a link's long-press; Bookmarks screen's "Reading list" tab: Unread / Read; swipe a row (either way) to mark read / unread; check and remove buttons | `components/ReadingListView.tsx` (gesture-handler `ReanimatedSwipeable`), `add-to-reading-list.action.ts` | Adding a page already on the list makes it unread again. **Hook for B17:** `bookmarkOrganizerRepository.setReadingOfflineCopy(id, uri)` (`reading_list.offline_uri`); a row opens the offline copy when there is one |
| #91 Broken link check | Bookmarks menu → Check links: "Only on Wi-Fi" (on), Start, "Checked 12 of 230", Cancel; then the problems: Moved (with **Use new address**), Not found, Unreachable | `bookmarks/link-check.ts` (pure), `components/LinkCheckSheet.tsx` | 4 at a time, 10 s each, **no cookies** (`credentials: 'omit'` → react-native's OkHttp `CookieJar.NO_COOKIES`, checked in its source), HEAD then GET when refused. 401 / 403 / 429 count as Works (the site is there). Only the bookmark's own address is requested, on the user's tap. **Never deletes anything**; "Use new address" changes one address when the user taps it |
| #92 Tags / #93 Notes | Tags and a note in Edit; tag chips above the list (All, #food, …); search covers titles, addresses, hosts, notes and tags; rows show the note and #tags | `searchBookmarks`, `listTags`, `BookmarkRows.tsx` | Tags: trimmed, no commas, ≤ 40 characters, repeats (ignoring case) dropped, ≤ 20 per bookmark |
| #87 Add to home screen | A bookmark's options → Add to home screen: the launcher's own dialog adds a shortcut (the first letter on a colour); "This phone's launcher can't add shortcuts" when it can't | VidoraWeb `pinBookmarkShortcut` / `consumeShortcutUrl` / `onShortcutOpen` (B9 native), `bookmarks.service.ts` | Tapping the shortcut starts VidoraX with a private action (never the shared-link path); the site opens **in a new tab after App Lock** (`useAppLockStore` unlocked) on the Browser tab. **Decision:** a letter icon, not the site icon — fetching a favicon natively for it would be one more network call |

- **Fix after review (`B9: fix`):** the new screen had dropped two things the previous Bookmarks screen did — the
  confirmation before deleting one bookmark and "Clear all bookmarks". Both are back (the same `BookmarkDeleteDialog`
  and strings; Clear all is in the screen's menu and calls the existing store `clear()`, leaving folders, now empty).
  Also checked: every `INSERT` into `bookmarks` (the star, B20's restore) names its columns, so they work on v3; App Lock
  locks when the app leaves the foreground, so a shortcut tapped while the app runs still asks for the PIN first.
- **Strings:** `browserBookmarks.*`. **Accessibility:** every row, chip, crumb and button labelled; ≥ 48 dp; RTL (rows,
  crumbs ‹, indents); TalkBack actions Move up / Move down / options on rows; the reading list's swipe has buttons and
  actions too.

### Files

New: native `shortcuts/BookmarkShortcuts.kt` (+ test); `storage/sqlite/bookmark-organizer-schema.ts`,
`storage/repositories/bookmark-organizer.{queries,repository}.ts` (+ `bookmark-organizer.test.ts`),
`browser/bookmarks/{netscape-import,link-check,bookmarks.service}.ts` (+ `link-check.test.ts`),
`BookmarkManagerScreen.tsx`, `components/{SortableRows,BookmarkRows,BookmarkSheets,LinkCheckSheet,ReadingListView,BookmarksBar}.tsx`,
`actions/builtins/add-to-reading-list.action.ts`, `screens/settings/browser-settings/BookmarksSettingsSection.tsx`,
`catalogs/browserBookmarks.{en,ur}.ts`.
Changed: `storage/constants/database.ts` (version 3, table names), `sqlite/schema.ts`, `sqlite/migrations.ts`,
`repositories/index.ts`, `app/(app)/bookmarks.tsx` (new screen; the old one kept), browser menu (star → Edit, Add to
reading list), `register-default-actions.ts`, tab switcher menu, `BrowserScreen.tsx` (bar, edit host),
`app-initializer.ts` (shortcut handling), settings store (2 keys), `browser-setting-keys.ts`, `BrowserSettingsScreen.tsx`,
`VidoraWebModule.kt`, `VidoraWeb.types.ts`, `en.ts` / `ur.ts`.

### Automated tests

`bookmark-organizer.test.ts` (13, real SQLite with foreign keys on): **migration** — the v2 `bookmarks` table made by
hand with 15 bookmarks, `migrateDatabase` → version 3, all 15 kept in the root in newest-first order; run twice (and the
profile path twice) changes nothing, a reorder after the upgrade survives, each column added once; a fresh install gets
v3 and the tables. Folders (nest, breadcrumbs, cycle refused, empty name refused), order with unpositioned (starred)
bookmarks first, delete "move up" / "delete all" with tag cascade, edit (invalid / duplicate address refused; title,
address, folder, tags normalised, note), search over notes / tags / tag filter, the bar folder once, reading list
(unread / read, re-add = unread, invalid refused, the B17 hook). Import / export: a Chrome-style file (toolbar flag,
lowercase tags, a 5 KB ICON, entities, Urdu, a bookmarklet = invalid, `<DD>` note, empty folder), import (bar mapping;
importing again skips all), export → import round trip. **5,000 bookmarks in a 10.6 MB file: parse ~30 ms, import
~200 ms** (500 per transaction). `link-check.test.ts` (4): classification, cookies omitted with HEAD → GET, timeout,
≤ 4 at a time with progress and Cancel. Kotlin `BookmarkShortcutsTest` (6): web addresses only, letter (Latin, Urdu,
digit, host fallback), stable ids / colours / labels, the intent carries the address once and is never a VIEW, the icon
bitmap, a bad address refused.

Gate (Windows): `npm test` **1692 / 1692**, typecheck 0, lint **0 / 82**, `git diff --check` clean. Kotlin vidorax-web
**90 / 91** (the Windows-only `WebViewSnapshotsTest`); vidorax-media doesn't compile its tests on Windows (see B8).

### Device test list for Faran

- [ ] **Upgrade from 1.1.0 with 15 bookmarks:** all there, in the same order, in the root; the star still shows on
      those pages; History and other data unharmed
- [ ] Folders: create, nest, rename, move a folder and a bookmark, breadcrumbs back; delete a folder both ways
- [ ] Edit from a row and from the star on a bookmarked page; a bad address and a duplicate address show the message
- [ ] Reorder by dragging (also near the list's edges, auto-scroll) and with Move up / down; survives a restart
- [ ] Bookmarks bar on: strip under the address bar with the "Bookmarks bar" folder, scrolls sideways, hides with the
      address bar (auto-hide on), opens in the tab in front; off by default
- [ ] Bookmark all tabs with a start page among them: folder "Tabs <date>" without the start page
- [ ] Export, then import on a clean install: folders, order, dates, tags, notes kept; import a hand-made / real Chrome
      export (with icons) — added / skipped / invalid counts; importing it again adds nothing; 5,000 bookmarks stay
      responsive with progress
- [ ] Reading list from the menu and a link's long-press; Unread / Read; swipe both ways; remove
- [ ] Check links with a 404 page and a redirect (e.g. `http://github.com` → https): Not found and Moved + Use new
      address; Cancel mid-way; "Only on Wi-Fi" on mobile data refuses; no cookies sent (a logged-in site isn't seen as
      logged in — e.g. httpbin.org/cookies bookmarked)
- [ ] Tags and notes: chips filter, search finds a note word and a tag
- [ ] Add to home screen: the launcher's dialog; tap the shortcut with App Lock on → PIN first, then a new tab with the
      site; also when the app is already open; a launcher without pinning → the message
- [ ] Merged manifest unchanged (no new permission)
- [ ] Urdu (RTL: crumbs ‹, indents), Dark, TalkBack (row actions Move up / down, swipe alternatives), font scale 1.3
- [ ] The bars at `bottom={12}` (B1's Undo, B6's background tab, B13's site notice) don't overlap each other

### Handoff note

```
B9 Bookmarks — done
Commits: 5df4a25 (native), 5395365 (database), e97e25c (UI), <docs: this commit>
Native code to review: VidoraWeb canPinShortcuts / pinBookmarkShortcut / consumeShortcutUrl + event onShortcutOpen —
  shortcuts/BookmarkShortcuts.kt: ShortcutManager.requestPinShortcut (8+, no permission, no manifest change), letter
  icon, private action (not VIEW) carrying the address once. Test: BookmarkShortcutsTest.
Database: DATABASE_VERSION 2 -> 3 (bookmark_folders, bookmark_tags, reading_list; bookmarks.folder_id / note /
  position), via applyBrowserTables so B20's profile databases get it too; safe to run twice; old bookmarks keep order.
  Reading list is its own table (bookmarks.url is UNIQUE and your restore relies on it) — differs from the card's
  kind / readAt fields.
New settings: bookmarksBar = false, linkCheckWifiOnly = true
New libraries: none
Tested: unit, typecheck, lint. Device: pending Faran's final pass (upgrade test needed).
  Kotlin on Windows: vidorax-web 90/91 (WebViewSnapshotsTest), vidorax-media won't compile — please rerun on the Mac.
Hook for B17: bookmarkOrganizerRepository.setReadingOfflineCopy(id, uri).
Found, not fixed: B20's backup / export doesn't carry folders, tags, notes or the reading list (its format is yours);
  import skips an address bookmarked in another folder (addresses are unique); shortcut icon is a letter, not the
  site icon.
```

## B15 — Reader mode (#161, #172, #173)

Mega 3. No native code, no database change (`DATABASE_VERSION` stays 3), no permission. Two new libraries and one font
(below). Testing rule: unit tests, typecheck and lint here; device checks in "Device test list for Faran".

### How it works

- **Readability runs in the page.** The app's JS engine has no DOM, so Mozilla Readability's own source is vendored as
  string constants (`src/browser/reader/vendor/readability-source.ts`, written by
  `scripts/dev/generate-readability-source.mjs` from `node_modules/@mozilla/readability`; a unit test fails if the file
  isn't the generator's output for the installed version). `reader-scripts.ts` wraps it in a function (no page globals)
  and injects it into the tab in front with `injectJavaScript`; the scripts carry only a request number.
- **Detection (#161).** 700 ms after a page finishes loading (or its address changes without a load), the page runs
  `isProbablyReaderable` and answers `{ type: 'state', readerable }`. The answer is kept per tab with the address it was
  for (without `#fragment`), so the address bar's reader button (`ReaderButton`, next to the clear / spinner slot) and
  the menu's "Reader mode" item show only for that page. Pages with JavaScript off for their site never answer: no
  button there.
- **Extraction.** "Reader mode" runs `new Readability(document.cloneNode(true)).parse()` on a copy of the page (the page
  isn't changed) and answers title, byline, site name, language, direction and the article HTML (capped at 2,000,000
  characters; longer articles say so). Answers come on their own channel, `vidorax-reader` (an article is bigger than
  the browser-chrome channel's 50 KB cap); `BrowserWebView.handleMessage` offers each message to `readerMode` first (a
  string-prefix check, then the checked parser). Only the newest request of the same tab counts.
- **Sanitising (#161).** `reader-sanitize.ts`: a whitelist. `script`, `style`, `iframe`, `object`, `embed`, `svg`,
  `math`, `form` and its fields, `audio` / `video`, `noscript`, `template`, `canvas`, `head` and the like are dropped with
  everything inside; every attribute goes except a link's `href` and an image's `src` / `alt`, and those only when they
  are http(s) after removing control and space characters and decoding entities (so `java&#x09;script:` and
  `&#106;avascript:` are caught); other links become plain text. The result is then turned into blocks (paragraph,
  heading, list item, quote, code, picture, rule) — **the app never renders HTML**: `ReaderBlocks` draws them with the
  app's own `Text` / `View` / `expo-image`.
- **The reader** (`ReaderView`) is a full-screen window over the page, so Back (or ✕) closes it and the page is exactly
  where it was. Top: site, title, byline, "N min read" (220 words a minute; CJK by characters). Links close the reader
  and load in the same tab. Pictures can be turned off (Aa sheet) and are cached in memory only (`cachePolicy="memory"`),
  so they never outlive Clear browsing data or a private tab. Leaving the page (another tab or address) closes it.
- **Appearance (#172).** The Aa sheet: Follow app (default) / Light / Sepia / Dark (fixed palettes; every text, link and
  highlight colour at least 4.5:1, checked in a test), text size 14–32, Sans serif / Serif (system families, so bold and
  italic work), line spacing Compact / Normal / Wide, Show pictures. All remembered in the settings store (Backup, Reset
  and profiles carry them).
- **Urdu in Nastaliq (#172).** `isUrduText`: a page that says `ur` is Urdu; `ar` / `fa` / `ps` / `sd` / `ug` / `ku` /
  `ckb` aren't; otherwise (no language, or the `en` many Urdu templates leave in) Arabic script over half the letters
  and Urdu's own letters (ٹ ڈ ڑ ں ھ ہ ے ۓ) at least 2 % of it. Urdu articles read right to left and use the bundled
  **Noto Nastaliq Urdu** (`assets/fonts/NotoNastaliqUrdu-Regular.ttf`, OFL 1.1, licence file beside it), loaded with
  `expo-font` the first time it is needed (`src/browser/fonts/urdu-font.ts` — `loadNastaliqFont` / `useNastaliqFont`,
  shared with B16), with extra line height for Nastaliq.
- **Read aloud (#173).** `read-aloud.service.ts` over `expo-speech` (the phone's own text-to-speech): paragraph by
  paragraph (headings, paragraphs, list items, quotes; code and pictures skipped; paragraphs over 3,800 characters split
  at sentence ends), the paragraph being read highlighted and kept on screen, Play / Pause (Android can't pause speech:
  Pause stops and Play starts that paragraph again), Previous / Next paragraph, speed 0.75–2× (remembered). **Voices
  whose name says `network` are never picked**, so reading doesn't go online. An Urdu article with no Urdu voice on the
  phone shows a note with **Speech settings** (`Linking.sendIntent('com.android.settings.TTS_SETTINGS')`) and **Use
  default voice**. It stops when the app leaves the foreground, the reader closes, or the page changes.

### Files

- New: `src/browser/reader/` (`reader-scripts.ts`, `reader-article.ts`, `reader-sanitize.ts`, `reader-mode-state.ts`,
  `reader-mode.service.ts`, `read-aloud.ts`, `read-aloud.service.ts`, `reader-settings.ts`, `vendor/readability-source.ts`,
  `components/{ReaderView,ReaderBlocks,ReaderAppearanceSheet,ReaderButton}.tsx`), `src/browser/fonts/urdu-font.ts`,
  `scripts/dev/generate-readability-source.mjs`, `assets/fonts/NotoNastaliqUrdu-{Regular.ttf,OFL.txt}`, catalogs
  `browserReader.{en,ur}.ts`.
- Changed (additive): `BrowserWebView.tsx` (reader messages first in `handleMessage`), `AddressBar.tsx` (the button),
  `BrowserScreen.tsx` (`ReaderHost`), menu `types.ts` / `browser-menu-actions.ts` (`reader_mode`), settings store
  (types, state, partialize, merge), `browser-setting-keys.ts`, `browser-setting-choices.ts`, `en.ts` / `ur.ts`,
  `package.json` / `package-lock.json`.

### Tests

`reader.test.ts` and `reader-mode-state.test.ts` (41): the sanitiser (scripts / styles / frames / forms / SVG / media
dropped with contents, nested drops, all attributes and event handlers gone, ten `javascript:` / `data:` / `vbscript:` /
`file:` / `intent:` link tricks, relative links made absolute and escaped, image `src` rules, stray and unclosed tags,
`>` inside attribute values); blocks (headings, nested lists, quotes, `pre`, white space and `<br>`); the message parser
(bounds, types, other channels, oversize); Urdu detection (Urdu / Arabic / Persian / English, a wrong `en`); reading
time; **both page scripts in `node:vm`** (readerable / not, failure path answers instead of throwing, no page globals,
only a request number, both compile); the vendored file is current; read aloud (what is read, splitting, previous /
next, paragraph start, offline voice choice); settings (normalising, size steps, contrast of every palette); reader
state (stale and other-tab answers ignored, `#fragment` keeps the reader open, tab switch / new address closes it,
closed tabs dropped, late timeouts ignored). Real extraction on real pages needs a DOM, so it is on the device list.

### Decisions

- Readability runs inside the page (the only place with a DOM); the app keeps only a sanitised, re-built copy and draws
  it natively — no WebView, no HTML rendering, nothing from the page runs in the app.
- Its own message channel instead of raising the browser-chrome channel's 50 KB cap.
- Sans / Serif are the system families (`sans-serif` / `serif`), not the app's Inter, because the app loads Inter only in
  two weights and article text needs bold and italic.
- Speech: expo-speech has no "offline only" switch; skipping voices named `…network` is the available way.

### Found, not fixed

- The reader button needs JavaScript on for the site (Readability runs in the page).
- Reader pictures load through the app (`expo-image`, memory cache), not the WebView, so WebView image blocking doesn't
  reach them; B18 covers them separately (see B18).

### Device test list for Faran

- [ ] News article (e.g. a BBC / Dawn article): reader button in the address bar after load; not on a home page or
      search results; menu → Reader mode enabled only on the article
- [ ] Reader: title, author, site, "N min read"; pictures; tap a link → the reader closes and the link opens in the tab;
      Back → the page at the same scroll place
- [ ] Aa: Light / Sepia / Dark / Follow app (switch the app theme), text size − / +, Serif, line spacing, pictures off —
      close and reopen the reader and the app: all remembered
- [ ] Urdu article (e.g. BBC Urdu, Express Urdu): right to left, Nastaliq letters, bold headings readable, lines don't
      overlap at size 32 and line spacing Compact
- [ ] Read aloud (English): highlight moves paragraph by paragraph and stays on screen; Pause / Play; Previous / Next;
      speed 0.75 → 2×; airplane mode still reads (offline voice); press Home → it stops
- [ ] Read aloud (Urdu) without an Urdu voice → the note; Speech settings opens the phone's TTS settings; Use default
      voice reads. With an Urdu voice installed, the first read right after a cold start uses it
- [ ] Links inside paragraphs are tappable (paragraph text is selectable — check a tap isn't eaten by selection)
- [ ] A very long article (e.g. a long Wikipedia page): opens, scrolls smoothly, read aloud works
- [ ] A site with JavaScript off (B12 exception): no reader button
- [ ] TalkBack: reader button label, links announced as links, headers, Aa radio groups; font scale 1.3; Urdu UI (RTL)
- [ ] Merged manifest: expo-speech adds only `<queries>` for `android.intent.action.TTS_SERVICE`, no permission

### Handoff note

```
B15 Reader mode — done
Commits: 575d825 (reader), ec9ebef (fix: pure tested state, memory-only pictures), <docs: this commit>
Native code to review: none
Database: unchanged (DATABASE_VERSION 3)
New settings: readerTheme = 'app', readerFontSize = '18', readerFontFamily = 'sans', readerLineSpacing = 'normal',
  readerImages = true, readerSpeechRate = '1'
New libraries: @mozilla/readability 0.6.0 (Apache-2.0; 90 KB source, ~99 KB of strings in the JS bundle);
  expo-speech 57.0.3 (MIT; 141 KB installed; manifest gets <queries> TTS_SERVICE, no permission);
  font Noto Nastaliq Urdu (OFL 1.1, 690,304 bytes, assets/fonts, licence beside it)
Tested: unit, typecheck, lint. Device: pending Faran's final pass.
Hook for B16: src/browser/fonts/urdu-font.ts (NASTALIQ_FONT_ASSET, loadNastaliqFont).
Found, not fixed: reader needs JavaScript on for the site; reader pictures load through the app (B18 covers them).
```

## Lists kept for the owner

### Native changes for Faran to review

| Package | Change | Files |
| --- | --- | --- |
| B1 | `snapshotWebView(viewTag, maxWidth, key)`: finds the WebView by view tag (like `setWebViewActive`), draws it into a bitmap on the main thread (scroll offset applied), encodes JPEG q72 on a single background executor, writes `<cacheDir>/tab-previews/<key>.jpg` atomically (temp + rename). `key` must match `[A-Za-z0-9_-]{1,64}`. Kotlin test `WebViewSnapshotsTest` (Robolectric NATIVE graphics, added as a test-only dependency of vidorax-web, same 4.16.1 as vidorax-media) | `VidoraWeb.types.ts`, `VidoraWebModule.kt`, `snapshot/WebViewSnapshots.kt`, `build.gradle` |
| B6 | `getWebViewHistory(viewTag)` / `goBackOrForward(viewTag, steps)` (WebView back/forward list window, main thread); `setKeyCapture(volumeKeys, combos)` + event `onCapturedKey` — `VidoraKeyChannel`, asked first by **`MainActivity.dispatchKeyEvent`** (app module), takes keys only while JS listens and asked; `getNavigationMode()` (`Settings.Secure navigation_mode`); `prefetchDns(host)` (background `InetAddress`, ≤ 1 / min / host). Kotlin tests `KeyCaptureTest`, `WebHistoryWindowTest`, `NavigationModeTest`, `DnsPrefetcherTest` | `VidoraWeb.types.ts`, `VidoraWebModule.kt`, `keys/VidoraKeyChannel.kt`, `navigation/WebHistoryWindow.kt`, `navigation/NavigationMode.kt`, `network/DnsPrefetcher.kt`, `android/app/.../MainActivity.kt` |
| B8 | Hook listener `wrapSelectionMenu` (Faran's patch hook, unchanged): `SelectionMenuCallback` (an `ActionMode.Callback2`) delegates every call to Chromium's callback, removes Chromium's Web search (resource entry `select_action_menu_web_search`) and adds the items from `setSelectionMenu(ids, titles, readScript)`; a tap runs `readScript` with `evaluateJavascript`, finishes the menu in its callback and sends `onSelectionAction { viewTag, itemId, text }`. Items only while JS listens. Kotlin test `SelectionMenuTest` | `VidoraWeb.types.ts`, `VidoraWebModule.kt`, `selection/SelectionMenu.kt`, `selection/SelectionMenuCallback.kt` |
| B21 | `pickStartPageImage(maxSize)` / `clearStartPageImage()`: the system Photo Picker (`MediaStore.ACTION_PICK_IMAGES`, Android 13+ or 11–12 with SDK extension 2) else `ACTION_OPEN_DOCUMENT` `image/*` — no permission, no manifest change — launched through Expo's `RegisterActivityContracts`; the picked image is decoded (sampled), turned upright from EXIF, scaled to ≤ maxSize (480–2560) and written as JPEG 85 to `<filesDir>/start-page/background-<time>.jpg` (temp + rename; older files deleted). Kotlin test `StartPageImagesTest` | `VidoraWeb.types.ts`, `VidoraWebModule.kt`, `startpage/StartPageImages.kt`, `startpage/StartPagePhotoPicker.kt` |
| B3 | `getAppMemory()`: the app process's memory (`Debug.getMemoryInfo` summary: total PSS, Java heap, native heap, graphics) and the device's (`ActivityManager.getMemoryInfo`: available, total, low memory), kB; async (background queue), no permission. Kotlin test `AppMemoryTest` | `VidoraWeb.types.ts`, `VidoraWebModule.kt`, `memory/AppMemory.kt` |
| B9 | `canPinShortcuts()`, `pinBookmarkShortcut(url, title)`, `consumeShortcutUrl()` + event `onShortcutOpen`: `ShortcutManager.requestPinShortcut` (Android 8+, the launcher confirms; no permission, no manifest change); icon = first letter on a colour from the address; one id per address (SHA-1); the shortcut starts the launcher activity with a private action (`com.vidorax.web.action.OPEN_BOOKMARK_SHORTCUT`, not VIEW) and the address, handed to JS once (consumed flag). Kotlin test `BookmarkShortcutsTest` | `VidoraWeb.types.ts`, `VidoraWebModule.kt`, `shortcuts/BookmarkShortcuts.kt` |
| Reader mode (B15) | No reader button on sites with JavaScript off (Readability runs in the page) |

### New dependencies

| Package | Dependency | Licence | Size | Why |
| --- | --- | --- | --- | --- |
| B4 | `tldts` 7.4.18 (+ `tldts-core` 7.4.18, pinned with `overrides` so both are the same release) | MIT | 128 KB minified (`dist/index.cjs.min.js`, the Public Suffix List included); release APK +~0.4 MB with everything else in B4 | Registrable domain (eTLD+1) for the domain highlight, autocomplete and Sort by Site; bundled, no network |
| B15 | `@mozilla/readability` 0.6.0 | Apache-2.0 | 155 KB installed; `Readability.js` 90 KB + `Readability-readerable.js` 4 KB, carried as ~99 KB of strings in the JS bundle | Article detection and extraction, run inside the page (vendored by `scripts/dev/generate-readability-source.mjs`) |
| B15 | `expo-speech` 57.0.3 | MIT | 141 KB installed (small Kotlin module); merged manifest gets `<queries>` for `android.intent.action.TTS_SERVICE`, no permission | Read aloud with the phone's own text-to-speech |
| B15 | Noto Nastaliq Urdu (font, `assets/fonts/NotoNastaliqUrdu-Regular.ttf`, from google/fonts) | SIL OFL 1.1 (licence in `assets/fonts/NotoNastaliqUrdu-OFL.txt`) | 690,304 bytes (APK +~0.69 MB) | Urdu articles in Nastaliq (reader); B16's page font reuses the asset |

### New settings and defaults

| Setting (`SettingsState`) | Package | Default | Values |
| --- | --- | --- | --- |
| `tabSortOrder` | B1 | `manual` (today's order) | `manual`, `site`, `lastUsed`, `opened` |
| `searchEngine` | B5 | `google` | `google`, `bing`, `duckduckgo`, `yahoo`, `ecosia`, `brave` |
| `safeSearch` | B5 | `moderate` (no Google parameter = today's URL) | `off`, `moderate`, `strict` |
| `searchLanguage` | B5 | `default` (engine decides = today's) | `default`, `app`, `en`, `ur`, `ar`, `hi`, `fa`, `bn`, `tr`, `fr`, `de`, `es`, `zh` |
| `searchRegion` | B5 | `auto` (engine decides = today's) | `auto`, `pk`, `in`, `ae`, `sa`, `bd`, `gb`, `us`, `ca`, `au`, `de`, `tr` |
| `searchSuggestions` | B5 | `true` (today's) | on / off |
| `addressBarPosition` | B4 | `top` (today's) | `top`, `bottom` |
| `addressBarAutoHide` | B4 | `false` (today's) | on / off |
| `searchShortcuts` | B4 | `g` Google, `b` Bing, `d` DuckDuckGo, `w` Wikipedia | JSON list of `{ keyword, name, engine }` or `{ keyword, name, template }` (≤ 30 entries — Add turns off at 30 and says so; Backup refuses more than 16,000 characters) |
| `swipeNavigation` | B6 | `true` | on / off |
| `scrollSpeed` | B6 | `normal` | `slow`, `normal`, `fast` |
| `volumeKeyScroll` | B6 | `false` (today's) | on / off |
| `preloadPages` | B6 | `wifi` | `off`, `wifi`, `always` |
| `saveHistory` | B10 | `true` (today's) | on / off |
| `clearHistoryOnExit` | B10 | `false` (today's) | on / off |
| `homepageUrl` | B21 | `''` = the start page (today's) | an http(s) address (checked) |
| `startupOption` | B21 | `continue` (today's) | `continue`, `startPage`, `homepage` |
| `spellCheck` | B21 | `true` (today's) | on / off |
| `toolbarButtons` | B21 | `back,forward,home` (today's) | 1–6 of `back`, `forward`, `home`, `newTab`, `reload`, `share`, `bookmarks`, `history`, `downloads`, `searchSite` |
| `startPageBackground` | B21 | `theme` (today's) | `theme`, `color`, `gradient`, `photo` |
| `startPageBackgroundColor` | B21 | `night` | `night`, `forest`, `ocean`, `plum`, `rust`, `slate` |
| `startPageBackgroundGradient` | B21 | `dusk` | `dusk`, `lagoon`, `ember`, `aurora` |
| `startPageBackgroundPhoto` | B21 | `''` | `file://…/start-page/background-<time>.jpg` (only the app's own) |
| `tabSleepAfter` | B3 | `off` (today's) | `off`, `15m`, `30m`, `1h`, `3h` |
| `sitePermissions` | B13 | `'{}'` (no site) | JSON `{ site: { blocked: [location, camera, microphone, notifications], popupsAllowed, updatedAt } }`, ≤ 300 sites / 16,000 characters |
| `bookmarksBar` | B9 | `false` (today's) | on / off |
| `linkCheckWifiOnly` | B9 | `true` | on / off |
| `readerTheme` | B15 | `'app'` (follows the app) | app / light / sepia / dark |
| `readerFontSize` | B15 | `'18'` | 14, 16, 18, 20, 22, 24, 28, 32 |
| `readerFontFamily` | B15 | `'sans'` | sans / serif |
| `readerLineSpacing` | B15 | `'normal'` | compact / normal / wide |
| `readerImages` | B15 | `true` | on / off |
| `readerSpeechRate` | B15 | `'1'` | 0.75, 1, 1.25, 1.5, 2 |

### Found, not fixed

| Where | What |
| --- | --- |
| Browser tabs | A tab left while its page is still loading keeps the WebView's interim title (the URL) until it is shown again (seen after reopening several closed tabs in a row) |
| Browser, Back | Back on a tab's first page goes to the start page in that tab (so a restored tab can become a start page) — existing behaviour, noted because it changes what the switcher shows |
| ~~Address bar suggestions~~ | ~~Badges and lines are English in Urdu~~ — **fixed in B4** (with the security indicator, Reload / Stop and "Loading page") |
| History / Bookmarks screens | Relative times "6m ago" / "1h ago" are English in Urdu (B9/B10 change these screens) |
| ~~Address bar (all packages)~~ | ~~The suggestion list is drawn under the keyboard~~ — **fixed in B4** (the list is sized to the space above the keyboard) |
| Downloads card | "770.0 KB saved" and "100 percent complete" (accessibility) are English in Urdu (download screens are not in Hamza's packages) |
| Long-press Back (B6) | An entry whose load failed is listed with Chromium's own English error title ("Webpage not available") — it is a real history entry |
| Release builds | `http://` pages are refused (the app's network security config) — local `http` test fixtures need the debug build |
| Dev only | After a JS reload (debug), expo-image can fail to create its view ("The current activity is no longer available"); a cold start clears it. Not seen on release |
| Selection menu (B8) | Text selected inside an iframe isn't read (the read script runs in the main frame), so Search does nothing there |
| Kotlin tests on Windows | vidorax-web `WebViewSnapshotsTest.replacesAnOlderSnapshot` fails (`File.renameTo` over an existing file); vidorax-media's unit tests don't compile (a `DownloadRunnerTest` name has a double quote). Both pass on the Mac; not changed by any B package of Mega 1 |
| History search (existing) | `%` and `_` in a search act as wildcards (`LIKE` without `ESCAPE` in `HistoryRepository`): searching `100%` also lists `100 …`. Left as it is (existing code) |
| History visit count (B10 export) | History merges revisits of a URL within 5 minutes into one entry, so "Visits" in the export counts those entries, not every load |
| Clear browsing data (B10) | Clears the browser profile in use only (B20); other profiles keep theirs (the sheet says so) |
| Start page photo (B21) | Android 8–10 (and 11–12 without the photo picker's SDK extension) get the system document picker for images instead of the Photo Picker; no permission either way. The Google Play services backport of the Photo Picker needs a manifest `<service>` entry, not added |
| Spell check off (B21) | Whether a keyboard honours "no suggestions" is the keyboard's choice; unknown until tried on a device |
| Kotlin tests on Windows (B21) | Robolectric here has no `ExifInterface(InputStream)` and decodes any bytes as a placeholder image, so `StartPageImagesTest` injects the orientation and can't check a real non-image file |
| Find in page (B7) | Text inside iframes and closed shadow roots isn't searched (the script runs in the main document); a match across two paragraphs can be found as one (block boundaries aren't separators) |
| Find in page (B7) | On a site with JavaScript off (B12) nothing can be searched (the bar says so); on WebView < 105 only the current match is shown (as the selection) |
| Find in page (B7) | While the bar is open, the page's own scripts could observe the search text (native find doesn't expose it) — the cost of Match case / Whole word |
| Tab sound (B3) | Mute / volume don't reach sound made with the Web Audio API or players inside cross-origin frames (the script runs in the main document) |
| Memory monitor (B3) | The figure is the app process only; WebView's renderer process (where pages run) isn't counted |
| Site permissions (B13) | Requests from cross-origin frames aren't seen by the page script (WebView still refuses them: no permission); on WebView < 72 (no `navigator.userActivation`) pop-ups aren't blocked |
| Bookmarks (B9) | B20's backup / restore and export don't carry folders, tags, notes or the reading list (B20's format; Faran's) |
| Bookmarks import (B9) | An address already bookmarked in another folder is skipped (bookmark addresses are unique) |
| Bookmark shortcuts (B9) | The home-screen icon is a letter on a colour, not the site's icon |

### Decisions (all packages)

- Regression: per package only the quick release check (§3 step 6); the full R1–R16 runs once at §7.
- B4: components never call `getSearchEngine()` (or any other module-level getter) while rendering — the React
  Compiler keeps the first result; they subscribe to the setting (`useSearchEngineDefinition`).
- B4: the calculator row stays when "Address bar suggestions" is off (it reads no history); inline autocomplete is off
  with it.
- B4: deleting a search shortcut has no confirmation; "Restore default shortcuts" brings the defaults back.
- B6: the Long-press Back list comes from the WebView's own back/forward list (native), not a recording of events.
- B6: swipe navigation lives on the toolbar (gesture navigation owns the screen edges); page edges only with button
  navigation. Scroll speed controls Auto scroll and the Volume-key step (Android owns fling speed).
- B6: Volume keys are taken only while JS listens and asks; one key channel for B21's shortcuts.
- B6: Preload pages = DNS ahead + `rel="next"` prefetch, never a hidden page load; savers seam for B18.
- B4: user text inside Urdu sentences is wrapped in a first-strong isolate (`\u2068…\u2069`, as escapes, never raw
  characters), like the e-mail isolates already in `ur.ts`.
- B8: Copy and Share are Android's own selection-menu items (kept); the app adds Search and removes Chromium's Web
  search. The selection is read in the page only after an app item is tapped, and the menu closes after the answer.
- Mega 1 (B8, B10, B21, B7): the owner's testing rule — unit tests, typecheck and lint per package; device, release and
  upgrade tests are Faran's final pass (each package lists them under "Device test list for Faran").
- B10: tab previews are cleared for every time range (a cache). Menu → Exit appears only while "Clear history on
  exit" is on. "Save history" off also stops new recent searches. The site-data part of every clear is one hook,
  `bindSiteDataClearer`, left for B12.
- B21: Tabs and Menu stay in the address bar and are listed as locked in Customize toolbar; ordering with arrows (TalkBack,
  RTL). Startup options add one tab in front and keep every tab; a launch link always wins. A custom start page
  background uses a dark layer **and** the dark palette (`ThemeModeOverrideContext`). Keyboard shortcuts have no on/off
  setting; Esc is taken only while a browser panel is open.
- B7: an injected search instead of `findAllAsync` (which has no match case / whole word); highlights through the CSS
  Custom Highlight API (no DOM change); Unicode word boundaries for Urdu; only numbers come back, validated in the
  bridge parser. Back closes the bar through the existing Back owner, Esc through B21's `escapePanels`.
- Strings: each package has a top-level catalog group like B1–B6 (`browserSelection`, `browserHistory`,
  `browserStartup`, `browserFind`) rather than `browser.find.*`.
- B3: the speaker reuses B6's `media_state`; mute / volume wrap the page's media accessors so the page (and that report)
  keep seeing their own values. Tab sleeping defaults to Off (a sleeping tab reloads); it unmounts the second live
  WebView early. Hook `bindTabSleepShortener` for B18.
- B13: requests are answered in the page (document-start script), not natively — the native chrome client can't be
  hooked without a patch-script change. The allowed-pop-up list stays in the app; an allowed pop-up loads like any new
  window (same tab).
- B9: DATABASE_VERSION 3 through `applyBrowserTables` (app and profile databases). The reading list is its own table
  (`bookmarks.url` stays UNIQUE for B20's restore) instead of `kind = 'reading'` rows. The star on a bookmarked page
  opens Edit. Link check sends no cookies. Shortcut icons are letters.
- B15: Readability runs in the page and the app draws a sanitised, re-built copy with its own views (no HTML
  rendering); its own `vidorax-reader` channel (articles exceed the chrome channel's 50 KB cap); Sans / Serif are the
  system families (bold / italic); read aloud skips `…network` voices.
