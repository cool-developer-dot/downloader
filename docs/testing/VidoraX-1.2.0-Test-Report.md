# VidoraX 1.2.0 (design build): device test report, Browser and Downloader

## 0. Update 22 November 2026: the four main bugs and the Low findings are fixed and verified

The fixes are in a new build of the same APK, `VidoraX-1.2.0-vc5-design.apk`: SHA-256 `49bf6763…62db7fd5`, the same
upload-key certificate, and the same 38 permissions. Each fix was checked on the emulator against the original repro:

| Bug | Fix | Device check |
|---|---|---|
| BUG-001 (High) shared / opened links load unseen | `incoming-link.service.ts`: a link that arrives while the app runs calls `navigation.navigate(routePaths.browser)` (the launch link doesn't need it) | Share from Downloads, a VIEW from Settings, a share from the Tabs screen, a VIEW from the home screen: each shows the Browser tab at the page. **FIXED** (V1-*.png) |
| BUG-002 (Medium) empty Total speed graph | `'use no memo'` in `useTotalSpeedGraph` and `useDownloadProgressDetails` (React Compiler kept the first, empty read) | The 12-bar graph draws live during an HLS download. **FIXED** (V2-graph-2.png) |
| BUG-003 (Medium) tour step 1 on the hidden address bar | New tour target `startSearch` on the start page's search field; the "Address bar" step uses it while the header is hidden (`addressBarVisibility.isHidden()`) or slid off screen (`isMostlyOnScreen`, unit-tested) | Fresh data → step 1 spotlights "Search or paste link"; steps 2–6 unchanged. **FIXED** (V3-tour-step1-fixed.png) |
| BUG-004 (Medium) a linked module screen without its root | `unstable_settings = { anchor: 'index' }` in the Browser and Downloads stack layouts | `vidorax://downloads/settings` from Browser → Back → Downloads list (the tab keeps it); `vidorax://browser/privacy` from Downloads → Back → browser page. **FIXED** (V4-*.png) |

Checks after the fixes: tsc (app + tests) clean, JS tests 2024 / 2024 (one new), eslint 0 errors.

### The Low findings, fixed the same day

Build: `VidoraX-1.2.0-vc5-design.apk` replaced again, SHA-256 `f33ba26c…2aa25164`, same certificate
(`36b9c622…`), same 38 permissions.

| Bug | Fix | Check |
|---|---|---|
| BUG-005 failed card without Retry | `DownloadCard`: a failed card that can be retried shows an accent **Try again** in its status row (still in ⋮ too) | Storage filled so a 470 MB HLS download failed with "Not enough storage." → the card shows Try again → space freed, tapped → the download ran. **FIXED** (V5-failed-card.png, V5-state.png) |
| BUG-006 DNS errors while "connected" fail for good | Engine: a network error while Android says the network has no working internet (not `VALIDATED`) holds the download in "Waiting for network" and tries again when the internet is back (or every 30 s), without using up the retries; after about 15 minutes errors count as before | Unit tests `DownloadEngineNoInternetTest` (waits then completes; a network that never works still fails; a working network retries as before). Not reproduced on the AVD: its DNS can't be broken on demand. **FIXED (unit-tested)** |
| BUG-008 HLS name "x36xhzz.m3u8" | The sheet's Rename row shows the name the download really gets; playlist extensions (.m3u8/.mpd/…) are never part of a name. Found while checking: a pasted link's sheet showed the browser's last page name — it now uses its own link | HLS sheet → "x36xhzz", and the download is named "x36xhzz"; a pasted httpbin link → "response-headers". **FIXED** (V8-hls-rename.png, L5-pasted-rename.png) |
| BUG-009 404 shown as "Needs review" | Batch Add: a page link that answers 404 / 410 is "Not found: the link is gone (404)" (English and Urdu) | Pattern `[1-3]` with three 404 links → three "Not found" rows. **FIXED** (L9-batch-404.png) |
| BUG-010 system-styled disguised-file dialog | New themed app dialog (`showAppDialog` + `AppDialogHost`, built on `ConfirmModal`); the disguised-file and dangerous-file warnings use it | `holiday.mp4` (an APK) → Open with… → themed "This file isn't what its name says" with Cancel / Open anyway; Cancel closes it and it opens again. **FIXED** (V10-disguised-dialog.png) |

Checks: tsc (app + tests) clean, JS tests 2026 / 2026, eslint 0 errors, vidorax-media native tests 1137 / 1137
(3 new).

**Still open:** BUG-007 (an observation, not reproduced), and everything under "Blocked" and "Not tested" (section 6).
**Observation:** during a fast series of links (5 in about 2 minutes), the address bar once showed a different page
than the one on screen. It didn't come back after a restart and a single share; I'll watch for it.

## 1. Summary

| | |
|---|---|
| **Build** | `VidoraX-1.2.0-vc5-design.apk`, versionCode 5, SHA-256 `5a2a8256…2033ed` (verified) |
| **Device** | AVD `VidoraX_Browser_F`, Android 15 (API 35), 1080×2400. **No physical phone was available.** |
| **Date** | 21–22 November 2026 |
| **Method** | The prompt in `VidoraX-1.2.0-Deep-Test-Prompt.md`. Evidence is in `report-shots/`. |

**Results:** 37 PASS · 5 FAIL (1 High, 3 Medium, 1 Low) · 4 BLOCKED · many NOT TESTED (section 6) · N/A items
were skipped. Five more Low findings sit inside passing rows (BUG-006 to BUG-010).

**Top risks for the Play release:**
1. A link shared from another app doesn't bring VidoraX's browser forward, so nothing seems to happen (BUG-001).
2. The "Total speed" graph on the Downloads list is always empty (BUG-002).
3. Tour step 1 points at an address bar that the new start page hides (BUG-003).
4. A module screen opened by a deep link becomes the only screen in that tab, and Back leaves the tab (BUG-004).
5. Not checked on a real phone: voice input, real mobile data, the battery and Doze tests, and LAN remote control from a laptop.

## 2. Release verdict

**Updated 22 Nov: the High bug and the three Medium bugs are fixed and verified (section 0). The Low findings and the untested areas remain.** (The original verdict was: not ready yet, with one High bug blocking it, BUG-001.)

Everything that could lose data or get the app rejected passed:
- Downloads are byte-identical to their sources, including after pause, a network failure, an emulator restart and a retry.
- YouTube and DRM are refused.
- Quick Access shows only login-free sites.
- The malware and zip guards work.
- The remote API is locked down.
- Upgrades from 1.1.0 keep the user's data and settings.

## 3. Coverage matrix (what was run)

| ID | Area / feature | Result | Evidence |
|---|---|---|---|
| UP-1 | Fresh install: onboarding, tour, Light theme, **Simple** view | PASS | T-G1-*.png |
| UP-2 | Upgrade from 1.1.0 after changing the theme to Dark and downloading a video | PASS: Dark kept, the download is listed and plays | T-UP2-*.png, T-UP2b-*.png |
| UP-3 | Upgrade from 1.1.0 with no setting touched | PASS: Settings view **Advanced**, Live recording **on**, no crash | T-UP3-*.png |
| UP-4 | Upgrade from the pre-design 1.2.0 | PASS (run on 21 Nov during the design check: data kept, "logo" theme became Red) | — |
| G1 | First run: no theme flash; Skip works on every step | PASS | T-G1-first/tour/home |
| G3 | Six themes switch live (Light, Dark, Red, Cream, Midnight, Blush) | PASS (21 Nov design check) | earlier screenshots |
| G3a | Red: band behind the status bar, white icons, no pink lines | PASS (fixed in this build) | — |
| G4 | Urdu + right-to-left on 8 screens; no leftover English except page content and brand or technical words | PASS | T-G4-*.png |
| G9 | Permissions: 38, identical to 1.2.0; no restricted ones | PASS (aapt2 diff) | — |
| G10 | Quick Access on a fresh install: Vimeo, TED Talks, Wikimedia, Mixkit, NASA, ESA all open logged out with no wall (Vimeo and TED only show their own "Log in / Join" header links) | PASS | T-G10-*.png |
| 1 | Start page: search field, Paste & Go, Scan QR, clipboard line, Quick Access | PASS (look and navigation) | T-G1-home |
| 1/34 | Voice search: mic opens Google voice input | PASS (21 Nov). Speaking can't be tested: the emulator has no microphone. | — |
| 3 | Find in page ("domain" on example.com → "1 of 2") | PASS | T-B3-find-example2 |
| 5 | Weekly blocked count (w3schools: page 5 = week 5) | PASS (21 Nov) | — |
| 6 | Incognito tab blocks screenshots (screencap is solid black) | PASS | — |
| 34 | Address-bar unit converter `5 km in mi` → `= 3.10686 mi` | PASS (21 Nov) | — |
| D1 | Direct MP4 opened from outside: one tap downloads; file byte-identical to the source | PASS | T-D1-*.png |
| D2 | 168 MB WebM (multi-connection) byte-identical | PASS | — |
| R1 | Pause at 27% → paused; resume continues from the byte offset | PASS | T-R1-*.png |
| R4 | Emulator restart while failed, then "Try again": continues at about 53% and the 300 MB file is **byte-identical** | PASS | T-R4-after-reboot |
| R5 | Airplane mode mid-HLS download, then back online: auto-resumes and completes | PASS | T-R5-* |
| 33 | Video sheet (HLS): preview, **Secure** badge, chips, 5 qualities, rename, save to | PASS (one Low finding, BUG-008) | T-D33-hls-sheet |
| D3 | HLS 480p (Mux) and 720p (Apple bipbop) download and complete | PASS | — |
| D4 | DASH: 432p chosen → 768×432 file (track header checked) | PASS | — |
| D5 | YouTube refused ("YouTube downloads are not supported"); Widevine DASH refused ("This video can't be downloaded") | PASS | T-D5-youtube-drm |
| 41 | Live recording: start, "Recording · 0:46 · 3.7 MB", Stop (⋮) → 5.2 MB MP4 | PASS | T-D41-* |
| 11/P4 | Batch: pattern `[1-3]` → 3 links + choice list + rules; results 2 added, the 404 one → "Needs review" | PASS (one Low finding, BUG-009) | T-P4-* |
| 13 | Exit when done: a 31 MB download finishes in the background → VidoraX's task is closed (0 activities, gone from recents); setting persists | PASS | T-13-exit-on |
| 10 | List card progress updates live (13% → 24% in 15 s, matching the notification) | PASS (controlled run) | T-D10-card-live-sequence |
| 10 | Total speed card graph | **FAIL** (BUG-002) | T-D10-card-live-sequence |
| 10/46 | Failed card actions | **FAIL**, Low (BUG-005) | T-D10-failed-card |
| 47 | Progress notification: title, MB of total, speed, Pause/Cancel; completion; tap → Player library | PASS | T-N-* |
| P6 | Remote control starts on Wi-Fi: URL and PIN shown; "Connect to Wi-Fi" message when on mobile data | PASS | T-P6-remote-on |
| P6 | API: `info` 200; no token → 401; wrong PIN → `attemptsLeft` 4…1, then **429 locked + Retry-After 30**; pair; TSV and JSON list (no URLs or paths); `POST downloads` → checking → `added`; `/files/../` → 404; pause-all / resume-all | PASS | — |
| P6 | Web UI headers: CSP `default-src 'none'…`, `X-Frame-Options: DENY`, nosniff, no-referrer | PASS (page sends `no-cache`; the API sends `no-store`) | — |
| P6 | Automation intents: off → "ignored PAUSE_ALL" logged; on → `ADD_DOWNLOAD` queues the link | PASS | — |
| P8 | APK renamed `holiday.mp4`: Save → "Not saved: this file is not a video and may be harmful"; Open with → "This file isn't what its name says … really an Android app (APK)" | PASS (one Low design finding, BUG-010) | T-P8-* |
| P8 | Zip with `../../evil.mp4` → "This archive tries to put files outside its folder… won't open it" | PASS | T-P8-zip |
| R14 | Cold start (`am start -W`): 737 / 694 / 718 ms; PSS after start 237 MB | PASS | — |
| B2 | Share or VIEW a link while on another tab → the browser comes forward | **FAIL** (BUG-001) | T-B2-*.png, T-D1-browser-after-intent |
| T1 | First-run tour step 1 highlights the address bar | **FAIL** (BUG-003) | T-tour-step1, T-G1-tour |
| NAV | A deep link to a module screen from another tab | **FAIL** (BUG-004) | — |

## 4. Bugs

```
BUG-001 [High] A link shared or opened from another app loads silently: the app stays where it was
Screen / feature: 1 Browser home, share-to-app / default-browser VIEW   Build: 1.2.0 vc5 design (5a2a8256…)
Device: AVD Android 15        Theme / language: Light / English
Steps: 1. Open VidoraX and tap the Downloads tab.
       2. From another app, share a link to VidoraX (am start -a SEND --es android.intent.extra.TEXT <url> -p <pkg>).
Expected: the Browser tab comes forward and shows the link loading.
Actual: the app stays on the Downloads list (also seen on Settings, Network and Tabs). The link loads unseen in
        the browser's tab; the user sees nothing happen.
Reproducible: 3/3 (clean state after a force-stop, and twice before)
Evidence: report-shots/T-B2-clean-share.png, T-B2-share-from-downloads.png, T-D1-browser-after-intent.png
Root cause: src/browser/services/incoming-link.service.ts:32-46. `open()` calls `openPastedLink(url, …)` and returns.
            It never navigates to the browser. The same code exists in the pre-design 1.2.0 (8f69b5e), so this is
            older than the redesign. The nested browser stack makes it more visible.
Suggested fix: after `openPastedLink`, call `navigation.navigate(routePaths.browser)` and pop the browser stack to
               its index (`dismissTo` / `router.dismissAll` inside the browser stack). Add a test for the SEND and
               VIEW paths while another tab is in front.
```

```
BUG-002 [Medium] The Downloads "Total speed" card never draws its 12-bar graph
Screen / feature: 10 Downloads list (design: speed graph)
Steps: start any download, stay on the Downloads list for 20+ s.
Expected: 12 red bars, one per second, as in the PDF's frame 10.
Actual: the figure (e.g. 2.3 MB/s) updates, but the graph box stays empty in every sample.
Reproducible: 3/3 downloads (progressive, HLS, DASH)
Evidence: report-shots/T-D10-card-live-sequence.png (6 frames over 18 s), T-R5-airplane-crop.png
Root cause (PLAUSIBLE, not proven on device):
  src/screens/downloads/components/DownloadsTotalSpeed.tsx:66-82, `useTotalSpeedGraph`.
  - It reads `getProgressStats()` (a plain map outside React) inside `useMemo` and keeps `revision` as a
    dependency only through `void revision;` (line 71).
  - `app.json:84` turns the React Compiler on. The repo already knows that compiled components cache external
    reads, and fixes it with `'use no memo'` (e.g. DeveloperSettingsSection.tsx:35, FocusScreen.tsx:41).
  - So the hook most likely returns its first value (null: no samples yet) forever.
  - `useDownloadProgressDetails.ts:46-69` (Details: average speed, elapsed, graph) uses the same pattern, so check
    it too.
Suggested fix: add 'use no memo' to `useTotalSpeedGraph` (and the details hook), or compute from a snapshot
               selected through the stats store. Verify on device that bars appear within 2 s.
```

```
BUG-003 [Medium] First-run tour step 1 ("Address bar") highlights nothing on the new start page
Screen / feature: first-launch tour (T2) on screen 1
Steps: fresh install → onboarding Skip → tour step 1.
Expected: the spotlight on the search field ("Search or paste link").
Actual: the spotlight is a thin box over the status bar, with the card "Address bar — Paste a video link or search
        the web here" pointing at it. Steps 2–6 are correct.
Reproducible: 2/2 (fresh install, then after `pm clear`)
Evidence: report-shots/T-G1-tour.png, T-tour-step1.png, T-tour-steps-2-6.png
Root cause: src/browser/components/BrowserHeader/AddressBar.tsx:59 registers the `addressBar` tour target on the
            browser header's address bar. The redesign hides that header on the start page (AutoHideHeader
            collapses it to 0 height), so the measured target is an empty strip at the top.
Suggested fix: on the start page, register `addressBar` on BrowserHomeView's DsSearchField (`browser-home-search`),
               or skip the step while the chrome is hidden.
```

```
BUG-004 [Medium] A module screen opened by a deep link from another tab becomes the only screen in that tab
Screen / feature: Browser and Downloads nested stacks (vidorax:// links, e.g. widget and notification paths)
Steps: from the Browser tab, open vidorax://downloads/settings. Press Back or the ← arrow.
Expected: Back returns to the Downloads list; the Downloads tab still has its list.
Actual: Back leaves for the Browser tab. Tapping the Downloads tab (even twice) shows Download settings again; the
        list can't be reached until the app restarts. Same with browser/* screens: page loads from those screens
        went nowhere until a restart.
Reproducible: 3/3
Evidence: logcat-free; observed through UI dumps (see section 5 of this report)
Root cause: expo-router opens the nested route without its stack's index underneath. Hamza's notes say
            notifications deep-link to /downloads and /downloads/:id. A finished download's notification opened the
            Player library here, so check where each notification, widget and app-shortcut link lands.
Suggested fix: give the nested stacks `initialRouteName: 'index'` (unstable_settings in the stack _layout) so a deep
               link always has the list or start page under it. Then re-test each vidorax:// link.
```

```
BUG-005 [Low] Failed card has no Retry button; "Try again" is only in the ⋮ menu
Screen / feature: 10 Downloads list, 46 Failed · Retry
Evidence: report-shots/T-D10-failed-card.png ("Network error. Check your connection and retry." with no action)
Suggested fix: show an inline "Retry" on failed cards (as completed cards show "Play · Share").
```

```
BUG-006 [Low] A failure from DNS errors while "connected" is final; it is not retried when the network returns
Context: the emulator's DNS broke mid-download → "Download failed: network error" at 53%. After the network came
         back (and after a restart) it stayed Failed until "Try again". Airplane mode, by contrast, waits and
         auto-resumes correctly (R5).
Suggested fix: treat UnknownHost / DNS failures like "offline", or retry failed network errors once a validated
               network appears (when Auto-resume is on).
```

```
BUG-007 [Low, observation] The list card showed stale state while the screen was being remounted or switched
Observed: "0% · Downloading" while 83 MB were done; "27% · Paused" for about 18 s after Resume all; "3.8 MB/s" while
          in airplane mode. A controlled run with the list in front updated correctly (section 3, row 10).
Action: watch for it after BUG-004 is fixed (all three happened right after deep-link tab switches).
```

```
BUG-008 [Low] The HLS video sheet's default name is "x36xhzz.m3u8", but the result is an MP4
Evidence: report-shots/T-D33-hls-sheet.png (Rename row)
Suggested fix: drop playlist extensions (.m3u8/.mpd) from the default title, or use the page title.
```

```
BUG-009 [Low] Batch Add shows a 404 link as "Needs review / Open" instead of "Not found"
Evidence: report-shots/T-P4-results.png (…_3MB.mp4 returns 404)
```

```
BUG-010 [Low, design] The disguised-file warning is the system dialog (teal buttons), not the app theme
Evidence: report-shots/T-P8-openwith.png
```

## 5. Design mismatches (separate from function)

- **Downloads list (design 10):** the Total speed graph is empty (BUG-002); failed cards have no Retry (BUG-005).
- **Tour step 1** points at the hidden address bar (BUG-003).
- **Disguised-file dialog** isn't themed (BUG-010).
- **DsRow toggle rows** don't toggle when the row is tapped, only the switch. This is intentional (`DsRow.tsx`:
  "the row stays a plain view so TalkBack reads one switch"), but the prop comment still says the row toggles.
  Update the comment.

## 6. Blocked and not tested

**Blocked:**
- **Voice:** speaking into voice search (no microphone on the AVD). It needs a real phone.
- **Real-network items:** real mobile data with multi-network, roaming and the data limit; Doze and battery
  behaviour. They need a real phone.
- **Remote control from a real laptop** on the same Wi-Fi: the browser extension and the CLI script. The API was
  tested over adb port forwarding.
- **FTP/FTPS:** no public FTP video host was found.

**Not tested in this run:**

| Area | What wasn't run |
|---|---|
| Browser screens | 2 Tabs: grouping, sleep, timeline, close-all · 4 Bookmarks: folders, import/export, broken-link check, home-screen shortcut · 7 Passwords notice · 8 Developer tools panels · 9 Browser settings: engine, address bar bottom · 35 Tab options · 36 History: clear ranges, export · 37 Focus: timer, blocker, quiet downloads · 38 Utilities tiles · 39 Display & Urdu fonts · Notes, highlights, saved pages offline |
| Downloads screens | 12 Details panels: mirrors, cloud, watch, comments, checksum · 15 Statistics numbers and queue export/import/send · 16 settings effects: speed limiter, cooldown, buffer and cache, low memory, duplicate action · 40 Playlist screen · 42 Organize folders · 43 Link grabber on a page · 45 File actions · 46 Failed screen · 47 widgets |
| 1.2.0 packages | P3 watched links and RSS · P4 M3U/PLS/XSPF and rules · P5 site grabber and comments · P7 cloud save, auto upload, folder import |
| Robustness | R2 process death (`am kill`) · R3 force-stop mid-download · R6 Wi-Fi only · R7 storage full · R8 10 parallel downloads · R9 Doze · R10 low battery · R11/R12 duplicates · R13 long live recording memory |
| Global | G5 font scale 1.3 · G6 TalkBack · G7 rotation · G8 Back through every stack |

## 7. Performance

- **Cold start** (`am start -W` TotalTime): 737, 694, 718 ms. Memory (PSS) right after start: 237 MB.
- **Download speeds on the emulator's network:** progressive about 0.9–3.9 MB/s, HLS 2–3 MB/s, DASH 1–2 MB/s.
- **Battery:** not measured (emulator).

## 8. Upgrade results

| Path | Result |
|---|---|
| 1. Fresh install | PASS: Light, Simple, six login-free tiles |
| 2. 1.1.0 → design (theme Dark + one download) | PASS: Dark kept; download listed and playable; no crash |
| 3. 1.1.0 → design (nothing touched) | PASS: Settings view Advanced; Live recording on |
| 4. Pre-design 1.2.0 → design | PASS (21 Nov) |

## 9. Test environment notes

- The emulator's Wi-Fi and DNS failed once under host load. That caused the DNS-error failure behind BUG-006 and
  needed an emulator restart with `-dns-server 8.8.8.8,1.1.1.1`.
- `cmd wifi set-wifi-enabled disabled/enabled` brought Wi-Fi back; Remote control requires Wi-Fi.
- Shared storage (`/sdcard/Movies/VidoraX`) keeps files from earlier installs. New downloads with the same name get
  a "(n)" suffix; that is expected.
