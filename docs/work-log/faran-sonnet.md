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

## F8 — Open link in new tab

**Plan.** Enable `openInNewTabAction`; give the sheet's `openInNewTab` a real implementation over
`browserStore.createTab({ url })`; at the 10-tab limit show "Maximum 10 tabs open"; translate the sheet title,
announcement and the four labels; unit-test the action and the open/limit/non-http paths.

**Decisions.**
- *Limit message:* `browser.tabsLimitReached` was only ever announced to screen readers (the menu's feedback is an
  invisible live region). F8 shows it as a toast + announcement (`services/tabs-limit-notice.ts`, same pattern as the
  YouTube refusal), so a sighted user sees why no tab opened.
- *Non-http links* (`mailto:`, `tel:` — the sheet also opens for them): "Open in new tab" is not offered
  (`isAvailable`), rather than shown greyed out; the sheet already hides disabled entries.
- Actions carry a `labelKey` (translated when the sheet renders) instead of an English `label`; the dead "(Soon)"
  suffix for disabled actions is gone (the sheet never showed disabled entries). The share sheet's fallback title is
  translated too.
- The browser Help answer (F12) now says a link can be opened in a new tab (en + ur).

**Files changed:** `src/browser/actions/{types.ts, open-link-in-new-tab.ts (new), open-link-in-new-tab.test.ts (new),
builtins/*.action.ts}`, `src/browser/hooks/useBrowserLongPressActions.ts`, `src/browser/services/tabs-limit-notice.ts
(new)`, `src/localization/{en,ur}.ts` (`browser.linkActions.*`, `support.faq.howToUseBrowser.answer`).

**Automated:** `npm test` 639 / 639 (+8: creates the tab with the trimmed URL; limit → message, no tab;
`mailto:`/`tel:`/`javascript:`/`intent:`/empty → nothing; http/https only; action enabled, offered for http(s), not
for mailto/tel, passes the trimmed link, translated label key); typecheck OK; lint 0 errors (84 warnings);
`git diff --check` clean.

**Manual cases**

| # | Case | Build | Result | Note |
| --- | --- | --- | --- | --- |
| 1 | Long-press a link on a news site → Open in new tab → page in a new tab, counter +1 | debug | PASS | Hacker News → "REA Reverse" link → new tab `rea.tools`, counter 1 → 2; switching back: the sheet does not reappear |
| 2 | Video page opened this way → "Video available" → download | debug | PASS | w3schools "HTML Multimedia" → long-press Next → new tab `html5_video.asp` → offer (first "Already downloaded": the earlier copy was still in the Gallery — deleted it) → after an app restart the restored tab offered again → MP4 770 KB completed |
| 3 | 10 tabs open → message, no 11th tab | debug | PASS | toast "Maximum 10 tabs open", counter stays 10, page unchanged |
| 4 | Copy / Share / Open in external browser still work | debug | PASS | Copy: pasted into the address bar = the link; Share: system chooser; External: Chrome opened the link |
| 5 | Urdu labels, RTL sheet | debug | PASS | "لنک کے اختیارات", four Urdu labels, icons on the right; limit toast "زیادہ سے زیادہ ۱۰ ٹیبز کھلے ہیں" |
| 6 | Release over test1 | release | PASS | Open in new tab → 1 → 2 tabs, video page offered |

**Regression (release `3a08b5d`, debug-key re-signed, over a freshly seeded test1)**

| # | Result | Note |
| --- | --- | --- |
| R1 | FAIL (target), no regression | browser chrome 1.9* / 6.2 / 6.4 s (*first sample caught a red frame early — counted as noise); test1 6.2–6.4 s |
| R2 | PASS | MP4 → Player PLAYING |
| R3 | PASS | 184p completed |
| R4 | PASS | TikTok 576p, Facebook completed |
| R5 | PASS | YouTube toast |
| R6 | PASS | (script picked 1080p) paused at 103.6 / 430.5 MB, unchanged 8 s, resumed, completed 465.3 MB |
| R7 | PASS | 02:30 → +10 02:40 → −10 02:30 → seek 05:19, PLAYING, fullscreen ROTATION_90, PiP pinned |
| R8 | PASS | PIN asked after enable; after disable (done by hand — the script tapped the wrong PIN field) no PIN |
| R9 | PASS | Settings in Urdu (25 strings) |
| R10 | PASS | 1 download, favorite, 4 history entries, test1 recent search row |

**Found, not fixed (F8)**

- "New tab" in the browser menu and "+" in the tab switcher at the 10-tab limit still only announce the message to
  screen readers (invisible otherwise); F8's toast helper could be reused there.

## F7 — Paste a copied link

**Plan.** `useQualitySelection.open` (the "Paste link" action of Downloads and Home) only navigated to the Browser. Make
it read the clipboard (`expo-clipboard` `getStringAsync`, SDK 57 docs: empty string when empty or denied), pick the first
http(s) link, and open it through `openPastedLink` in the active tab — the address-bar paste path, direct analyzer
first. YouTube → `announceYouTubeNotSupported`, nothing loads. No link → Browser with the address-bar editor focused
and the keyboard up.

**Decisions.**
- *Extraction* (`services/clipboard-link.ts`): stricter than `urlFromSharedText` (shares), because copied text is often
  not a link: only `http://`/`https://`; the URL must start a word, so an `intent://…;S.browser_fallback_url=https://…`
  or a `?next=https://…` inside another link is not taken; no bare hosts (`v1.2`, `file.txt`); trailing `.,!?;:…`
  and unmatched `)`/`]`/`}` are dropped (Wikipedia-style `/Mercury_(planet)` kept); `https:///x` refused.
- *YouTube:* the toast shows and the user stays where they were (Downloads); the Browser is not opened.
- *Focus request* (`services/address-bar-focus.ts`): a one-shot request (expires after 5 s so it can never steal focus
  later), taken by the address bar when the Browser screen gains focus. The compact bar has no ref; focusing means
  opening the editor overlay (`onFocus`). On Android the overlay's first keyboard request is dropped
  (`ImeTracker … onFailed at PHASE_CLIENT_VIEW_SERVED` — the field is not yet served to the IME; a tap does not hit
  this), and React Native ignores `focus()` on an already-focused field, so the hook blurs and refocuses it once
  (800/900 ms). Verified: `mInputShown=true`, `ImeTracker … onShown`.
- *Home:* the Home screen is never shown in the app (see F12); it uses the same `open`, so it gets the behaviour too,
  but its manual case is BLOCKED (not reachable).
- The Downloads empty state's "Open Browser" button used the same `open`; it now just opens the Browser (its label
  promises nothing else) with its own hint `downloads.emptyActionHint`. Paste-link hints (`home.pasteLinkA11y`,
  `downloads.pasteLinkHint`) describe the new behaviour (en + ur).
- If the active tab's WebView is not mounted, the link is queued with `pendingNavigationService` (Browser loads it on
  focus) instead of being dropped.

**Files changed:** `src/browser/services/{clipboard-link.ts, clipboard-link.test.ts, address-bar-focus.ts,
address-bar-focus.test.ts, paste-clipboard-link.ts}` (new), `src/browser/hooks/useAddressBar.ts`,
`src/screens/downloads/{quality/useQualitySelection.ts, DownloadsScreen.tsx, components/DownloadEmptyState.tsx}`,
`src/localization/{en,ur}.ts`.

**Automated:** `npm test` 653 / 653 (+14: link alone, inside text (emoji, Urdu), first of several, none
(text, `v1.2`, bare host, ftp, mailto, javascript, `https://`, `https:///nohost`), intent:// and nested links,
spaces/newlines, trailing punctuation and brackets, upper-case scheme; decision open / YouTube (watch, youtu.be,
shorts in text) / focus; focus request taken once, expires after 5 s, listener + unsubscribe); typecheck OK; lint 0
errors (84 warnings); `git diff --check` clean.

**Manual cases**

| # | Case | Build | Result | Note |
| --- | --- | --- | --- | --- |
| 1a | TikTok link copied in Chrome (Chrome's "Copy link") → Downloads → Paste link | debug | PASS | Browser loads `tiktok.com/@complex/video/7626254334065511711`; `[VidoraDirect] status SUPPORTED reason VERIFIED`; "Video available" |
| 1b | Facebook link copied in Chrome → Paste link | debug | PASS | `m.facebook.com/watch/?v=1376350954687257` → SUPPORTED/VERIFIED, "Video available" |
| 2 | Plain text copied ("hello cats and dogs") → Paste link | debug | PASS | Browser, address-bar editor open and focused, keyboard visible (`mInputShown=true`). First two attempts failed (no ref / keyboard dropped) — fixed as described above |
| 3 | YouTube link copied in Chrome → Paste link | debug | PASS | toast "YouTube downloads are not supported", stays on Downloads, the tab's page unchanged |
| 4 | Downloads screen paste button → same results | debug | PASS | cases 1–3 were all run from the Downloads paste button |
| 5 | After a cold start | debug | PASS | force-stop → launch → Downloads → Paste link with a TikTok link → loads, "Video available" |
| 6 | Home → Paste link | — | BLOCKED | Home screen is not reachable in the app (`/` redirects to Browser); it uses the same action |
| 7 | Urdu | debug | PASS | no new visible text; the two hints have Urdu strings (catalog parity test) |
| 8 | Release over test1: TikTok link copied in Chrome → Paste link | release | PASS | `@complex/video/7626254334065511711` loaded, "Video available" |

**Regression (release `75eda12`, debug-key re-signed, over a freshly seeded test1)**

| # | Result | Note |
| --- | --- | --- |
| R1 | FAIL (target), no regression | 6.4 / 6.4 / 6.4 s; test1 6.2–6.4 s |
| R2 | PASS | MP4 → Player PLAYING |
| R3 | PASS | 184p completed |
| R4 | PASS | TikTok 576p, Facebook completed (re-run after R8 left the app locked) |
| R5 | PASS | YouTube toast |
| R6 | PASS | 288p paused at 14.4 / 36.6 MB, unchanged 8 s, resumed, completed |
| R7 | PASS | 00:04 → +10 00:14 → −10 00:04 → seek 05:19, PLAYING, fullscreen ROTATION_90, PiP pinned |
| R8 | PASS | PIN asked after enable; disable done by hand (the scripted disable step is unreliable), then no PIN |
| R9 | PASS | Settings in Urdu (27 strings) |
| R10 | PASS | 1 download, favorite, 4 history entries, test1 recent search row |

**Found, not fixed (F7)**

- Android shows its own "VidoraX pasted from your clipboard" toast first (system behaviour, Android 12+); our YouTube
  refusal toast follows it.

## F11 — Translate page

**Plan.** Add "Translate page" to the browser menu after Share; tap → new tab with
`https://translate.google.com/translate?sl=auto&tl=<en|ur>&u=<encodeURIComponent(page)>` (`tl` = app language);
disabled on the browser home, non-web pages and Google Translate pages; 10-tab limit → the F8 toast; one sentence in
the Privacy Policy (en + ur); unit-test the URL builder.

**Decisions.**
- *Google Translate pages* = `translate.google.com`, `*.translate.goog` (where Google serves the translated copy) and
  `translate.googleusercontent.com`; Translate is disabled there.
- *Privacy sentence* appended to section 5 "Third-party and service-provider processing", paragraph 1 (structure of the
  frozen legal document unchanged); `legalConfig.updatedDate` → 2026-10-10 because the policy text changed.
- The tab limit reuses F8's `announceTabsLimitReached` (one small shared helper; F11 now depends on F8's commit).
- `BROWSER_CHROME_ACTIONS` `translate` set to `enabled: true` (that list's flags mark what ships).

**Files changed:** `src/browser/services/{translate-page.ts, translate-page.test.ts}` (new),
`src/browser/components/BrowserOverflowMenu/{browser-menu-actions.ts, types.ts}`,
`src/browser/constants/chrome-actions.ts`, `src/legal/config.ts`, `src/localization/{en,ur}.ts`
(`browser.translatePageA11y`, `privacy.sections.thirdParties.p1`).

**Automated:** `npm test` 658 / 658 (+5: sl=auto, tl=en/ur; `?`, `#`, `&` and spaces encoded and round-trip; non-Latin
raw and percent-encoded addresses round-trip; home/about/file/empty/invalid → unavailable; Google Translate pages →
unavailable); typecheck OK; lint 0 errors (84 warnings); `git diff --check` clean.

**Manual cases**

| # | Case | Build | Result | Note |
| --- | --- | --- | --- | --- |
| 1 | Spanish news site → Translate page → English page in a new tab | release | PASS | BBC Mundo → new tab (1 → 2) → `www-bbc-com.translate.goog/mundo?_x_tr_sl=auto&_x_tr_tl=en…`, "Spanish → English", headlines in English. On the debug build the first try reached Google's "unusual traffic" reCAPTCHA (`google.com/sorry`, with the correct `translate?sl=auto&tl=en&u=https%3A%2F%2Fwww.bbc.com%2Fmundo` as `continue`) — not solved (not allowed); later tries went through |
| 2 | App in Urdu → `tl=ur` | debug | PASS | menu label "صفحہ ترجمہ کریں" right after Share; new tab URL `tl=ur` → `…translate.goog/mundo?_x_tr_tl=ur` |
| 3 | Disabled on the browser home / on a Google Translate page | debug | PASS | menu row `enabled=false` on the home tab and on `translate.google.com/?sl=es…`; `true` on BBC. (The reCAPTCHA page is `www.google.com/sorry`, not a Translate page, so Translate stays enabled there) |
| 4 | Video on the translated page still detected | debug | PASS | w3schools `html5_video.asp` → Translate (ur) → `www-w3schools-com.translate.goog/…` → `[VidoraPipeline] stage offer OFFERED`, bar "ویڈیو دستیاب / پہلے سے ڈاؤن لوڈ شدہ" (already saved earlier) |
| 5 | 10 tabs → message | debug | PASS | toast "زیادہ سے زیادہ ۱۰ ٹیبز کھلے ہیں", still 10 tabs |
| 6 | Privacy Policy sentence en + ur | debug | PASS | "When you tap Translate page in the browser menu, the address of that page is sent to Google Translate…", Urdu in section ۵; "Last updated: 2026-10-10" |

**Regression (release `525ed4d`, debug-key re-signed, over a freshly seeded test1)**

| # | Result | Note |
| --- | --- | --- |
| R1 | FAIL (target), no regression | 6.2 / 6.2 / 6.5 s; test1 6.2–6.4 s |
| R2 | PASS | MP4 → Player PLAYING |
| R3 | PASS | 184p completed |
| R4 | PASS | TikTok 576p, Facebook completed |
| R5 | PASS | YouTube toast |
| R6 | PASS | 288p paused at 13.9 / 36.7 MB, unchanged 8 s, resumed, completed |
| R7 | PASS | 00:04 → +10 00:14 → −10 00:04 → seek 05:19, PLAYING, fullscreen ROTATION_90, PiP pinned |
| R8 | PASS | lock screen after enable + Home; none after disable (`r8.sh`) |
| R9 | PASS | Settings in Urdu (27 strings) |
| R10 | PASS | 1 download, favorite, 6 history entries, test1 recent search row |

**Found, not fixed (F11)**

- The browser menu keeps its icons on the left and is not mirrored in Urdu (existing layout).
- The emulator's network sometimes gets Google's "unusual traffic" CAPTCHA (also seen for Google searches) — an
  environment limit, not an app issue.

## F10 — Player: time left + double-tap play/pause

**Plan.** Tappable duration label (total ↔ −time left, persisted like `library/view-mode.ts` does in MMKV); replace the
half-split double tap with thirds (−10 s / play-pause / +10 s), keeping the zoom-reset precedence; update
`player.surfaceHint` and ARCHITECTURE §7; unit-test the zone function and the label formatting.

**Decisions.**
- *Zone:* the existing double tap covered the whole surface width (`resolveCenterDoubleTapSide(x, layout.width)`), so
  "centre zone" = that surface; the new `resolveDoubleTapAction(x, width, zoomed)` is a `'worklet'` called inside the
  gesture (`surfaceWidth`, `isZoomed(scale)`), so the zoom rule stays first exactly as before: zoomed → only reset.
  The middle third includes both edges (exactly 1/3 and 2/3 → play/pause). Physical `event.x`, never mirrored.
  `resolveCenterDoubleTapSide` / `resolveDoubleTapSide` (halves) are removed.
- *Play/pause* reuses the screen's `onPlayPause` (same as the button: keeps the controls' timer fresh).
- *Label format:* the existing `formatPlaybackTime` style (`00:05`, `1:02:03`), so time left reads `−00:05` /
  `−1:02:03` (U+2212) next to the `00:05`-style position label, not `−0:05` as in the task's example.
- *Time left* = ⌊total⌋ − ⌊position⌋: with a fractional length (634.63 s → "10:34") a rounded-up remainder showed
  05:42 + 04:53 = 10:35 on the device; fixed so the labels always add up to the total shown.
- MMKV key `vidorax.mmkv.player.durationLabelMode.v1` (default `total`).

**Files changed:** `src/player/{double-tap-seek.ts, double-tap-seek.test.ts (new), duration-label.ts (new),
duration-label.test.ts (new), duration-label-preference.ts (new), index.ts}`,
`src/screens/player/{PlayerScreen.tsx, components/PlayerTimeline.tsx, components/PlayerVideoSurface.tsx}`,
`src/storage/constants/mmkv-keys.ts`, `src/localization/{en,ur}.ts` (`player.surfaceHint`, `player.duration*`),
`docs/ARCHITECTURE.md` §7.

**Automated:** `npm test` 671 / 671 (+13: thirds; exactly 1/3 and 2/3 and a width not divisible by 3; zoomed →
reset wherever the tap lands, also with width 0; zero/negative/NaN/∞ width → nothing; ±10 s; total label; −00:05,
−1:02:03; position + left = total incl. a fractional length; never below zero; unknown duration `--:--` in both modes;
toggle; stored values); typecheck OK; lint 0 errors (84 warnings); `git diff --check` clean.

**Manual cases**

| # | Case | Build | Result | Note |
| --- | --- | --- | --- | --- |
| 1 | Tap duration → toggles; survives restart | debug + release | PASS | "Total length 10:34" → "Time left −04:47" with position 05:47; after force-stop still time left; tap → total again. Release: 00:55 / −01:10 of 02:05, still time left after force-stop |
| 2 | Double-tap middle / left / right | debug | PASS | right 00:21 → 00:31, left → 00:21, middle → PLAYING, middle again → PAUSED (time unchanged) |
| 3 | Zoom in, double-tap → zoom resets only | — | BLOCKED | the AVD cannot produce a pinch: console multi-touch events reach `/dev/input/event1` (a console single tap works) but a two-finger pinch is not recognised; the emulator window is not reachable for host Ctrl+drag. Covered by the unit test and by keeping the existing reset branch first in the worklet |
| 4 | Locked → nothing happens | debug | PASS | middle and right double-taps while locked: PAUSED at 35.96 s before and after |
| 5 | Mini player unaffected | debug | PASS | leaving the Player shows the mini player; its play button plays; a tap reopens the full Player |
| 6 | Landscape fullscreen | debug | PASS | ROTATION_90; right 00:41 → 00:51, left → 00:41, middle play, middle pause |
| 7 | Urdu: sides stay physical | debug | PASS | physical right +10 (01:01 → 01:11), left −10; label a11y "کل دورانیہ 02:05" / "باقی وقت −01:04" |

**Regression (release `fed09a1`, debug-key re-signed, over a freshly seeded test1)**

| # | Result | Note |
| --- | --- | --- |
| R1 | FAIL (target), no regression | 6.5 / 6.5 / 6.5 s (Gradle building alongside); test1 6.2–6.4 s |
| R2 | PASS | MP4 → Player PLAYING |
| R3 | PASS | 184p completed |
| R4 | PASS | TikTok 576p, Facebook completed |
| R5 | PASS (verified in §7) | the script's screenshot shows no toast: the AVD keyboard had switched to floating mode and its toolbar covered the "Go" suggestion, so the link was never submitted. Re-checked by hand (Enter) on the final build, which contains this change: toast shown, page unchanged |
| R6 | PASS | 288p paused at 23.4 / 37.2 MB, unchanged 8 s, resumed, completed |
| R7 | PASS | 00:04 → +10 00:14 → −10 00:04 → seek 05:19, PLAYING, fullscreen ROTATION_90, PiP pinned |
| R8 | PASS | lock screen after enable + Home; none after disable |
| R9 | PASS | Settings in Urdu (27 strings) |
| R10 | PASS | 1 download, favorite, 3 history entries |

**Found, not fixed (F10)**

- The 288p HLS file that was paused/resumed in a regression run again stuck in BUFFERING after seeks (at 05:57); see F9.

## F5 — Recognise F4V, 3G2 and DivX

**Plan.** Teach every layer the three types without new decoders: native sniffer/types (vidorax-media), the network
classifier (vidorax-web), JS detection (extension, MIME, in-page observer, pasted links, enqueue). F4V → `.mp4`,
3G2 → `.3g2` / `video/3gpp2`, DivX → AVI path; an AVI Android can't decode is kept for "Open with" like WMV. Kotlin
tests on real ffmpeg-made header bytes (+ a DRM-branded F4V refused); JS extension/MIME tests; manual test with ffmpeg
files on `fx.127.0.0.1.nip.io:8090` + `adb reverse` (debug build only — the fixture host is a dev setup).

**Decisions.**
- *F4V* is ISO-BMFF (`ftyp` brand `f4v `) and Media3 reads it as MP4, so it gets no container of its own: it is
  sniffed/kept/remuxed as MP4 and saved as `.mp4`, `video/mp4`. A DRM-branded F4V (`ftyp` brand / `sinf` box) is
  refused by the existing ISO-BMFF protection checks — test only, no new branch.
- *3G2* gets `Container.THREE_G2("3g2")` (brand prefix `3g2`), kept byte for byte, `video/3gpp2`, details label "3G2";
  Media3 reads it with the 3GP track container. Android's media scanner records the Gallery copy as `video/mp4` — not
  ours to change.
- *DivX/XviD:* `.divx`, `video/divx`, `video/x-divx` map to AVI. MPEG-4 Part 2 DivX (`DIVX`/`XVID` fourcc) is remuxed
  to MP4 like any AVI (MP3 → AAC). DivX 3 (`DIV3`, MS-MPEG4v3) has no Android decoder and Media3 exposes only its sound,
  so the AVI was refused as "audio only". New `process/AviHeader.declaresVideoStream` (an `strh` chunk of type `vids` in
  the first 64 KiB): MediaProcessor keeps such a file as downloaded (`.avi`) and DownloadEngine skips its audio-only
  refusal for it. An AVI that declares no video stream is still refused (test).
- *"Open with" message:* the v2 module rejects `openWith` with `ERR_NO_APP` when no installed app handles the type; the
  JS mapper only knew `NO_COMPATIBLE_APP`/`ACTIVITY_NOT_FOUND`, so the user saw "couldn't open this downloaded file".
  `ERR_NO_APP` now maps to "No compatible video app is installed." (existing string, en + ur) — also for WMV.
- No new strings, no new permissions, refusals unchanged.

**Files changed:** vidorax-media `model/ContractValues.kt`, `plan/MediaSniffer.kt`, `verify/Verifier.kt`,
`process/{MediaProcessor.kt, AviHeader.kt (new)}`, `library/MediaTypes.kt`, `engine/DownloadEngine.kt`,
`src/VidoraMedia.types.ts`; tests `MediaSnifferTest`, `MediaTypesTest`, `RemuxerTest`, `DownloadEngineTest` + fixtures
`test/resources/media/process/{sample.f4v, sample.3g2, divx-mp3.divx, div3-mp3.divx}` (ffmpeg testsrc, 1 s);
vidorax-web `network/NetworkMediaClassifier.kt` + `NetworkMediaClassifierDownloadTest`; JS
`src/media-detection/{types/media.types.ts, constants/media.constants.ts, resource/video-resource.ts,
direct-analyzer/media-url.ts, observers/injected-script.ts, parsers/extension.parser.test.ts (new)}`,
`src/browser/hooks/useBrowserEngineEvents.ts`, `src/downloads/v2/enqueue-request.ts`, `src/library/format-label.ts`,
`src/downloads/completed-file/{action-errors.ts, action-errors.test.ts (new)}`; `docs/ARCHITECTURE.md` §1, §3.

**Automated:** `npm test` 678 / 678 (+7: F4V/DivX/3G2 by extension and by declared MIME, DivX prefers an external
player and F4V doesn't, pasted links are progressive, observer regex; `ERR_NO_APP` → no compatible app); typecheck OK;
`npm run lint` 0 errors (84 warnings); `git diff --check` clean. Kotlin `--rerun`: vidorax-media 505 / 0 failures (+12:
sniffer F4V/3G2/DivX/DIV3 from real bytes, DRM F4V by brand and by `sinf`; types; F4V/3G2 kept, DivX remuxed, DIV3
kept, AVI without video refused; engine keeps a DIV3 AVI and still refuses an AVI with no video stream);
vidorax-web 27 / 0 (+1: `.f4v/.3g2/.divx` responses are video files).

**Manual cases** (debug build, ffmpeg testsrc files served by a local Range-capable server with
`video/x-f4v`, `video/3gpp2`, `video/divx`)

| # | Case | Build | Result | Note |
| --- | --- | --- | --- | --- |
| 1 | `sample.f4v` (H.264 + AAC) | debug | PASS | offered → completed → `.mp4`, `video/mp4`, avc, 4.08 s; details MP4; plays |
| 2 | `sample.3g2` (MPEG-4 + AAC) | debug | PASS | link on the index page → download → `Download_0435985c.3g2`, `video/3gpp2`, mp4v-es, 4.0 s; details "3G2"; plays; "Open with" → Photos |
| 3 | `sample.divx` (DivX MPEG-4 + MP3) | debug | PASS | offered → remuxed: `Download_413ed54e.mp4` (video copied, MP3 → AAC), 4.11 s, details MP4 240p; plays (first open stayed on "Preparing video" with sound — see Found) |
| 4 | `sample-div3.divx` (DivX 3 + MP3, undecodable) | debug | PASS | before the keep rule: refused `VIDEO_TRACK_MISSING`, then "This file has no video"; now kept `Download_b53b523a.avi`, `video/x-msvideo`, "AVI · 194.2 KB · Original Quality" |
| 5 | "Open with" on the kept DIV3 AVI | debug | PASS (no player on the AVD) | the AVD has no app for `video/x-msvideo` (`cmd package query-activities` empty), so the native check rejects `ERR_NO_APP`; the message was "couldn't open this downloaded file", now "No compatible video app is installed." The handoff itself works: the 3G2's "Open with" opens Photos |
| 6 | DRM-branded F4V refused | — | unit test | `MediaSnifferTest` (brand + `sinf`); no DRM F4V sample to serve |

**Regression (release `cad62b8`, debug-key re-signed, over a freshly seeded test1)**

| # | Result | Note |
| --- | --- | --- |
| R1 | FAIL (target), no regression | 6.2 / 6.3 / 6.5 s; test1 6.2–6.4 s |
| R2 | PASS | MP4 → Player PLAYING |
| R3 | PASS (2nd run) | first run: the hls.js demo page showed no offer within the script's wait (no crash; the same step passed alone after a restart, 184p completed) |
| R4 | PASS | TikTok 576p, Facebook completed |
| R5 | PASS (verified in §7) | the script's screenshot shows no toast: the AVD keyboard had switched to floating mode and its toolbar covered the "Go" suggestion, so the link was never submitted. Re-checked by hand (Enter) on the final build, which contains this change: toast shown, page unchanged |
| R6 | PASS | 288p paused at 37.3 / 37.7 MB (the pause landed late), unchanged 8 s, resumed, completed |
| R7 | PASS | 00:04 → +10 00:14 → −10 00:04 → seek 05:19, PLAYING, fullscreen ROTATION_90, PiP pinned (2nd run; the first used R3's missing file) |
| R8 | PASS | `r8.sh`: lock screen after enable + Home; none after disable (the default step list also ran the scripted R8, whose disable is unreliable — it left the lock on, so the first R9 met the PIN screen) |
| R9 | PASS | Settings in Urdu (27 strings), 2nd run |
| R10 | PASS | 1 download, favorite, 3 history entries |

**Found, not fixed (F5)**

- The F4V typed into the address bar on a tab that showed a Facebook reel was saved with the reel's title (the handoff
  takes the tab's last page title) — existing behaviour for any direct file URL.
- The remuxed DivX MP4 stayed on "Preparing video" on its first open in the Player while the sound played; closing and
  reopening showed the picture. Not reproduced on a second try.
- Android's media scanner records the Gallery copy of a `.3g2` as `video/mp4`; the library keeps `video/3gpp2`.

---

## Final pass (§7)

**Automated gate on `2561d94`** (code head; later commits are docs only): `npm test` 678 / 678 (baseline 624, +54);
`npm run typecheck` OK; `npm run lint` 0 errors, 84 warnings (= baseline); `git diff --check` clean;
`gradle :vidorax-media:testDebugUnitTest :vidorax-web:testDebugUnitTest --rerun` → vidorax-media 505 / 0 failures
(baseline 493), vidorax-web 27 / 0 (baseline 26).

**Release build.** Fresh `:app:assembleRelease` of `2561d94` (generated React release assets deleted first; the bundle
contains the F5 `ERR_NO_APP` mapping), signed by Gradle with the upload key — **not re-signed**. Certificate SHA-256
`36b9c622…dd7b5af`, identical to the Gradle-signed test1 baseline APK.

**R10 with the Gradle-signed APKs.** Uninstall → install the upload-key test1 APK → seed (favorited MP4 download,
example.com + wikipedia history, search "cats") → `adb install -r` the final upload-key APK → `Success`, data kept.

| # | Result | Note |
| --- | --- | --- |
| R1 | FAIL (target), no regression | 6.1 / 6.0 / 6.1 s to browser chrome; test1 6.2–6.4 s (the JS splash; same as every pass) |
| R2 | PASS | HTML video MP4 176p → Player PLAYING |
| R3 | PASS | hls.js demo 184p completed (19.1 MB) |
| R4 | PASS (re-run) | first run: TikTok 576p completed, Facebook no offer — see the stall below; re-run after clearing it: TikTok completed + Facebook completed |
| R5 | PASS | by hand (Enter): toast "YouTube downloads are not supported", page unchanged. The script's own screenshot had no toast (floating AVD keyboard covered "Go"); the script now submits with Enter |
| R6 | PASS | 288p paused at 12.2 / 36.5 MB, unchanged after 8 s, resumed, completed |
| R7 | PASS | 00:04 → +10 00:14 → −10 00:04 → seek 05:19, PLAYING, fullscreen ROTATION_90, PiP |
| R8 | PASS | `r8.sh`: lock screen after enable + Home, no PIN after disable (re-run in full; the first run's output was cut) |
| R9 | PASS | Settings in Urdu (27 strings, no Latin-only labels) |
| R10 | PASS | upload-key test1 → upload-key final: 1 download, favorite, 3 history entries, recent search kept |

No crash in the crash buffer during the pass.

**Emulator stall (environment).** At 21:03 `system_server` ran at ~306 % CPU in kernel time (load 28, `artd`
compiling after the install). Android logged an ANR for Chrome (21:03:22, "failed to complete startup") and then for
VidoraX (21:03:40, "Input dispatching timed out … KeyEvent"; VidoraX itself at 26 % CPU). The ANR dialog of that dead
process kept coming back 5 s after each "Wait", with no new `am_anr`, and covered the screen, so R4's taps failed.
"Close app" cleared it; after a restart R4 passed and no further ANR was logged (app frames ~10 ms).

**BLOCKED (whole branch)**

- F10 case 3 (zoom then double-tap → reset only): the AVD cannot produce a pinch; covered by the unit test.
- F7 case 6 (Home → Paste link): the Home screen is unreachable in the app (`/` redirects to Browser).
- PR screenshots: the in-app browser is not signed in to GitHub, so the evidence sheets (`.claude/pr-evidence/`,
  not committed) were sent to the user to attach.
- R1 target: no pass meets it; it never regressed against test1.
