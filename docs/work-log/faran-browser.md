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

## B12 — Privacy controls (#112, #113, #115, #124, #125, #126, #130, #135)

### Design and decisions

| # | Feature | What the user gets | Where |
| --- | --- | --- | --- |
| #112 / #113 | Cookies | Browser settings → Privacy and security → Cookies: Allow all / **Block third-party cookies** (default) / Block all. Third-party is the WebView prop (`thirdPartyCookiesEnabled` only for Allow all); Block all turns the profile's jar off natively (`setCookiesEnabled`, re-applied at start, on change and after every profile switch — WebView keeps it only while the app runs) | `src/browser/privacy/privacy-settings.ts`, `privacy.service.ts`, native `privacy/SitePrivacy.kt` |
| #115 | Do Not Track | Off by default. On: `DNT: 1` and `Sec-GPC: 1` on the pages the browser opens itself, and `navigator.doNotTrack` / `globalPrivacyControl` for the page (a script that defines two read-only values and nothing else) | `privacy-page-script.ts`, `BrowserWebView.tsx` |
| #124 | HTTPS-only mode | With the switch on, an http page opens over https (typed, restored, reloaded and links); a site with no secure version gets "No secure version of this site" with **Open unsecured this once** (that host stays allowed until the app closes). Local and intranet hosts are left alone. A **release build can't open http at all** (no cleartext in the manifest — a product decision, HANDOFF §4.17): there the switch shows "Always on", every http address is tried over https, and a failure says so without an unsecured button | `https-upgrade.ts` (pure), `privacy.service.ts`, `useTabScopedBrowserEngine.ts`, `useBrowserEngineEvents.ts`, `BrowserErrorView.tsx` |
| #125 | Certificate / site information | Tapping the lock opens the site sheet: secure or not, the certificate (issued to, issued by, valid from–until, SHA-256 fingerprint in byte groups), cookies, stored data, JavaScript for this site, Clear site data, Privacy settings. A page whose certificate failed, or that has no secure version, shows the open lock and "Connection isn't secure" | `components/SiteInfo/SiteInfoHost.tsx`, `SecurityIndicator.tsx`, native `SitePrivacy.certificate` |
| #126 | Insecure page warning | On a page opened over plain http: a notice at the top ("Anything you type or send here can be seen by others"), dismissed per site until the app closes. Setting on by default; hidden in a release build, where no http page can open | `components/SiteInfo/InsecurePageBar.tsx` |
| #130 | Site data | Browser settings → Site data: the sites that keep storage in this profile, largest first, with size; clear one or all (all also removes every cookie). The site sheet clears one site (both schemes) | `PrivacySettingsSection.tsx`, native `listOrigins` / `clearOrigin` / `clearAll` |
| #135 | JavaScript per site | A global switch plus per-site exceptions (from the site sheet; listed and removable in Browser settings). The WebView prop follows the tab's site; when the next page's site has the other setting, the navigation guard cancels it and loads it again after the WebView switched | `privacy-settings.ts`, `BrowserWebView.tsx`, `useBrowserEngineEvents.ts` |

Settings: six new `BROWSER_SETTING_KEYS` (`cookiePolicy`, `doNotTrack`, `httpsOnly`, `insecurePageWarning`,
`javaScript`, `javaScriptExceptions`), so each profile (B20) keeps its own and Settings Backup validates them
(`cookiePolicy` choices; the exception list up to 200 hosts / 16,000 characters). The settings store merge accepts only
the right types, so 1.1.0 data starts from the defaults.

How HTTPS upgrades are told apart from other failures (`privacy.service.ts`): every upgrade is noted per host (where it
came from, when, how many in a row). A failure of that https page within 90 s is "no secure version". The note is
cleared 1.5 s after the page's load end, because react-native-webview on Android reports a failed load's end *just
before* its error (`RNCWebViewClient` "simulates" the iOS order) — clearing at once made every failure look generic.
An https page that sends the browser straight back to the http address it came from, or upgrades of one host three times
without a page loading, is a loop: "no secure version" instead of upgrading again. An http link to another page of the
same host is simply upgraded.

Not changed: `webview-configuration.ts` (mixed content, file access, incognito), the download rules, the cleartext
policy. No new permission. The injected DNT script gives the page two constants and reads nothing.

### Files

Native (`B12: native …` commit): `modules/vidorax-web/android/src/main/java/com/vidorax/web/privacy/
{SiteDataRules,SitePrivacy}.kt` (cookies on/off, certificate with SHA-256, site storage list / clear with
`WebStorageCompat.deleteBrowsingData(ForSite)` where WebView has `DELETE_BROWSING_DATA`, cookie count),
`VidoraWebModule.kt` (`setCookiesEnabled`, `getCertificate`, `listSiteData`, `clearSiteData`, `clearAllSiteData`,
`getCookieCount`, `isCleartextAllowed`), contract `VidoraWeb.types.ts` (`PageCertificate`, `SiteDataEntry`); Kotlin
test `SiteDataRulesTest`.

JS: `src/browser/privacy/{privacy-settings,https-upgrade,privacy-page-script,privacy.service,format-bytes}.ts`;
`src/store/settings/{types,state,index}.ts`, `src/browser/settings/{browser-setting-keys,browser-setting-choices}.ts`;
`src/browser/hooks/{useTabScopedBrowserEngine,useBrowserEngineEvents}.ts`, `src/browser/types/navigation.types.ts`
(`https_unavailable`, `https_required`), `src/browser/utils/errors.ts`; `src/browser/components/BrowserContainer/
BrowserWebView.tsx`, `BrowserErrorView/BrowserErrorView.tsx`, `BrowserHeader/SecurityIndicator.tsx` (a button now),
`SiteInfo/{site-info-requests,SiteInfoHost,InsecurePageBar}.tsx`, `BrowserScreen.tsx`;
`src/screens/settings/browser-settings/{PrivacySettingsSection,BrowserSettingsScreen}.tsx`;
`src/bootstrap/app-initializer.ts` (`ensurePrivacyControls`); catalogs `browserPrivacy.{en,ur}.ts`, `en.ts` / `ur.ts`
(`browser.errors.https_unavailable`, `https_required`; the certificate error page now says what happened).

For Hamza: B11 (incognito) can call `clearAllSiteData()` and B19 (security panel) `getPageCertificate(tabId)` from
`privacy.service.ts`.

### Automated tests

| Suite | What it proves |
| --- | --- |
| `browser/privacy/privacy.test.ts` (14) | Cookie policy default and fallback; site keys (no `www`, web pages only); exceptions flip the default, add / remove relative to it, parsed defensively (bad hosts, duplicates, over-long, more than 200); HTTPS upgrade (port 80 dropped, other ports kept), what is left alone (allowed, local, intranet, IP, `[::1]`); the policy (secure-only without cleartext, else the switch); secure-only upgrades local and let-through hosts too; redirect back to the same address and 3 in a row → no secure version, another page of the host → upgrade; which errors count as security failures; the DNT script defines exactly two values, works without `Navigator`, contains no bridge / network call; storage sizes |
| Kotlin `SiteDataRulesTest` (4) | Web origins only (WebStorage's trailing `/` accepted, then removed); cookie names parsed, invalid skipped; expiry headers for the host and each parent domain; numeric hosts |

### Manual cases (AVD `VidoraX_Browser_F`, API 35, WebView 124; release builds signed as for Play unless noted)

| # | Case | Build | Result | Evidence |
| --- | --- | --- | --- | --- |
| 1 | Privacy section, Urdu RTL dark | release r5 | PASS | Cookies row with the choice, Do Not Track, HTTPS-only, warning, JavaScript, exceptions ("کوئی نہیں…"), Site data; above Profiles |
| 2 | Do Not Track | release r5 | PASS | httpbin `/headers`: `Dnt: 1`, `Sec-Gpc: 1` |
| 3 | Block third-party cookies (default) | release r6 | PASS | `tp` (SameSite=None) set on httpbin first-party; iframetester.com framing `httpbin.org/cookies`: `{}` |
| 4 | Allow all cookies | release r6 | PASS | Same frame after reload: `{"tp": "1"}` |
| 5 | Block all cookies | release r6 | PASS (see found-not-fixed) | httpbin receives no `Cookie` header and `/cookies` is `{}`; back on Block third-party, the earlier cookies are sent again |
| 6 | Each profile keeps its own privacy settings | release r6 | PASS | Work → Block third-party while Personal stayed on Block all; Personal's jar started without Work's httpbin cookies |
| 7 | Site sheet on an https page (Urdu) | release r5 → r8 | PASS after fixes | Issued to / by, validity, SHA-256, cookies, storage, JS switch, two buttons. Fixed: the validity range read in the wrong order in Urdu (now "… سے … تک") and the fingerprint wrapped mid-group (now byte groups) |
| 8 | Clear site data from the sheet | release r5 | PASS | httpbin cookie count 1 → 0 after the confirmation; reload shows `{}` |
| 9 | Release: http address typed | release r6 → r7 | PASS after fix | `http://example.com` opens `https://example.com`; neverssl.com, an http-only local server and `http://expired.badssl.com` show "اس سائٹ کا محفوظ ورژن نہیں" with Home only. r6 showed the generic or certificate page (the load-end-before-error order, fixed in r7) |
| 10 | Release: restored http tab | release r6 | PASS | A tab left on an http address reopens on "No secure version" instead of "Something went wrong" |
| 11 | Release: HTTPS-only row | release r6 | PASS | Shown on and locked, "Always on: …"; the insecure warning row hidden |
| 12 | https page redirecting to http on the same host | release r8 | PASS | `httpbin.org/redirect-to?url=http://httpbin.org/get` ends on `https://httpbin.org/get` (r7 wrongly stopped it) |
| 13 | Redirect loop (three https → http hops) | release r8 | PASS | Stops on "No secure version", lock open |
| 14 | Certificate error page | release r7 | PASS | `self-signed.badssl.com`: "کنکشن محفوظ نہیں" page, the lock reads "not secure" (it said "secure HTTPS" before), the sheet says "Connection isn't secure" |
| 15 | JavaScript per site | release r6 | PASS | whatismybrowser "Is JavaScript enabled?": Yes → switch off in the sheet → page reloads → No; listed in Browser settings as "JavaScript off", removed with ✕ |
| 16 | Video detection with third-party cookies blocked | release r7 | PASS | w3schools HTML5 video → "ویڈیو دستیاب" |
| 17 | Site data list and clear | release r9 → r10 | PASS after fix (see found-not-fixed) | r8 listed nothing (WebStorage reports `https://host/`, the filter wanted no slash). r10: squoosh.app 485 KB first; clearing a site / all removes cookies, localStorage and IndexedDB; empty origins hidden |
| 18 | English | release r10 | PASS | Site sheet, Privacy section, error pages read naturally |
| 19 | Font scale 1.3, dark | release r10 | PASS | Site sheet and Privacy rows wrap, nothing cut off |
| 20 | Block all in the site sheet | release r10 | PASS | "Blocked: none are sent (1 kept)" instead of "In use: 1" |
| 21 | Debug build (cleartext allowed): http page | debug | PASS after fix | Opens over http with the warning bar; Dismiss hides it at once (it first stayed until the next page: React Compiler kept the old render — the dismissed state is now read in render) and it stays hidden for that host |
| 22 | Debug: HTTPS-only on | debug | PASS | A normal switch with its own hint; the http-only fixture → "No secure version" + Go home + **Open unsecured this once** → the plain page with the bar; `http://example.com` still upgraded |
| 23 | Accessibility labels | release | PASS | Lock "Secure HTTPS connection. Site information" / "Not a secure connection…"; switches named; "Clear <site>'s data", "Remove <site> from the list"; the bar's Dismiss; targets ≥ 48 dp (checked in the accessibility tree) |
| 24 | Permissions and size | release r10 | PASS | 37 permissions, identical to 1.1.0 vc4; APK 50,658,051 bytes (B20 r4: 50,605,263; +53 KB) |
| 25 | Upgrade 1.1.0 → B12 (`adb install -r` over snapshot `seeded110f`) | release r11 | PASS | PIN 1357, Urdu, 6 tabs (archive.org); Privacy starts at the defaults: Block third-party, Do Not Track off, HTTPS-only locked on, JavaScript on; the site sheet shows archive.org's certificate; no crash or ANR in the log |

Also found while testing (fixed): the Urdu catalog's raw direction marks (now `\u` escapes, checked); the site data
list was empty (trailing `/`); every upgrade failure looked generic (load end before error); a same-host http link was
treated as a loop; the lock said "secure" on a certificate error page; the warning bar stayed after Dismiss.

### Quick release check

Gate on the final head: `npm test` 1,588 / 1,588, `npm run typecheck` clean, `npm run lint` 0 errors (82 warnings,
unchanged), vidorax-media 971 / 0, vidorax-web 68 / 0 (SiteDataRulesTest new), patch test 5 / 5, `git diff --check`
clean. Release r11 installed over
1.1.0 and r5–r10 over each other; debug build for the cleartext paths. Full regression R1–R16 stays with the final
testing before a release.

### Found, not fixed

- **WebView keeps cookies while all are blocked.** With `setAcceptCookie(false)` WebView 124 sends none, but still stores
  what sites set (seen in the default and a WebView profile). They are sent once cookies are allowed again. The site
  sheet says "Blocked: none are sent (N kept)", and Clear site data removes them.
- **Cache Storage and service workers on older WebView.** Without `DELETE_BROWSING_DATA` (WebView 124 on the AVD),
  clearing removes cookies, localStorage and IndexedDB but not a PWA's Cache Storage (squoosh.app kept 485 KB). Where
  WebView has the feature, the code uses `deleteBrowsingData(ForSite)`, which clears everything — **not device-tested
  here** (no newer WebView on this machine); final testing on a phone with a current WebView should check case 17.
- Typing the address a tab already shows on an error page does nothing (the same-document check; older navigation code).
- The insecure warning and "Open unsecured" can only appear in a build that allows cleartext (debug today).

## Integration — `hamza/browser` + `faran/browser` (2026-11-13)

Branch `integration/browser`: Hamza's cleaned `hamza/browser` (82dac31, all 18 packages and DATABASE_VERSION 8) with
`faran/browser` merged in (B12 and the Reddit shadow-root fix). Release builds, AVD `VidoraX_Browser_F` (API 35,
WebView 124).

### Fixed during the final test

- **Incognito never opened (B11).** Every incognito tab closed with "Incognito isn't available on this phone". The new
  architecture only sends a native view the props its codegen spec declares, so the `webProfile` prop never reached
  `createViewInstance`; the WebView stayed in the normal profile and the B11 check closed it. The patch script now also
  declares `webProfile?: string` in `src/RNCWebViewNativeComponent.ts` and adds a no-op `setWebProfile` to the
  new-architecture manager (2 new tests). Device: logcat `B11 webProfile prop received; incognito profile joined=true`;
  cookies separate both ways (httpbin); screenshots blocked in incognito, back on a normal tab.
- **React Compiler froze external-store reads.** Hooks that subscribe with `useSyncExternalStore` (or a `use…Version()`
  hook), ignore its value and then call a getter were compiled into "compute once" (or once per `tabId`). Found by
  compiling every file in `src` with the project's compiler and checking each such hook. Affected: tab groups (a new
  group was saved but never shown), incognito "verified" state (the tab would stay blank), page capture, tab mute and
  volume, data saver effects and per-site images, Browsing data usage, Developer tools (all panel sections, per-tab
  settings) and the Remote debugging switch. `useTabGroups` now returns the store snapshot; the rest start with the
  compiler's `'use no memo'` directive. Device: groups show, console prints `← Karachi - Wikipedia`, Network lists
  requests, Remote debugging switch shows its state.
- **Reader mode header under the status bar (B15).** The reader's window is edge to edge like the app: it now pads for
  the status bar (as Draw on page does). The Read aloud icon (`text-to-speech`, not in the icon font, drawn as "?") is
  now `account-voice`.

### Device checks (release build)

Upgrade over seeded 1.1.0 vc4: tabs, cookies, history, downloads (paused and completed) and bookmarks kept (bookmarks
check redone after finding the seed script never saved any: 1.1.0's menu scrolls and "Add bookmark" was off-screen).
Then: Find in page (count, next, whole word, close), reader + read aloud, incognito, tab groups, page picture → Pictures,
QR code, notes, Draw opens, Save offline + Saved pages, Developer tools console / network, remote debugging, profile
switch + guest mode (separate cookies, Personal back after leaving), ad + tracker blocker (site sheet "Blocked on this
page"), selection menu Search, HLS detection + quality sheet + play online, MP4 download completed. No crash or JS
error in logcat. Automated: tsc, eslint, 1869 unit tests, 12 patch-script tests.

### Second pass (same day): the rest of the device lists, and Hamza's open questions

Fixed:

- **A link from another app was lost on a cold start** (older than the browser work: 1.1.0 has the same path). The
  launch link arrives before the tab's WebView exists, `loadUrlForTab` found no controller and returned false, and the
  restored tab stayed in front. `openPastedLink` now hands such a link to `pendingNavigationService`, which BrowserScreen
  loads as soon as that tab's controller is ready. Device: force-stop, `am start -a VIEW -d https://www.wikipedia.org/`
  → Wikipedia in front.
- **B2: tab options unreachable once a group exists.** The grouped list draws plain `TabCard`s without B1's gesture, so
  a long-press did nothing (pin, mute, volume, add to / remove from group only through TalkBack). `TabCard` takes
  `longPressOptions`; the grouped list sets it.
- **B2: drop a tab onto another (Hamza's open item 5), built.** In B1's flat list, a dragged card held 30–70 % over a
  neighbour dims and shrinks that neighbour; letting go there groups the two (or adds the tab to the target's group).
  Past 70 % it reorders as before (B1 swapped at 50 %). `tabs/tab-drop.ts` (pure, worklet, 6 tests),
  `groupTabWith`, "Tabs grouped" toast (en / ur), card hint updated. Device: dragged W3Schools onto Example → a
  2-tab group.
- **B3: the tab sheet said "Mute tab" on a muted tab** (its memoized list never saw the sound state). It now subscribes
  to the options tab's muted state.
- **B24: Urdu prayer countdown cut off.** `'\u2068{prayer}\u2069 میں \u2068{time}\u2069'` was measured too narrow
  and the time wrapped onto a hidden line. The Urdu string has no isolates now (Urdu name, Urdu digits and the colon
  keep their order) and the label is one line that doesn't shrink. Device: "عصر میں ۲:۰۱" in full.

Device checks (release build, all passed): cold-start link; B13 location / camera + microphone / notifications refused
with the bar, timer pop-up blocked with Allow once; B14 blocked site; B18 Block images (0 of 15 images vs 14 of 14);
B16 Grayscale (page grey, app bars red); B21 homepage → Home, "Open the homepage" after a force-stop (tabs kept);
B10 history search (on Enter, as in 1.1.0) and Clear last hour; B9 new folder, move a bookmark, breadcrumbs; B24
calendar (13 November 2026 = 3 Jumada al-Thani 1448) and Lahore prayer times; B17 print dialog and the PDF choice
sheet; Urdu + Dark start page and menu; the earlier checks above. Twice a page showed "Website unavailable" (HTTP
error) on Wikipedia / w3.org after many loads from the emulator; the same pages loaded on retry — server rate limiting,
not reproduced.

**Hamza's open questions — decided (owner can still change them):**

1. B17 offline viewer with file access: **kept** — one archive, JavaScript and network off, not exported, closes when
   the app leaves the screen.
2. / 4. New defaults: **kept** — PDF links ask (with Remember, reset in Settings); "Translate this page?" once per site.
3. Page detectability: **accepted** — `__vidoraxConsole` only while Developer tools are on, the B23 message type and
   B1's guard identify the app, not the user.
5. Drop a tab onto another: **built** (above).

Still not checked on a device: Clear site data on a WebView with `DELETE_BROWSING_DATA` (the AVD has WebView 124), B22
camera upload on a phone with no camera app (needs a patch change), TalkBack and font scale 1.3 passes, the B24 widget,
B23 page alerts (forced job), B19 user scripts.

### Client report (2026-11-13): a Bilibili link shows "Detecting video" and never offers

**Reproduced and measured.** `https://www.bilibili.com/en/video/BV1BVaC6KEnw/`:

- **On the mobile site it works.** With the app's normal (mobile) identity the link redirects to `m.bilibili.com`,
  whose player streams one progressive MP4 — "Video available", downloaded here as MP4 360p, 18.1 MB, plays with sound.
- **On the desktop page it cannot work.** The client's recording is `www.bilibili.com` (desktop layout). There the
  player feeds a `blob:` MediaSource from **two separate whole files fetched by byte range** — video
  `…-1-100022.m4s` and audio `…-1-30216.m4s` on `upos-*.akamaized.net` — with **no DASH manifest anywhere**: the stream
  list comes from `api.bilibili.com/x/player/wbi/playurl`, a WBI-signed call that answers an anti-bot HTML page for
  anyone else (checked). The engine merges a split video+audio pair only when a manifest names both files
  (`inline-dash.ts`, `DashPlanner`), and `.m4s` is rejected as a segment by the general classifier
  (`general-network-resource.ts`, `SEGMENT_EXT`) — correctly, since a `.m4s` is normally one chunk of many. So the page
  offers the engine nothing it can prove, and detection ends with no answer. Supporting it means teaching the engine
  that a ranged `.m4s` can be a whole file and pairing two of them without a manifest: a new engine capability that
  touches the rule protecting every other site from junk-segment offers — **not done here; owner's call.**

**Worked on: naming the two files of a split player (toward Bilibili desktop).** The engine can already download a
video file and an audio file and merge them (`split-tracks.ts`, "a split pair the engine proves and merges"), and the
page observation names the file behind each SourceBuffer by remembering which URL answered the bytes that were
appended (`injected-script.ts`, `bufferUrls`). Measured on the real page: Bilibili's desktop player appends a **copy**
of each response (`isView:false`, a fresh ArrayBuffer), so that identity is lost and nothing was ever named — and its
XHRs are plain main-thread `arraybuffer` requests of **two whole files** (`Content-Range … /12322966` video,
`… /3743812` audio), not a stream of chunks. Two changes, both generic:

- An appended copy is matched to the response it came from by **exact size and first 16 bytes**, among the responses
  read in the last 20 s; two responses that match equally name neither, and the engine still proves the pair from the
  files' own bytes afterwards.
- The bytes are recorded when the page **reads `xhr.response`**, not only from our `load` listener. A page that set
  `onload` before `send()` runs first and appends the bytes before our listener is ever called — measured on the
  fixture: at append time the recent-response list was still empty.

Device (debug build, a local fixture that is Bilibili's shape — one video-only `.m4s` and one audio-only `.m4s`,
ranged XHR, appended as copies): both files are now named and the page sends the app
`mseTracks:"split"` with `mseFiles:{video,audio}`; before the change `__vidoraxFiles` stayed `null`. 5 tests in
`observers/split-track-files.test.ts`.

**Not finished: Bilibili desktop still does not offer a download.** With the files named and delivered, the app did
not turn that evidence into an offer on the fixture (it ends at the give-up message), so the remaining work is in the
app-side split-pair resolution (`useBrowserMediaAction` / `classifyMsePlayback`), not in the page. Bilibili's own
desktop page could not be loaded on the AVD at all to confirm end to end: it answers Android WebView with the mobile
site whatever UA Desktop site sets, because WebView still sends `Sec-CH-UA-Mobile: ?1` (worth a look of its own —
Desktop site does not convince sites that read Client Hints). **The mobile site keeps working and is what users get:**
re-checked on the final build — "Video available", downloaded.

**Fixed: the silent dead end.** Detection has a 10 s window and a 30 s cap (`useBrowserMediaAction.ts`). When the cap
passed with no offer and no verdict, the notice became `null` and the bar simply vanished — the user was left waiting
for an answer that never came (the last 13 s of the client's recording show exactly this). The presentation now has
`liveDetectingExhausted` and says **"This video can't be downloaded"** (en + ur) for a video it is sure is playing on
the page. An offer, a verdict, a hidden player or detection still running all still win over it (4 new cases in
`browser-download-presentation.test.ts`). Device: the release build still offers the Bilibili mobile video, and a local
MSE page built from one `.m4s` (the desktop-Bilibili shape) now ends with the message instead of silence.
