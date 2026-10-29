# Prompt D — Hamza · Claude Opus · Browser (16 packages, 108 features)

> **How to use:** open a **new** Claude Code chat with model **Opus** in the `vidorax-mobile` folder on the Mac and
> paste everything below the line, or write: *"Read `docs/work-plans/hamza-browser-prompt.md` and do everything in
> it."*
> Plan: "VidoraX Browser — Work Plan for Hamza & Faran" (https://claude.ai/artifact/MTs9zmLkhcwVEFTqVU81Xa).
> Packages, in order: B1, B5, B4, B6, B8, B10, B21, B9, B15, B16, B18, B22, B2, B19, B23, B24 (45 points).
> Faran's 8 WebView-engine packages (B3, B7, B11, B12, B13, B14, B17, B20) have their own prompt and aren't part of
> this one.
> Written 2026-10-29, on top of the 1.1.0 downloader work (`integration/final-check`).

---

You are working on **VidoraX** (`com.vidorax.fast.videodownloader`). It's an Android-first Expo SDK 57 /
React Native 0.86 app with an in-app browser, a video downloader and a player. It has two native Kotlin modules:
- `modules/vidorax-media`: download engine, library, media processing and the home-screen widget.
- `modules/vidorax-web`: WebView hooks through a patched react-native-webview 13.16.1.

Version 1.0.3 is in Google Play review. The downloader work (1.1.0) is finished and has been sent to the client as a
local APK.

**Your job:** build the Browser features assigned to Hamza: **16 work packages, 108 features from the client's
checklist**. Each one must be **100% finished and 100% tested, both automated and manual**. Do one package at a time,
in the order of §6.

**Scope:**
- The client's checklist is `/Users/mac/Downloads/1234 VidoraX.xlsx`, sheet *Checklist*, Browser section. The `#`
  numbers below are its feature numbers.
- §6 says what each feature must do. Where §6 leaves a choice, take the option that fits the app best and record
  why.

## 0. Before writing any code

1. **Read, in this order:**
   - `AGENTS.md`. Read the Expo v57 docs it links (https://docs.expo.dev/versions/v57.0.0/) before using any Expo
     API.
   - `docs/RELEASING.md`
   - `docs/HANDOFF.md` §1, §3, §5 and §6
   - `docs/ARCHITECTURE.md`:
     - §2 overview
     - §4 `vidorax-web`
     - §5 detection: why the page bridge and injected scripts must never break
     - §8 app shell
     - §9 data ownership
     - §10 testing
   - `docs/work-log/final-check.md`: the current state, gate numbers and device lessons
   - `docs/play-console/PLAY_SUBMISSION.md`: permissions and Data safety as filed
   - `scripts/qa/README.md`
   - `docs/work-plans/faran-opus-prompt.md` §1–§3: the same rules and loop, proven over 11 tasks
2. **Work in your own worktree.** Never switch the owner's folder to another branch.
   ```bash
   cd /Users/mac/Downloads/vidorax-mobile
   git status --short   # must be empty apart from docs/work-plans/hamza-browser-prompt.md; otherwise stop and tell the owner
   git fetch origin
   # Base: origin/main if it already contains the 1.1.0 work, otherwise the local integration branch.
   if git rev-parse -q --verify integration/final-check >/dev/null &&
      ! git merge-base --is-ancestor integration/final-check origin/main; then BASE=integration/final-check; else BASE=origin/main; fi
   echo "BASE=$BASE"
   git worktree add /Users/mac/Downloads/vidorax-browser-hamza -b hamza/browser "$BASE"
   mv docs/work-plans/hamza-browser-prompt.md /Users/mac/Downloads/vidorax-browser-hamza/docs/work-plans/
   cd /Users/mac/Downloads/vidorax-browser-hamza && npm ci
   git add docs/work-plans/hamza-browser-prompt.md && git commit -m "B0: Hamza browser prompt"
   ```
   - Work only from `/Users/mac/Downloads/vidorax-browser-hamza`. Write `BASE` in the work log.
   - Resumed run: if the worktree and `hamza/browser` already exist, just `cd` into the worktree and continue.
   - Never commit to `main`, `release/1.0` or `integration/final-check`.
   - Never check out, merge or edit `faran/*`, `dl/*` or any other person's branch.
3. **Use your own emulator.** Faran's chat may be using `Pixel_8` at the same time, the owner uses `VidoraX_Test2`,
   and `VidoraX_Play_Shots` is kept for store screenshots. Don't touch, wipe or reboot any of them. Create your own
   AVD:
   ```bash
   echo no | ~/Library/Android/sdk/cmdline-tools/latest/bin/avdmanager create avd -n VidoraX_Browser_H \
     -k "system-images;android-35;google_apis_playstore;arm64-v8a" -d pixel_8
   # In ~/.android/avd/VidoraX_Browser_H.avd/config.ini set: hw.ramSize=4096, PlayStore.enabled=false
   # (with PlayStore.enabled=true, a new AVD's system_server hit its watchdog).
   ~/Library/Android/sdk/emulator/emulator -avd VidoraX_Browser_H -no-window -no-audio -no-boot-anim \
     -no-snapshot-save -gpu host -feature -Vulkan -memory 4096 -cores 6 &
   ```
   - Wait about 5 minutes after the first cold boot before driving the UI.
   - Find the serial with `adb devices` (usually `emulator-5556` when another emulator runs). Export
     `ANDROID_SERIAL=<serial>` in every shell, so no command ever reaches another person's emulator.
   - Keep the display on: `adb shell svc power stayon true`.
   - The QA scripts' screen coordinates fit this AVD, since it has the same Pixel 8 profile.
4. **Metro and typed routes.**
   - If port 8081 is free (`lsof -i :8081`), use it. Otherwise run `npx expo start --port 8082 < /dev/null` and map
     it with `adb reverse tcp:8081 tcp:8082`.
   - Never use `--localhost` (it's IPv6-only). Without `CI=1`, Metro watches files.
   - Starting Metro once generates `.expo/types/router.d.ts`. Typecheck fails on routes until it exists, and again
     after you add a route until Metro has run.
5. **Baseline gate.** Run the gate (§4) once before any change and record the totals. Expected roughly:
   - JS about 1,390 pass
   - lint 0 errors / **84 warnings**
   - vidorax-media 971 / 0
   - vidorax-web 34 / 0

   Pre-existing failures: record them, and don't fix them unless they block you.
6. **Baseline APK for upgrade checks.** The client has `~/Downloads/VidoraX-Client-APK/VidoraX-1.1.0-vc4.apk`,
   signed with the upload key. A Gradle release build from your branch is signed with the same key, so it installs
   over it with `adb install -r` and keeps the data. A debug build is signed with the debug key: going between debug
   and release needs an uninstall, which loses the data.

   Seed the old version before every upgrade check (§4):
   - 15 bookmarks
   - history from several sites
   - 6 open tabs, one in desktop mode
   - a recent search
   - App Lock on (PIN 1357)
   - Urdu language
   - one finished download

## 1. Faran works in parallel: who owns what

Faran builds the WebView-engine packages on his own branch at the same time. Don't build any of these features, even
when they look easy:

| Package | Features |
| --- | --- |
| B3 | #8, #15, #190, #220, #283 |
| B7 | #66–#71 |
| B11 | #52, #104–#109, #111 |
| B12 | #112, #113, #115, #124–#126, #130, #135 |
| B13 | #116–#120 |
| B14 | #114, #121, #187, #218, #276–#278 |
| B17 | #174–#178, #264, #265, #280 |
| B20 | #16, #206–#210 |

Also not yours: the 10 features on hold for a Play decision (#134, #138–#143, #145, #147, #150) and the 48 that the
client's Fully Local list left out.

Seams that keep the two branches mergeable:
- **Native code.** Faran owns how `modules/vidorax-web` behaves. You may add *small* native calls your features need.
  The prompt names them: image blocking, text autosizing, a colour matrix, remote debugging, a WebView snapshot,
  pinned shortcuts, hardware keys, the certificate, the QR scanner and the cookie read. For each one:
  - Write the contract first in `modules/vidorax-web/src/VidoraWeb.types.ts`, then the Kotlin in
    `VidoraWebModule.kt`. Find the WebView by its React view tag, the same way `setWebViewActive(viewTag, …)` does.
  - Commit it on its own as `B<n>: native …`, with a Kotlin test.
  - List it in the work log under "Native changes for Faran to review".
  - Avoid changing `scripts/patch-react-native-webview.js`. If a feature can't be done without it (e.g. serving the
    Urdu font in B16), make the smallest change, extend `scripts/patch-react-native-webview.test.mjs`, and list it
    first under "Native changes for Faran to review".
- **Browser settings screen.** You create it in B5 (route `browser-settings`), with one file per section. Faran adds
  his privacy and permission sections as his own files. Keep your strings under your own key groups (e.g.
  `browserSettings.search.*`).
- **Private tabs.** In B1, add one helper, `shouldPersistForTab(tab)`, in `src/browser/tabs/`. It returns `true` for
  now. Everything you save per page goes through it: history, closed tabs, thumbnails, highlights, notes, page
  watches and the reading list. Faran's incognito (B11) makes it `false` for private tabs.
- **Profiles.** Faran's B20 will later split history, bookmarks and settings per profile. So touch storage only
  through the repositories in `src/storage/repositories/` and the stores. No SQL anywhere else.
- **Database.** The app's SQLite (`src/storage/sqlite/migrations.ts`, `DATABASE_VERSION` 2 in
  `src/storage/constants/database.ts`) may also get migrations from Faran:
  - Make every step check the real schema: `CREATE TABLE IF NOT EXISTS`, and `PRAGMA table_info` before
    `ALTER TABLE … ADD COLUMN`. Then it is safe to run twice and in any order with his.
  - Note the version numbers you used, so the owner can settle them when merging.
  - The same goes for the tab envelope (`BROWSER_TABS_SCHEMA_VERSION`, B1 and B2): read old envelopes by the fields
    they have, not by the version number alone. Faran may change it too.
- **Overlaps:**
  - #231 Security panel shows Faran's certificate data (#125) if it's in your branch. If not, use your own small
    native read.
  - #279 Draw on page uses B1's snapshot helper if Faran's screenshot (#174) isn't there.
  - #230 Storage inspector is the developer view. The user-facing site data view is Faran's #130.
  - Ctrl+F (B21) calls Faran's find in page (#66) only if it exists in your branch.

## 2. Rules (every package)

**Scope and quality**
- **Scope:** exactly the package's features. Bugs elsewhere go in the work log under "Found, not fixed".
- **Check the code first.** Some features are partly there:
  - History and Bookmarks already have a search box.
  - Tabs are restored at start.
  - Desktop mode and Translate page exist.

  Finish what's missing instead of rebuilding. If a feature already works completely, prove it on the device and
  record "Already present" with the evidence.
- **One package = its own commits.** Each message starts with the ID (`B9: …`); never mix packages in a commit. This
  is what lets the owner change or revert one package alone.
- **Defaults keep today's behaviour,** unless §6 says otherwise.
- **No fake results.** PASS only for what you ran and saw. A feature you can't test is **BLOCKED**, with the reason;
  then carry on with the next feature. Don't stop the run.
- **Don't stop to ask.** Take the option that fits the architecture, and write the decision and reason in the work
  log. Update `docs/ARCHITECTURE.md` where the design changed.

**Settings, data and text**
- **Every new setting must really work:**
  - It's stored on the device.
  - It's included in Settings backup/import (`src/store/settings/backup.ts`) and in Reset
    (`src/store/settings/reset.ts`); `backup.audit.test.ts` must pass.
  - It survives `adb shell am force-stop`.
  - It's **proven on the device to change behaviour**, not just saved.
- **Database:** never change or drop a table in place (see §1 for how migrations must work). Test the upgrade from a
  real v2 database with rows, through the 1.1.0 APK. The native `vidorax-media.db` isn't yours.
- **Strings:**
  - Every user-visible text goes in `src/localization/en.ts` **and** `ur.ts`, in real Urdu.
  - `catalog-parity.test.ts` and `hardcoded-strings.test.ts` must pass.
  - Check right-to-left (helpers in `src/localization/rtl.ts`), including drag directions and arrows.
- **Themes and accessibility:**
  - Check System, Red and Dark wherever a screen changes.
  - Every control gets an accessibility label, and TalkBack reads it.
  - Drag-to-reorder lists also offer *Move up / Move down* actions.
  - Touch targets are at least 48 dp.
  - Font scale 1.3 doesn't clip text.

**Performance and security**
- **Performance:** browsing must not get slower.
  - Injected scripts are small, and run only while their feature is on.
  - No per-scroll work on the JS thread beyond what auto-hide needs, and that work is throttled.
  - Cold start no slower than before (`scripts/qa/coldstart.sh`; record it).
- **Security:**
  - Never relax `src/browser/webview/webview-configuration.ts`: mixed content, file access, the `incognito` prop rule.
    That file is Faran's ground.
  - Injected scripts never give pages app data.
  - Pages, user scripts and imported files are untrusted: parse them, never `eval` them in the app.
  - Never put user data into URLs, except the search the user typed.

**Local only and Google Play**
- **Local only:** no server calls, accounts, analytics or cloud. The only network requests your features make are ones
  the user starts (a search, the broken-link check, page-change checks).
- **Google Play: no new permissions.** None of your features needs one:
  - QR scanning uses Google's code scanner, which needs no CAMERA permission.
  - Camera upload uses the system camera app.
  - Brightness is window-only (`expo-brightness`, no `WRITE_SETTINGS`).
  - Pinned shortcuts and widgets need nothing.
  - Prayer times use a city the user picks, not location.

  After every package, compare `apkanalyzer manifest permissions` on the release APK with the baseline. A new line
  means stop that feature, remove it, and record it as an owner decision.
- **Still refused:** YouTube downloads, DRM, encrypted HLS, login/paywall bypass. Don't change any download rule.
  *Opening* the YouTube app with "Open in app" is fine.

**Dependencies and build**
- **Dependencies:** prefer what's installed (`expo-brightness`, `expo-clipboard`, `expo-file-system`,
  `expo-notifications`, `react-native-svg`, gesture-handler, reanimated, `@gorhom/bottom-sheet`, NetInfo, MMKV,
  `expo-sqlite`).
  - New pure-JS libraries are fine when small and MIT, Apache, BSD or OFL licensed. Record the name, exact version,
    licence and size added.
  - New native Expo modules (e.g. `expo-speech`, `expo-image-picker`, `expo-background-task`) need care: use
    `npx expo install`, read their config plugin in `node_modules/<pkg>/plugin`, and apply any manifest change **by
    hand** in `android/`, because prebuild is never run. Then check the merged manifest.
- **Build tools:**
  - Never run `npx expo prebuild`. Run Gradle only through `bash scripts/dev/gradle.sh …`. It holds a machine-wide
    lock, so "waiting for Gradle lock" just means Faran is building.
  - Before each release build, delete `android/app/build/generated/res/react/release` and
    `android/app/build/generated/assets/react/release` (stale bundles have shipped before).
  - For emulator-only builds add `-PreactNativeArchitectures=arm64-v8a`.
- **Device facts:**
  - Package `com.vidorax.fast.videodownloader`.
  - Launch activity `com.vidorax.fast.videodownloader/com.anonymous.vidorax.MainActivity`.
  - Kotlin packages stay `com.anonymous.vidorax` / `com.vidorax.*`.
  - The Home tab is hidden on purpose (it redirects to Browser). The start page is
    `src/browser/components/BrowserHome/BrowserHomeView.tsx`; start-page features go there.
- **Never** change `versionCode` or `versionName`; the owner sets them at release. Never read, print or copy
  `~/.vidorax-signing`. Never upload anything to Google Play.

## 3. The package loop (repeat for each package)

1. Merge your base again: `git merge origin/main` (or `integration/final-check`) to pick up the owner's merges.
   Read every file named in the package, and search for related code and tests.
2. Write the design in the work log, per feature: what the user sees, where it lives, data and migration, edge
   cases, failure modes, tests.
3. Implement.
4. **Automated tests:** unit tests (`*.test.ts`, `node:test`) for every decision and algorithm the package adds, and
   Kotlin JVM tests for native calls. Then the gate (§4).
5. **Manual tests:** every manual case of the package, in this order:
   - a debug build first;
   - then a **release build**, freshly installed;
   - for packages that change stored data (B1, B2, B5, B9, B10, B21, B22, B23), a release build installed over the
     seeded 1.1.0 APK.

   Do it in English and Urdu, with the themes where screens changed. Save screenshots to
   `.claude/pr-evidence/hamza-browser/<ID>-<case>.png` (not committed).
6. **Quick release check** (no full regression per package):
   - cold start with no crash or ANR;
   - a page opens;
   - "Video available" still appears on `https://www.w3schools.com/html/html5_video.asp`, and that download works;
   - no new permission.

   Record it as "Regression: quick check; full R1–R16 at §7".
7. Docs:
   - the work log entry;
   - `docs/ARCHITECTURE.md`: add a "Browser features" part to §8 and keep it current;
   - one line per package in a new `docs/HANDOFF.md` §4 entry "Browser — Hamza packages" (next free number).
8. Commit with the ID prefix. Push only as §5 says.

Long run: the chat may be compacted or resumed. Keep the work log current, so a resumed chat re-reads this prompt
and the log and continues at the first unfinished package without redoing anything.

## 4. Gate, upgrade check, regression

**Gate** (after every package; paste the totals into the work log):
```bash
npm test
npm run typecheck
npm run lint                                                                   # 0 errors, warnings ≤ 84
bash scripts/dev/gradle.sh :vidorax-media:testDebugUnitTest --rerun :vidorax-web:testDebugUnitTest --rerun
node --test scripts/patch-react-native-webview.test.mjs                        # when WebView code changed
git diff --check
```
If `--rerun` looks suspiciously fast, confirm from the test result files that the tests really ran.

**Upgrade check** (packages that change stored data, and §7):
1. Install the 1.1.0 APK on a clean app and seed it (§0.6).
2. `adb install -r` your release APK.
3. Everything must still be there and still work: bookmarks, history, tabs, recent search, App Lock, language,
   downloads.
4. The new data starts with sensible values.

`scripts/qa/seed_test1.sh` can help (`SEED_APK=<the 1.1.0 APK>`). If one of its taps misses on 1.1.0, add that data
by hand and say so in the log.

**Regression R1–R16** (once, at §7). Use `scripts/qa/regress.py`, `r8.sh` and `coldstart.sh` with your
`ANDROID_SERIAL`.

| # | Check | Pass when |
| --- | --- | --- |
| R1 | Cold start | No crash or ANR. Browser chrome no slower than the base (record seconds) |
| R2 | MP4 page | w3schools video page → download → plays |
| R3 | HLS | `https://hlsjs.video-dev.org/demo/?src=https%3A%2F%2Ftest-streams.mux.dev%2Fx36xhzz%2Fx36xhzz.m3u8` → a quality downloads and plays |
| R4 | Social | Public TikTok, Instagram reel and Facebook video (logged out) → offered → downloads |
| R5 | Refusals | YouTube refused (submit with **Enter**; confirm the toast on the screenshot); AES HLS refused |
| R6 | Pause / kill / resume | Pause → resume completes. Force-stop mid-download → reopen → resumes |
| R7 | Player | Play, seek, ±10 s, fullscreen, PiP, mini player |
| R8 | App Lock | `r8.sh`: PIN on return when on, none when off |
| R9 | Urdu and themes | Right-to-left, no English left on any screen you touched. System / Red / Dark |
| R10 | Upgrade | Over the seeded 1.1.0 APK: all data intact |
| R11 | DASH | `https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd` downloads and plays |
| R12 | Wi-Fi only | On, then `svc wifi disable` → "Waiting for Wi-Fi"; Wi-Fi on → continues |
| R13 | Tabs | 10 tabs with pins and groups → force-stop → restored as they were |
| R14 | Detection unaffected | With every page-display / data-saver / developer option on, "Video available" still appears on R2 and R3 |
| R15 | Permissions and size | `apkanalyzer manifest permissions` identical to the base. APK size growth recorded |
| R16 | Scrolling | `adb shell dumpsys gfxinfo com.vidorax.fast.videodownloader` janky frames on a long Wikipedia page: no worse than the base (record) |

**Test pages:**
- Use `https://en.wikipedia.org`, `https://ur.wikipedia.org`, `https://www.bbc.com/urdu`, `https://example.com`,
  `https://httpbin.org/user-agent`, and the w3schools "try it" pages.
- Check each with `curl -sIL <url>` first, and note replacements.
- Local fixture pages work only on **debug** builds (release refuses cleartext), served at
  `http://fx.127.0.0.1.nip.io:<port>` with `adb reverse tcp:<port> tcp:<port>`. The URL guard drops `10.0.2.2` and
  `localhost` pages on purpose.

**Emulator lessons:**
- `uiautomator dump` hangs while a page video plays. Use screenshots (`scripts/qa/shot.sh`).
- `adb shell input text` can drop the first characters right after a focus tap. Wait ~2.5 s and type slowly.
- Deliver `am start -a android.intent.action.VIEW -d <url>` only after the browser is up.
- Hardware keys: `adb shell input keyevent 24/25` (volume) and `adb shell input keycombination KEYCODE_CTRL_LEFT
  KEYCODE_T` (Android 13+).
- Navigation mode: `adb shell cmd overlay enable com.android.internal.systemui.navbar.gestural` (or `.threebutton`).
- Font scale: `adb shell settings put system font_scale 1.3`. Reset it afterwards.
- The emulator can't pinch with two fingers. Test pinch zoom on a real phone if one is available, otherwise mark it
  BLOCKED.
- A stale "isn't responding" dialog under heavy load: tap Close app, restart, re-run the step, and record it.

## 5. Work log, commits, pull request

**Work log:** `docs/work-log/hamza-browser.md`. It holds:
- the `BASE` and the baseline numbers;
- per package:
  - design and decisions;
  - files;
  - automated test totals;
  - a table of every manual case (PASS / FAIL / BLOCKED + note + screenshot name);
  - measurements;
  - the quick release check;
  - "Found, not fixed";
- the lists "Native changes for Faran to review", "New dependencies" (name, version, licence, size) and "New settings
  and defaults".

**Push and PR:**
- If `BASE` was `origin/main`:
  - After the first finished package, push `hamza/browser`.
  - Open one PR into `main` titled "Hamza · Browser packages (B1–B24)". Use the repo PR template, with a checklist of
    the 16 packages, and tick each package as it finishes.
  - List the evidence screenshots for the owner to attach; the in-app browser isn't signed in to GitHub.
- If `BASE` was the local `integration/final-check`, that branch isn't on GitHub yet, and pushing would publish it.
  So **commit locally and don't push**. The owner pushes after merging the 1.1.0 work.

## 6. The packages (in this order)

### B1 — Tab management (3 points)

Features: Reopen Closed Tab (#3), Pin Tab (#5), Duplicate Tab (#7), Close Other Tabs (#9), Close All Tabs (#10),
Drag to Reorder (#11), Search Tabs (#13), Tab Preview (#14), Auto Sort Tabs (#17).

**Today:**
- Tabs live in `src/browser/tabs/`:
  - `tab-operations.ts`: create, close, switch, update.
  - `tab-persistence.service.ts`: restored at every start; envelope `BROWSER_TABS_SCHEMA_VERSION` 1.
  - `constants.ts`: `MAX_OPEN_TABS` 10 and `MAX_MOUNTED_WEBVIEWS` 2. At most two live WebViews; other tabs are
    parked and reload when shown.
- `src/browser/components/BrowserTabSwitcher/BrowserTabSwitcher.tsx` lists tabs with select, close and New tab.
- The limit notice is `src/browser/services/tabs-limit-notice.ts`.

**Build:**
1. **#3 Reopen closed tab:**
   - Keep the last 10 closed tabs: URL, title, position, pinned. Persist them through `shouldPersistForTab`.
   - Offer "Reopen closed tab" in the switcher and the menu, plus an **Undo** snackbar right after a close.
   - The tab returns at its old position. Its back/forward history isn't kept; record that.
2. **#5 Pin:**
   - Pinned tabs come first, with a pin badge, and survive restart.
   - Close other / Close all leave them open unless the user ticks "Also close pinned tabs".
3. **#7 Duplicate:** the same URL in a new tab right after it. It respects the 10-tab limit and its notice.
4. **#9 / #10 Close other / Close all:**
   - Available from the switcher menu and a tab's long-press menu.
   - The confirmation shows the count.
   - Close all leaves one fresh start-page tab (the existing `REPLACED_HOME` path).
   - Both can be undone as one group.
5. **#11 Drag to reorder** in the switcher: long-press lifts the card (gesture-handler + reanimated).
   - The order persists: bump the tab envelope to v2 with a migration from v1, so restored tabs are never lost.
   - Accessibility actions Move up / Move down.
6. **#13 Search tabs:** a field in the switcher filters by title and URL. Case-insensitive; Urdu works.
7. **#14 Tab preview:**
   - Each card shows a small, recent snapshot of its page. Long-press opens a larger preview with title and URL.
   - Snapshots come from a native `snapshotWebView(viewTag, maxWidth)`, which writes a JPEG to the cache dir. Take
     one when the user leaves a tab or opens the switcher.
   - Delete the snapshot with its tab. None for tabs where `shouldPersistForTab` is false.
8. **#17 Auto sort:** "Sort by: Manual / Site / Last used / Opened", persisted. Manual is the drag order; pinned tabs
   always come first.

**Automated:**
- Closed-tab stack: limit 10, position, pinned, persistence.
- Duplicate at the limit.
- Close others keeps pinned tabs.
- Close all → one start tab.
- Undo as a group.
- v1 → v2 envelope migration.
- Sort orders; Urdu search matching.
- Kotlin: snapshot scaling and encoding.

**Manual:**
- 10 tabs:
  - pin 2;
  - reorder by drag;
  - force-stop → order and pins restored.
- Closing:
  - close a tab → Undo;
  - Close all → Undo;
  - reopen a closed tab after a restart.
- Duplicate at 10 tabs → limit notice.
- Search "wiki" and an Urdu title.
- Previews match their pages after switching around.
- Urdu right-to-left drag; TalkBack Move up / Move down.

### B5 — Search settings (2 points)

Features: Choose Search Engine (#56), Site Search (#57), Disable Suggestions (#61), Safe Search (#62), Search
Language (#63), Region Setting (#64).

**Today:**
- Every search goes to Google: `BROWSER_SEARCH_BASE_URL` in `src/browser/constants/browser.constants.ts`, built by
  `buildSearchUrl` in `src/browser/utils/url.ts`.
- Omnibox suggestions are local only (history, bookmarks, recent searches; `src/browser/suggestions/`).
- Settings has no Browser section. Sub-screens follow `src/app/(app)/download-settings.tsx` →
  `src/screens/settings/download-settings/`.

**Build:**
1. **The Browser settings screen:**
   - Route `src/app/(app)/browser-settings.tsx` → `src/screens/settings/browser-settings/`, with a "Browser" row in
     Settings.
   - One section component per area (Search, Address bar, Tabs, Page display, Data saver, Startup, Developer), each
     added by the package that needs it.
2. **#56 Search engine:**
   - Google (default), Bing, DuckDuckGo, Yahoo, Ecosia, Brave Search.
   - Each is a definition: name, URL template, and its own Safe Search, language and region parameters.
   - Icon: a bundled letter badge in the engine's colour. No remote fetch, no brand assets.
   - Expose one `getSearchEngine()` that every search uses: the address bar, selected text (B8), shortcuts (B4) and
     the widget (B24). Faran's incognito can choose its own engine through it.
3. **#57 Site search:**
   - "Search this site" in the menu opens the address bar prefilled with `site:<host> `.
   - Typed `site:example.com cats` works for every engine.
4. **#61 Suggestions:** on by default. Off means the omnibox shows no history, bookmark or recent-search
   suggestions.
5. **#62 Safe Search: Off / Moderate / Strict.**
   - Use each engine's own parameter (e.g. Google `safe=active`, DuckDuckGo `kp=1`).
   - **Verify** each one with a real search and record the parameter.
   - An engine without a level → the nearest one, noted in the setting.
6. **#63 Search language** (App language, English, Urdu, …) and **#64 Region** (Automatic, Pakistan, …): each
   engine's `hl` / `gl` / `setlang` / `cc` / `kl` style parameter, verified on the device.

**Automated:**
- URL builder: every engine × safe level × language × region, as a table test.
- `site:` handling.
- Suggestions off → none.
- Backup and reset include the new keys.

**Manual:**
- Each engine with "cats" and "بلی".
- Strict Safe Search visible on the results page.
- Language and region visible.
- Suggestions off.
- Force-stop → kept.
- Urdu screens.

### B4 — Address bar (2 points)

Features: URL Autocomplete (#24), Address Bar Position (#28), Auto Hide Address Bar (#29), Search Engine Icon (#36),
Domain Highlight (#37), Search Shortcuts (#33), Address Bar Calculator (#268).

**Today:**
- `src/browser/components/BrowserHeader/`: `AddressBar.tsx`, `SuggestionOverlay.tsx`, `SecurityIndicator.tsx`,
  `HighlightedText.tsx`.
- `src/browser/hooks/useAddressBar.ts` and `useOmniboxSuggestions.ts`.
- The bottom toolbar is `src/browser/components/BrowserToolbar/` (`toolbar-config.ts`).

**Build:**
1. **#24 Inline autocomplete:**
   - While typing, complete the best matching visited or bookmarked host inline, as selected text: → or Enter
     accepts, Backspace removes it.
   - Never complete in the middle of a word.
   - Off when suggestions are off (B5).
2. **#28 Position: Top (default) / Bottom.** At the bottom, the bar sits above the toolbar, suggestions open upward,
   and the keyboard never covers it.
3. **#29 Auto-hide on scroll:** setting, default off.
   - Hides on scroll down. Shows on scroll up, at the top, while loading, and when the "Video available" bar appears.
     The download bar is never hidden.
   - Throttled `onScroll`, with no jank.
4. **#36 Engine icon:** the current engine's badge shows in the focused or empty bar and beside search suggestions.
5. **#37 Domain highlight:**
   - When not editing, show the registrable domain (eTLD+1) in full colour and the rest dimmed.
   - Use a bundled public-suffix helper, e.g. `tldts` (MIT); record its size.
   - IDN/punycode hosts show their `xn--` form with a warning style.
6. **#33 Search shortcuts:**
   - Keyword + space + query. Defaults: `g` Google, `b` Bing, `d` DuckDuckGo, `w` Wikipedia.
   - The user can add, edit and delete shortcuts (keyword + URL with `%s`) in Browser settings → Search.
7. **#268 Calculator:**
   - An expression like `12*(3+4)/2`, `15% of 2000` or `2^10` shows its result as the first suggestion; a tap
     copies it.
   - Own small parser, never `eval`. Eastern digits (۰–۹) are accepted.
   - No result for incomplete or invalid input.

**Automated:**
- Autocomplete matching: prefix, `www.`, case, mid-word.
- Auto-hide state machine.
- eTLD+1 (`co.uk`, `com.pk`, IDN).
- Shortcut parsing.
- Calculator: precedence, `%`, `^`, division by zero → no suggestion, `۱۲+۳`.

**Manual:**
- "wik" completes and Backspace removes the completion.
- Bottom position with the keyboard open, in Urdu.
- Auto-hide on a long article.
- The icon follows the B5 engine.
- An `xn--` domain.
- `w Lahore`.
- The calculator with Eastern digits.

### B6 — Navigation and scrolling (3 points)

Features: Hard Reload (#42), Long Press Back History (#44), Swipe Navigation (#45), Scroll to Top (#46), Scroll to
Bottom (#47), Scroll Speed (#53), Auto Scroll (#54), Volume Key Scroll (#240), Open in Background (#51), Page
Preloading (#55).

**Today:**
- `src/browser/hooks/useBrowserNavigation.ts` and `useBrowserHardwareBack.ts`.
- A one-shot cache-bypassing reload exists for user-agent changes (`BROWSER_WEBVIEW_CACHE_MODE_UA_RELOAD`).
- `allowsBackForwardNavigationGestures` is iOS-only.
- Link long-press actions live in `src/browser/actions/builtins/`: new tab, copy, share, open external.

**Build:**
1. **#42 Hard reload:** long-press Reload (and a menu item) reloads without the cache, reusing the `LOAD_NO_CACHE`
   path.
2. **#44 Long-press Back:**
   - Lists the tab's earlier pages (title + URL, newest first), recorded per tab from navigation events. SPA
     `pushState` and redirects are handled.
   - A tap goes back that many steps.
   - Parked tabs may lose the list; record that.
3. **#45 Swipe navigation:**
   - With gesture navigation, Android owns both screen edges: system Back is already page Back. So: a horizontal
     swipe on the **bottom toolbar** = Back / Forward, with an arrow indicator.
   - With 3-button navigation, a page-edge swipe also works.
   - Mirrored in right-to-left. Setting, default on. Record this design.
4. **#46 / #47 Scroll to top / bottom:** menu items, plus a small floating ↑/↓ button that appears after a fast
   scroll on long pages and fades out.
5. **#54 Auto scroll:** Menu → Auto scroll.
   - A floating control: pause/resume, slower/faster, stop.
   - Stops at the bottom, on navigation, and in the background. A touch pauses it.
6. **#53 Scroll speed (Slow / Normal / Fast):** Android sets touch fling speed, so this controls auto-scroll speed
   and the volume-key / button scroll step. Record that.
7. **#240 Volume keys:** setting, default off.
   - Volume Down / Up scroll one screen (with overlap) while a page shows.
   - Keys keep their normal job when the setting is off, while a page or the app's player is playing media, on
     other screens, and while the keyboard is up.
   - Native: `MainActivity` key events gated by a flag JS sets (`setVolumeKeyScroll(enabled)`). Build one key
     channel that B21's shortcuts reuse.
8. **#51 Open in background:**
   - Link long-press → "Open in background tab": created without switching, with a toast "Opened in background ·
     Switch".
   - It loads when shown, or now if a WebView slot is free.
   - Respects the limit.
9. **#55 Page preloading:** "Preload pages", Off / Wi-Fi only (default) / Always.
   - Preconnect for the top URL suggestion, and `<link rel=prefetch>` for a page's `rel="next"` link.
   - Off while Data saver or Battery saver is on (B18).
   - **Measure** load times with and without (3 runs each) and record them.

**Automated:**
- Back-list building (redirects, reloads, `pushState`).
- Swipe threshold and RTL.
- Auto-scroll controller (speed, pause, stop rules).
- Volume-key decision table.
- Preloading decision.
- Open-in-background at the limit.

**Manual:**
- All features on a long Wikipedia article.
- Gesture and 3-button navigation.
- Volume keys with and without a playing page video.
- Preload timings.
- Urdu.

### B8 — Selected text (1 point)

Features: Search Selected Text (#72), Copy Selected Text (#73), Share Selected Text (#74).

**Today:** text selected in a page shows Android's default WebView action menu.

**Build:**
- One consistent selection menu through react-native-webview's `menuItems` + `onCustomMenuSelection`: Copy, Share,
  Search.
- Later packages add Save to notes (B22) and Highlight (B23) to the same list.
- Search uses `getSearchEngine()` and opens a new tab right after the current one.
- Long selections are cut to 300 characters for Search, with a note.
- Check that Select all and copying still work on API 35, with the custom items in place.

**Automated:** selection → action mapping, query cleanup (trim, newlines → spaces, length cap).

**Manual:**
- Wikipedia (English and Urdu text):
  - Search → results in a new tab;
  - Copy → paste in the address bar;
  - Share → Android share sheet.
- A 2,000-character selection.

### B10 — History (2 points)

Features: Search History (#95), Clear by Time Range (#98), Auto Clear on Exit (#99), Disable History (#101), Export
History (#103).

**Today:**
- `src/screens/history/HistoryScreen.tsx` already has search, delete one, clear all and clear recent searches.
- Data is in SQLite (`src/storage/repositories/history.repository.ts`), written by
  `src/browser/services/history-recording.service.ts`; the store is `src/store/history/`.

**Build:**
1. **#95 Search:** verify it matches title and URL, stays fast with 5,000 rows (index if needed) and highlights
   matches. Finish what's missing, or record "Already present" with evidence.
2. **#98 Clear browsing data:**
   - Ranges: last hour / 24 hours / 7 days / 4 weeks / all time.
   - What it clears: history, recent searches, closed tabs and tab snapshots (B1).
   - Leave one hook where Faran adds cookies, cache and site data.
3. **#99 Auto clear on exit:** setting.
   - Clears on the next cold start, and on a new menu item **Exit**, which closes the tabs, clears and leaves the
     app.
   - Record that a killed app clears at its next start.
4. **#101 Disable history:**
   - No new rows; existing rows stay.
   - The History screen shows "History is off".
   - Suggestions still use bookmarks.
5. **#103 Export:** a CSV (title, URL, last visit ISO time, visit count), UTF-8 with BOM so Excel shows Urdu. Saved
   where the user picks (system file picker or share sheet; no permission).

**Automated:**
- Range boundaries and time zone.
- Disabled → nothing written.
- The auto-clear trigger.
- CSV escaping: quotes, commas, newlines, Urdu, BOM.

**Manual:**
- On the debug build, insert old rows with a `__DEV__`-only seed helper (never in release).
- Each range.
- Exit → cleared.
- Force-stop with auto-clear on → cleared at start.
- History off.
- Open the export in a spreadsheet: Urdu shown correctly.

### B21 — Startup and customization (2 points)

Features: Set Homepage (#232), Startup Options (#233), Spell Check (#237), Customize Toolbar (#238), Custom
Background (#245), Keyboard Shortcuts (#246).

**Today:**
- The start page is `BrowserHomeView.tsx`: Quick Access, a bookmark grid and history.
- Tabs are restored at every start.
- Toolbar buttons are in `toolbar-config.ts`.

**Build:**
1. **#232 Homepage:** the start page (default) or a URL the user enters. An optional Home toolbar button opens it.
   New tabs still open the start page.
2. **#233 Startup:**
   - Options: "Continue where you left off" (default, today), "Open the start page" (tabs kept, a start-page tab in
     front) and "Open the homepage".
   - An incoming link (VIEW intent or share) always wins.
3. **#237 Spell check:** setting, default on.
   - Sets `spellcheck` on page text fields (injected).
   - Sets `spellCheck` / `autoCorrect` on the app's own text fields, except the address bar.
   - The keyboard does the checking. Record which keyboards honour it.
4. **#238 Customize toolbar:**
   - Pick and order the bottom toolbar's buttons: Back, Forward, Home, New tab, Bookmarks, Downloads, Share, Reload,
     Search this site, …
   - Tabs and Menu can't be removed, so everything stays reachable.
   - Reset to default.
   - Unknown IDs from older saves are ignored safely.
5. **#245 Custom background** for the start page:
   - Options: the theme, a colour, a gradient, or a photo the user picks (Android Photo Picker; e.g.
     `expo-image-picker`). The merged manifest must not gain `READ_MEDIA_IMAGES` or `CAMERA`.
   - The photo is copied and scaled into app storage.
   - A scrim keeps the text readable in every theme.
6. **#246 Keyboard shortcuts** (physical keyboard, Chromebook, emulator):

   | Keys | Action |
   | --- | --- |
   | Ctrl+T | new tab |
   | Ctrl+W | close tab |
   | Ctrl+Shift+T | reopen closed tab |
   | Ctrl+Tab / Ctrl+Shift+Tab | next / previous tab |
   | Ctrl+L | address bar |
   | Ctrl+R / F5 | reload |
   | Ctrl+Shift+R | hard reload |
   | Alt+← / Alt+→ | back / forward |
   | Ctrl+D | bookmark |
   | Ctrl+H | history |
   | Ctrl+F | find in page (only if Faran's B7 is in your branch) |
   | Esc | close panels |

   - Use the key channel from B6.
   - A help list in Browser settings shows all shortcuts.

**Automated:**
- Startup decisions: cold start, incoming link, empty session.
- Toolbar config validation.
- Shortcut → action map.

**Manual:**
- Each startup option with force-stop and cold start, also with a VIEW link.
- Toolbar changes survive restart and Reset.
- A background photo, in Dark and Urdu.
- Shortcuts with `input keycombination`.

### B9 — Bookmarks (4 points)

Features: Bookmark Folders (#77), Edit Bookmark (#78), Reorder Bookmarks (#80), Bookmarks Bar (#81), Bookmark All
Tabs (#83), Import Bookmarks (#84), Export Bookmarks (#85), Reading List (#89), Broken Link Check (#91), Tags (#92),
Bookmark Notes (#93), Add to Home Screen (#87).

**Today:**
- Bookmarks are a flat list. `BookmarkEntry` (`src/storage/types/bookmark.types.ts`) has id, url, title, hostname,
  faviconUrl and dates.
- Table in `src/storage/sqlite/schema.ts`; `bookmark.repository.ts`; store `src/store/bookmarks/`.
- Screen `src/screens/bookmarks/`: search, delete, clear all.
- Start-page grid `BrowserBookmarkGrid.tsx`; header star `BrowserBookmarkControls.tsx`.
- Favorites (`src/store/favorites`) is a separate feature; leave it alone.

**Build:**
1. **Schema (next version, §1 rules):**
   - A folders table: id, parentId, name, position.
   - Bookmark columns: folderId, position, note, kind (bookmark / reading), readAt.
   - Tags, kept searchable.
   - Existing bookmarks land in the root folder in their current order.
2. **#77 Folders:**
   - Create, rename, nest, and move bookmarks between folders.
   - Deleting a folder asks: move its contents up, or delete them.
   - Breadcrumb navigation.
3. **#78 Edit:** title, URL (validated), folder, tags, note. Open it from long-press, and from the header star when
   the page is already bookmarked.
4. **#80 Reorder** by drag inside a folder, persisted. Plus Move up / Move down.
5. **#81 Bookmarks bar:**
   - Setting, default off.
   - A strip under the address bar shows the "Bookmarks bar" folder.
   - It scrolls horizontally and hides with auto-hide (B4).
6. **#83 Bookmark all tabs:** saves them into a new dated folder, skipping start-page tabs.
7. **#84 / #85 Import / export** in the standard Netscape bookmark HTML format (what Chrome, Firefox and Edge
   export):
   - Folders and dates are kept.
   - Import skips the same URL in the same folder, and shows added / skipped / invalid counts.
   - 5,000 bookmarks without freezing the UI.
   - The file is parsed as text, never rendered.
8. **#89 Reading list:**
   - "Add to reading list" from the menu and from link long-press.
   - Its own tab in Bookmarks with Unread / Read; swipe marks a page read.
   - Offline copies only through Faran's Save page offline (#178), if it's in your branch.
9. **#91 Broken link check**, started by the user ("Check links"):
   - HEAD, falling back to GET with `Range: bytes=0-0`. 4 at a time, 10 s timeout, no cookies, Wi-Fi only by
     default, with progress and cancel.
   - Results: Works / Moved (offer the final URL) / Not found (404, 410) / Unreachable ("may be temporary").
   - Never deletes by itself.
10. **#92 Tags:** add in Edit; filter chips; search includes tags.
11. **#93 Notes:** free text per bookmark, shown in the list and searchable.
12. **#87 Add to Home Screen:**
    - A pinned launcher shortcut (`ShortcutManager.requestPinShortcut`, native, no permission) with the favicon or a
      letter icon.
    - Tapping it opens VidoraX with that URL in a new tab through the existing incoming-link path
      (`src/browser/services/incoming-link.service.ts`). App Lock asks for the PIN first.
    - If the launcher can't pin, show a clear message.

**Automated:**
- Migration, run twice, on a database with rows.
- Folder tree: move, delete with children, cycles refused.
- Positions.
- Netscape parser / serializer round trip, with Chrome-style and Firefox-style fixtures: nested folders, Urdu titles,
  malformed HTML, `<script>` treated as text.
- Duplicate rules.
- Link-check classification (fake fetch).
- Tag and note search.

**Manual:**
- Folders, tags, notes, reorder, bookmarks bar.
- Bookmark all tabs.
- Export → import on a clean install; import a hand-made Chrome-format file.
- Check links with a 404 and a redirect.
- Add to home screen → icon → opens the site (App Lock on).
- Upgrade from 1.1.0 with 15 bookmarks → all present, in order.

### B15 — Reader mode (3 points)

Features: Reader Mode (#161), Reader Theme (#172), Read Aloud (#173).

**Build:**
1. **#161 Reader mode:**
   - A reader button appears in the address bar when the page is an article (Readability's
     `isProbablyReaderable`), and in the menu.
   - The article is extracted in the page with Mozilla Readability (`@mozilla/readability`, Apache-2.0), injected as
     a string and run on a document clone.
   - It shows in a reader view: title, byline, site and reading time; images optional; links open in the browser.
   - Back returns to the page at its scroll position.
   - **Sanitize** the extracted HTML (no scripts, event handlers, iframes or `javascript:` links). Render it with
     JavaScript off, or natively.
2. **#172 Reader theme:**
   - Light / Sepia / Dark; the default follows the app theme.
   - Font size, serif/sans and line spacing.
   - Urdu articles use Nastaliq (the font from B16; if B16 isn't done yet, B15 adds it and B16 reuses it).
   - All remembered.
3. **#173 Read aloud:**
   - On-device text-to-speech (`expo-speech`; check the v57 docs; Android TTS, no network).
   - Reads paragraph by paragraph, highlighting the current one. Play/pause, previous/next and speed controls.
   - Urdu uses an Urdu voice when the phone has one; otherwise it offers the TTS settings.
   - It stops in the background (no service needed); record what happens.

**Automated:**
- The readerable decision on fixture HTML: article, home page, video page.
- Sanitizer cases.
- Paragraph chunking (length cap, Urdu `۔`).

**Manual:**
- An English and an Urdu Wikipedia article; a news article.
- A non-article page shows no button.
- Each theme.
- Read aloud in English and Urdu (record the AVD's voices).
- Rotate; Dark.

### B16 — Page display (3 points)

Features: Force Dark Web Pages (#163), Font Size (#164), Page Zoom (#165), Text Reflow (#169), Font Style (#170),
Default Urdu Font (#272), Color Filters (#179), Night Light (#180), Brightness Control (#181).

**Today:**
- react-native-webview 13.16.1 has `forceDarkOn`, `textZoom`, `setBuiltInZoomControls`, `setDisplayZoomControls` and
  `androidLayerType` (`node_modules/react-native-webview/lib/WebViewTypes.d.ts`).
- Props are set in `src/browser/components/BrowserContainer/BrowserWebView.tsx`.
- `expo-brightness` is installed.

**Build:**
1. **#163 Force dark:**
   - Off (default) / On / Follow app theme, through `forceDarkOn` (algorithmic darkening).
   - Pages with their own dark theme keep it.
   - A "Not on this site" exception.
2. **#164 Font size:** 50–200 % through `textZoom`. A global value plus per-site values, with a live preview.
3. **#165 Page zoom:**
   - Pinch zoom always available: "Force enable zoom" rewrites a blocking viewport meta.
   - A default zoom per site.
   - No on-screen zoom buttons.
4. **#169 Text reflow:** zoomed text re-wraps to the screen width.
   - Use `WebSettings.LayoutAlgorithm.TEXT_AUTOSIZING` through a small native setter, or injected CSS.
   - Choose by testing real pages, and record.
5. **#170 Font style:** Default / Sans / Serif / Monospace, for page text through injected CSS. **Icon fonts must stay
   intact**; test pages with icon fonts.
6. **#272 Default Urdu font:** Urdu text on pages shows in Nastaliq; setting, default **on**.
   - Check first whether the system already has it (`adb shell ls /system/fonts | grep -i nastaliq`), and use
     `local()`.
   - Otherwise bundle Noto Nastaliq Urdu (OFL). Serve it only through `androidx.webkit.WebViewAssetLoader`
     (`https://appassets.androidplatform.net/…`, native), so pages can't read any other app file.
   - Scope it with `:lang(ur)` and an Arabic-script `unicode-range`, so English text is untouched.
7. **#179 Colour filters:** None / Grayscale / Protanopia / Deuteranopia / Tritanopia.
   - Apply a native colour-matrix paint on the WebView's layer (`setLayerType(…, Paint(ColorMatrixColorFilter))`).
     It doesn't break page layout the way CSS `filter` on `<html>` does.
8. **#180 Night light:** a warm colour matrix with a strength slider, composed with #179.
9. **#181 Brightness:**
   - A window-brightness slider (`expo-brightness`, no permission).
   - System brightness returns when the user leaves the browser or the app.
10. **One "Page display" panel** from the menu (Aa) holds the common controls.
    - Global defaults live in Browser settings → Page display.
    - A per-site list has Reset.

**Automated:**
- Value resolution: global, then per site.
- Colour matrices and their composition.
- The CSS builder keeps icon fonts.
- The viewport rewrite.

**Manual:**
- Wikipedia; a site with its own dark mode; a site that blocks zoom (record which).
- Text at 200 % and reflow.
- Fonts.
- ur.wikipedia.org and BBC Urdu in Nastaliq, with English text unchanged.
- Each colour filter (screenshots), and night light.
- Brightness, and that it is restored.
- Page video still plays with the filters on.
- Scrolling jank before/after (`dumpsys gfxinfo`, record).
- Pinch on a real phone (or BLOCKED).

### B18 — Data saver and performance (3 points)

Features: Block Images (#183), Data Saver (#184), Data Usage Counter (#185), Lite Mode (#188), Hardware Acceleration
(#189), Battery Saver (#191), Cache Limit (#192), Images on Wi-Fi Only (#193), Lightweight Home (#285).

**Today:**
- `src/screens/data-usage/DataUsageScreen.tsx` shows **download** data and limits.
- The network type comes from `@react-native-community/netinfo`.
- The WebView uses the platform cache.

**Build:**
1. **#183 Block images:**
   - Real blocking, so no image bytes are downloaded: `WebSettings.setBlockNetworkImage(true)` through a native
     setter. CSS hiding saves nothing.
   - Per-site exceptions.
2. **#193 Images on Wi-Fi only:** blocked on mobile data and loaded on Wi-Fi. A network change applies from the next
   page load.
3. **#184 Data saver:** one switch that turns on:
   - images on Wi-Fi only;
   - no preloading (B6);
   - Lite mode on mobile data;
   - Faran's autoplay blocking, through a hook only.

   Add the `Save-Data: on` header only if it can be done without touching the patch; otherwise skip it and record
   that.
4. **#185 Data usage counter:**
   - Browsing data = the app's `TrafficStats` bytes (native, no permission) minus the bytes the download engine
     reports.
   - Sampled on pause and resume, and safe across reboots (counters reset).
   - Shown as a "Browsing" section in Data usage: today, this month, Reset.
   - Per-site numbers need request interception, which isn't yours; record that.
5. **#188 Lite mode** for slow phones and networks:
   - one live WebView;
   - animations and transitions off (injected CSS);
   - images on Wi-Fi only;
   - the light start page.

   Record the exact set.
6. **#189 Hardware acceleration:** default on.
   - **On = today's behaviour** (`androidLayerType` not set / `'none'`); Off = `'software'`.
   - Never `'hardware'` for all tabs: it costs memory.
   - Applies after a reload.
7. **#191 Battery saver:** follows Android Battery Saver (`PowerManager.isPowerSaveMode`, native), or a manual
   switch. While active: no preloading, and slower auto-scroll. A hook lets Faran's tab sleeping (B3) act sooner.
8. **#192 Cache limit:**
   - Browser settings → Cache shows the WebView cache size (measured natively).
   - A limit of 50 / 100 / 250 / 500 MB / Off, default Off.
   - Over the limit, the cache is cleared at the next start (`clearCache(true)` through the WebView ref).
   - A "Clear cache now" button.
9. **#285 Lightweight home:** a start page with no images or thumbnails, and text lists of Quick Access and
   bookmarks. On in Lite mode, or by its own switch.

**Automated:**
- Image-blocking decision table: network × setting × site exception.
- `TrafficStats` delta accounting: reboot reset, negative deltas, day/month rollover, minus download bytes.
- Cache trigger.
- Lite-mode set.

**Manual:**
- An image-heavy page with blocking on/off: compare the counter (record the bytes).
- Mobile data vs Wi-Fi (`svc wifi disable`).
- Data saver and Lite mode.
- Hardware acceleration off still renders.
- Battery saver (`adb shell settings put global low_power 1`, then `0`).
- Cache limit 50 MB → cleared at the next start.
- Lightweight home.

### B22 — Share, QR and upload (3 points)

Features: Create QR Code (#249), QR Code Scan (#30), File Upload (#254), Camera Upload (#255), Save to Notes (#252),
Open in App Prompt (#273), Quick Form Fill (#274).

**Today:**
- Share link exists (`src/browser/actions/builtins/share-link.action.ts`).
- `intent:` links are handled by `src/browser/navigation/intent-navigation.service.ts` and
  `modules/vidorax-web/.../IntentUris.kt`.
- The app declares **no CAMERA permission**, so react-native-webview's file chooser offers the system camera app
  (`RNCWebViewModuleImpl.java`, `needsCameraPermission`).

**Build:**
1. **#249 Create QR:**
   - Menu → "QR code" shows the page URL as a QR (a pure-JS generator rendered with react-native-svg).
   - Share as an image, and save to the gallery (MediaStore; check `minSdkVersion` and use share only where saving
     would need storage permission).
2. **#30 Scan QR:**
   - A scan button in the empty address bar and on the start page.
   - Google code scanner (`play-services-code-scanner`, no CAMERA permission) through a small native call.
   - Results:
     - a URL → "Open <host>?" first;
     - text → search or copy;
     - `javascript:` / `intent:` / `file:` → shown as text only.
   - No Play services → a clear message.
3. **#254 File upload:** verify `<input type=file>` with single and multiple files, `accept` filters and **cancel**
   (the page gets no file and doesn't hang). Fix what's broken.
4. **#255 Camera upload:** `accept="image/*"` and `capture` open the system camera. Check the null-photo-intent path
   doesn't crash.
5. **#252 Save to notes:**
   - In-app Notes (local table; §1 migration rules) from the B8 selection menu, or "Save page to notes" (title + URL
     + optional selection).
   - A Notes screen with search, edit, delete, copy and share.
6. **#273 Open in app:**
   - For a fixed list of sites whose app is installed (YouTube, Instagram, Facebook, TikTok, X, Google Maps): a
     small "Open in app" chip, once per site per session.
   - Detect the apps with specific `<queries><package …/></queries>` entries (never `QUERY_ALL_PACKAGES`).
   - Launch with the page URL, using `FLAG_ACTIVITY_REQUIRE_NON_BROWSER` where available.
   - "Don't ask for this site", and a setting to turn the chip off.
7. **#274 Quick form fill:**
   - The user saves their own text snippets in Browser settings → Form snippets.
   - When a page text field is focused, a small bar above the keyboard offers them; a tap inserts into the focused
     field, firing input events so page frameworks see it.
   - **Never** offered for password, one-time-code or credit-card fields (`autocomplete="cc-*"`).
   - Never fills by itself; never leaves the phone.
   - This is not the on-hold Address/Contact Autofill: no field detection, no profile.

**Automated:**
- QR result handling, including dangerous schemes.
- Site → package map.
- Field eligibility: types and `autocomplete` values.
- The insertion script.
- Notes repository and migration.

**Manual:**
- Create a QR and decode it (`zbarimg` on the Mac if available, or another phone).
- Scan on the emulator (BLOCKED if the camera or Play services can't) and on a real phone.
- Uploads on `https://www.w3schools.com/tags/tryit.asp?filename=tryhtml5_input_type_file` and a fixture page:
  single, multiple, cancel.
- Camera upload.
- Notes from a selection.
- Open in app with Google Maps (`https://maps.google.com/?q=Lahore`).
- Form snippets on a public form; none on a password field.
- No CAMERA in the merged manifest.

### B2 — Tab groups and timeline (3 points)

Features: Tab Groups (#6), Smart Tab Grouping (#258), Tab Timeline (#259), Tab Group History (#288). Needs B1 and
B4's domain helper.

**Build:**
1. **#6 Groups:**
   - Create a group from a tab's menu, or by dropping a tab on another.
   - Name and colour (8 theme-safe colours).
   - Collapse / expand, move tabs in and out, close a group.
   - Persisted; the tab envelope gets its next version.
2. **#258 Smart grouping:**
   - "Group by site" (same registrable domain).
   - Optional setting: tabs opened from a page join the opener's group.
3. **#259 Timeline:** a switcher view of open and recently closed tabs by time opened / last used: Today, Yesterday,
   Earlier.
4. **#288 Group history:**
   - Closing a group keeps it (last 10).
   - "Recently closed groups" restores its tabs into the group.
   - At the 10-tab limit, restore what fits and say so.

**Automated:** group operations at the limit, smart grouping, timeline order, envelope migration from B1's version.

**Manual:**
- Groups across 10 tabs, through a restart.
- Restore a closed group.
- Urdu names.
- TalkBack.

### B19 — Developer tools (5 points)

Features: Inspect Element (#222), Console (#223), Network Tab (#224), View Source (#225), Change User Agent (#226),
Device Emulation (#227), Remote Debugging (#228), Storage Inspector (#230), Security Panel (#231), User Scripts
(#199).

**Today:**
- Desktop mode switches the user agent per tab (`src/browser/session/desktop-mode.service.ts`,
  `src/browser/constants/user-agent.ts`).
- The document-start script is `src/browser/bridge/browser-chrome.injected.ts`; messages are parsed in
  `browser-chrome.bridge.ts`.
- A request/response example is `src/browser/services/page-link-grabber.ts` (request id, timeout, size cap).

**Build:** Browser settings → Developer → "Developer tools", default **off**. When on, Menu → Developer tools opens a
bottom panel. When off, nothing is injected and nothing costs anything.

1. **#223 Console:**
   - The page's `console.*` and uncaught errors, captured from document start while the tools are on: a 500-entry
     buffer per tab, a level filter, Clear.
   - An input line runs the user's JavaScript in the page and shows the result.
2. **#224 Network:**
   - The page's requests from the Resource Timing API: URL, type, transfer size, duration, status where available.
   - Says plainly that headers and bodies aren't shown.
   - Don't reuse `NetworkMediaObserver`; that's media detection.
3. **#222 Inspect:**
   - In tap-to-select mode, the touched element is highlighted.
   - The panel shows its tag, id, classes, size, key computed styles and its outer HTML (truncated, copyable).
   - Parent/child navigation. Read-only.
4. **#225 View source:** re-fetches the page in the page context (same cookies) and shows the HTML with line numbers,
   search, wrap and copy.
5. **#226 User agent:**
   - Presets per tab: Default, Desktop (reuse desktop mode), iPhone, iPad, Custom.
   - Applied on reload.
6. **#227 Device emulation:**
   - Viewport presets: 360, 412, 768, 1280 and 1440 px, through a viewport override plus the matching UA.
   - Rotate and reset.
7. **#228 Remote debugging:**
   - A switch with a warning ("anyone with USB access can inspect pages").
   - Native `WebView.setWebContentsDebuggingEnabled(true)`; off again at the next app start.
   - Verify from the Mac: `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`, then
     `curl localhost:9222/json`.
8. **#230 Storage:**
   - The current site's cookies (native `CookieManager.getCookie`, values masked until tapped), plus localStorage and
     sessionStorage keys and values.
   - Delete one item; clear the site's storage.
9. **#231 Security:**
   - Protocol and certificate (issuer, subject, validity), from Faran's #125 if it's in your branch, else a small
     native `getCertificate` read.
   - Mixed-content warnings from the console.
10. **#199 User scripts:**
    - The user's own scripts: name, match patterns (`*://*.example.com/*`), run at start or end, on/off.
    - A plain editor, and import of a `.user.js` file (read the `// ==UserScript==` header).
    - Scripts run only on matching pages, with page rights only, and the panel shows which ran.
    - Never downloaded automatically.
    - Record the Play note: JavaScript in a WebView is allowed under the Device and Network Abuse policy.

**Automated:**
- Console serialization: circular objects, long strings, errors.
- Resource-timing mapping.
- Outer-HTML truncation.
- UA and viewport presets.
- The match-pattern matcher (Chrome extension semantics).
- The userscript header parser.
- Cookie masking.

**Manual:**
- Wikipedia, and a fixture page with console errors.
- Network list; inspect.
- Source of a large page.
- UA presets checked on `https://httpbin.org/user-agent`.
- Device emulation.
- Remote debugging from the Mac.
- Storage on a site with localStorage.
- A user script that recolours `example.com`.
- Tools off → nothing injected (check with a debug build).

### B23 — Annotate and page alerts (3 points)

Features: Highlight and Annotate (#261), Draw on Page (#279), Page Change Alert (#289), Language Detection (#263).

**Build:**
1. **#261 Highlight and annotate:**
   - Selection menu → Highlight (4 colours) + an optional note.
   - Stored per normalized page URL with text-quote anchors (exact text + prefix/suffix), so highlights return on
     the next visit even when the page shifts a little.
   - "Highlights on this page", and an all-highlights screen with search, share and delete.
2. **#279 Draw on page:**
   - Capture the visible page (Faran's #174 if present, else B1's snapshot at full size).
   - Draw with pen colours and sizes, eraser, undo/redo.
   - Save to `Pictures/VidoraX` or share.
3. **#289 Page change alert:**
   - "Watch this page": the app re-fetches it in the background with `expo-background-task` (v57 docs; manifest
     changes by hand). Every 6 h by default, at least 1 h, Wi-Fi only by default, no cookies.
   - It compares a hash of the page's readable text and posts a local notification "Page changed: <title>"
     (`expo-notifications`, respecting the app's notification setting).
   - A Watched pages list, maximum 20.
   - Pages that render only with JavaScript show "can't be watched" instead of false alerts.
4. **#263 Language detection:**
   - Detect from `<html lang>`, else from the text's script. Urdu-specific letters (ٹ ڈ ڑ ں ے ھ) tell Urdu from
     Arabic or Persian.
   - When it differs from the app language, offer "Translate this page?" once per site: Translate / Never for this
     language / Never for this site.
   - Translate uses the existing `src/browser/services/translate-page.ts`.

**Automated:**
- Text-quote anchoring: shifted, ambiguous, missing.
- The drawing undo stack.
- Change-hash normalization.
- Schedule rules.
- Language samples: ur, ar, fa, hi, en.
- Prompt suppression.

**Manual:**
- Highlight on Wikipedia → reload → still there.
- A drawing saved and visible in Files / Photos.
- A watched fixture page (debug build) changed by you → notification after a forced run
  (`BackgroundTask.triggerTaskWorkerForTestingAsync()` on debug).
- The language prompt on a French page in the English app, and on an English page in the Urdu app.

### B24 — Urdu, calendar and widgets (3 points)

Features: Urdu Input Support (#271), Dual Calendar (#269), Prayer Times Widget (#270), Search Widget (#65).

**Today:** a home-screen widget already exists for downloads
(`modules/vidorax-media/android/src/main/java/com/vidorax/media/widget/DownloadsWidgetProvider.kt`): follow its
pattern.

**Build:**
1. **#271 Urdu input:**
   - The address bar and the app's fields handle Urdu fully: caret and alignment by text direction, mixed
     Urdu/English, correct encoding in searches, Urdu matching in history, bookmark and tab search, and Eastern
     digits.
   - When no Urdu keyboard is enabled, a hint in Browser settings → Language input with "Add Urdu keyboard" (opens
     `Settings.ACTION_INPUT_METHOD_SETTINGS`).
   - Typing Urdu into page forms is the keyboard's job: verify it with Gboard Urdu.
2. **#269 Dual calendar:**
   - The start page shows today in Gregorian and Hijri, with Urdu month names in the Urdu app.
   - Hijri comes from Hermes `Intl` Islamic calendars **only if they work on the device** (test that), else a
     bundled Umm al-Qura/tabular algorithm.
   - A ±2-day adjustment (Pakistan follows local moon sighting).
   - A tap opens a month view with both calendars. Show/hide setting.
3. **#270 Prayer times** card on the start page:
   - The five times plus a countdown to the next prayer, computed on the phone (e.g. the `adhan` library, MIT).
   - The city comes from a bundled list (Pakistani cities + major world cities with coordinates and time zones) or
     coordinates entered by hand. **No location permission.**
   - Calculation method default University of Islamic Sciences, Karachi. Asr Hanafi (default) / Shafi.
     High-latitude rule.
   - Urdu names (فجر، ظہر، عصر، مغرب، عشاء). Show/hide setting.
   - No adhan audio or notifications (not requested; record).
4. **#65 Search widget:**
   - A resizable 4×1 home-screen widget with the VidoraX mark and a search-field look.
   - A tap opens VidoraX with a new tab and the address bar focused; App Lock first.
   - Light and dark; Urdu label.

**Automated:**
- Hijri vs a table of known dates, with the adjustment.
- Prayer times vs published timetables (Lahore, Karachi, London; 3 dates each; within 2 minutes).
- The city list.
- Mixed-direction text helpers.
- Widget intent routing.

**Manual:**
- Urdu typing in the address bar, search and bookmark edit, with Gboard Urdu.
- The calendar in English and Urdu, plus the adjustment.
- The prayer card for Lahore and London.
- Add the widget (long-press home → Widgets) → tap → address bar focused. Also with App Lock on, and in Dark.

## 7. Finish

When all 16 packages are done:
1. Full gate on the final head; the upgrade check; R1–R16 (§4) on a fresh release build, installed over the seeded
   1.1.0 APK; one real phone if available. Record the totals.
2. The work log is complete:
   - every manual case is PASS or BLOCKED with a reason, and no `CHECK` is left unconfirmed;
   - the lists "Native changes for Faran to review", "New dependencies" and "New settings and defaults";
   - `docs/ARCHITECTURE.md` and the HANDOFF entry are current.
3. **Client checklist ticks:**
   - In the work log, a table: feature # → Done / Already present / BLOCKED → evidence.
   - Copy `~/Downloads/VidoraX-Client-APK/VidoraX-Feature-Checklist-1.1.0.xlsx` to
     `~/Downloads/VidoraX-Client-APK/VidoraX-Feature-Checklist-browser-hamza.xlsx`. Never edit the original.
   - In the copy (openpyxl, keeping all formatting, the conditional formats and the ✔/✘ dropdown):
     - set column F to ✔ for each Done feature, with a short note in column I;
     - update the Summary sheet's Browser and Total counts;
     - leave *Checklist* as the active sheet.
4. **Final message to the owner:**
   - A table of the 16 packages: status, commits, tests added, manual cases passed, measurements.
   - Everything BLOCKED, with reasons.
   - Decisions; new settings and their defaults; new dependencies (licence, size); native changes for Faran.
   - The permission comparison (should be unchanged), and the APK size change.
   - "Found, not fixed".
   - Branch state: pushed with the PR link, or local only.
