# Prompt C — Tester feedback → test build 2 (versionCode 2)

> **How to use:** open a **new** Claude Code chat with model **Opus** in the `vidorax-mobile` folder on the Mac and
> paste everything below the line. It works only on `release/1.0` (via a fix branch) and a sync branch into `main`;
> it never touches the downloader branches.

---

You are working on **VidoraX** (`com.vidorax.fast.videodownloader`), an Android-first Expo SDK 57 / React Native 0.86
app — in-app browser + video downloader + player — with native Kotlin modules in `modules/vidorax-media` and
`modules/vidorax-web`. Version 1.0.0 (versionCode 1, tag `v1.0.0-test1`) is in **Google Play closed testing**. The
testing company sent a feedback report: **no crashes or bugs**, four improvement requests and some general advice.
Your job: deliver all of it **100% finished and 100% tested**, as **test build 2** for the same testing track, without
disturbing the downloader work that is going on in parallel.

## 0. Branch rules — read first, follow exactly

| Branch | What it is | You |
| --- | --- | --- |
| `release/1.0` | Exactly what testers have. Every Play build comes from here | Change it **only** through your PR. After the owner merges, build test2 from it |
| `fix/test2-tester-feedback` | **Your working branch**, created from `origin/release/1.0` | All app changes and store docs go here |
| `chore/test2-into-main` | Created from `origin/main` at the end | Your commits copied into `main` with `git cherry-pick -x`, PR into `main` |
| `main` | New features (Phase 16, downloader plan) | Never commit or push to it directly |
| `faran/*`, `dl/*`, any other branch | Other people's downloader / feature work | **Never check out, merge, rebase, push or edit.** If an open PR from them conflicts with you, leave it alone and report it |

- The repo folder may currently be on another person's branch. **Don't switch it.** Work in your own worktree:
  ```bash
  cd /Users/mac/Downloads/vidorax-mobile
  git status --short            # must be empty; if not, stop and tell the owner — someone else's work is in progress
  git fetch origin --tags
  git worktree add /Users/mac/Downloads/vidorax-test2 -b fix/test2-tester-feedback origin/release/1.0
  cd /Users/mac/Downloads/vidorax-test2 && npm ci
  ```
  Do everything from `/Users/mac/Downloads/vidorax-test2`. At the very end, remove your worktrees
  (`git worktree remove …`), never the owner's folder.
- `release/1.0` does **not** contain the new features from `main` (time-left player label, translate page, parallel
  downloads, etc.). Don't copy anything from `main` into it — test2 = test1 + this feedback only.
- One topic = its own commits, message prefixed with the item ID (`T1: …`). Never mix topics in a commit.
- Never `npx expo prebuild`; Gradle only via `bash scripts/dev/gradle.sh …`; Metro with `CI=1 npx expo start --port 8081`.
- Local only: no server calls, accounts, analytics, tracking or new permissions. YouTube and DRM stay refused.
- Every new user-visible text in `src/localization/en.ts` **and** `ur.ts` (real Urdu), right-to-left checked. If
  `release/1.0` has no en/ur key-parity test, add one (`src/localization/catalog-parity.test.ts`).
- Never read, print or copy the upload key in `~/.vidorax-signing`; Gradle uses it. Never upload anything to Google
  Play — you prepare files, the owner uploads.
- Don't stop to ask; take the option that fits the existing code and write the decision in the work log. Stop only at
  the owner gate marked **⏸** below.
- **No fake results:** PASS only for what you ran and saw. Untestable → BLOCKED + reason.

Read before coding: `AGENTS.md` (and the Expo v57 docs it links before using any Expo API), `docs/RELEASING.md`,
`docs/HANDOFF.md` §1, §5–§6, `docs/ARCHITECTURE.md` (§7 player, §8 settings/theme), `docs/play-console/PLAY_SUBMISSION.md`.
Test helpers live on `main` in `scripts/qa/` (README there) — use them from a read-only worktree
(`git worktree add /tmp/vx-qa origin/main`); don't add them to `release/1.0`.

## 1. The work

### T1 — "Rate VidoraX" and "Check for Updates" (report item 4)

**Today:** `src/constants/app-identity.ts` line ~25 has `PLAY_STORE_LISTING_URL = null`, so Settings → About
(`src/screens/settings/components/AboutSection.tsx`) and the About screen (`src/screens/legal/AboutScreen.tsx`,
`src/screens/legal/about/use-about-store-actions.ts`) show Rate / Check for Updates as unavailable. The automatic
Google Play in-app review already exists (`src/review/` — review policy after genuine completed downloads).

**Do:**
1. Set the listing URL to `https://play.google.com/store/apps/details?id=com.vidorax.fast.videodownloader`; open it
   with the Play Store app (`market://details?id=…`) and fall back to the web URL.
2. Make **Rate VidoraX** clearly visible in Settings (top of the About/Help area, not buried), with the hint "Your
   rating helps us improve VidoraX" (en + ur). Check for Updates works too.
3. Keep the automatic review prompt as it is (after a successful download, rate-limited by `review-policy.ts`) —
   read the policy and confirm in the work log that it fires only after a positive moment, never at random.

**Test:** unit tests for the URL/intent choice and availability; manual: Settings → Rate opens the Play Store page of
VidoraX (emulator with Play Store; else BLOCKED + the opened URL from logcat), About → Check for Updates, Urdu.

### T2 — First-launch walkthrough (report item 2)

**Today:** after the splash, new users see a one-time 3-page intro (`src/screens/onboarding`, flag
`vidorax.app.onboardingComplete`) and land in the Browser; Settings has a static "How to use VidoraX" list
(`src/screens/settings/components/HowToUseSection.tsx`). Nothing guides the user inside the real screens.

**Build an interactive coach-mark tour** of the real UI, in-house (no new native dependency; `react-native-svg` and
reanimated are available):
1. **When:** the first time the Browser is visible after onboarding — for new installs **and** for testers upgrading
   from test1 (they never saw it). Once only (MMKV flag, e.g. `vidorax.tour.browser.v1`). Never over the App Lock
   screen, a dialog, the keyboard or a link the app was just opened with — wait for the next idle Browser moment.
2. **Steps** (each: dimmed screen, the real element highlighted, a short card with "Step x of 6", Back / Next / Skip):
   1. Address bar — "Paste a video link or search the web here."
   2. Start page / Quick Access — "Open a site and play the video you want."
   3. Where "Video available" appears — "When a video can be saved, this bar appears. Tap it to download." (no real
      video on screen: show an illustrative sample of the bar in its real position, clearly marked as an example)
   4. Downloads tab — "Track progress. Pause, resume or retry any time."
   5. Player tab — "Watch your videos offline, with gestures and Picture-in-Picture."
   6. Settings tab — "Language, theme, App Lock, and Help & Support (Vidoraxlabs@gmail.com)." + the reminder
      "Download only videos you have the right to save. YouTube and DRM-protected videos aren't supported."
3. **Replay:** "Show the tour again" in Settings → How to use VidoraX, and in Help & Support.
4. **Quality bar:** follows the theme (System / Red / Dark) and brand typography; respects reduce-motion; works in Urdu
   right-to-left; small screens and large font scale don't clip the card; a missing target (e.g. layout changed)
   skips that step instead of pointing at nothing; TalkBack reads each step and the buttons; Back key = previous step /
   close on step 1; rotating or backgrounding the app doesn't break it.
5. Add one sentence about permitted use to "How to use VidoraX" (report advice: copyright education), en + ur.

**Test:** unit tests for the tour state (first launch, upgrade, already seen, replay, skipped, target missing, App Lock
/ link-open deferral). Manual on the Pixel_8 emulator, debug then release: fresh install → onboarding → tour; skip;
replay from Settings and Help; Urdu; Dark and Red; `adb shell wm size 720x1280` and `settings put system font_scale 1.3`
(reset both afterwards); TalkBack on/off; Back key; rotate; App Lock on; **upgrade from test1 → tour shows once, data
intact**. Attach screenshots of every step (English + Urdu) to the PR.

### T3 — Support and help easy to find (report advice)

Help & Support already opens a pre-filled email to `Vidoraxlabs@gmail.com` (Settings → Help & Support). Check it's
reachable within two taps from Settings and from About, that the address is shown as text with a "Copy address"
fallback when no email app exists, and that both languages read well. Fix only what's missing; record what you found.

### T4 — Store listing text (report item 1) — no app change

Create `docs/play-console/STORE_LISTING_v2.md` with copy-paste-ready text, **English and Urdu** listings:
- **App name** (≤ 30 chars), **short description** (≤ 80), **full description** (≤ 4000): keyword-rich but natural,
  features with their benefit, bullet points, plain language.
- First fetch the **live** listing (`https://play.google.com/store/apps/details?id=com.vidorax.fast.videodownloader`)
  and `PLAY_SUBMISSION.md`'s current copy; keep claims true to **test2** (no features that are only on `main`).
- **Play metadata policy (rejection risks):** no other apps' or sites' brand names (YouTube, Instagram, TikTok,
  Facebook, WhatsApp, …), no "download from any site / any video", no "#1 / best / free download" ranking or price
  claims, no keyword lists or repetition, no emoji or ALL-CAPS title, no fake reviews. End the description with a
  short permitted-use line (download only what you have the right to; DRM and YouTube not supported).
- A keyword table: keyword → where it appears → why (category terms like video downloader, video saver, offline video
  player, browser, HD, private, MP4, HLS…), plus a 1-line note of what to change after a month of Play Console search
  data.

### T5 — Feature-focused store screenshots (report item 3) — no app change

Produce **8 designed phone screenshots** per language (English, Urdu), 1080 × 1920 PNG (9:16, Play phone size), plus
the generator in `scripts/store/` so they can be rebuilt:
1. Capture real screens from the **test2 release build** on a **separate clean emulator** named
   `VidoraX_Play_Shots` (Pixel 8 profile, API 35 — create it with `avdmanager` if it doesn't exist). **Never wipe or
   reuse the `Pixel_8` AVD** — it holds the downloader team's test data. Use only public-domain / test content (e.g.
   Big Buck Bunny, the w3schools sample, Mux test stream) — no logos or videos of real platforms or people.
2. Screens: browser start page; "Video available" on a page; quality choice; downloads in progress; Player library;
   player with gestures; App Lock / privacy; Urdu interface.
3. Design each: brand background (theme brand red from `src/theme/colors.ts`), a 3–6-word caption at the top in
   Poppins (`node_modules/@expo-google-fonts/poppins`), the screenshot in a simple device frame. Same style across all 8.
   Captions follow the same brand-name rules as T4.
4. Also a 1024 × 500 feature graphic in the same style.
5. Output to `~/Downloads/VidoraX-Play-Assets/v2/{en,ur}/` (outside the repo); commit only the generator and a contact
   sheet description in `STORE_LISTING_v2.md`.

## 2. Tests and checks for the branch

After each topic: `npm test`, `npm run typecheck`, `npm run lint` (0 errors, warnings not above the branch's
baseline — record it first), `bash scripts/dev/gradle.sh :vidorax-media:testDebugUnitTest :vidorax-web:testDebugUnitTest --rerun`
if any Kotlin changed, `git diff --check`. Paste totals into the work log.

Manual: debug build first, then a **release build** (`bash scripts/dev/gradle.sh :app:assembleRelease`). Upgrade check:
build the **test1 APK** from the tag once (`git worktree add /tmp/vx-test1 v1.0.0-test1`, `npm ci`, assembleRelease),
seed it with `scripts/qa/seed_test1.sh` (from the `/tmp/vx-qa` worktree; `SEED_APK=…`), install your release APK over
it with `adb install -r`, and confirm downloads, favourites, history and settings survive and the tour shows once.
For switching between debug and release on the same emulator, re-sign both APKs with `android/app/debug.keystore`
(zipalign + apksigner) as Prompt A did; the final check uses the APKs exactly as Gradle signed them.

Regression after the last topic (release build): run `regress.py` R1–R10 from `/tmp/vx-qa/scripts/qa/` (its step
numbering: R1 cold start — no slower than test1, ~6.2 s on this emulator; R2 MP4 page; R3 HLS; R4 social; R5 YouTube
refused — confirm the toast on the screenshot, never assume; R6 pause/resume; R7 player; R8 App Lock with `r8.sh`; R9
Urdu; R10 upgrade). Emulator: don't reboot or wipe without asking the owner; if the system stalls and a stale "not
responding" dialog keeps returning, tap Close app, restart, re-run, and record it.

Work log: `docs/work-log/test2-tester-feedback.md` — baseline, per topic (plan, decisions, files, test totals, manual
cases PASS / FAIL / BLOCKED with notes), regression, "Found, not fixed".

## 3. Version, pull request — ⏸ the only owner gate

1. Last commit on your branch: set **versionCode 2** and **versionName "1.0.1"** in **both**
   `android/app/build.gradle` and `app.json` (`T0: versionCode 2 / 1.0.1`).
2. Push `fix/test2-tester-feedback` and open a PR into **`release/1.0`** titled "Test build 2: tester feedback
   (rating, walkthrough, support, store listing)", using the repo PR template, with a checklist of T0–T5. Save
   screenshots to `.claude/pr-evidence/test2/` (not committed) and list them for the owner to attach.
3. **Stop** and report: what's done, the PR link, and that the owner should review and merge it. Continue with §4 only
   when the owner says it's merged.

## 4. After the owner says "merged" — build test2

1. In your worktree: `git fetch origin`, `git switch release/1.0` (or `git switch -c release/1.0 --track
   origin/release/1.0`), `git pull --ff-only`. Run `bash scripts/release/check-release.sh` — every check must pass
   (branch, clean tree, versions match, versionCode 2 above the last tag's 1, upload key present).
2. `bash scripts/dev/gradle.sh :app:bundleRelease`. Confirm the AAB is signed with the upload key (same certificate
   SHA-256 as test1, starting `36:B9:C6:22`). Make a universal APK from it with bundletool and install it **over the
   Gradle-signed test1** on the emulator: data intact, tour shows once, Rate works, quick R1–R10.
3. Tag and push: `git tag -a v1.0.1-test2 -m "VidoraX 1.0.1 (versionCode 2) — tester feedback: rating link,
   first-launch walkthrough, support, store listing. AAB SHA-256 <sum>"`, `git push origin v1.0.1-test2`.
4. Copy the AAB to `~/Downloads/VidoraX-Play-Assets/VidoraX-1.0.1-vc2.aab`.

## 5. Copy the changes into `main`

1. `git switch -c chore/test2-into-main origin/main`, then `git cherry-pick -x <every T commit and the version commit>`
   in order. Resolve conflicts keeping **both** sides (main has newer features, e.g. Help text, player and settings
   changes); re-run the full gate on this branch. On `main` the versionCode must end up ≥ 2.
2. Push and open a PR into `main`. Don't touch `faran/*` or `dl/*` branches; if they're open PRs, they'll pick this up
   when they merge `main`.

## 6. Final report to the owner

- Table of T1–T5: status, commits, tests added, manual cases, screenshots.
- **What to upload where (owner does this in Play Console):**
  1. **Closed testing → same track → Create new release → upload `VidoraX-1.0.1-vc2.aab`** (same track keeps the
     14-day testing count; release notes in en + ur — write them).
  2. **Store presence → Main store listing:** paste the new name/short/full description (English), add the Urdu
     translation, replace the phone screenshots and the feature graphic from `~/Downloads/VidoraX-Play-Assets/v2/`.
  3. No Data safety, permission or content-rating change is needed (confirm this is still true).
- Branch state at the end (`release/1.0`, `main`, tag, open PRs) and worktrees removed.
- BLOCKED items, decisions, and "Found, not fixed".
