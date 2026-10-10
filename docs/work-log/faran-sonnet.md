# Work log — Faran · Sonnet · Phase 16 quick fixes

Branch `faran/sonnet-fixes` (from `main` at `efcd4ec`), prompt `docs/work-plans/faran-sonnet-prompt.md`. One task = its
own commits, prefixed with the task ID. Device: Pixel_8 AVD (API 35), `emulator-5554`.

## Baseline (2026-10-10, before any change)

| Gate | Result |
| --- | --- |
| `npm ci` | OK |
| `npm test` | 624 tests, 624 pass, 0 fail (98 suites) |
| `npm run typecheck` | OK (0 errors) |
| `npm run lint` | 0 errors, 84 warnings |
| `gradle :vidorax-media:testDebugUnitTest :vidorax-web:testDebugUnitTest --rerun` | BUILD SUCCESSFUL — vidorax-media 493 tests / 0 failures, vidorax-web 26 / 0 |

Environment: macOS 26.6.2, Node 22.23.1, Play upload key present in `~/.vidorax-signing` (never read).

## Test-build decisions (apply to every task)

- **test1 baseline APK.** `main` differs from tag `v1.0.0-test1` only in docs, the PR template and
  `scripts/release/check-release.sh` (`git diff --stat v1.0.0-test1 efcd4ec`), so the test1 build used for R10 is a
  release build of the untouched tree, made once before the first change.
- **Signing for the per-task release passes.** Debug and release builds share the application id, and Android only
  installs over an app with the same signature. To switch between the debug build (Metro) and the release build without
  wiping the device data the regression needs, per-task release passes re-sign both the test1 baseline and the task's
  release APK with the repo debug keystore (`apksigner sign --ks android/app/debug.keystore`). Signature equality is all
  the upgrade path depends on, so R10 behaves the same as with the upload key. The final pass (§7) repeats R10 with both
  APKs as Gradle signed them (upload key). No APK built here is uploaded anywhere.

---

## F12 — Correct wrong help answers

**Plan.** Check every Help & Support answer (`support.faq.*`, 20 answers, `src/support/faq-content.ts` holds keys only)
against the code; rewrite the wrong ones in `en.ts` and `ur.ts` (real Urdu, UI labels quoted exactly as the Urdu UI shows
them); add `src/localization/catalog-parity.test.ts`. Manual: open every changed answer in English and Urdu.

**Checks made against the code (claim → evidence → verdict).**

| Answer | Claim | Evidence | Verdict |
| --- | --- | --- | --- |
| themeSettings | Light, Dark, System | `theme-preference.ts` `'light' \| 'logo' \| 'dark'`, labels `settings.themeLight/Logo/Dark` = System / Red / Dark, default `logo`; `resolveThemeMode` maps 1:1 (System is the light palette, it does not follow the device) | Wrong → fixed |
| pauseAndResume | HLS can't be paused; Auto Resume restarts paused progressive downloads | `runtime-actions.ts` withholds Pause only when `sourceSupportsResume === false`, which only the v1 JS engine sets; native `DownloadEngine.pause/resume` take any kind; `HlsTransfer` checkpoints every segment (HLS and DASH segment tracks); `restore()` keeps PAUSED paused and re-queues interrupted rows; `ProgressiveTransfer` restarts from zero on a 200 to a ranged request; the Auto Resume setting is not pushed to the native engine (`ensure-bridge.ts` sends Wi-Fi-only + concurrency only) | Wrong → fixed (no claim about the Auto Resume switch; see Found, not fixed) |
| support.description, whereDownloadsAppear, howToPlayDownloaded, videoNotPlaying, storageSettings, category "Library & Files", action "لائبریری کھولیں" | "Library" | the tab is `nav.library` = "Player" / "پلیئر" | Wrong → "Player tab" |
| whereDownloadsAppear | only Downloads + Library | auto Gallery copy is on by default (`autoSaveToGallery`, Download Settings → Save to Gallery) | Incomplete → added |
| howToDownload | "use the download controls … confirm the download" | the offer is "Video available"; tap → quality sheet → download; no separate confirm; YouTube refused | Fixed |
| howToUseBrowser | long-press: share / open external | sheet has Copy Link, Share Link, Open in External Browser (Open in New Tab disabled until F8) | Fixed (F8 adds "new tab") |
| wifiOnlyDownloads | "Wi-Fi Only" in Download Settings | label "Download over Wi-Fi only"; engine holds running downloads in WAITING_NETWORK too | Wording fixed |
| unsupportedSource | list of refusals | YouTube missing | Fixed |
| renameMedia | "item's details or file actions" | Rename only in Download details → menu (File actions); Player-tab long-press has no Rename | Made precise |
| deleteMedia | Delete in Downloads or Library removes file + entry | Player tab long-press "Delete from VidoraX"; Download details File actions Delete; the gallery copy is kept (`library.deleteMessage`, ARCHITECTURE §3.3) | Fixed |
| shareMedia / openExternally | file actions | Player tab long-press has Share / "Open with…"; details File actions has Share / Open | Made precise |
| favorites | mark from details or Library | only Download details (heart in the header); Player tab has a Favorites filter and there is a Favorites list | Fixed |
| folders | create/move from details or "Library organization controls" | Download details → Folder row → Move to folder / Manage folders; Player tab → Folder filter; folders are logical (files not moved) | Fixed |
| storageSettings | usage on "Home or Library"; uninstall removes VidoraX files | the Home screen is never shown (`(tabs)/index.tsx` redirects `/` to Browser, tab `href: null`); usage is Settings → Storage → Manage Storage (Clear Cache = temp files only); gallery copies survive uninstall | Fixed |
| howToPlayDownloaded / resumePlayback / fullscreenOrientation / downloadFailed / fileUnavailable / unsupportedCodec / loginAccount / languageSettings | — | checked against Player controls (fullscreen + orientation sheet), playback persistence, Settings → Language (English / اردو), local-only storage | Correct, unchanged (except the tab name) |

Keywords: `pauseAndResume` gains DASH/stream, `themeSettings` gains red (en + ur).

**Device check of the pause claim before writing it** (debug build, Pixel_8): Mux `x36xhzz` 288p HLS from the hls.js
demo page → paused at 75 % in Downloads (`hls.checkpoint` `completed:49`, `.part` 30,454,496 B, unchanged 10 s later) →
Resume → checkpoint went 50, 51, 53… (not 0) → completed, 36,597,153 B, 10:34, remuxed to MP4. An emulator crash during
an earlier 184p HLS download left it `downloading` at 18.9 of 21.8 MB; the next app start resumed it and it completed
(19,991,045 B) — the "phone restart continues on its own" sentence.

**Files changed:** `src/localization/en.ts`, `src/localization/ur.ts` (16 answers, support description, category
"Player & Files" / "پلیئر اور فائلیں", Urdu action "پلیئر کھولیں", 2 keyword lists), new
`src/localization/catalog-parity.test.ts`.

**Automated** (after the change): `npm test` 627 / 627 pass (+3: same keys, no empty Urdu string, same `{placeholders}`;
a mutation run — one blanked Urdu string and one deleted Urdu key — failed 2 of 3 as expected, then restored);
`npm run typecheck` OK; `npm run lint` 0 errors (84 warnings, unchanged); `git diff --check` clean. No Kotlin changed.

**Manual cases**

| # | Case | Build | Result | Note |
| --- | --- | --- | --- | --- |
| 1 | About → Help & Support → open each of the 16 changed answers (EN) | debug | PASS | text read back from the screen = catalog for 16/16 (`f12_walk_en`) |
| 2 | Same in Urdu | debug | PASS | 16/16 = catalog; right-aligned, real Urdu UI labels (`f12_walk_ur`) |
| 3 | Theme answer in Red / Dark / System | debug | PASS | Dark: readable; System is the plain light palette (screenshot) — matches the new answer |
| 4 | UI named in the answers exists | debug | PASS | Player long-press: Open with… / Share / Save to device / Delete from VidoraX; Download details: heart, File actions (Open, Share, Rename, Delete), Play; Settings → Appearance → Theme System/Red/Dark |
| 5 | Help & Support on the release build, Urdu | release | PASS | "فولڈرز کیسے کام کرتے ہیں؟" shows the new answer, RTL |

**Regression (release build `4018b22`, re-signed with the debug key, installed with `adb install -r` over test1)**

| # | Result | Note |
| --- | --- | --- |
| R1 | FAIL (target), no regression | no crash; `am start -W` TotalTime 1.1 s, but the browser is usable at ~6.9 s: the branded JS splash animation runs ~6 s (by design, ARCHITECTURE §8). Same splash in test1 — see the baseline timing under F9 |
| R2 | PASS | w3schools → "Video available" → MP4 770 KB 176p → plays (media session PLAYING) |
| R3 | PASS | hls.js demo → quality sheet (1080/720/480/288/184p) → 184p → MP4 19.1 MB → plays |
| R4 | PASS | TikTok @scout2015 → MP4 2.8 MB 576p; Facebook `m.facebook.com/watch/?v=2289516264908285` → MP4 5.0 MB 360p (Facebook's logged-out viewer had moved on to the next NASA reel; that one was downloaded) |
| R5 | PASS | `youtu.be/dQw4w9WgXcQ` typed + Go → toast "YouTube downloads are not supported", page unchanged |
| R6 | PASS | HLS paused at 21.1/21.6 MB, held, resumed, completed, plays |
| R7 | PASS | play/pause, +10 s 00:39→00:49, −10 s →00:39, scrubber →05:19, fullscreen → ROTATION_90 landscape, Home while playing → task `mode=pinned` (PiP) |
| R8 | PASS | enable (PIN + recovery code) → Home → return → "Enter PIN" → unlock → disable with PIN → Home → return: no PIN |
| R9 | PASS | Urdu: Help, Settings, tabs in Urdu, Help RTL |
| R10 | PASS | test1 (1 favorited MP4, 3 history pages) → `install -r` → Downloads 1 item, Favorites 1 item, History 3 entries |

**Found, not fixed (F12)**

- The Auto Resume switch (Settings → Download Settings) does nothing for downloads made by the native engine:
  `ensure-bridge.ts` pushes only Wi-Fi-only and concurrency, and the engine always resumes interrupted downloads. The
  switch only affects the legacy v1 JS engine. The FAQ no longer claims it does anything.
- Theme "System" is the light palette (`resolveThemeMode` maps 1:1, "no OS takeover"); it does not follow the device's
  dark mode, which the label suggests. `docs/ARCHITECTURE.md` §8 still describes Light / Logo / Dark / System and says
  System follows the device.
- The omnibox "Go to website" row lowercases the whole URL: typing `youtu.be/dQw4w9WgXcQ` offers
  `https://youtu.be/dqw4w9wgxcq` — case-sensitive paths (YouTube ids, many CDNs) break when that row is tapped.
- The Home screen (`src/screens/home`, with "Paste link" and the storage summary) is never shown: `(tabs)/index.tsx`
  redirects `/` to Browser and the tab has `href: null`. (Matters for F7.)
- Hard-coded English seen while testing: the "Press back again to exit" toast (`use-tab-exit-back-handler.ts`) and the
  omnibox row subtitles "Recent search", "Suggested site", "Search Google for “…”" (`suggestion.service.ts`).

## F9 — Clear recent searches

**Plan.** The store's `clear()` exists but nothing calls it, and it does not drop the omnibox's cached suggestion index
(`suggestionService` keeps a 1-minute index plus a per-query cache), so a cleared search could still be suggested.
Add a History row + its own confirmation dialog, make `clear()` invalidate the suggestion index like `record()` does, and
test "after clear, no `recent_search` suggestion" against the real `SuggestionService`.

**Decisions.**
- *Placement:* a full-width row "Clear recent searches" under the History search field (with a one-line hint), shown
  while there are recent searches — not a second unlabeled header icon beside "Clear all", which would be
  indistinguishable from it. ROADMAP Phase 16 #3 also calls it a row.
- *Testability:* `SuggestionService` now receives its sources in the constructor (`SuggestionSources`); the app
  instance in `browser/suggestions/index.ts` passes the storage services (`storage-sources.ts`). The storage layer
  needs expo-sqlite (and uses parameter properties), so it cannot load under `node --test`.
- The clear sequence lives in `store/recent-searches/clear-recent-searches.ts` (clear table → invalidate suggestions), used
  by the store and by the test.
- "Clear all" history already only touches `browser_history` + `recent_urls`; its dialog now says recent searches
  are kept (en + ur).

**Files changed:** `src/browser/suggestions/{suggestion.service.ts, index.ts, storage-sources.ts (new),
suggestion.service.test.ts (new)}`, `src/store/recent-searches/{actions.ts, clear-recent-searches.ts (new)}`,
`src/screens/history/{HistoryScreen.tsx, hooks/useHistoryScreen.ts, components/HistoryClearSearchesRow.tsx (new),
components/HistoryDeleteDialog.tsx, components/index.ts}`, `src/localization/{en,ur}.ts` (`history.clearSearches*`,
`history.clearMessage`).

**Automated:** `npm test` 631 / 631 (+4: "cats" suggested before; no `recent_search` for "ca"/"cats"/"c" after
clear even with a warm cache; history suggestions kept; without the invalidation the stale index still offers it);
typecheck OK; lint 0 errors (84 warnings); `git diff --check` clean. No Kotlin changed.

**Manual cases**

| # | Case | Build | Result | Note |
| --- | --- | --- | --- | --- |
| 1 | Search "cats", type "ca" → "cats" suggested | debug | PASS | row "cats · Recent search" |
| 2 | History → Clear recent searches → confirm → "ca" → no "cats" | debug | PASS | row disappears; 10 history entries kept (incl. the Google results page — that is browsing history) |
| 3 | Force-stop + reopen → still cleared, history still there | debug | PASS | 0 recent rows, 10 history rows |
| 4 | Cancel in the dialog → nothing cleared | debug | PASS | row and suggestion stay |
| 5 | Urdu dialog + row | debug | PASS | "حالیہ تلاشیں صاف کریں؟" / "تلاشیں صاف کریں", row mirrored RTL |
| 6 | Clear all browsing history keeps searches | debug | PASS | Urdu "سب صاف کریں" → 0 history rows, "dogs" still suggested for "do" |
| 7 | Release over test1: the test1 search shows the row → clear → gone, no suggestion | release | PASS | |

**Regression (release `62ccd8a`, debug-key re-signed, over a freshly seeded test1; scripted in `regress.py`)**

| # | Result | Note |
| --- | --- | --- |
| R1 | FAIL (target), no regression | browser chrome 6.2 / 6.2 / 6.2 s; test1 measured the same way 6.2 / 6.3 / 6.4 s (splash animation) |
| R2 | PASS | w3schools MP4 → Player PLAYING |
| R3 | PASS | quality sheet → 184p → completed |
| R4 | PASS | TikTok 576p, Facebook completed |
| R5 | PASS | toast "YouTube downloads are not supported" |
| R6 | PASS | 288p paused at 31.5 / 37.7 MB, unchanged after 8 s, resumed, completed, plays from the start |
| R7 | PASS | −10/+10 (00:05→00:15→00:05), seek →05:19, PLAYING, fullscreen ROTATION_90, PiP `mode=pinned` (Home while a video plays) |
| R8 | PASS | PIN asked after enable; none after disable (first scripted try missed the Enable button while the screen scrolled — redone) |
| R9 | PASS | Settings 25 Urdu strings; History row/dialog in Urdu |
| R10 | PASS | 1 download, favorite, 6 history entries, the test1 recent search shows the new row |

**Found, not fixed (F9)**

- The 288p HLS download that was paused and resumed opened at its saved position 84.025 s and stayed BUFFERING (no
  picture, no PiP because nothing played); seeking from the start and to 87–170 s played normally, on test1 too. A
  frame comparison against ffmpeg's own copy of the same variant shows one frame missing at the first segment boundary
  (app frame 299 = source frame 300) and 18,979 vs 19,039 video frames overall. Worth a look by whoever owns
  `HlsTransfer`/`Remuxer` (Faran · Opus engine batch?).
- Home while a video plays in landscape *fullscreen* pauses it instead of entering PiP (portrait PiP works).
- The History list's day header "TODAY" stays English in Urdu.
- Omnibox rows "Recent search"/"Recent" stay English in Urdu (see F12).
