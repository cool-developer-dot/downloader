# Prompt A — Faran · Claude Sonnet · Phase 16 quick fixes + extra file types

> **How to use:** open Claude Code (model: **Sonnet**) in the `vidorax-mobile` folder on the Mac and paste everything
> below the line. Run this prompt **before** Prompt B (Opus); its tasks are small and testers notice them first.
> Branch: `faran/sonnet-fixes`. Tasks: F12, F9, F8, F7, F11, F10, F5 (7 packages, 8 effort points).

---

You are working on **VidoraX**, an Android-first Expo SDK 57 / React Native 0.86 app (in-app browser + video
downloader + player) with native Kotlin modules in `modules/vidorax-media` and `modules/vidorax-web`. The app is in
Google Play testing (tag `v1.0.0-test1`). Your job: build the 7 tasks below on the branch `faran/sonnet-fixes`,
**100% finished and 100% tested — automated and manual** — one task at a time, in the order given.

## 0. Before writing any code

1. Read, in this order: `AGENTS.md` (read the Expo v57 docs it links before using any Expo API), `docs/RELEASING.md`,
   `docs/HANDOFF.md` §1, §4.31, §5–§6, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md` (Phase 16 table).
2. Set up the branch:
   ```bash
   git fetch origin
   git checkout faran/sonnet-fixes
   git merge --ff-only origin/faran/sonnet-fixes
   git merge origin/main
   ```
   Never commit to `main` or `release/1.0` directly. Never touch `release/1.0`.
3. Run the baseline so you know the starting state: `npm ci`, `npm test`, `npm run typecheck`, `npm run lint`,
   `bash scripts/dev/gradle.sh :vidorax-media:testDebugUnitTest :vidorax-web:testDebugUnitTest --rerun`.
   Write the numbers (passed/failed) into the work log (§4). If anything already fails, record it and don't "fix" it
   unless it blocks your task.

## 1. Rules (apply to every task)

- **Scope:** do exactly the task. No drive-by refactors. If you find a real bug outside the task, note it in the work
  log under "Found, not fixed".
- **One task = its own commits.** Every commit message starts with the task ID, e.g. `F7: open a copied link from
  Home`. Never mix two tasks in one commit. This is what lets us change or undo one feature when a tester asks.
- **Strings:** every new user-visible text goes in `src/localization/en.ts` **and** `src/localization/ur.ts` (real
  Urdu, not English). No hard-coded English in components. Check the Urdu (right-to-left) layout.
- **Local only:** no new server calls, accounts, analytics or cloud. The only exception is F11, which opens a Google
  Translate page when the user taps it.
- **Still refused:** YouTube, DRM, encrypted streams, login/paywall bypass. Don't weaken any refusal.
- **No new Android permissions.** If you think one is needed, stop that task and record why in the work log.
- **Build tools:** never run `npx expo prebuild` (it destroys the hand-maintained `android/`). Build Gradle only via
  `bash scripts/dev/gradle.sh …`. Start Metro with `CI=1 npx expo start --port 8081` (never `--localhost`).
- **Package id** is `com.vidorax.fast.videodownloader` (use it for `adb shell run-as`, `am start`, `pm clear`).
- **Decisions:** don't stop to ask questions. When a choice comes up, take the option that best fits the existing code
  and write the decision + reason in the work log.
- **No fake results.** Never mark a step passed that you didn't run. If something can't be tested (a site's login
  wall, no device), mark it **BLOCKED** with the reason.

## 2. The task loop (repeat for each task)

1. Read every file named in the task, and search for related code before changing anything.
2. Write a short plan in the work log (files, approach, tests).
3. Implement.
4. **Automated tests** — add or update tests for every new piece of logic (`*.test.ts` next to the file, using the
   repo's `node:test` setup; Kotlin tests under `modules/*/android/src/test` for native changes). Then run the full gate:
   ```bash
   npm test
   npm run typecheck
   npm run lint            # 0 errors
   bash scripts/dev/gradle.sh :vidorax-media:testDebugUnitTest :vidorax-web:testDebugUnitTest --rerun   # if any Kotlin changed
   git diff --check
   ```
   All must pass. Paste the totals into the work log.
5. **Manual tests** — run every manual case in the task on the **Pixel_8 emulator (API 35)**, first on a debug build
   with Metro, then the final pass on a **release build**:
   ```bash
   bash scripts/dev/gradle.sh :app:assembleRelease
   ```
   If the Play upload key (`~/.vidorax-signing/keystore.properties`) isn't on this Mac, the release APK comes out
   unsigned: sign it for local testing only with the repo debug keystore
   (`zipalign` + `apksigner sign --ks android/app/debug.keystore --ks-pass pass:android`). Never upload that APK.
   Check each case in **English and Urdu**, and in **System, Red and Dark** themes where the screen changes.
6. **Regression smoke** (§3) on the release build.
7. Update docs: tick the task in the work log with evidence; if behaviour described in `docs/ARCHITECTURE.md` changed,
   update that line; add the task to `docs/HANDOFF.md` §4 (one short entry per task).
8. Commit (ID prefix), push `faran/sonnet-fixes`, and update the pull request (§5).

## 3. Regression smoke (release build, after every task)

| # | Check | Pass when |
| --- | --- | --- |
| R1 | Cold start | Browser usable within ~2 s, no crash |
| R2 | MP4 page | `https://www.w3schools.com/html/html5_video.asp` → "Video available" → download completes → plays in Player |
| R3 | HLS page | `https://hlsjs.video-dev.org/demo/?src=https%3A%2F%2Ftest-streams.mux.dev%2Fx36xhzz%2Fx36xhzz.m3u8` → quality sheet → 184p downloads and plays |
| R4 | Social | One public TikTok and one public Facebook video (logged out) → offered → downloads |
| R5 | YouTube | Pasting a youtube.com link shows the refusal message; nothing downloads |
| R6 | Pause/resume | Pause a running download, resume, it completes and plays |
| R7 | Player | Play, seek, ±10 s, fullscreen, PiP (press Home while playing) |
| R8 | App Lock | Enable, background the app, come back → PIN asked; disable again |
| R9 | Language | Switch to Urdu → layout right-to-left, no English left on the screens you touched |
| R10 | Upgrade | Install the build **over** the `v1.0.0-test1` build that has downloads, favorites and history (`adb install -r`) → all still there |

## 4. Work log

Create `docs/work-log/faran-sonnet.md` on the first task and keep it current: baseline numbers, then per task —
plan, decisions, files changed, automated test totals, a table of every manual case (PASS / FAIL / BLOCKED + note),
regression R1–R10 results, "Found, not fixed". This file is how the owner and testers see what was done.

## 5. Pull request

After the **first** finished task, open one PR `faran/sonnet-fixes → main`, title "Faran · Sonnet · Phase 16 quick
fixes", using the repo PR template, with a checklist of all 7 tasks. Tick each task as it finishes and attach its
screenshots or screen recordings to the PR (don't commit images). The owner may merge the PR after any finished task;
afterwards keep working on the same branch (`git merge origin/main` first).

## 6. The tasks (in this order)

### F12 — Correct wrong help answers (1 point)

**Why:** two Help & Support answers contradict the app. **Where:** `src/localization/en.ts` and `ur.ts` —
the answer containing "pick Light, Dark, or System" (~line 1636) and the one containing "HLS stream downloads do not
support user pause/resume" (~line 1540); FAQ structure in `src/support/faq-content.ts`.

Do:
1. Theme answer → the real options are **System, Red, Dark** (check `src/screens/settings` and `settings.theme*` keys).
2. Pause answer → HLS and DASH downloads **can** be paused and resumed (the native engine checkpoints segments; confirm
   in `src/downloads/runtime-actions.ts` and by pausing an HLS download on the emulator before you write it). Sources
   that refuse resuming restart from zero; keep the Auto Resume sentence accurate.
3. Read **every other FAQ answer** and check each claim against the code. Fix any that are wrong (e.g. tab names,
   "Library" vs "Player", where Help lives). List every change in the work log.

Automated: add `src/localization/catalog-parity.test.ts` (none exists yet) checking that `en` and `ur` have exactly
the same keys and no empty Urdu strings; it must pass, and so must `npm run typecheck`.
Manual: Settings → How to use / About → Help & Support → open each changed answer in English and Urdu.

### F9 — Clear recent searches (1 point)

**Why:** searches typed in the address bar are stored and suggested, but can't be cleared. **Where:** store
`src/store/recent-searches/actions.ts` (`clear()` exists, ~line 118), hook `src/storage/hooks/use-recent-searches.ts`
(currently unused), suggestions `src/browser/hooks/useOmniboxSuggestions.ts`, screen `src/screens/history/HistoryScreen.tsx`.

Do: add **"Clear recent searches"** to the History screen (next to "Clear all", with its own confirmation dialog). It
clears only searches — browsing history stays. Clearing browsing history must not clear searches either.

Automated: a test that after `clear()` the suggestion service returns no `recent_search` items.
Manual:
1. Search "cats" in the address bar; type "ca" → "cats" is suggested.
2. History → Clear recent searches → confirm → type "ca" → no "cats" suggestion.
3. Force-stop and reopen → still cleared. Browsing history entries are still there.
4. Cancel in the dialog → nothing cleared. Urdu dialog text correct.

### F8 — Open link in new tab (1 point)

**Why:** the long-press link menu has "Open in New Tab", but it's switched off and does nothing. **Where:**
`src/browser/actions/builtins/open-in-new-tab.action.ts` (`enabled: false`),
`src/browser/hooks/useBrowserLongPressActions.ts` (~line 58: empty `openInNewTab` stub; title `'Link options'`
hard-coded), the other actions in `src/browser/actions/builtins/*.action.ts` (labels hard-coded in English),
`browserStore.createTab({ url })` (`src/browser/stores/browserStore/actions.ts` ~line 424, returns
`status: 'LIMIT_REACHED'` at 10 tabs).

Do:
1. Enable the action; `openInNewTab` creates a tab with the link and switches to it.
2. At the 10-tab limit, show the existing "Maximum 10 tabs open" message (`browser.tabsLimitReached`) instead.
3. Localize the sheet title and all four action labels (new keys under `browser.linkActions.*`, en + ur).
4. Media detection must work in the new tab exactly as in any tab.

Automated: tests for the action (calls `createTab` with the URL; limit path shows the message; disabled when the URL
isn't http(s)).
Manual:
1. Long-press a link on a news site → Open in New Tab → new tab shows that page; tab counter +1.
2. Open a video page this way → "Video available" appears and the download works.
3. With 10 tabs open → message shown, no 11th tab.
4. Copy / Share / Open in external browser still work. Urdu labels, right-to-left sheet.

### F7 — Paste a copied link (1 point)

**Why:** Home "Paste link" only opens the browser; it never reads the clipboard. **Where:**
`src/screens/home/HomeScreen.tsx` (`onPasteLink={qualitySelection.open}` ~line 69),
`src/screens/downloads/quality/useQualitySelection.ts` (`open` ~line 295 navigates to the browser; the Downloads
screen uses the same `open`), `src/browser/services/pasted-link.service.ts` (`openPastedLink(url, { source })`),
`src/browser/services/pasted-link.ts` (`isYouTubeLink`), URL helpers in `src/browser/utils/url.ts`,
`expo-clipboard`.

Do:
1. "Paste link" reads the clipboard. If it holds an http(s) link (alone or inside other text, take the first one),
   open the browser and load it through `openPastedLink` (so the direct analyzer runs, exactly like pasting into the
   address bar). YouTube → the existing refusal message.
2. No link on the clipboard → open the browser with the address bar focused and the keyboard up.
3. Same behaviour from the Downloads screen's paste button.

Automated: tests for the link-extraction function (link alone, inside text, several links, none, `intent://`,
YouTube, extra spaces/newlines).
Manual:
1. Copy a public TikTok/Facebook video link in Chrome → VidoraX Home → Paste link → page loads, "Video available".
2. Copy plain text → browser opens, address bar focused, keyboard visible.
3. Copy a YouTube link → refusal message, nothing loads.
4. Downloads screen → paste button → same results. Works after a cold start too.

### F11 — Translate page (1 point)

**Why:** "Translate page" exists only as a label. **Where:** `src/browser/components/BrowserOverflowMenu/browser-menu-actions.ts`
(menu items + handlers), `src/browser/constants/chrome-actions.ts` (`translate` label key), app language from
`src/localization`, legal text in `src/legal` (find the Privacy Policy content).

Do:
1. Add **Translate page** to the browser menu (after Share). Tap → open a **new tab** with
   `https://translate.google.com/translate?sl=auto&tl=<en|ur>&u=<encoded page URL>` (`tl` = the app's language).
2. Disabled when there's no valid page, on the browser home, or when the page is already a Google Translate page.
   10-tab limit → existing message.
3. Add one sentence to the Privacy Policy (en + ur): when you tap Translate page, that page's address is sent to
   Google Translate.

Automated: tests for the URL builder (encoding of `?`, `#`, `&`, non-Latin characters; `tl` for en/ur; disabled
cases).
Manual: open a Spanish news site → Translate page → English page in a new tab; switch app to Urdu → `tl=ur`; menu item
disabled on browser home; a video on the translated page is still detected (record PASS/BLOCKED).

### F10 — Player: time left + double-tap play/pause (2 points)

**Why:** testers expect to see time left and to play/pause with a double-tap in the middle. **Where:**
`src/screens/player/components/PlayerTimeline.tsx` (time labels ~lines 195–198), `src/player/double-tap-seek.ts`
(`resolveCenterDoubleTapSide`: the centre zone is split in two halves), `src/player/gesture-zones.ts` (outer 25 % =
brightness/volume), `src/screens/player/components/PlayerVideoSurface.tsx` (`handleDoubleTap` ~line 174, zoom reset
~line 154), hint text `player.surfaceHint`.

Do:
1. Tap the duration label → it switches between total time and **−time left**; remember the choice across launches
   (MMKV, follow the repo's existing preference pattern).
2. Double-tap inside the centre zone: **middle third → play/pause**, left third → −10 s, right third → +10 s. Keep the
   existing zoom rule first: when the video is zoomed, double-tap resets the zoom (read the current code and keep its
   exact precedence). The lock still blocks all gestures. Left/right stay physical (no flip in Urdu).
3. Update the `player.surfaceHint` text (en + ur) and the gesture line in `docs/ARCHITECTURE.md` §7.

Automated: tests for the new zone function (boundaries at exactly 1/3 and 2/3, zoomed case, zero width) and for the
time-label formatting (−0:05, −1:02:03, unknown duration).
Manual: on a local video — tap duration (toggles, survives restart); double-tap middle/left/right; zoom in then
double-tap → zoom resets only; locked → nothing happens; mini player unaffected; landscape fullscreen too.

### F5 — Recognise .f4v, .3g2 and .divx files (1 point)

**Why:** the client's formats guide lists them; they're MP4-family / AVI files VidoraX should accept. **Where:** JS
detection `src/media-detection/constants/media.constants.ts` and `src/media-detection/types/media.types.ts` (extension
and MIME lists — `mpg`, `3g2` partly present); native `modules/vidorax-media/android/src/main/java/com/vidorax/media/plan/MediaSniffer.kt`
(ISO-BMFF via `ftyp`, AVI via `RIFF…AVI `), `.../library/MediaTypes.kt` (extension/MIME table, aliases).

Do:
1. A link ending in `.f4v`, `.3g2` or `.divx` (or served as `video/x-f4v`, `video/3gpp2`, `video/divx`) is detected
   as a video.
2. The native probe accepts them by their bytes. Save **F4V as `.mp4`** (it's ISO-BMFF; Gallery and players expect
   MP4), **3G2 as `.3g2`** (`video/3gpp2`), **DivX through the existing AVI path** (remuxed to MP4 like `.avi`).
   Verify each choice against the existing pipeline and record it.
3. A DivX/XviD file Android can't decode is still downloaded and offered "Open with" — same rule as WMV today.

Automated: Kotlin tests feeding the sniffer real header bytes for each type (+ a DRM-branded F4V must still be
refused); JS tests for extension/MIME detection.
Manual (debug build with a local fixture server — release builds refuse `http://`): make three short files with
ffmpeg (`brew install ffmpeg`), serve them on `fx.127.0.0.1.nip.io` with `adb reverse`, open each link → detected →
downloads → correct extension in Download details → plays (or "Open with" for undecodable DivX).

## 7. Finish

When all 7 tasks are done:
1. Run the full automated gate once more on the final branch head and the complete regression R1–R10 on a fresh
   release build. Record totals.
2. Make sure the work log has PASS for every manual case (or BLOCKED with a reason), and the PR checklist is complete.
3. Final message to the owner: a table of the 7 tasks (status, commits, tests added, manual cases passed), anything
   BLOCKED, decisions you made, and "Found, not fixed".
