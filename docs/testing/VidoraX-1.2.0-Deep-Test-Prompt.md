# VidoraX 1.2.0 (design build): deep test and debug prompt, Browser and Downloader

> Paste everything below the line into a fresh Claude Code session that has `adb` and an Android emulator or phone.
> It is self-contained.

---

## 0. Your role and goal

You are a senior Android QA and debugging engineer. Test the release APK of **VidoraX 1.2.0 (versionCode 5,
design build)** against the client's requirements for two modules, the **Browser** and the **Downloader**. Prove each
requirement works on a real device, with evidence. For every failure, find the root cause in the source code.

The goal is a **report the client can trust**, not a green checkmark. Follow these four rules for every item:

- Mark it PASS only when you saw it work on the device.
- Mark it FAIL with evidence when it doesn't.
- Mark it BLOCKED with the reason when the environment can't show it (no microphone, a site is down, a login wall).
- Mark it N/A only for features on the "not in this release" list (section 9).

Never guess and never assume. If you didn't run it, it's NOT TESTED.

Work through the whole plan. Don't stop at the first bug: log it, then continue. Deliver the report in section 11's
format.

## 1. Hard rules (non-negotiable)

1. **Test and diagnose only. Don't change the app's code, commit, push or open PRs** unless the user tells you to in
   this chat. Root-causing means reading code and citing `file:line`, not editing it.
2. **Security on this Mac.** A Node trojan has hit this machine twice through npm's `cli.js`. You don't need npm,
   npx or Gradle for this job: you test a prebuilt APK. If anything ever makes you think you need them, first run
   both checks below, and stop and tell the user if either fails:
   - `ls -d ~/.node_modules` must say "No such file".
   - `grep -c npm-ws ~/.nvm/versions/node/v22.23.1/lib/node_modules/npm/lib/cli.js` must print `0`.

   Never run `npm install`.
3. **Never read or touch the signing key** in `~/.vidorax-signing`.
4. **Never sign in to any website or account, and never create one.** A login or sign-up wall is a finding: record
   where it appeared, then go back. Never type real passwords, card numbers or personal data. Test PINs such as
   `123456` and fake form data are fine.
5. **Local-only app.** VidoraX has no backend. Any request to a VidoraX-owned server is a **critical** finding.
6. **Don't weaken safety guards to make a test pass.** For example, the private-network URL guard rejects `10.0.2.2`
   on purpose.
7. **Report outcomes faithfully.** Include the exact command output, logcat excerpt or screenshot path for every FAIL.
8. **Respect the sites you visit.** Load public pages at a normal human pace, with no scraping loops or load testing
   of third-party sites.

## 2. Inputs (read these first, about 20 minutes)

| What | Where |
|---|---|
| APK under test | `~/Downloads/VidoraX-Client-APK/VidoraX-1.2.0-vc5-design.apk` (SHA-256 `5a2a82561bd22b4198ae1879305041080568c83becc9300f98b69c32502033ed`) |
| Previous build users have (upgrade source) | `~/Downloads/VidoraX-Client-APK/VidoraX-1.1.0-vc4.apk` (versionCode 4, same upload key) |
| Pre-design 1.2.0 (second upgrade source) | `~/Downloads/VidoraX-Client-APK/VidoraX-1.2.0-vc5.apk`. **Do not ship it**: it promotes login-wall Quick Access tiles. |
| Client design (the requirement) | `~/Downloads/VidoraX-6-Themes-65-Screens (1).pdf`: 54 pages = 6 themes × 9 pages. Pages 1–9 are the Light theme with every screen. Each screen has a caption listing its features under "Features:". |
| Feature status sheets (scope) | `~/Downloads/VidoraX-Client-APK/VidoraX-Design-Check-1.2.0.xlsx` (133 design features, with an ID per screen), `VidoraX-Downloader-Feature-Status-1.2.0.xlsx` (145 downloader features), `VidoraX-Browser-Features-Agreed-List.xlsx` (190 browser features) |
| Source code | `/Users/mac/Downloads/vidorax-mobile/.claude/worktrees/downloader-finalized-formats-4a36f8`, branch `claude/design-65-screens` (PR cool-developer-dot/downloader#39). JS/TS is in `src/`; native Kotlin is in `modules/vidorax-media` (download engine) and `modules/vidorax-web` (browser). |
| Engineering notes | `docs/HANDOFF.md` §4.34–4.40, `docs/ARCHITECTURE.md`, `docs/REMOTE_API.md`, `docs/AUTOMATION.md` |

Read the PDF pages 1–9 with the Read tool, using the `pages` parameter, 4–5 pages at a time. Read the "Browser &
Downloads" sheet of the design-check xlsx with Python and openpyxl, or `markitdown`. Your test IDs must reuse that
sheet's screen numbers (1–17, 33–47).

## 3. Environment setup

### 3.1 Device

- **Preferred:** the AVD `VidoraX_Browser_F` (Android 15, Google APIs; it has Google voice input).
  - Start it with `~/Library/Android/sdk/emulator/emulator -avd VidoraX_Browser_F -no-snapshot-save -no-boot-anim -gpu host &`.
  - Wait until `adb shell getprop sys.boot_completed` prints 1.
- **Also:** if a physical Android phone is connected (`adb devices`), repeat sections 6.2, 7.3 and 8 on it. A real phone
  has a microphone, real mobile data and real battery behaviour.
- Pass `-s <serial>` to every adb command. Make a helper: `a() { adb -s emulator-5554 "$@"; }`.

### 3.2 Identity of the app

- Package: `com.vidorax.fast.videodownloader`
- Launcher activity: `com.anonymous.vidorax.MainActivity` (NOT `.MainActivity`)
- Launch: `a shell monkey -p com.vidorax.fast.videodownloader -c android.intent.category.LAUNCHER 1`
- It's a release build, so `run-as` won't work, there are no dev logs, and `http://` pages are refused. Use only
  HTTPS test pages.

### 3.3 Install paths you must exercise (each is its own test)

1. **Fresh install:**
   - `a uninstall com.vidorax.fast.videodownloader`
   - `a install <design apk>`
2. **Upgrade from production 1.1.0:**
   - Uninstall, install `VidoraX-1.1.0-vc4.apk`, launch, and finish onboarding.
   - Change one setting (for example the theme to Dark) and download one small video.
   - `a install -r <design apk>`. Data must survive.
3. **Upgrade from 1.1.0 without touching any setting.** This is the zustand-5 trap: untouched settings are never
   persisted. Expected after the upgrade: Settings view = **Advanced**, Live recording = **on**.
4. **Upgrade from the pre-design 1.2.0** (`VidoraX-1.2.0-vc5.apk`, same versionCode; use `install -r -d`).

The same upload key signs all builds, so `install -r` must succeed. A signature error is a FAIL.

### 3.4 Navigation shortcuts (deep links)

Every screen opens directly with:
`a shell am start -a android.intent.action.VIEW -d "vidorax://<route>" -p com.vidorax.fast.videodownloader`

- **Browser:**
  - `browser`, `browser/tabs`, `browser/page-tools`, `browser/bookmarks`, `browser/history`
  - `browser/privacy`, `browser/incognito`, `browser/passwords`, `browser/developer`, `browser/settings`
  - `browser/search`, `browser/tab-options`, `browser/focus`, `browser/utilities`, `browser/display`
  - `browser/notes`, `browser/highlights`, `browser/saved-pages`
- **Downloads:**
  - `downloads`, `downloads/add`, `downloads/batch-add`, `downloads/queue`, `downloads/queues`
  - `downloads/torrent`, `downloads/statistics`, `downloads/settings`, `downloads/alerts`, `downloads/playlist`
  - `downloads/live-convert`, `downloads/organize`, `downloads/link-grabber`, `downloads/network`
  - `downloads/file-actions`, `downloads/failed`, `downloads/notifications`, `downloads/history`
  - `downloads/favorites`, `downloads/<id>`
- **1.2.0 screens:** `watched-links`, `download-rules`, `remote-control`, `site-grabber?url=<encoded>`,
  `archive-import`, `paste-link`
- **App:** `settings`, `files`, `player`, `library`, `private`, `storage`, `data-usage`, `about`, `support`

**Also test that tapping through the UI reaches every screen.** Deep links skip the navigation code, so they don't
prove the in-app paths work.

### 3.5 Evidence tools

- **Screenshot:**
  - `a exec-out screencap -p > shots/<id>.png`
  - Downscale with `sips -Z 1200` before viewing.
  - To review many screens cheaply, put 4 screenshots side by side in one image with Python and PIL.
- **UI tree** (reliable tapping without guessing coordinates):
  - `a shell uiautomator dump /sdcard/u.xml && a shell cat /sdcard/u.xml`
  - Find a node by `text=`, `content-desc=` or `resource-id=` (testIDs are exposed as resource-id), then tap the
    centre of its `bounds`.
- **Crashes and errors:**
  - Clear with `a logcat -c` before each test group.
  - Afterwards run `a logcat -d | grep -E "FATAL EXCEPTION|AndroidRuntime|ANR in|ReactNativeJS|Hermes|E VidoraMedia|E VidoraWeb|W System.err"`.
  - A JS crash shows as a red-screen-free restart in release, so also check whether `pidof` changed.
- **Process:** `a shell pidof com.vidorax.fast.videodownloader`
  - Use `am kill` to simulate process death in the background, and `am force-stop` for a user force-stop.
- **Downloads engine state:**
  - `a shell dumpsys activity services com.vidorax.fast.videodownloader` (foreground service)
  - `a shell dumpsys notification --noredact | grep -A3 vidorax` (notifications)
  - `a shell dumpsys jobscheduler | grep -A5 vidorax` (watched-links job, background downloads)
- **Media playback:** `a shell dumpsys media_session | grep -A14 vidorax`
- **Files:**
  - `a shell ls -la /sdcard/Movies/VidoraX /sdcard/Download`
  - Compare size and SHA-256 against the source: `curl -sL <url> | shasum -a 256`, or `a shell sha256sum <file>`.
- **Network conditions:**
  - `a shell svc wifi disable|enable`, `a shell svc data disable|enable`
  - Airplane mode: `a shell cmd connectivity airplane-mode enable|disable`
- **Battery:**
  - `a shell dumpsys battery unplug`, `a shell dumpsys battery set level 10`, `a shell dumpsys battery reset`
- **Doze:**
  - `a shell dumpsys deviceidle force-idle`, then `a shell dumpsys deviceidle unforce`
- **Time:** `a shell cmd alarm set-time` is unreliable on emulators. Prefer settings that take a time window you can
  set near "now".
- **Theme switch:** Settings tab → Appearance → six swatches (resource-ids `settings-appearance-theme-light|dark|red|cream|midnight|blush`).
- **Language:** Settings → Language → Urdu. This turns on RTL; restart if the app asks.
- **Font scale:** `a shell settings put system font_scale 1.3` (reset to 1.0 afterwards).

## 4. Test data (public, HTTPS, no login)

Before using each URL, check it is still live: `curl -sIL --max-time 20 <url> | head -5`. Public test hosts disappear.

| Case | URL |
|---|---|
| Small MP4 (1 MB) | https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4 |
| Page with `<video><source>` | https://www.w3schools.com/html/html5_video.asp |
| Big progressive (pause/resume, 168 MB) | https://upload.wikimedia.org/wikipedia/commons/transcoded/c/c0/Big_Buck_Bunny_4K.webm/Big_Buck_Bunny_4K.webm.720p.vp9.webm |
| HLS in a page | `https://hlsjs.video-dev.org/demo/?src=` + urlencoded `https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8` |
| HLS (Apple) | https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/bipbop_4x3_variant.m3u8 |
| DASH SegmentTemplate | https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd |
| DASH split video+audio | https://storage.googleapis.com/wvmedia/clear/h264/tears/tears.mpd |
| DRM (must be REFUSED) | https://storage.googleapis.com/wvmedia/cenc/h264/tears/tears.mpd, https://playertest.longtailvideo.com/adaptive/oceans_aes/oceans_aes.m3u8 (AES-128 HLS: plays in the page, never offered) |
| Live HLS (live recording) | https://demo.unified-streaming.com/k8s/live/stable/live.isml/.m3u8 |
| Live DASH | https://livesim2.dashif.org/livesim2/testpic_2s/Manifest.mpd |
| Vimeo | https://vimeo.com/76979871 |
| Dailymotion | https://www.dailymotion.com/video/x9zk0s0 (may show a "Join" wall: record it, don't sign in) |
| TikTok | https://www.tiktok.com/@scout2015/video/6718335390845095173 |
| Facebook (mobile form) | https://m.facebook.com/watch/?v=1376350954687257 |
| Instagram reel | https://www.instagram.com/reel/DSxdvp9lcDa/ (may be blocked: split A/V or login; expected limits) |
| Bilibili mobile | https://www.bilibili.com/en/video/BV1BVaC6KEnw/ (redirects to m., progressive MP4) |
| YouTube (must be REFUSED) | https://www.youtube.com/watch?v=aqz-KE-bpKQ |
| RSS / Atom video feed | https://feeds.twit.tv/twit_video_hd.xml |
| Site to save offline | https://test-videos.co.uk/ |
| FTP | `ftp://ftp.gnu.org/gnu/hello/hello-2.12.tar.gz` (must be refused or flagged as not a video) and any public FTP video file you can find. Record "BLOCKED: no public FTP video" if none. FTPS if available. |
| Pattern (batch) | `https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_[1-2]MB.mp4` |
| Ad-heavy page (blocker count) | https://www.w3schools.com/html/ (about 5 blocked with the blocker on) |
| Login-free Quick Access | Vimeo /watch, TED /talks, Wikimedia Commons Category:Videos, Mixkit free stock video, NASA images (video), ESA Videos |

**Disguised file (malware warning):**
- Create a local zip and a fake video (an APK renamed `.mp4`).
- Push them with `a push x.mp4 /sdcard/Download/`.
- Open them with VidoraX through Files → "Open with", or `am start -a VIEW -t video/mp4 -d file:///sdcard/Download/x.mp4`
  (content URIs are better; use the system Files app to "Open with VidoraX").

**Malicious zip (extract guard):**
- Build it on the Mac with Python's zipfile. Include:
  - an entry named `../../evil.mp4` (path escape)
  - a 1 KB file that claims a 10 GB uncompressed size (zip bomb)
  - an encrypted entry
- Every one of them must be refused safely.

## 5. Global checks (run first; they affect everything)

| ID | Check | Expected |
|---|---|---|
| G1 | First run after a fresh install: splash, onboarding, tour | No flash of the wrong theme; every Skip works; the app lands on the Browser tab. New installs default to the **Simple** settings view and the **Light** theme. |
| G2 | Upgrades (3.3, paths 2–4) | Data and downloads kept; theme kept (a stored "logo" theme becomes **Red**; "system" becomes Light); Live recording on; Settings view Advanced for existing users; no crash on the first launch |
| G3 | Six themes × 10 screens | Pick Light/Dark/Red/Cream/Midnight/Blush. On each, open Browser home, a web page, Tabs, Page tools, Privacy, Downloads list, Add download, Download details, Download settings and Settings. Compare with the PDF (Light p.1–9; Dark p.10; Red p.19; Cream p.28; Midnight p.37; Blush p.46). |
| G3a | Red theme specifics | The red band reaches the top of the screen with **white** status-bar icons. The bottom bar is red with a white pill on the active tab. **No thin pink lines** under the address bar, at the progress strip, or between the browser toolbar and the tab bar. Check the video sheet too. |
| G3b | Dark/Midnight | Light status bar; force-dark web pages; the reader's dark palette follows |
| G4 | Urdu + RTL | Every Browser and Downloads screen mirrors correctly; no clipped or overflowing text; numbers, PIN, URL and email fields stay LTR; no untranslated English (grep the UI dump for Latin text on Urdu screens) |
| G5 | Font scale 1.3 and a narrow width (`wm size 720x1600`, reset afterwards) | No overlapping text; rows grow; tiles don't truncate important words |
| G6 | TalkBack spot check (toggles, rows, chips) | Every toggle announces its name and state; icon buttons have labels |
| G7 | Rotation on the video sheet, a web page and Download details | No crash; state kept |
| G8 | Five-tab bar (Browser · Downloads · Player · Files · Settings) | Every tab opens; the module stacks remember their screen; Android Back walks the stack, then leaves the app |
| G9 | Permissions | `aapt2 dump permissions <apk>`: 38 permissions, identical to the pre-design 1.2.0. No new restricted permission (no SMS, call log, all-files access, `REQUEST_INSTALL_PACKAGES`, `QUERY_ALL_PACKAGES`). `CHANGE_NETWORK_STATE` is expected. |
| G10 | Play-policy UI | Quick Access shows **only** Vimeo, TED Talks, Wikimedia, Mixkit, NASA and ESA. Open each tile on a **fresh install**: none may show a login, sign-up or phone-number wall (an earlier version was rejected for exactly this). No tile, banner or onboarding screen promotes Instagram, TikTok, Facebook, YouTube or any other login site. |

## 6. Browser module (design screens 1–9 and 34–39)

For each screen:

1. **Look:** compare it with its PDF frame (rows, order, labels, icons, toggles).
2. **Act:** exercise every row and chip. Use real effects, not just "it opened".
3. **Edge cases:** try the edge cases listed.
4. **Logcat:** check logcat.

Any "Not available yet" toast on a row that the design-check sheet marks "Done" is a FAIL.

### 6.1 Screens

**1 Home (start page)**
- Paste & Go with a URL on the clipboard, then with plain text (should search), then with an empty clipboard.
- Scan QR: camera permission prompt. On the emulator use the virtual scene, or mark BLOCKED.
- Search field: opens Search (34).
- **Mic → voice search:** Google's voice input sheet opens.
  - Real phone: say "vimeo dot com" → opens; say "cat videos" → searches.
  - Emulator: the sheet opens and closes with no result, and nothing breaks.
- Camera icon: QR.
- Clipboard monitor line: on/off state is correct; copying a video link shows "Download?".
- Quick Access (G10).
- Recent: the latest finished download (play / share / show in folder / details).
- Lightweight home when Data saver / lite mode is on.
- Prayer-times and dual-calendar cards appear when enabled.

**2 Tabs**
- Create 6+ tabs.
- Groups (Smart Tab Grouping by site), Incognito tab, Sleeping tabs (force sleep from Tab options).
- Tile badges: pinned, muted, sleeping.
- "New"; Tab Timeline (recently closed); Reopen closed tab.
- Manage: search tabs, sort, group by site, bookmark all, close all (with a confirm).
- Long-press a tile → Tab options (35).
- Drag-onto-tab grouping.
- 30+ tabs: memory and scroll performance (`dumpsys meminfo`).

**3 Page tools** (from ⋮ on a page and on the start page)
- Find in page: count, next/previous, case, whole word.
- Reader mode: theme, font, read aloud.
- Desktop site toggle: the page reloads with the desktop UA.
- Text size & zoom: reflow, Urdu font.
- Highlight & draw: annotate, save, reopen. Highlights persist.
- Save as PDF / Print; full-page capture.
- Save offline: open it from Saved pages with no network.
- Night light & filters.
- Address-bar calculator & converter.
- Selected text chips (select text in a page first): Copy, Share, Search, Translate (opens a translation of the selection).
- The MORE card: every legacy menu item works.

**4 Bookmarks**
- Folders: create, rename, delete with a confirm, reorder by drag.
- Bookmarks bar toggle; Tags & notes; Broken link check (add a dead URL first).
- Import/Export: round trip an HTML bookmarks file.
- Add to home screen (a launcher shortcut opens that page).
- Bookmark all tabs.
- Reading list and History chips; Notes chip.

**5 Privacy & security**
- Blocker on: w3schools shows "Blocked on this page: N" in the lock panel. The card shows "**N trackers & ads blocked this week**" with N ≥ the page count, and the number survives an app restart.
- HTTPS-only: an http link upgrades or warns.
- Phishing & safe browsing: the toggle is on and its tap explains Android Safe Browsing. Visit `https://testsafebrowsing.appspot.com/s/phishing.html`: the warning comes from the WebView.
- Cookie control: block third-party.
- Anti-fingerprinting says it isn't available (N/A).
- Proxy / DNS / JS off: JS off for a site works.
- Site permissions (location / camera / mic / notifications) and Certificate & site data: the certificate shows the issuer and the SHA-256, and clear site data works.

**6 Incognito**
- An incognito tab blocks screenshots: `screencap` gives a black image, as does the recent-apps thumbnail.
- Incognito lock (needs App Lock).
- Wipe on close: history and cookies are gone after closing.
- Incognito search engine.
- Extensions in incognito: shows "N of M user scripts allowed". The row opens Developer tools. Allowing a script per-script makes it run in incognito.
- Downloads made in incognito show the notice and never appear in history.

**7 Passwords**
- The notice says VidoraX never stores passwords. Each password row explains the phone's password manager (no "Not available yet").
- Autofill and Quick form fill open the form snippets. Snippets never appear on password, OTP or card fields: verify on a login form.

**8 Developer tools**
- Each row opens the devtools panel at that section: Inspect, Console, Network, View source, Device emulation & UA, Remote debugging, Storage inspector.
- User scripts toggle; add a script that changes the page's title.
- Performance profiler is N/A.

**9 Browser settings**
- Search engine: switch it, then search.
- Site search, suggestions, safe search.
- Homepage & startup: restore session on/off.
- Address bar position: top/bottom. Repeat G3a for the bottom position.
- Language & region.
- Data saver & lite mode; Block images / autoplay; Battery saver · cache limit; Memory monitor.
- BROWSE / PRIVACY / ADVANCED sections, and Keyboard shortcuts.

**34 Search**
- Live suggestions and URL autocomplete; suggestions on/off.
- Search shortcuts (`@w cats`).
- Site search; search language; region; safe search.
- **Mic.**
- **Converter rows:**
  - `5 km in mi` → `= 3.10686 mi`
  - `100 f to c` → `= 37.7778 °C`
  - `2 gb to mb` → `= 2000 MB`
  - `۵ kg to g` → `= 5000 g`
  - `5 km to kg` → no row
  - Tapping a converter row copies the result.
- Calculator rows: `12*(3+4)/2` → `= 42`.

**35 Tab options**
- Pin, mute, duplicate, move to new window (split screen), add to group, sleep.
- Close others/all; move up/down; volume.
- Link long-press: open in background / incognito.

**36 History**
- Search; day sections.
- Clear: last hour / today / 7 days / 4 weeks / all time. Check that the right entries vanish.
- Auto clear on exit; disable history; export.

**37 Focus**
- Start focus (25:00 countdown); Edit.
- Site blocker: add facebook.com; it's blocked during focus.
- Site time limit: 1 minute, then exceed it.
- Block autoplay.
- **Quiet downloads:** turn on → a download notification arrives with no sound or vibration (`dumpsys notification`: importance or sound fields). It's the same setting as Alerts → Silent mode.

**38 Utilities**
- Calculator / Converter tiles focus the address bar with a hint.
- Dual calendar; Prayer times card values (check against a known source for your city).
- Scan QR / Create QR; Save to notes; Install web app (add to home screen); Page alert (the page-change watch).
- Voice commands (voice input).
- Copy text from image is N/A.

**39 Display & Urdu**
- Font size / style; default Urdu font (Noori Nastaliq renders on an Urdu page such as `https://www.bbc.com/urdu`); Urdu input.
- Page zoom · text reflow; force dark; color filters · night light; brightness.
- Custom background (photo picker, no storage permission).

### 6.2 Browser engine and integration

- **Video detection on each site in section 4:**
  - The download bar or video sheet (33) appears for downloadable media.
  - **Refused with the right message:** YouTube, DRM (Widevine / AES), audio-only, private and LAN hosts.
  - Check that the CTA always refers to the **current** video after scrolling a feed (Dailymotion, TikTok).
- **Inbound links:**
  - Share-to-VidoraX from another app (`am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT <url>`).
  - An external VIEW of an http(s) link.
  - The `vidorax://paste-link` app shortcut; the search widget; bookmark shortcuts.
  - A cold start from a link: the link must not be lost.
- **Session restore:** kill the process with 5 tabs open; on relaunch the tabs return and the startup tab isn't overwritten.
- **Memory:** 15 heavy pages open → no ANR. Background tabs sleep. Record `dumpsys meminfo` TOTAL PSS.

## 7. Downloader module (design screens 10–17 and 33, 40–47, plus engine)

### 7.1 Screens

**10 Downloads list**
- Filter chips (All / Active / Queued / Completed); search; sort.
- Total-speed card with a 12-bar graph during 2+ downloads.
- Pause all / Resume all / Cancel all.
- Card states: downloading %, ETA, queued P2, completed (Play · Share · Show in folder), failed (Retry).
- Tap to toggle.
- "+ Add link" FAB; long-press the FAB for its menu.
- Play while downloading.

**11 Add download**
- Paste and Scan QR.
- Chips:
  - **Link:** single URL → video sheet.
  - **Batch:** see 7.2 P4.
  - **Torrent / Magnet:** must say it's not part of the Play build; there must be no crash and no fake progress.
  - **Playlist:** design 40.
- Quality; Rename before download (template); Save location (SAF picker); Auth · Referer · Headers (opens headers); Preview before download; Trim · Subtitle · Metadata; Data estimate.

**12 Download details** (running and completed items)
- The hero % / speed / done of total / left matches the engine.
- Segments: HLS/DASH show their segment count; a ranged file shows one bar (Partly by design).
- Priority, Connections per file, Per-download limit: they take effect mid-download (watch the speed).
- **Mirror sources** (running file download): add a mirror with a different host for the same file. A mismatched mirror (different length) is rejected.
- Checksum & repair: SHA-256 of the completed file. Repair a damaged partial (truncate it if you can, or kill mid-write).
- Notes · Tags · Lock (moves the file to Private; the PIN is required to see it).
- Start at…; Save location; Save thumbnail; Subtitles; Link actions (re-download, copy, share, **send to computer**); Edit (trim / convert); Rename; Favorite; Info.
- **Save to cloud** (Android save screen → Downloads → saved → offer to remove from the phone).
- **Check source for updates** (adds a weekly watch, visible in Watched links).
- **Comments:** Reddit or a JSON-LD page saves its comments; they are shown and deleted with the download.
- **Malware warning** for a disguised file.

**13 Queues & schedule**
- Main queue (max at once); Night queue; scheduled start/stop; weekly schedule.
- Smart rules: Wi-Fi only (with Wi-Fi off a download waits "Waiting for Wi-Fi"), Disable on roaming, Pause on low battery (battery set level 10), Only while charging (unplugged → waits).
- **Exit when done:** turn on, start a small download, put the app in the background → when the queue empties the app's process goes away (`pidof`) and the notification is gone. With the app in the foreground it must NOT exit.
- Post-download action.

**14 Torrent**
- The notice text is shown; every control says it isn't available. No crash.

**15 Statistics**
- Today / Month / Total numbers match what you downloaded (sizes add up).
- Largest download; data limit alert (set 50 MB/day, exceed it → alert); history · export · clear; error log.
- Automation rows: Page link / site grabber, Pattern download, **API · CLI · Extension bridge** → Remote control.
- Export / Import / **Send** queue:
  - Round trip on two installs or two devices.
  - Duplicates counted.
  - A malformed file is refused with a clear message.

**16 Download settings**
- Storage rows; Ask where to save (N/A toast); Duplicate action (ask / skip / keep both / replace: test each with the same link).
- Speed limiter: 500 KB/s caps the speed (measure it).
- **Simple vs Advanced view:**
  - In Simple these are hidden: Disk cache · buffer · timeout, Multi-network, Download rules, "Allow other apps".
  - Advanced shows them.
  - The Mode row switches the view; Alerts → Beginner/Advanced chips switch the same setting.
- Low memory mode: Automatic / On / Off. With On, 1 connection and 1 download at a time.
- Performance sheet: buffer KB, write cache, cooldown seconds (two files from the same site start ≥ N s apart), exit when done.
- Multi-network (Advanced): off and disabled while Wi-Fi only is on.
- User agent; advanced network sheet (timeouts).
- Behaviour toggles, notifications, MORE section, the TOOLS section opens every extra screen, the "Watch · Cloud · Remote" section, the Mode section.

**17 Alerts & sync**
- Progress notifications (permission flow on Android 13+); Sound & vibrate.
- Floating widget is N/A.
- Home widget (add the widget to the launcher: it shows active downloads, tap → app).
- **Battery exemption** opens Android's battery-optimization list. The app must not request `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`.
- Cross-device sync (send queue / import); Send to device → Remote control; Save / auto upload to cloud sheet; Beginner / Advanced.

**33 Video detected sheet**
- Preview; Video / Audio / Subtitles chips (Audio = refused or none for video-first; Subtitles behaviour).
- Quality rows with "best"; tap downloads at once.
- Rename; Save to; Trim · Subtitle · Metadata.
- **Source check badge:** "Secure" for HTTPS; "Not secure" for an http media URL (use a page that has one); "Check source" for a numeric IP, a punycode look-alike, a shortener or a long redirect chain.
- Play before download where offered.

**40 Playlist**
- Hand it links (Add → Playlist chip, or a Link Grabber prefill); All / Selected chips; check and uncheck.
- Quality for all; Data estimate; Cooldown between files (0 / 2 / 5 / 10 s: measure the gaps); "Download N".

**41 Live & convert**
- Live recording of the live HLS stream: starts, shows REC with its length and size, stops at the max length setting or by the user, and the result plays.
- Convert the last completed download (MP4 / MKV, etc.); Trim download; Post-download action.
- Compress / Metadata are N/A.

**42 Organize**
- Auto categorize; per-type and per-site folders (download two sites and check the folders on disk); filename template `{site}-{title}`; duplicate action.
- Size filter → Download rules.
- Tags / Custom extension are N/A.

**43 Link grabber**
- On a page with many links (test-videos.co.uk): the count and chips (Video / Audio / Docs / Images) are right.
- Select → "Add selected" → Batch Add prefilled.
- Pattern download: `[1-3]`, `[a-c]`, `[1-9:2]`, `{a,b}` and descending `[3-1]`.
- RSS download → Watched links; Include / exclude rules; Site grabber → Save a site with the current page.

**44 Network**
- Custom headers · Referer (prove a referer-protected link works only with it set, if you can find one; otherwise check that the header is sent with a request to `https://httpbin.org/headers` in a download).
- Custom user agent (`https://httpbin.org/user-agent` as a "download" or page).
- SSL / IPv6 toggles explain "always on".
- Multi-network; Remote control & Web UI (status shows the URL when on); Browser extension bridge; CLI · Automation API toggle (= allow other apps).

**45 File actions** (`downloads/file-actions?id=<id>`)
- Play, Show in folder, Share, **Send to device** (appears in the Web UI "Sent from phone"), **Save to cloud** (modal), Lock file, Verify checksum (SHA-256 matches `sha256sum`), Rename (the file on disk is renamed too), Delete with a confirm.

**46 Failed**
- Force failures:
  - A 404 link.
  - Airplane mode mid-download → "retrying soon".
  - A server that refuses ranges.
- Retry, Repair, Retry limit (5), Error log, Auto-resume after the network returns.
- Server limit detection is N/A.

**47 Notifications & widgets**
- Progress notification with Pause / Cancel actions working from the shade.
- Sound / Vibrate / Silent mode; the home widget's Add link / Continue / Music.
- Floating widget is N/A.

### 7.2 The 1.2.0 feature packages (deep)

- **P1 Engine tuning**
  - Buffer size and write cache: download the 168 MB WebM with the cache at 8 MB, then off. Both files are
    byte-identical to the source.
  - Low-memory mode set to On: 1 connection, 1 download at a time. Automatic mode needs a low-RAM device; mark it BLOCKED if you have none.
  - Cooldown per site; exit when done.
- **P2 Sources**
  - FTP/FTPS download + resume after airplane mode.
  - Mirrors: a matching mirror is accepted and used; a mismatched one is dropped. Failover when the main host dies
    needs a host you control; mark it BLOCKED otherwise.
  - Multi-network: on a real phone with Wi-Fi + mobile data, `dumpsys netstats` shows bytes on both. Mobile bytes
    count toward the data limit.
- **P3 Watched links**
  - Add the TWiT feed: "feed" kind, latest videos listed.
  - The hourly job is registered (`dumpsys jobscheduler`).
  - Auto-download new videos respects the rules.
  - A broken URL gives a clear message.
  - The notification deep link `vidorax://watched-links` opens the screen.
- **P4 Bulk adding**
  - Patterns (≤ 500, truncated message beyond that).
  - Include/exclude rules: types, words, regex and size (a size-rule skip shows "skipped by size").
  - M3U/PLS/XSPF playlists (host a tiny M3U on a public gist / raw URL, or paste its text).
  - "Open playlist" replaces a playlist link with its entries.
  - The choice list (Select all / none).
  - `link | mirror` lines save mirrors.
- **P5 Site grabber & comments**
  - Depth ≤ 2, ≤ 50 pages, 1 request/second (time it), robots.txt respected, no account or cart pages.
  - Stop works; saved pages open offline.
  - Found videos are added with the rules.
- **P6 Remote control** (laptop on the same Wi-Fi as a real phone; on the emulator use `adb forward tcp:<port> tcp:<port>` and treat it as BLOCKED for LAN-only behaviour)
  - Start: a random port, a 6-digit PIN or QR code, and the URL shown.
  - Web UI: queue, live progress, add a link, pause / resume / cancel / retry, the "Sent from phone" list with a 10-minute file ticket.
  - Wrong PIN 5× → 429 lockout with Retry-After.
  - Stops after 30 minutes idle, and on Wi-Fi loss.
  - **API** (`docs/REMOTE_API.md`): `GET info`, `POST pair`, `GET downloads` (+ `?format=tsv`), `POST downloads`, `GET links/<id>`, pause/resume/retry/cancel, pause-all/resume-all, `GET sent`, `DELETE sent/<id>`, `POST sent/<id>/ticket`, `/files/<ticket>`.
  - **Security:**
    - No token → 401.
    - Answers never contain media URLs, file paths or token hashes.
    - Headers present: CSP, `X-Frame-Options: DENY`, `nosniff`, `no-referrer`, `no-store`.
    - Path traversal on `/files/` is refused.
    - A non-LAN Origin is refused.
  - **CLI:** `extensions/cli` against the phone.
  - **Browser extension:** load `extensions/vidorax-bridge` unpacked in Chrome, pair, send the current tab's link, and see the phone's verdict.
  - **Automation intents** (off by default → ignored; logcat says "ignored"):
    - `a shell am broadcast -a com.vidorax.action.ADD_DOWNLOAD --es url <mp4> -p com.vidorax.fast.videodownloader`
    - `com.vidorax.action.PAUSE_ALL`, `com.vidorax.action.RESUME_ALL`
    - Turn on "Allow other apps", then repeat: they work.
    - The completion broadcast `com.vidorax.action.DOWNLOAD_COMPLETE` fires (register a receiver if possible; otherwise check logcat).
- **P7 Cloud**
  - Save a copy to … (Drive/Files); remove from phone after upload.
  - Auto upload (Save Location into a cloud folder, Wi-Fi only, retries).
  - Import from a folder (duplicates skipped; Drive's limitation is explained).
  - Queue to another phone.
- **P8 Safety & modes**
  - Malware warning for the disguised APK-as-MP4, a double extension `video.mp4.apk`, and an executable inside a zip.
  - Source check badge (above).
  - Extract archive:
    - A normal zip with videos and subtitles → imported to the library.
    - The malicious zip entries are refused.
    - Encrypted → refused.
    - RAR/7z → unsupported message.
  - Simple/Advanced (above).

### 7.3 Engine robustness (both modules)

| ID | Scenario | Expected |
|---|---|---|
| R1 | Pause at 40%, resume | Continues from the byte offset, no restart; the final file matches the source SHA-256 |
| R2 | `am kill` (process death) mid-download, relaunch | Resumes; no duplicate rows |
| R3 | Force-stop mid-download | Shows paused/failed honestly; resume works |
| R4 | Reboot mid-download (`a reboot`) | After the reboot the queue resumes (or waits per the settings) |
| R5 | Network loss / airplane mode mid-download, then restore | "Waiting for network", then auto-resume |
| R6 | Wi-Fi → mobile switch with Wi-Fi only on | Pauses on mobile, resumes on Wi-Fi |
| R7 | Storage nearly full (fill /sdcard with a large dummy file) | A clear "not enough space" error; no corrupt file left in the library |
| R8 | 10 simultaneous downloads (max concurrent 3) | Exactly 3 run, the others queue in order; progress never goes backwards (watch for steps back in the UI and the Web UI) |
| R9 | Doze (`deviceidle force-idle`) during a download | The foreground service keeps it going, or it resumes on exit; no ANR |
| R10 | Low battery 10% with pause-on-low-battery | Pauses; resumes after `battery reset` |
| R11 | Duplicate link while the first is running | Duplicate action is honoured |
| R12 | Same file from 2 tabs / batch + remote | One download, or a clear duplicate |
| R13 | Long-running live recording (10 min) | Memory stays flat (`dumpsys meminfo` every 2 minutes) |
| R14 | Cold start time | `am start -W` TotalTime, measured 3 times after `a shell am force-stop` (and once after a reboot). Report it; 26 s on this AVD is the known baseline under load. |

## 8. Cross-checks that often hide bugs

- Every toggle **persists**: change it, force-stop, relaunch, and check it's still changed. Repeat for 15 random
  toggles across both modules.
- Every setting **takes effect**, not just shows. For example, the speed limit caps the speed, and Wi-Fi only
  actually blocks mobile data.
- Back navigation from every pushed screen; Android back during sheets and modals; the hardware back in the browser
  walks page history before leaving.
- Strings: no raw keys (`lightDetails.foo`), no `{placeholder}` left unfilled, no English on Urdu screens, no
  "Not available yet" on a Done feature.
- Visual: nothing overlaps the status bar or the tab bar; the keyboard never hides the focused field (Batch Add,
  Search, PIN).
- Accessibility labels exist for icon-only buttons (UI dump: `content-desc` not empty).
- Theme switch **while** a download runs and a sheet is open: no crash; colours update.

## 9. Not in this release: mark N/A, do not report as bugs

These are deliberately absent, because of Google Play policy, the client's decisions, or technical limits:
- Torrent / magnet (whole screen 14)
- Proxy / SOCKS
- Saved passwords, password manager, checkup, strong-password suggestion, password import/export, payment autofill
- Floating widget
- Install APK
- Audio-only downloads; YouTube downloads; DRM content
- Copy text from image (OCR)
- Anti-fingerprinting
- Performance profiler
- Ask where to save
- Compress and metadata tagging
- Tags manager / custom extension
- Server limit detection
- A per-connection segment bar for ranged file downloads (one bar)
- Currency conversion

Two more limits are expected:
- The emulator has no microphone: the voice sheet opens but can't hear you.
- The release build refuses `http://` pages and LAN hosts.

The Player, Files, Private folder and App settings screens (PDF 18–32 and 48–65) aren't redesigned yet. Test that
they **work** (play a download, open Private with a PIN, change settings), but don't fail them for not matching the
PDF layout. List them separately.

**But:** if one of these N/A items shows broken UI, a crash, fake data or a misleading promise, that IS a bug.

## 10. Debugging protocol for every failure

1. **Reproduce it twice** from a clean state (force-stop; clear logcat). Note the minimal steps.
2. **Collect evidence:**
   - Screenshot(s).
   - Logcat around the failure: FATAL / ANR / JS errors, plus `VidoraMedia`, `VidoraWeb`, `ReactNativeJS`.
   - Engine or file state commands from 3.5.
3. **Classify:**
   - App bug, or
   - Site behaviour (a login wall, a site changed its player, a host is down: confirm with curl or another browser), or
   - Emulator limit, or
   - Expected by design (section 9).
4. **Root cause in source (read only):**
   - Find the screen by its testID: `grep -rn "testID=\"<id>\"" src`.
   - Follow the handler to the service or store, then to the native bridge if needed: `modules/vidorax-media/src/VidoraMedia.types.ts` → Kotlin in `modules/vidorax-media/android/src/main/java/com/vidorax/media/…` (engine) or `modules/vidorax-web/android/…` (browser).
   - Cite `file:line` and explain why it fails.
   - Check `docs/HANDOFF.md` for a known limitation before calling it a bug.
5. **Severity:**
   - **Critical:** crash, ANR, data loss, a corrupt file reported as complete, a security or privacy leak, a Play-policy violation such as a login wall promoted in the app, or a request to a VidoraX server.
   - **High:** a Done feature doesn't work, a wrong file is downloaded, a setting is ignored.
   - **Medium:** works with a wrong state, label or design mismatch, or bad RTL; a workaround exists.
   - **Low:** cosmetic.
6. **Suggested fix:** one or two sentences, plus the files to touch. Do not apply it.

## 11. Report format (deliver exactly this)

Save the report to the session folder as `VidoraX-1.2.0-Test-Report.md`. Also save the screenshots folder.

1. **Summary**
   - Build tested (SHA-256 check), device(s), date.
   - Totals: PASS / FAIL / BLOCKED / NOT TESTED / N/A.
   - Top 5 risks for the Play release in one line each.
2. **Release verdict:** "Ready for Play" or "Not ready", with the critical and high bugs that block it.
3. **Coverage matrix:** one row per design-check sheet feature (screens 1–17, 33–47), plus the G-, R- and 7.2 items.
   Columns: ID · screen · feature · result · evidence (screenshot path / log line) · notes.
4. **Bugs:** one block each:
   ```
   BUG-### [Severity] Title
   Screen / feature: <design #, feature>      Build: 1.2.0 vc5 design (5a2a8256…)
   Device: <AVD/phone, Android version>        Theme / language: <…>
   Steps: 1… 2… 3…
   Expected: …                                  Actual: …
   Reproducible: 2/2
   Evidence: shots/…png, logcat excerpt (≤ 20 lines)
   Root cause: path/to/file.ts:123 — <why>
   Suggested fix: …
   ```
5. **Design mismatches:** screen, PDF page, and what differs (label, order, icon, colour, missing row). Kept apart
   from functional bugs.
6. **Blocked and not tested:** what, why, and what's needed to test it (a real phone, a laptop on the LAN, an FTP host).
7. **Performance numbers:** cold start, memory per scenario, download speed with and without the cache, battery
   notes.
8. **Upgrade results:** the 3.3 paths 1–4.

Be concise in prose and exhaustive in coverage. If you run out of time, say exactly which sections were not run.
