# Work log — Faran · Browser packages (B20, B12)

Faran's share of the browser plan after the 70/30 split of 2026-10-31 (shared docs "VidoraX Browser — Faran's Work
(30%)" and "— Hamza's Work (70%)"). Development and testing only here; merges, release builds for Play and releases
are separate. Branch `faran/browser`, from `0e188aa` (B6 docs on `hamza/browser`); commits local only, never pushed.

## 0. Setup

- `hamza/browser`'s uncommitted B8 start (the selection-menu hook in the WebView patch) is parked on the local branch
  `hamza/b8-wip` (`d691d5d`), so Hamza continues B8 from there. `hamza/browser` itself is unchanged.
- node_modules: react-native-webview's sources restored from the npm tarball (sha512 equal to package-lock) and the
  patch re-applied, so the installed patch matches this branch's `scripts/patch-react-native-webview.js`.
- Emulator: a new AVD `VidoraX_Browser_F` (`emulator-5558`, the same Pixel 8 / API 35 config as Hamza's, fresh
  data, Play Store off), so Hamza's `VidoraX_Browser_H`, Faran's other `Pixel_8`, the owner's `VidoraX_Test2` and
  `VidoraX_Play_Shots` are never touched. WebView 124.0.6367.219 (supports `MULTI_PROFILE`).
- Seed for upgrade checks: 1.1.0 vc4 (`~/Downloads/VidoraX-Client-APK/VidoraX-1.1.0-vc4.apk`) set up through its UI —
  15 bookmarks, history from ~20 pages, 6 tabs (one in desktop mode), recent search "cats", one finished download
  (Big Buck Bunny 360p 1 MB), App Lock on (PIN 1357), Urdu — saved as this AVD's own snapshot `seeded110f`.
  (Seeding note: 1.1.0's browser menu scrolls; "Add bookmark" is below its first screen.)

## B20 — Profiles, guest mode, backup and restore, export, tab windows (#206, #207, #208, #209, #210, #16)

### Design and decisions

| # | Feature | What the user gets | Where |
| --- | --- | --- | --- |
| #206 | Multiple profiles | Browser settings → Profiles and guest mode: up to 5 profiles (the default one is "Personal" until renamed), each with its own colour and initials; add, rename, delete (not the one in use, never the default) | `src/browser/profiles/profile-registry.ts` (pure rules), `profile-service.ts`, `screens/settings/browser-settings/ProfilesSettingsSection.tsx`, `ProfileNameSheet.tsx` |
| #207 | Switch profile | Browser menu → "Profile: <name>" → a sheet of profiles, guest mode, Manage profiles; or a profile's options in Browser settings | `components/ProfileSwitcher/ProfileSwitcherHost.tsx`, `profile-switch` in `profile-service.ts` |
| #208 | Guest mode | Starts empty with default settings; a card on the start page says so and offers "Leave guest mode"; leaving (or the next cold start) deletes everything it kept. With App Lock on, leaving it locks the app first | `enterGuest` / `exitGuest`, `GuestModeCard.tsx` |
| #209 | Backup and restore | Browser settings → Back up and export: one JSON file (folder picker) with every profile's bookmarks, history, recent searches and browser settings plus the app settings; Restore adds a backup to what is there (nothing replaced or deleted), after a summary | `src/browser/data/data-backup.ts` (pure), `profiles/data-transfer.service.ts`, `storage/repositories/browser-profile-data.repository.ts`, `BrowserDataSection.tsx` |
| #210 | Export data | The profile's bookmarks as the Netscape bookmark file Chrome/Firefox/Edge import, and its history as CSV (UTF-8 BOM, formula-safe), both into one picked folder | `data/netscape-bookmarks.ts`, `data/history-csv.ts`, `exportTextFiles` |
| #16 | Move tab to new window | Browser menu → Move to new window: the tab opens in a window of its own (next to the app in split screen), in its profile, with back / forward / reload, its title and address, Move to main window and Close; links and downloads it doesn't show go to the main window | native `window/BrowserWindowActivity.kt`; `profiles/browser-window.service.ts` |

What a profile keeps apart (`src/storage/profile/active-profile.ts`):

- **SQLite.** The default profile keeps history, bookmarks, recent searches and recent URLs in the app database
  `vidorax.db`, exactly where 1.1.0 has them, so an upgrade moves nothing. Every other profile has
  `vidorax-profile-<id>.db` with only those tables (`storage/sqlite/browser-database.ts`); the four browser
  repositories use `getBrowserDatabase()` instead of `getDatabase()`. Downloads, the library and favorites stay in the
  app database for every profile. The browser tables are now created by `applyBrowserTables` (shared by both kinds of
  database): a later package that changes them adds an idempotent step there.
- **MMKV.** Open tabs, closed tabs and the old single-page session (scroll positions) use `<key>@<id>` for other
  profiles (`profileScopedKey`); a debounced write keeps the key of the profile it was scheduled in. Tab previews of
  other profiles are `pf-<id>-<tabId>.jpg`, so each profile prunes and clears only its own.
- **Browser settings** (`BROWSER_SETTING_KEYS`): the store holds the active profile's; a switch saves them to
  `browserProfileSettings.v1@<id>` in Settings Backup's format and loads the next profile's through Backup's validation
  (`profile-settings-format.ts`); a new profile or guest starts from the defaults. App settings (theme, language,
  downloads, App Lock) are shared.
- **Cookies, site storage, cache, service workers.** WebView profiles (`androidx.webkit` `ProfileStore`, already in
  the APK through react-native-webview, 1.14.0): `Default` for the default profile, `vidorax-<id>` for the others.
  A WebView's profile can only be set before it is used, so the patch gains `RNCWebViewHooks.beforeWebViewSetup`
  (first line of `createViewInstance`), where `WebProfiles.apply` sets it; JS tells the native side before it mounts
  the new profile's tabs. Downloads read the active profile's jar (`vidorax-media` `ActiveWebCookies`, set by
  `setCookieProfile`), as do `startSystemDownload` and the flush on background. Without `MULTI_PROFILE` (old WebView)
  profiles share the default jar and Browser settings says so.

Switch order (`performSwitch`): flush the leaving profile's tabs and session → save its browser settings →
`setWebProfile` + `setCookieProfile` → `setActiveProfileId` (module caches reset through `subscribeActiveProfile`) →
load the new profile's settings → hydrate its tabs into the browser store → reset and reload history, bookmarks and
recent searches. One change at a time (`switching`).

Decisions:

- **Default profile = today's data.** No migration, nothing copied: the riskiest part of a profile split (moving 1.1.0
  users' data) doesn't exist.
- **Guest mode is the browser's.** Downloads and the library stay visible in the app; the guest confirmation says so,
  and with App Lock on leaving guest mode asks for the PIN. Backup, restore and export are hidden in guest mode (a
  backup holds every profile), and so is profile management.
- **Backup content.** Bookmarks, history (newest 20,000 per profile), recent searches, browser settings per profile,
  app settings. Not open tabs, downloads or the library, App Lock, or cookies/site logins (WebView doesn't export
  them, and a file with logins would be a risk). Restore merges (bookmark by address, visit by address + time,
  search by text) and never deletes. A backup profile goes to the same id, else to a profile of the same name, else a
  new profile while there is room (5).
- **Untrusted files.** `parseBackup` parses, never evaluates: format and version, profile ids and names by the
  profile list's own rules (guest and invalid ids dropped), http/https addresses only (≤ 4,096 characters), dates
  1995–tomorrow, text cut and stripped of control and direction-override characters, counts capped. Settings go
  through Settings Backup's validation. Import is capped at 30 MB.
- **Window.** A small native browser, not a second React Native screen: the same safety settings as the browser
  (mixed content never, no file or content access, no geolocation), one tab per window (`window.open` loads in place),
  its renderer crashing never takes the app down (the tab returns to the main window). It has no video detection,
  file upload or fullscreen video: those stay in the main window, one tap away. With App Lock on, a window the user
  leaves closes and its tab goes back behind the current tab, so nothing shows without the PIN.
- **No new permissions, no new library.**

### Files

Native (`B20: native …` commit):
`scripts/patch-react-native-webview.js` (+ test) — `beforeWebViewSetup` hook;
`modules/vidorax-web/android/src/main/java/com/vidorax/web/profiles/{WebProfileNames,WebProfiles}.kt`,
`network/ServiceWorkerRequests.kt` (a client per profile), `window/{BrowserWindowActivity,BrowserWindowRequest,
BrowserWindowRecord,BrowserWindows,WindowUrlPolicy}.kt`, `VidoraWebModule.kt` (`isWebProfileSupported`,
`setWebProfile`, `deleteWebProfile`, `openBrowserWindow`, `closeBrowserWindows`, `onBrowserWindow`),
`android/src/main/AndroidManifest.xml` (the window activity, not exported), `res/drawable/vx_window_*.xml`,
`build.gradle` (androidx.webkit 1.14.0, already in the APK); `modules/vidorax-media/.../net/ActiveWebCookies.kt`,
`SessionCookies.kt`, `analyze/PageFetcher.kt`, `VidoraMediaModule.kt` (`setCookieProfile`), `build.gradle`;
contracts `VidoraWeb.types.ts`, `VidoraMedia.types.ts`; Kotlin tests `WebProfileNamesTest`, `WindowUrlPolicyTest`,
`BrowserWindowRequestTest`.

JS: `src/storage/profile/active-profile.ts`, `src/storage/sqlite/{browser-database,schema}.ts`,
`src/storage/repositories/{browser-profile-data.repository,history,bookmark,recent-search,recent-url}.repository.ts`,
`src/storage/constants/mmkv-keys.ts`; `src/browser/profiles/{profile-registry,profile-service,profile-settings,
profile-settings-format,profile-feedback,use-profile-actions,data-transfer.service,browser-window.service}.ts`;
`src/browser/data/{data-backup,netscape-bookmarks,history-csv}.ts`; `src/browser/tabs/{tab-persistence.service,
closed-tabs.service,tab-snapshots}.ts`, `src/browser/session/session-persistence.service.ts`,
`src/browser/stores/browserStore/{state,actions,types}.ts` (`hydrateBrowserState`, `closeTab(…, { record: false })`);
`src/browser/components/ProfileSwitcher/*`, `BrowserOverflowMenu/{browser-menu-actions,types}.ts`,
`BrowserHome/BrowserHomeView.tsx`, `BrowserScreen.tsx`; `src/screens/settings/browser-settings/{Profiles
SettingsSection,ProfileNameSheet,BrowserDataSection,BrowserSettingsScreen}.tsx`,
`src/screens/settings/backup-reset/useSettingsBackupReset.ts` (`importSettingsValues`);
`src/utils/text-file-export{,-core}.ts` (`exportTextFiles`, import `maxBytes`); `src/bootstrap/app-initializer.ts`;
catalogs `browserProfiles.{en,ur}.ts`.

### Automated tests

| Suite | What it proves |
| --- | --- |
| `profiles/profile-registry.test.ts` (12) | Default first and never lost; guest, invalid ids, duplicates (case-insensitive) and nameless profiles dropped; colours repaired; at most 5; invisible / direction-override characters stripped; name checks (empty, > 30, taken — the default by its shown name, Urdu); colour and id choice; initials (Urdu too) |
| `data/data-backup.test.ts` (5) | Round trip; not JSON / wrong format / newer / fractional version refused; a hostile file (javascript: / file: links, an over-long URL, a guest and a `../etc` profile, a future visit, blank searches, nested and huge settings, a bidi-override title) keeps only the valid parts; per-profile caps; BOM |
| `data/export-formats.test.ts` (3) | Netscape file: one folder, HTML-escaped titles and addresses, no `javascript:` entries, ADD_DATE seconds; CSV: BOM, CRLF, quoting, `'` before = + - @ |
| `profiles/profile-settings-format.test.ts` (3) | Only browser settings; defaults for a profile without a copy; a saved copy returns; an unknown engine, a wrong type or broken text fall back to defaults |
| `utils/text-file-export-files.test.ts` (5) | Several files into one picked folder; cancel writes nothing; no folder for several files fails rather than sharing half; one file still falls back to sharing; the import size limit |
| `localization/catalog-parity.test.ts` (+1) | Placeholders use single braces (`{name}`); a device test caught `{{name}}` showing braces |
| Kotlin `WebProfileNamesTest` (3), `WindowUrlPolicyTest` (4), `BrowserWindowRequestTest` (5) | Only `Default` and `vidorax-<id>` profiles; the window keeps web pages, hands other schemes to the app and never follows script / local URLs; requests with a bad id, page or profile refused; an unsafe User-Agent dropped; colours parsed with fallbacks; labels trimmed, cut and never empty |
| `patch-react-native-webview.test.mjs` | `beforeWebViewSetup` is the first call in `createViewInstance` and in the Listener |

### Manual cases (AVD `VidoraX_Browser_F`, API 35, WebView 124; release builds signed as for Play, Urdu unless noted)

| # | Case | Build | Result | Evidence |
| --- | --- | --- | --- | --- |
| 1 | Upgrade 1.1.0 → B20 (`adb install -r` over snapshot `seeded110f`) | release r2/r4 | PASS | PIN 1357 asked and unlocks; Urdu; all 6 tabs, the archive.org tab still in desktop mode; 15 bookmarks; history (~40 entries); "cats" offered from history; the finished download; menu shows "پروفائل: ذاتی" |
| 2 | Profiles section, Urdu RTL | release | PASS | Avatar ذ on blue, "استعمال میں", Add profile, Start guest mode; explanation text; Back up and export section below |
| 3 | Create "Work"; a second "work" | release | PASS | Created with green W; "work" refused: "یہ نام کسی اور پروفائل کا ہے۔" (case-insensitive); the sheet sits above the keyboard |
| 4 | Switch to Work (switcher and Browser settings) | release | PASS | 1 empty tab, no bookmarks, "Profile: Work", toast; back to Personal: its 6 tabs |
| 5 | Cookies apart | release | PASS | Work: httpbin `vx=work`; Personal: `{}`; Work again: `vx=work` (survives the round trip) |
| 6 | Browser settings apart | release | PASS | Work → DuckDuckGo; Personal still Google; Work still DuckDuckGo after switching back |
| 7 | Guest mode start | release | PASS | Confirmation (with the App Lock note), empty tab, guest card "آپ مہمان کے طور پر براؤز کر رہے ہیں" + Leave; guest history empty; httpbin shows only the guest's cookie |
| 8 | Leave guest mode with App Lock on | release | PASS | Lock screen first; PIN → Personal with its 6 tabs; Personal's httpbin still `{}` |
| 9 | A second guest session starts empty | release r2 → **FAIL**, r3 PASS | PASS | r2: the next guest still had `vx=guest` (WebView hadn't finished deleting the ended profile before the same name was reused). Fix: a new WebView profile per guest session + a sweep of orphans; r3: `{}` |
| 10 | App killed in guest mode | release r3 | PASS | Force-stop in guest → next start (PIN) in Personal; a new guest: history 0, cookies `{}` |
| 11 | Back up browser data | release r4 | PASS | Folder picker → `vidorax-backup-2026-11-03.json` (9 KB): 2 profiles, Personal 15 bookmarks / 40 history / 1 search, Work 1 bookmark, 27 app settings (language `ur`), no App Lock keys |
| 12 | Export data | release r4 | PASS | One folder, two files: Netscape file with the 15 bookmarks in "VidoraX — ذاتی"; CSV with BOM, Urdu headers, 40 rows |
| 13 | Restore into a fresh install | release r4 | PASS | Confirmation "Made on 3 November 2026. Profiles: 2. Bookmarks: 16. History entries: 41."; after: Work back (green), Urdu applied, toast "Bookmarks added: 16. History entries added: 41. Settings changed: 1." |
| 14 | Restore the same file again | release r4 | PASS | "Bookmarks added: 0 … 0 … 0" — no duplicates, no second Work |
| 15 | Delete Work, create Work again | release r4 | PASS | Confirmation names the profile; gone from the list; the new Work has no bookmarks |
| 16 | Download inside Work | release r4 | PASS | Big Buck Bunny MP4 → "ویڈیو دستیاب" → download completed (the engine reads Work's cookie jar) |
| 17 | Move tab to new window | debug + release | PASS | Opens next to the app in split screen; the tab leaves the main window; toolbar Back / Forward / Reload / title + host / Move to main window / Close |
| 18 | Link, Back, Close inside the window | debug | PASS | "Learn more" → iana.org stays in the window, Back returns; Close → "Reopen closed tab" brings it back; the iana.org visit is in history |
| 19 | Move to main window | debug | PASS | In front, in the empty start tab the move left (1 tab, not 2) — after a fix (it first opened a second tab) |
| 20 | Window with App Lock on, user presses Home | debug | PASS | The window closes; after the PIN its tab is in the main window behind the current tab |
| 21 | Window in Urdu, dark theme | release r4 | PASS | Toolbar mirrored (Close at the left, arrows flipped), dark colours, Urdu labels |
| 22 | Dark theme + font scale 1.3 (Profiles section, switcher) | release r4 | PASS | Nothing cut off; rows grow |
| 23 | Accessibility labels | release | PASS | Every control has an Urdu label in the accessibility tree: profile rows ("ذاتی، استعمال میں", options hint), switcher rows, guest card, window buttons; touch targets ≥ 48 dp (rows 56). (Checked through the accessibility tree, not with TalkBack speaking.) |
| 24 | Permissions and size | release r4 | PASS | 37 permissions, identical to 1.1.0 vc4; release APK 50,605,263 bytes (B6: 50,418,610; +187 KB) |

Also found while testing (fixed): the new catalogs used `{{name}}` while `translate()` replaces `{name}` (names showed in braces) — now a catalog test refuses double braces; my Urdu used "بُک مارک" where the app says "بک مارک".

### Quick release check

Gate on the final head: `npm test` 1,574 / 1,574, `npm run typecheck` clean, `npm run lint` 0 errors (82 warnings, unchanged), vidorax-media 971 / 0, vidorax-web 64 / 0 (12 new), patch test 5 / 5, `git diff --check` clean. Release r4 installed fresh and over 1.1.0; no crash or ANR in the log. Full regression R1–R16 stays with the final testing before a release (`docs/work-plans/hamza-browser-prompt.md` §4).

### Found, not fixed

- 1.1.0's History screen shows "TODAY" and "5m ago" in English in the Urdu app (older code, not B20).
- A restore that changes the language shows its result in the language it started in.
- A download still running when the user switches profiles uses the new profile's cookie jar for its later requests (rare; documented in `ActiveWebCookies`).
- The window has no video detection, file upload or fullscreen video; those stay in the main window.
