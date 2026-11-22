# Work log — Hamza · Player packages (P1–P13)

Plan: `docs/work-plans/hamza-player-tasks.md` (kept untracked). Packages in order P1 → P13; Faran builds P14–P19 and
reviews, merges into `integration/player` and device-tests each package.

## 0. Setup (2026-11-22)

- **Base = `origin/claude/design-65-screens` `9e9f343`** (PR #39 into `integration/browser` still open): VidoraX 1.2.0
  with the 6-theme design; it contains `hamza/light-theme` and `integration/browser`. The tip passed the malware checks
  (no `init` file, no `node init` in `package.json`, `babel.config.js` 8 lines, `.env` ignored).
- Local `hamza/player` from the base (`--no-track`); one branch per package from it (`hamza/P<n>-<name>`).
- `package.json` / lockfile identical to `hamza/light-theme`: no `npm ci`; `node scripts/patch-react-native-webview.js`
  re-run (the base adds the incognito `webProfile` spec edit).
- No emulator or phone on this Windows machine: the release-build device checks are Faran's.
- Expo v57 docs read for expo-video (`docs.expo.dev/versions/v57.0.0/sdk/video/`): exact seeks are the default
  (`seekTolerance` 0; nothing in `src` changes it); no frame-step call; `videoTrack.frameRate` gives the fps;
  `contentFit` is only contain / cover / fill; a `VideoSource` cannot carry side-loaded subtitle files and there is no
  subtitle styling (matters for P3 / P4).

### Baseline gate (on `9e9f343`)

| Check | Result |
| --- | --- |
| `npm run typecheck` | 0 errors |
| Unit tests (`node --import ./scripts/test/register-app-modules.mjs --test …`) | 2026 / 2026 |
| `node --test scripts/patch-react-native-webview.test.mjs` | 12 / 12 |

## P1 — Playback basics (#520, #527, #531, #532, #545)

**Decision (Hamza, 2026-11-22): P1 builds the PDF's screen 19 ("Video player") page, and also the plan's options
sheet.** The 65-screen PDF already draws the Player (screens 18–25, 48–55); screen 19 has a chip row and a tile grid.
The plan's registry-based options sheet (Playback, Video, Audio, Subtitles, Tools) is the ⋮ menu; the screen 19 tiles
are shortcuts to the same commands.

### What the user sees

| # | Feature | Where | How |
| --- | --- | --- | --- |
| — | Screen 19 page | Portrait, not full screen | Header "← Video player ⋮"; the video in a 326-wide card (169 dp for wide video, taller for 16:9 / portrait up to a square, so no black bars); chips 1.0× · Subs · Rotate · Lock (the design's Audio chip is hidden until Faran's P17); tiles 10 s · Custom seek · Frame by frame · A–B repeat · Aspect ratio · Filters; Up next; the tab bar. Landscape and full screen keep the black stage (no design frame for them). |
| — | Options sheet | ⋮ (page header, video card, full-screen top bar) | Sections in the plan's order, each with the rows the packages registered; empty sections are left out. P1: **Playback** — Stop, Jump to time, Seek interval (value "10 seconds"), Frame by frame; **Video** — the orientation lock (value Auto / Portrait / Landscape); **Tools** — "Save to VidoraX" for an unsaved file another app opened. |
| #520 | Stop | Options → Playback | Pause and go back to 0:00 ("Stopped at the start", toast + TalkBack). Not a full stop yet — see "Stop #520" below. |
| #527 | Custom Seek Interval | "Custom seek" tile, Options → Playback | 5 / 10 / 15 / 20 / 30 / 60 s, remembered (MMKV `vidorax.mmkv.player.seekStepSeconds.v1`). The "10 s" tile (skip back), the full-screen ⏪ / ⏩ (icon and label), double taps and their feedback follow it. |
| #531 | Frame by Frame | "Frame by frame" tile, Options → Playback | Pauses and shows a small panel (not a sheet, the picture stays visible): ◀ frame · time.ms + frame number · frame ▶ · ✕. A step is an exact seek into the middle of the neighbouring frame on the track's grid (`videoTrack.frameRate`, 30 fps when unknown); rapid taps chain from the last target. Back closes it. |
| #532 | Jump to Time | Options → Playback | Sheet with a field that starts at the current time; accepts `ss`, `m:ss`, `h:mm:ss`, Urdu / Arabic digits and colon look-alikes; refuses impossible times and times past the end with a reason under the field. |
| #545 | Long Press to Fast Forward | Hold the picture (½ s) | 2× while held ("2× speed ⏩" pill, announced); the chosen speed returns when the finger lifts, and on lock, any sheet, PiP, the frame panel, Stop, leaving or switching video. Paused video: nothing. The chosen speed and the 1.0× chip never change; the native player — and so any media session wrapping it, e.g. the now-playing notification — plays at 2× while held. |

### Placeholders on the page ("Not available yet") and who replaces them

| Chip / tile / row | Replaced by | Features there |
| --- | --- | --- |
| A–B repeat (tile) | **P5** Repeat & loops | #541 A-B repeat, #722 Save loop |
| Up next (row) | **P6** Queue & auto-next | #534 Auto play next, #619 Play queue, #620 Play next, #733 Next episode prompt |
| Audio (chip) | **Faran's P17** — hidden until P17 is merged (`PAGE_CHIP_FLAGS.audio = false`; P17 sets it to `true`) | screen 22, Audio & equalizer |
| Stop (options row) | **Faran's P15** — the full stop; until then Stop pauses and goes back to 0:00 | #520 Stop |

The package that builds one takes it out of `NOT_YET_ACTIONS` (`src/screens/player/page/player-page-actions.ts`) and
handles it in `onPageAction` (`PlayerScreen.tsx`). The 1.0× chip is Faran's P16; P1 leaves it as it was. P2 built the
Aspect ratio tile and turned the Filters tile into Mirror / Flip (see P2 below), and P3 built the Subs chip (see P3),
so those rows are gone from this table.

**Faran's answers (2026-11-22):** `integration/player` created from the base (`9e9f343`); Stop as it is is fine for P1
(real stop in P15); long-press 2× is fine as it is; Filters is not planned (the tile becomes Mirror / Flip in P2);
Audio chip → P17, hidden until then; 1.0× chip → P16, not touched.

### Options sheet (the plan's, registry-based)

- `src/player/options/registry.ts`: five fixed sections — Playback, Video, Audio, Subtitles, Tools. A package adds
  its rows with **one call**, `playerOptions.register('<package>', [rows])`, from its own file, plus one import line
  in `src/player/options/index.ts`. A row is `{ id, section, order, label, icon, value?, visible?, enabled?, onPress }`.
- **No package edits another's rows:** a row id another owner registered is refused (`PlayerOptionsRegistryError`).
  Registering again under the same owner replaces that owner's rows (Fast Refresh).
- Order: by `order` inside a section (P1 uses 10–40 in Playback, 10 in Video and Tools; leave gaps), ties keep the
  registration order. A section with no visible rows is not shown.
- **For Faran (Playback and Audio):** a row gets `ctx` — `ctx.session` (ready, playing, error, position, duration,
  speed; read-only), `ctx.controller` / `ctx.player` to act on the player, `ctx.ui` for the Player screen's own sheets
  and seeks (`stop`, `openJumpToTime`, `openSeekInterval`, `openFrameByFrame`, `openOrientation`, `openSpeed`,
  `saveToLibrary`, `seekTo`, `notAvailableYet`), and `ctx.t` for values. Example:
  `playerOptions.register('P14', [{ id: 'p14.audioTrack', section: 'audio', order: 10, label: …, icon: …, onPress }])`.
- P1's rows: `src/player/options/p1-playback-basics.ts`. Tests: `src/player/options/registry.test.ts` (12).

### Stop #520

Checklist row #520: "اسٹاپ — پلے بیک مکمل روک کر شروع پر جانے کے لیے" (stop playback completely and go back to the
start), a separate feature from #519 Play/Pause. So it means a **real stop**, not only a pause at 0:00.

That is not possible without editing `use-player-session.ts`: expo-video's `VideoPlayer` has no `stop()` (only play,
pause, replace, replaceAsync, seekBy, replay, release); the source is loaded (`replaceAsync`) and the now-playing
notification / background play (`showNowPlayingNotification`, `staysActiveInBackground`) are set by the session, which
owns the player; `replace(null)` or `release()` from the screen would break the session. **Kept: pause and seek to
0:00.** For Faran: a session `stop()` (unload the source or put ExoPlayer idle, drop the notification, load again on
Play) would make #520 complete; the options row and the Stop command (`ctx.ui.stop`) only need to call it.
**Faran: fine for P1; the full stop comes in his P15.**

### Design and decisions

- **Tile mapping** (one list, `src/screens/player/page/player-page-actions.ts`): "10 s" (⏪) skips back by the interval,
  "Custom seek" (⏩) chooses the interval (#527 by name), Stop and Jump to time are options-sheet rows (screen 19 draws
  no tile for them). If the CEO reads the two seek tiles differently it is a one-line swap.
- **One video surface.** The page's card and the stage are the same element in the same place in the tree; only its
  style changes, so rotating or entering full screen never remounts the `VideoView` (paused frame, PiP arming kept).
- **Rotate chip** enters full screen (landscape, immersive), like the stage's full-screen button; the orientation lock
  (Auto / Portrait / Landscape) is a row under Video in the options sheet, and still a button in the stage's top bar.
- **Lock on the page** covers the whole page (header, chips, tiles, tabs), not only the video, and hides those controls
  from TalkBack as well (a TalkBack double tap goes to the focused view, past any overlay).
- **Picture-in-picture** always shows the picture alone: the page layout is off while PiP is active (a portrait
  video's PiP window would otherwise be the whole page shrunk).
- **Back** closes, in order: the jump / interval / options sheets, speed, orientation, the frame panel, full screen; then
  leaves the Player (into the mini player).
- **Tab bar on the page** (the design draws it): `DsTabBarView`, the bar without a navigator, drawn without tour targets
  so the real bar keeps them. A tab leaves the Player like Back (`router.dismissTo(<tab path>)`).
- **"Save to VidoraX"** (a file another app opened, not yet saved) is a row under Tools in the options sheet.
- **Seeks** use the session's own seek (`beginSeekPreview` + `commitSeekPreview`, the timeline's path), so the position
  and the finished state update at once. `use-player-session.ts` (Faran's) is untouched.
- **Faran's code**: headset / media-session skips stay at 10 s until they read `getSeekStepSeconds()`
  (`src/player/seek-step-preference.ts`).

### Files

- Logic (unit-tested): `src/player/seek-step.ts`, `seek-step-preference.ts`, `frame-step.ts`, `jump-to-time.ts`,
  `long-press-speed.ts`, `playback-rates.ts` (`formatPlaybackRateChip`), `double-tap-seek.ts` (step argument).
- Options sheet: `src/player/options/*` (registry, context, P1 rows, tests).
- Page: `src/screens/player/page/*` (card overlay, body, options sheet, interval and jump sheets, frame panel, 2× pill,
  card size, mapping); `PlayerScreen.tsx` (layouts, handlers, Back chain, lock); `PlayerVideoSurface.tsx` (long press,
  interval); `PlayerTimeline.tsx` (`variant="card"`); `PlayerControls.tsx`, `PlayerTopBar.tsx` (⋮), `SeekFeedback.tsx`.
- Kit: `DsIcon` (rewind, fast-forward, skip-back/forward, step-back/forward; `fill`), `DsTile` (`labelLines`),
  `DsTabBar` → `DsTabBarView`.
- Strings: `videoPlayer.en.ts` / `videoPlayer.ur.ts`, new keys only (old `player.rewind` / `player.forward` /
  `player.surfaceHint` left in place, now unused).

### Gate

| Check | Result |
| --- | --- |
| `npm run typecheck` | 0 errors |
| Unit tests | 2066 / 2066 (40 new: `playback-basics.test.ts` 19, `options/registry.test.ts` 12, `player-page.test.ts` 8, `double-tap-seek.test.ts` 1) |
| `npm run lint` | 0 errors; 91 warnings, none in a file P1 changed |
| `git diff --check` | clean |
| `git diff 9e9f343` (base) | none of Faran's files: `remote-stream.ts`, `resolve-playback-source*.ts`, `use-player-session.ts`, `session-host/*`, manifests, `android/`, `modules/`, `package.json` / lockfile unchanged |
| Media3 | `1.9.0` (`modules/vidorax-media/android/build.gradle`), unchanged |

### Device checks for Faran (release build; not possible here)

1. Portrait: the page matches screen 19 in all six themes (Red: header band, red tab bar); Urdu (RTL rows). The chip
   row is 1.0× · Subs · Rotate · Lock (no Audio chip until P17).
2. Rotate chip → full screen landscape and back; the picture never goes black or restarts; a paused frame stays.
3. Lock on the page: nothing but the unlock pill responds (header ←, chips, tabs, Back).
4. Hold the picture while playing → 2×, lift → the chosen speed (try 1.5×); hold, then lock / PiP / switch video.
5. Frame by frame on a 24, 30 and 60 fps file: each step moves exactly one frame, back and forward.
6. Jump to time with Urdu digits; Stop after the video ended, then Play.
7. Seek interval 30 s → "30 s" tile, ⏪ / ⏩ icons in full screen, double-tap feedback, TalkBack hint.
8. A tab on the page → the Player continues in the mini player on that tab.
9. PiP from the page with a portrait video and with a landscape one: the window shows only the picture; back to the
   page afterwards.
10. Options → Jump to time and Options → Seek interval: the options sheet closes and the next sheet opens (two modals
    in a row on Android); Options → Orientation opens the orientation sheet.
11. TalkBack while locked on the page: only the unlock pill can be reached.
12. Scrubbing on the card: the bar answers a drag that starts a little above it (44 dp touch area).
13. The options sheet in all six themes and in Urdu: section labels, rows, values (10 seconds, Auto); greyed rows while
    the video is preparing.

## P2 — Video fit & display (#564, #565, #566, #573, #576, #721)

Built on `hamza/player` after P1 (PR #40) was merged into it; branch `hamza/P2-video-fit`. Its PR targets
`integration/player` and depends on #40.

### What the user sees

| # | Feature | Where | How |
| --- | --- | --- | --- |
| #564 | Aspect Ratio | "Aspect ratio" tile; Options → Video → Aspect ratio | A sheet: Fit to screen · Crop to fill · Stretch · Ratio 16:9 · Ratio 4:3 · Ratio 21:9 · Ratio 1:1 (toast + TalkBack name the choice). Checklist #564 names "16:9 or 4:3 etc."; 21:9 and 1:1 (square, asked for by Hamza) are the others. **Remembered per video** (MMKV `vidorax.mmkv.player.videoFits.v1`, the last 500 videos; choosing Fit forgets the video). A forced ratio is the largest box of that shape, centred, with the picture stretched into it: expo-video's `contentFit` is only contain / cover / fill. |
| #565 | Crop to Fill | the same sheet | `cover`: no black bars, the edges that stick out are cut off. Pinch-zoom works as on Fit; panning stays inside the visible picture, so no black edge ever shows. |
| #566 | Stretch | the same sheet | `fill`: the whole surface, the picture's shape not kept. |
| #573 | Mirror/Flip | "Mirror / Flip" tile (in Filters' place); Options → Video | Normal · Mirror (left ↔ right) · Flip (upside down) · Mirror and flip. For the video playing now; another video starts normal. A view transform on the picture's frame inside the zoom layer (the surface is a TextureView), so pinch and pan still follow the fingers. |
| #576 | Notch/Cutout Support | Options → Video → "Use the notch area" (a switch; off by default; remembered) | The app draws edge to edge (React Native sets the cutout mode to ALWAYS), and full screen uses no safe-area edges, so before P2 the top bar, the lock button, the timeline and the 2× pill could sit under the camera. Now in full screen all the controls and overlays keep clear of the cutout (safe-area insets, which include it). The picture keeps clear too, centred (the larger inset on both sides), unless the switch is on; then it fills the whole screen. Not applied in picture-in-picture. |
| #721 | Info Overlay | Options → Video → "Info overlay" (a switch; off by default; remembered) | Codec (H.264, H.265, VP9, AV1 …), Size, Frame rate, Bit rate (average, else peak), Range (SDR, HDR PQ / HLG) and Speed; a value the player doesn't know is left out (expo-video gives no audio codec). **Always shown while on, never over a control:** on the page, one line under the video card; in full screen with the controls showing, the same line in the timeline dock's bottom row between the volume button and the speed chip (a flex slot, so it cannot overlap them); with the controls hidden, a box in the top corner at the end side (right in English, left in Urdu) level with the lock button, which is at the start, and below the 2× pill. TalkBack reads it as one label. |

### Options sheet

Video now holds: Orientation (P1, 10), Aspect ratio 20, Mirror / Flip 30, Info overlay 40, Notch area 50. The registry
gained two optional row fields, `subtitle` and `toggle`: a toggle row is drawn as a switch and flips without closing the
sheet. P1's rows are unchanged; Playback and Audio are untouched for Faran.

### Decisions

- **The card on the page keeps the video's own shape** (P1's card size). For most videos Crop and Stretch therefore
  look like Fit on the card (the card already has no bars); the difference shows in full screen and for videos wider
  than the design card (about 1.93:1). A forced ratio shows inside the card, with bars.
- **Mirror is not remembered** (only for the video playing now); the fit is remembered per video, as planned. Either is
  a one-line change in `src/player/video-display-preference.ts`.
- **Picture-in-picture** always uses Fit (the PiP window has the video's own shape); mirror stays.
- **Notch's later home is screen 25** (Player settings, DISPLAY: "Notch"). Screen 25 isn't built, so the switch is an
  options-sheet row for now.
- **Filters (#571, #572) is not planned** (the checklist: "depends on device hardware/decoders"), so the tile is Mirror
  / Flip. The old `videoPlayer.tileFilters` string is left in place, unused.
- No native code, no change to `styles.xml`, the manifest or permissions; nothing of Faran's touched.

### Files

- Logic (unit-tested): `src/player/video-display.ts` (fit geometry, cutout area, per-video memory, mirror, info rows),
  `video-display-labels.ts`; the store: `video-display-preference.ts` (zustand + MMKV).
- Options: `src/player/options/p2-video-fit.ts` (+ one import in `index.ts`); `registry.ts` (`subtitle`, `toggle`);
  `player-options.ts` (`ctx.display`, `ui.openAspectRatio` / `openMirrorFlip` / `setFillCutout` / `setInfoOverlay`).
- Screen: `PlayerVideoSurface.tsx` (`fit`, `mirror`, `pictureInsets`; pan bounds follow the fit), `PlayerScreen.tsx`
  (the two sheets, Back, the cutout insets for the chrome and overlays), `page/VideoDisplaySheets.tsx`,
  `page/VideoInfoOverlay.tsx`, `page/PlayerOptionsSheet.tsx` (switch rows), `page/player-page-actions.ts`,
  `page/PlayerPageBody.tsx`, `page/use-video-track-info.ts` (codec, bit rate, range).
- Kit: `DsIcon` `flip-horizontal-2`. MMKV keys: `playerVideoFits`, `playerFillCutout`, `playerInfoOverlay`.
- Strings: 23 new `videoPlayer.*` keys at the end of `videoPlayer.en.ts` / `videoPlayer.ur.ts`, including
  `moreOptionsSectionsHint`, the ⋮ buttons' TalkBack hint (the old `moreOptionsHint` listed only P1's rows; it is left
  in place, unused). The Mirror / Flip tile's test id is `player-tile-mirrorFlip` (was `player-tile-filters`).

### Gate

| Check | Result |
| --- | --- |
| `npm run typecheck` | 0 errors |
| Unit tests | 2089 / 2089 (23 new: `video-display.test.ts` 17, `options/p2-video-fit.test.ts` 4, `options/registry.test.ts` 1, `player-page.test.ts` 1) |
| `npm run lint` | 0 errors; 91 warnings, none in a file P2 changed |
| `git diff --check` | clean |
| Against the base | none of Faran's files; `package.json` / lockfile, `android/`, `modules/`, manifests unchanged |
| Media3 | `1.9.0`, unchanged |

### Device checks for Faran (release build; not possible here)

1. Aspect ratio from the tile and from Options → Video: all seven on a 16:9, a 4:3, a portrait and a 2.39:1 file, on the
   card and in full screen. Close and reopen the same video: same fit. Another video: Fit.
2. Crop to fill, then pinch-zoom and pan to each edge: no black edge shows (the pan stops at the visible picture).
3. Mirror / Flip, each mode, also while zoomed: pinch and pan follow the fingers. Next / Previous: back to Normal.
4. A cutout (Developer options → "Simulate a display with a cutout": corner, punch hole, tall): full screen in landscape
   and in portrait (orientation lock Portrait, then Rotate). The top bar, lock, timeline, frame panel and 2× pill stay
   clear of it; the picture stays clear by default and fills it with "Use the notch area" on. Also with 3-button
   navigation.
5. Info overlay on: an H.264 file, an H.265 or VP9 file, an HDR file and a stream. The values are sensible. On the
   page: a line under the card, controls showing or not. Full screen: the line in the dock while the controls show
   (it shortens with "…" on a narrow screen, never covering volume or speed), the box at the top end when they hide,
   clear of the lock pill when locked. In Urdu the box is on the left. TalkBack reads it.
6. Picture-in-picture after choosing Crop, 4:3 and a mirror: the window shows the whole picture, mirrored.
7. All six themes and Urdu: both sheets, the switch rows in the options sheet, the "Mirror / Flip" tile label.
8. Changing the fit or the mirror never blacks out or restarts the picture (the view is laid out again, not remounted).

## P3 — Subtitles: load & tracks (#589, #590, #598, #602, #603, #601, #597)

Built on `hamza/player` after P2 (PR #41) was merged into it; branch `hamza/P3-subtitles`. Its PR depends on #41.
Local files only, no network, no new permission or dependency, no SQLite change.

### How subtitles are drawn (checked in expo-video 57.0.2)

- **Tracks inside the video** (MKV / MP4 text tracks, HLS / DASH subtitles): expo-video lists them
  (`availableSubtitleTracks`) and draws the chosen one itself, in Media3's subtitle view inside the video view
  (`SubtitleUtils.configureSubtitleView`: embedded styles off, Android's caption settings applied). It gives
  JavaScript no cue text. So these tracks **cannot be styled by P4, take no sync offset, cannot be one of P4's two
  tracks shown together, and are mirrored / cropped with the picture** (they live inside P2's frame). They follow
  Settings → Accessibility → Caption preferences.
- **Subtitle files** (loaded, or found next to the video): read, decoded, parsed and timed in JavaScript and drawn by
  VidoraX's own overlay — the one rendering path P4 styles. The overlay sits outside P2's frame (never mirrored or
  cropped) and is synced to `player.currentTime`, read ten times a second while a file shows.
- When a file or Off is chosen, P3 sets `player.subtitleTrack = null`, so the player's own subtitles never show at the
  same time. That is a player property set from P3's hook; no file of Faran's is edited.
- With nothing chosen for a video, the Player shows what the video turns on itself (Media3 picks a default-flagged
  track), else the auto-detected file in the app's language, else English, else one without a language.

### What the user sees

| # | Feature | Where | How (evidence) |
| --- | --- | --- | --- |
| #589 | Load Subtitle | Subs chip → Load subtitle; Options → Subtitles | The app's existing system file picker (`File.pickFileAsync`, as Download history and Settings import use; App Lock does not relock for it). The file must read as SRT / ASS / VTT with at least one cue and be at most 5 MB. Its bytes are copied to `<documents>/subtitles/` (a picked `content://` link does not survive a restart), it becomes the track, and a toast names it. While the picker is open, picture-in-picture is not armed. `src/player/subtitles/subtitle-files.ts` (`pickSubtitleFile`), `use-player-subtitles.ts` (`load`), `PlayerScreen.tsx` (`onLoadSubtitle`, `pipAutoEnter`). |
| #590 | Auto Detect Subtitle | Subtitles → Auto-detect (a switch, on by default, remembered) | When a library download opens, its folder (`<documents>/library/<site>/`, VidoraX's own) is listed for `<video>.srt`, `<video>.<lang>.vtt`, `<video>.<lang>.2.vtt`, `.ass`, `.ssa` (H19 saves downloaded subtitles as `<video>.<lang>.vtt`). They join the track list; with nothing chosen, the best one shows. **Videos from the gallery or another app are skipped:** their folders can't be listed without a storage permission. `sidecar.ts`, `subtitle-files.ts` (`listSidecarFiles`). |
| #598 | Multiple Tracks | Subtitles → Subtitle track | One list: Off, the tracks inside the video ("English · in the video", the player's label, else the language, else "Track 2"), then the files ("Urdu · Episode 1.ur.vtt"). Languages from the file name's tag; 20 common ones have names in English and Urdu, others show their tag. `subtitle-labels.ts`, `page/SubtitleSheets.tsx` (`SubtitleTrackSheet`). |
| #602 | Subtitle Off | Subtitles → Subtitle off; Off in the track list | Off for this video, remembered (so an auto-detected file does not come back). |
| #603 | Subtitle Formats | — | SRT, WebVTT, ASS / SSA (v4 and v4+). `parse-subtitles.ts`. Tags, entities and cue settings removed; ASS text kept with override blocks removed, `\N` a new line, drawings left out. **ASS features not drawn** (reported by the parser as `unsupported`): position (`\pos`, `\move`, `\org`), alignment (`\an`, `\a`), fade, animation (`\t`), karaoke, drawing (`\p`), colour and alpha, font name / size / spacing / scale, bold / italic / underline / strike, border / shadow / blur, rotation, clip, reset (`\r`), wrap (`\q`), the [V4+ Styles] section, the Effect field, layers (overlapping lines are stacked), per-line margins. |
| #601 | Subtitle Encoding | Subtitles → Encoding (shown for a file) | Automatic: a byte-order mark (UTF-8, UTF-16 LE / BE); UTF-16 without one (zero bytes); valid UTF-8; else Windows-1256 when the high bytes form words (Arabic script), else Windows-1252. By hand: UTF-8, UTF-16 LE, UTF-16 BE, Windows-1256 (Arabic, Urdu), Windows-1252 (Western). Every decoder is built in (no `TextDecoder`, no dependency); the two code pages are tables generated from Python's codecs. Remembered per file and video. `subtitle-encoding.ts`. |
| #597 | Subtitle Sync | Subtitles → Sync (for a file) | A sheet: −1 s, −0.1 s, +0.1 s, +1 s and Reset; the value ("+0.5 s") is spoken. Plus shows the subtitles later. 100 ms steps, ±5 minutes, remembered per video. A track inside the video can't be shifted (the row says "For subtitle files only"). `cues.ts` (`stepSubtitleOffset`, `subtitleTimeMs`), `SubtitleSyncSheet`. |

**Remembered per video** (MMKV `vidorax.mmkv.player.subtitles.v1`, the last 300 videos; no SQLite): the chosen track
(a track inside the video by id, then language and label, since ids may change between loads), the subtitle files
(up to 8; a detected file is kept once chosen) with their encodings, and the sync offset. Copies of loaded files are
deleted when their record or file is dropped. The reader ignores fields it does not know, so P4 adds its second track
to the same record. `subtitle-record.ts`, `subtitle-preference.ts`.

**Where:** the Subs chip (no longer "Not available yet") opens the options sheet's Subtitles section alone, titled
"Subtitles"; the ⋮ options sheet shows the same rows under Subtitles. Rows (screen 21's order): Subtitle track 10,
Load subtitle 20, Auto-detect 30 (switch), Sync 40, Encoding 50 (files only), Subtitle off 90 (when on).
`src/player/options/p3-subtitles.ts`.

### Decisions

- **Screen 21's "Subtitle editor" row is left out:** it is in no package of the plan.
- **"Auto-detect / download" is detect only:** no network.
- **The overlay's look in P3** is plain (white on a dark box, about 5.5 % of the picture's height); P4 makes it the
  user's style.
- **TalkBack does not read subtitle lines** (the overlay is hidden from it); the sync value and the toasts are spoken.

### Files

- Logic (unit-tested): `src/player/subtitles/cues.ts` (cue lookup, offset), `parse-subtitles.ts`,
  `subtitle-encoding.ts`, `sidecar.ts`, `subtitle-record.ts`; labels `subtitle-labels.ts`.
- Runtime: `subtitle-files.ts` (picker, copies, folder listing), `subtitle-preference.ts` (store),
  `use-player-subtitles.ts` (the hook).
- Screen: `page/SubtitleOverlay.tsx`, `page/SubtitleSheets.tsx`, `page/PlayerSheetFrame.tsx`,
  `page/PlayerOptionsSheet.tsx` (one section alone), `PlayerScreen.tsx`, `page/player-page-actions.ts`.
- Options: `src/player/options/p3-subtitles.ts` (+ one import), `player-options.ts` (`ctx.subtitles`, six `ui`
  commands). Kit: `DsIcon` `captions`, `palette`. MMKV keys: `playerSubtitles`, `playerSubtitleAutoDetect`.
- Strings: 47 new `videoPlayer.*` keys (English and Urdu), at the end of both catalogs.

### Gate

| Check | Result |
| --- | --- |
| `npm run typecheck` | 0 errors |
| Unit tests | 2118 / 2118 (29 new: `subtitles/subtitles.test.ts` 26, `options/p3-subtitles.test.ts` 3) |
| `npm run lint` | 0 errors; 91 warnings, none in a file P3 changed |
| Against the base | none of Faran's files; `package.json` / lockfile, `android/`, `modules/`, manifests, `app.json` unchanged |
| Media3 | `1.9.0`, unchanged |

### Device checks for Faran (release build; not possible here)

1. Load subtitle with an SRT, a VTT, an ASS and an SSA file (from Downloads and from a cloud provider in the picker);
   a `.txt` that is not a subtitle (refused, toast); a file over 5 MB (refused). The picker does not open a PiP window
   while a video plays; App Lock does not ask again on return.
2. A download with "Download subtitles" on (H19): open it, and the `<video>.<lang>.vtt` shows by itself (the app's
   language first); turn Auto-detect off, and only chosen files remain.
3. An MKV with two subtitle tracks and an HLS stream with subtitles: both appear as "… · in the video", switching works,
   Off turns them off, a file in between hides them, and the choice is back after closing and reopening the video.
4. A Windows-1256 Urdu SRT (no BOM), a UTF-16 SRT and a UTF-8 SRT with a BOM: automatic shows them right; choosing
   Windows-1252 on the Urdu file shows the wrong letters, and choosing back fixes it.
5. Sync: +0.5 s, −1 s and Reset while playing; the offset is back after reopening the video.
6. Subtitles on the card (above the card's timeline when the controls show), in full screen, with a cutout (clear of
   it), in PiP, mirrored (the text is not mirrored), with Crop.
7. Six themes and Urdu: the Subtitles sheet (Subs chip), the track, encoding and sync sheets.
8. Previous / Next with subtitles on: the next video starts with its own choice.
