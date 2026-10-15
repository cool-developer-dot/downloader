# Test build 2 — tester feedback (work log)

Branch `fix/test2-tester-feedback` from `origin/release/1.0` (`3656aa8`), worktree `/Users/mac/Downloads/vidorax-test2`.
Target: VidoraX 1.0.1 (versionCode 2) for the same closed-testing track. Test1 = tag `v1.0.0-test1` (`a2c89d9`).

Feedback report: no crashes or bugs; four improvement requests (store listing text, first-launch walkthrough, store
screenshots, rating link) plus advice (support easy to find, copyright education).

## Baseline (release/1.0 before any change, 2026-10-15)

| Check | Result |
| --- | --- |
| `npm test` | 624 / 624 pass, 98 suites |
| `npm run typecheck` | 0 errors (app + test configs) |
| `npm run lint` | 0 errors, **84 warnings** (the ceiling for this branch) |
| en/ur key parity | compile-time only (`CatalogStrings<typeof en>`); no runtime parity test on `release/1.0` → added in T1 |

Open PRs at start: cool-developer-dot/downloader#1 (`faran/sonnet-fixes` → main) and cool-developer-dot/downloader#2
(`faran/opus-engine` → main). Neither targets `release/1.0`; both left alone.

## Test setup and decisions that apply to every topic

- **Emulators.** Manual tests ran on a new AVD **`VidoraX_Test2`** (Pixel 8 profile, API 35, Google Play image, 4 GB),
  not on `Pixel_8`: fresh installs, `pm clear` and the test1 upgrade all wipe the app's data, and `Pixel_8` holds the
  downloader team's test data. Same screen (1080×2400, 420 dpi) and image as `Pixel_8`, so the `scripts/qa` coordinates
  apply. Store captures used a second clean AVD, **`VidoraX_Play_Shots`** (T5). `Pixel_8` was never started.
- **Host load.** Other work on this Mac kept the host load average at 10–50 during the session. The emulator stalled
  three times (system dialogs "Pixel Launcher / Digital Wellbeing isn't responding", system daemons crash-looping once);
  each time I tapped Wait or cold-booted my own AVD and re-ran the case. Timings are therefore not comparable to the
  6.2 s cold-start baseline (see Regression).
- **test1 APK.** `/tmp/vx-test1` (tag `v1.0.0-test1`, clean tree) already had a Gradle release APK from 2026-10-11, signed
  with the upload key (`36:B9:C6:22…`); reused instead of rebuilding.
- **Live Play listing.** `https://play.google.com/store/apps/details?id=com.vidorax.fast.videodownloader` returns
  HTTP 404 (closed testing has no public page).

## T1 — "Rate VidoraX" and "Check for Updates" (report item 4)

**Plan.** Point the listing constant at the real listing, open it through the Play Store app with a web fallback, put
Rate at the top of Settings → Help & Support with the requested hint, confirm the automatic review prompt.

**Decisions.**
- `market://details?id=…` is opened with `Linking.openURL` directly (no `canOpenURL`): `market:` would need a new
  `<queries>` entry on Android 11+, and asking first adds nothing — `openURL` rejects when nothing handles it, and the
  web URL (`https://play.google.com/store/apps/details?id=…`, already covered by the existing VIEW/https query) is
  tried next. No manifest change.
- The package id is a constant (`PLAY_STORE_PACKAGE_ID`), not read from the running build, so a debug build still
  points at the real listing.
- About → Rate uses the same hint ("Your rating helps us improve VidoraX"); About → Check for Updates' idle text now
  says what it does ("See if a newer version of VidoraX is on the Play Store.").

**Automatic review prompt (read, unchanged).** `src/review/review-policy.ts` asks Google Play only (1) after the
**third** genuine successful download (COMPLETED with a verified library file, each id counted once), (2) when the
latest success is less than 24 h old, (3) at most once a week and only after at least one new successful download since
the last request, and (4) at a calm moment: app in front and unlocked, nothing downloading, the user settled on the
Downloads or Player list for 2.5 s (`isCalmMoment`). There is no random or time-only trigger and no "do you like us?"
gate. Every input is a positive event the user just had — confirmed.

**Files.** `src/constants/play-store-listing.ts` (+ test), `src/utils/open-play-store-listing.ts`,
`src/constants/app-identity.ts`, `src/screens/legal/about/use-about-store-actions.ts`,
`src/screens/settings/components/AboutSection.tsx` (Settings → Help & Support), `src/localization/{en,ur}.ts`,
`src/localization/catalog-parity.test.ts` (new: keys, empty strings, `{placeholders}` must match).

**Tests.** +9 (6 listing/URL choice and fallback, 3 catalog parity). Gate after T1: 633/633, tsc 0, ESLint 0 errors /
84 warnings, `git diff --check` clean. No Kotlin changed (native unit tests not needed).

**Manual (VidoraX_Test2).**

| Case | Build | Result |
| --- | --- | --- |
| Settings → Help & Support starts with Rate VidoraX + hint (en, Dark) | debug | PASS (`t1-rate/settings-help-support-dark.png`) |
| Same in Urdu (Red), RTL | debug | PASS (`t1-rate/settings-ur.png`) |
| Rate → Play Store app opens the listing deep link | debug | PASS — logcat `START … act=VIEW dat=market://details/… cmp=com.android.vending/…MarketDeepLinkHandlerActivity`. The listing page itself: **BLOCKED** — no Google account on the emulator, Play shows its sign-in screen (`t1-rate/rate-opens-play-store-app.png`) |
| Rate with Play Store disabled (`pm disable-user com.android.vending`, re-enabled after) → web fallback | debug | PASS — `market://` START result −91 (no activity), then `START … dat=https://play.google.com/… cmp=com.android.chrome/…` (`t1-rate/rate-web-fallback-no-play-store.png`) |
| About → Check for Updates opens the listing, row then reads "Play Store opened so you can review updates." | debug | PASS (`t1-rate/about-dark.png`; logcat START market://details) |
| Rate VidoraX is the first row of Help & Support, with the hint | release | PASS (`t1-rate/release-settings-help-support.png`) |

## T2 — First-launch walkthrough (report item 2)

**Plan.** An in-house coach-mark tour (`src/tour`): a pure policy (when it may start, Back/Next/Skip, missing targets,
link deferral), pure geometry (spotlight, card placement), a small zustand store with the MMKV flag, a registry of
real targets measured with `measureInWindow`, and a full-window overlay drawn in the app's own window over everything
(tabs included) with an SVG even-odd dim and a white ring that glide between targets (reanimated).

**Decisions.**
- **Overlay in the app window, not a RN `Modal`:** targets and overlay share one coordinate space (the overlay also
  measures its own frame and subtracts it), so the spotlight lines up with or without edge-to-edge. TalkBack isolation
  is done the way AppLockGate does it: the app underneath gets `importantForAccessibility="no-hide-descendants"` while
  the tour shows. Android Back goes through the app's single back registry at priority 40 (above screens and gates).
- **Targets are the real elements:** address bar, the Quick Access block, the browser page area (the example bar is
  drawn in the bottom `BROWSER_TOUCH_TARGET` strip, exactly where `BrowserMediaDownloadBar` sits), and the Downloads /
  Player / Settings tab buttons (wrapped via `tabBarButton`, which React Navigation calls as a plain function).
- **When it starts:** onboarding complete (read from the app store `vidorax.app`, where onboarding really persists) and
  flag `vidorax.tour.browser.v1` unset, or a replay request; the Browser route is the visible screen; app active; not
  locked; no keyboard; no open sheet/menu/dialog (every `Modal`-based sheet registers a blocker: quality sheet, tab
  switcher, overflow menu, omnibox editor, ActionSheetModal, AppModal); not deferred by a link; and all of that for
  1.2 s. The flag is written when the tour ends (finished, skipped, closed with Back on step 1). Process death mid-tour
  → it shows again next time (it was never finished).
- **Links:** a link shared to / opened with VidoraX defers the tour until the start page shows or the user leaves and
  comes back; if the tour is showing when a link arrives it steps aside (not seen) and restarts from step 1 later.
  Android delivers a shared link just before VidoraX becomes active, so the deferral is a 3-state machine
  (`none / deferred / left`) — only a return after leaving the app since the link counts.
- **While running:** hidden (step kept) whenever the app is locked, in the background or off the Browser; shown again at
  the same step. A missing target (e.g. the start page while a site is open) is skipped in the direction of travel
  (forward past the end = finished; backward past step 1 = forward again).
- **Card:** step pill, Skip (not on the last step), title (Poppins), body (Inter), the permitted-use note on step 6,
  progress dots, Back/Next (Done on the last step). Header and buttons are fixed and only the text scrolls, so a small
  screen with a large font never hides Next. A card needs 200 dp beside the target, otherwise it overlays the emptier
  half. RTL: rows mirror (`rtlRow`), text aligns right. Theme: card uses the theme's dialog colours, primary button and
  dots follow the theme's primary (black in System, red in Red, off-white in Dark).
- **Reduce motion:** no fades, the spotlight jumps instead of gliding (`AccessibilityInfo.isReduceMotionEnabled`).
- **Rotation:** the app is portrait-locked (`app.json` orientation, manifest `screenOrientation`); the overlay
  re-measures on any frame change anyway.
- Replay entry points: Settings → How to use VidoraX, Settings → Help & Support, and the Help Center (About → Help &
  Support). How to use VidoraX also got the permitted-use sentence (en + ur).

**Files.** `src/tour/*` (policy, layout, store, targets, host, overlay, tab button, replay, tests),
`src/app/(app)/_layout.tsx`, `src/app/(app)/(tabs)/_layout.tsx`, `src/browser/BrowserScreen.tsx`,
`src/browser/components/BrowserHeader/{AddressBar,SuggestionOverlay}.tsx`,
`src/browser/components/BrowserHome/BrowserHomeView.tsx`, `src/browser/components/{BrowserOverflowMenu,BrowserTabSwitcher}/*.tsx`,
`src/browser/services/incoming-link.service.ts`, `src/components/{bottom-sheets/ActionSheetModal,modals/AppModal}.tsx`,
`src/screens/downloads/quality/QualitySelectionSheet.tsx`, `src/screens/settings/components/{HowToUseSection,AboutSection}.tsx`,
`src/screens/support/SupportScreen.tsx`, `src/localization/{en,ur}.ts`.

**Tests.** +21: first launch, upgrade (onboarding done, flag absent → once), already seen, settle time, every blocker
(App Lock, dialog, keyboard, other screen, background, link), presentability while running, Next/Back/Skip/Done, Back
on step 1 closes, missing targets both directions, replay, idempotent start, link deferral incl. the share-before-resume
order, suspend on link; geometry: unusable rects, spotlight clipping, example-bar position, card side/size/caret,
overlay mode, rounded even-odd path.

**Bugs found on the device and fixed (each its own `T2:` commit):** onboarding flag read from the wrong store (tour never
started); card buttons scrolled out of view at 720×1280 / font 1.3; TalkBack focus pinned to the title by re-renders;
a stale "focused input" after App Lock setup could block the tour; keyboard dismissed when the tour appears; the
example badge collided with the pointer; links arriving during a tour.

**Manual.** Screenshots in `.claude/pr-evidence/test2/`.

| Case | Build | Result |
| --- | --- | --- |
| Fresh install → onboarding → tour, all 6 steps on the real elements (Red) | debug + release | PASS (`tour-release-en/step1…6.png`) |
| Fresh install on a second clean AVD (VidoraX_Play_Shots) → tour | release | PASS |
| Urdu, all 6 steps, RTL | debug + release | PASS (`tour-release-ur/step1…6.png`, `tour-debug/system-ur-all-steps.png`) |
| Dark theme, all steps | debug | PASS (`tour-debug/dark-en-all-steps.png`) |
| System theme | debug | PASS (`tour-debug/system-ur-all-steps.png`) |
| Skip; Done; Back key = previous step; Back on step 1 closes (no exit toast) | debug | PASS |
| Seen persists across a cold start | debug | PASS |
| Replay: Settings → How to use; Settings → Help & Support; Help Center (Urdu) | debug + release | PASS |
| 720×1280 + font scale 1.3 (Urdu): card never clipped, Next/Done always visible, text scrolls | debug | PASS after fix (`tour-debug/small-720x1280-font1.3-ur.png`); size and font reset afterwards |
| TalkBack: focus starts in the tour, lands on each step's title, Next/Back activatable, page/tabs/address bar behind are not focusable | debug | PASS (`tour-debug/talkback.png`). Spoken output not recorded (no audio capture); TalkBack swipe gestures could not be injected with adb, touch exploration was used |
| Missing target: a site open (start page absent) → step 2 skipped forward and backward | debug | PASS |
| Rotate (user_rotation 1 → 0): app stays portrait, tour intact | debug | PASS (`tour-debug/rotate-background.png`) |
| Background (Home) mid-tour → return: same step | debug | PASS |
| App Lock on: background → lock screen with no tour over it → PIN → tour back at the same step | debug | PASS (`tour-debug/applock-hidden-then-resumed.png`) |
| Address bar focused before the 1.2 s settle → no tour until the editor closes, then it starts | debug | PASS |
| Link shared while the tour shows → tour steps aside, page shows "Video available", no tour; Home → tour from step 1 | release | PASS (`tour-release-en/link-arrives-during-tour.png`) |
| Cold start with a VIEW link | debug | not testable as a cold start: the existing tab restore drops a cold-start VIEW link on this build (known race, `docs/HANDOFF.md`); covered by the warm case above and unit tests |
| Reduce motion | — | unit/code path only (`isReduceMotionEnabled` → no fades, spotlight jumps); not toggled on the device |
| Upgrade from test1 → tour shows once, data intact | release | see Regression / R10 |

## T3 — Support and help easy to find (report advice)

**Found.**
- Settings → Help & Support: Contact Support is one tap after scrolling, shows `Vidoraxlabs@gmail.com` as text, opens a
  pre-filled email (subject + app/Android/device), and without an email app shows the address with **Copy address**.
  Nothing missing.
- About → Help & Support → Help Center (two taps): **Contact Support opened a bare `mailto:` through `canOpenURL` and did
  nothing without an email app; the address was not shown.** The Privacy "Email" link had the same silent failure.
- Report a Problem (Help Center): without an email app it said "Could not send report — Please try again." (retrying
  cannot help) and gave no address.

**Fixed.** Help Center Contact Support and the privacy email both call the same `openSupportEmail()` as Settings
(pre-filled; no email app → address + Copy address). Contact Support shows the address on its own line. Report a
Problem's failure explains that no email app opened, shows the address and adds **Copy address** (+ "Address copied"
announcement). en + ur.

**Tests.** No new pure logic (UI wiring only; `support-email.test.ts` already covers the mailto builder). Gate:
653/653 at that point, tsc 0, ESLint 0 errors / 84 warnings.

**Manual.**

| Case | Build | Result |
| --- | --- | --- |
| About → Help & Support → Contact Support: pre-filled `mailto:` (subject/body) → Gmail opens | debug | PASS (logcat `START … dat=mailto:…` long query; Gmail shows its welcome screen — compose itself BLOCKED, no account) |
| Same with Gmail disabled → "No email app found" + Copy address | debug | PASS (`t3-support/helpcenter-no-email-app.png`) |
| Report a Problem with no email app → explanation + address + Copy address; pasted address appears in Gboard's clipboard chip | debug | PASS (`t3-support/report-no-email-app.png`) |
| Help Center in Urdu | debug | PASS (`t3-support/helpcenter-ur.png`) |

## T4 — Store listing text (report item 1)

`docs/play-console/STORE_LISTING_v2.md`: English (en-US) and Urdu (ur) name / short / full description, keyword table
with a one-line "after a month" note, and the versionCode 2 release notes (en + ur).

**Decisions.**
- Name `VidoraX: Video Downloader` (25/30): the category's main term, no ranking/price words, no ALL-CAPS. Urdu name
  `VidoraX: ویڈیو ڈاؤن لوڈر` (24/30).
- Short description 77/80 (en), 74/80 (ur); full description 1,872/4,000 (en), 2,045/4,000 (ur) — measured with
  Python `len()` on the exact blocks.
- Only true-for-test2 claims (checked against `release/1.0`: formats per HANDOFF §4.22, Wi-Fi only, default browser,
  device videos, App Lock, themes, languages). Nothing main-only (no live recording, no parallel-download controls).
- Brand names: none, except the required disclaimer naming YouTube as **not supported** (restrictive use).
- The live listing returned HTTP 404 (closed testing); `PLAY_SUBMISSION.md`'s copy was the baseline.

## T5 — Feature-focused store screenshots (report item 3)

`scripts/store/build_play_assets.py` + `captions.json` + `README.md`; contact sheet and capture notes in
`STORE_LISTING_v2.md`. Output `~/Downloads/VidoraX-Play-Assets/v2/{en,ur}/` (8 × 1080×1920 + 1024×500 feature graphic
per language, 24-bit RGB PNG, all < 1 MB), raw captures in `…/v2/raw/{en,ur}/`.

**Decisions.**
- Pillow on this Mac has no libraqm, so it cannot shape Urdu: each asset is laid out in HTML and rendered by headless
  Chrome (Poppins from `node_modules`, Urdu in macOS Geeza Pro), then flattened to RGB by Pillow. One retry with a fresh
  Chrome profile when Chrome exits early on a busy machine.
- Screen 1 shows the paste-a-link flow instead of the start page: the Quick Access tiles name Instagram, TikTok,
  Facebook, … (brand names in downloader screenshots are a common rejection reason).
- Content: Blender open movies only (*Big Buck Bunny*, *Sintel*, CC BY) via test-videos.co.uk, Wikimedia's media host
  and the Mux test stream. A download with the Wikimedia logo as thumbnail and a watermarked "Jellyfish" test clip were
  deleted before capturing; finished downloads were renamed in the app (Download Details → Rename).
- Status bar: Android demo mode (9:30, full battery/Wi-Fi, no notifications).
- Captures come from the test2 release build (code identical to the final build except the version numbers set by T0,
  which no captured screen shows) on `VidoraX_Play_Shots`.

**Environment problems while capturing (all recovered, recorded for the next person).**
- `system_server` repeatedly hit its watchdog (SIGABRT in the Signal Catcher, then "Pixel is starting…" loops). Cause:
  the emulator itself kept running `dumpsys package com.google.android.gms` while `PlayStore.enabled=true` in the new
  AVDs' `config.ini` (system_server at ~300 % CPU). Setting `PlayStore.enabled=false` on `VidoraX_Play_Shots` and
  `VidoraX_Test2` (the Play Store app stays in the image) and running the emulator with `-no-window` fixed it.
- Under that load VidoraX showed "isn't responding" dialogs while typing into the address bar. The ANR traces
  (bugreports in the session scratchpad) show the main thread runnable in normal frame work
  (`HardwareRenderer.nSyncAndDrawFrame`, `Choreographer.scheduleVsync`) with run-queue wait ≥ run time, alongside ~40
  ANRs of system processes (phone, launcher, the system's own input dispatcher). Re-checked against test1 in the
  Regression section.
- Laggy injected swipes turned into taps twice (once opening "Show the tour again", which explained an "unexpected"
  tour earlier).

## Regression (release, upload-key APK, VidoraX_Test2)

Final release APK (`:app:assembleRelease` with the T0 version bump in the tree): versionCode 2 / 1.0.1, signed with the
upload key (cert SHA-256 `36:b9:c6:22:d3:29:9d:01:…`). test1: rebuilt from tag `v1.0.0-test1` in `/tmp/vx-test1-tag`
(same size as the 2026-10-11 build, 96,011,413 bytes, same upload-key certificate) after macOS's periodic `/tmp`
cleanup deleted the old `/tmp/vx-test1` build. Upgrade: `seed_test1.sh` (test1, onboarding skipped, one favourited MP4
download, history pages, recent search "cats"), theme set to Dark in test1, then `adb install -r` the test2 APK.
Both APKs exactly as Gradle signed them (no re-signing was needed — no debug/release switching on this AVD at this
stage).

`regress.py` (from `/tmp/vx-qa`, `main`) run 1, then the steps that failed for harness reasons re-run or checked by hand:

| Check | Result | Notes |
| --- | --- | --- |
| Upgrade test1 → test2 | PASS | Dark theme kept; tour shown once on the first Browser moment (step 2 skipped — the restored tab was a page); no tour after a restart. Repeated with a second seeded test1: tour once, download row kept, no tour after restart |
| R10 data after upgrade | PASS | download rows=1, favourite=yes, history=4 |
| R1 cold start | PASS | test2: 6.6, 6.9, 1.8 s during the run; 6.3, 6.4, 1.8, 1.8, 1.7, 1.7 s on a calm guest. test1 on the same AVD: 1.7, 6.0, 1.7, 6.4, 1.7, 1.7, 6.3, 1.7, 6.0 s — same two modes, no slowdown. No crash |
| R2 MP4 page | PASS | w3schools offer → completed → player PLAYING |
| R3 HLS | PASS (by hand) | script FAIL: 184p still Running at its 180 s timeout on this guest; the row completed shortly after (19.1 MB, Completed) and R7 then played it |
| R4 social | PASS (re-run) | TikTok 576p completed; Facebook completed. Run 1 FAIL was the App Lock cascade below |
| R5 YouTube refused | PASS (screenshot checked) | toast "YouTube downloads are not supported", page not loaded (`regression/r5-youtube-refused.png`). Run 1 had no browser on screen (R7 left the player in landscape) |
| R6 pause/resume | PASS (re-run) | paused at 4.7 MB of 36.9 MB, unchanged after 8 s, resumed, completed |
| R7 player | PASS | +10/−10 s, seek, PLAYING, fullscreen ROTATION_90, PiP |
| R8 App Lock | PASS (by hand) | script: enable + PIN screen OK; its unlock did not take (PIN check is slow on this guest; the script presses Escape 3 s later) and R9/R4/R6 then ran against the lock screen. By hand: after a cold start the PIN field needed a tap to focus, PIN unlocked, Settings → App Lock → PIN → Disable, Home + reopen → no PIN |
| R9 Urdu | PASS (re-run) | 27 Urdu strings on Settings, no Latin-only labels |

Typing A/B (the "isn't responding" dialogs seen while typing into the address bar on the overloaded screenshot AVD): on
the calm `VidoraX_Test2`, one `input text` of a 90-character URL into the address bar gave **0 ANRs on test2 and 0 on
test1**. No ANR, crash or `FATAL` from VidoraX during the release regression.

Native tests: no Kotlin changed, so `:vidorax-media:testDebugUnitTest :vidorax-web:testDebugUnitTest` were not needed.

## Final gate

| Check | Result |
| --- | --- |
| `npm test` | 654 / 654 (baseline 624, +30: 6 Play listing, 3 catalog parity, 21 tour) |
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 errors, 84 warnings (= baseline; no new warnings) |
| `git diff --check` | clean |

## Found, not fixed (pre-existing on `release/1.0`, outside the tester report)

1. **Native sheets stay above the App Lock screen.** If the app locks while a `Modal`-based sheet is open (seen with the
   address-bar suggestion overlay), the sheet's window stays drawn over the PIN screen — typed text and history
   suggestions are visible on the lock screen (`.claude/pr-evidence/test2/found-suggestion-overlay-over-app-lock.png`).
   Fix idea: close open sheets (or hide every `Modal`) when App Lock locks. The new tour is not affected (it is drawn in
   the app window and hides itself when locked).
2. **Untranslated strings in Urdu:** address-bar suggestion badges (`History`, `Frequent`, `Search`, `Site`, …,
   hard-coded in `SuggestionItem.tsx`) and "Search Google for …"; Player header "N videos"; Downloads rows "Other",
   "saved", "X of Y"; quality sheet "Audio". Visible in the Urdu screenshots where unavoidable.
3. **TalkBack in Settings:** whole groups of Settings rows are read as one block (focus box spans several sections),
   so individual rows are hard to reach with TalkBack.
4. **A link opened while onboarding runs is dropped** (fresh install launched by a VIEW link → after onboarding the
   start page shows). Related to the known cold-start tab-restore race in `docs/HANDOFF.md`.
5. **Cold-start lock screen:** the PIN field is sometimes not focused after a cold start (no keyboard until it is
   tapped). Warm locks focus it.
6. In-progress downloads cannot be renamed (Download Details offers File actions only when finished); bare-file
   downloads are titled "Download" (known, cosmetic).
7. Housekeeping: `git worktree list` shows `/private/tmp/vx-test1` as *prunable* (macOS deleted it); the owner may run
   `git worktree prune`.

## Commits

See the PR. Each topic has its own commits (`T1:` … `T5:`), the work log is `T0: work log`, and the last commit is
`T0: versionCode 2 / 1.0.1`.
