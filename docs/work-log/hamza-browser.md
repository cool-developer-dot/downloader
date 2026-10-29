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


## Lists kept for the owner

### Native changes for Faran to review

| Package | Change | Files |
| --- | --- | --- |
| B1 | `snapshotWebView(viewTag, maxWidth, key)`: finds the WebView by view tag (like `setWebViewActive`), draws it into a bitmap on the main thread (scroll offset applied), encodes JPEG q72 on a single background executor, writes `<cacheDir>/tab-previews/<key>.jpg` atomically (temp + rename). `key` must match `[A-Za-z0-9_-]{1,64}`. Kotlin test `WebViewSnapshotsTest` (Robolectric NATIVE graphics, added as a test-only dependency of vidorax-web, same 4.16.1 as vidorax-media) | `VidoraWeb.types.ts`, `VidoraWebModule.kt`, `snapshot/WebViewSnapshots.kt`, `build.gradle` |

### New dependencies

| Package | Dependency | Licence | Size | Why |
| --- | --- | --- | --- | --- |
| B4 | `tldts` 7.4.18 (+ `tldts-core` 7.4.18, pinned with `overrides` so both are the same release) | MIT | 128 KB minified (`dist/index.cjs.min.js`, the Public Suffix List included); release APK +~0.4 MB with everything else in B4 | Registrable domain (eTLD+1) for the domain highlight, autocomplete and Sort by Site; bundled, no network |

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

### Found, not fixed

| Where | What |
| --- | --- |
| Browser tabs | A tab left while its page is still loading keeps the WebView's interim title (the URL) until it is shown again (seen after reopening several closed tabs in a row) |
| Browser, Back | Back on a tab's first page goes to the start page in that tab (so a restored tab can become a start page) — existing behaviour, noted because it changes what the switcher shows |
| ~~Address bar suggestions~~ | ~~Badges and lines are English in Urdu~~ — **fixed in B4** (with the security indicator, Reload / Stop and "Loading page") |
| History / Bookmarks screens | Relative times "6m ago" / "1h ago" are English in Urdu (B9/B10 change these screens) |
| ~~Address bar (all packages)~~ | ~~The suggestion list is drawn under the keyboard~~ — **fixed in B4** (the list is sized to the space above the keyboard) |
| Downloads card | "770.0 KB saved" and "100 percent complete" (accessibility) are English in Urdu (download screens are not in Hamza's packages) |
| Dev only | After a JS reload (debug), expo-image can fail to create its view ("The current activity is no longer available"); a cold start clears it. Not seen on release |

### Decisions (all packages)

- Regression: per package only the quick release check (§3 step 6); the full R1–R16 runs once at §7.
- B4: components never call `getSearchEngine()` (or any other module-level getter) while rendering — the React
  Compiler keeps the first result; they subscribe to the setting (`useSearchEngineDefinition`).
- B4: the calculator row stays when "Address bar suggestions" is off (it reads no history); inline autocomplete is off
  with it.
- B4: deleting a search shortcut has no confirmation; "Restore default shortcuts" brings the defaults back.
- B4: user text inside Urdu sentences is wrapped in a first-strong isolate (`\u2068…\u2069`, as escapes, never raw
  characters), like the e-mail isolates already in `ur.ts`.
