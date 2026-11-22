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
- **expo-video turns the player's own subtitles off** when the player starts and for every new video
  (`VideoPlayer.kt`: "we want them disabled by default"), so nothing carries over between videos. With nothing chosen
  for a video, P3 shows a track the video flags as its default, else the auto-detected file in the app's language,
  else English, else one without a language.

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
   while a video plays (PiP is disarmed before the picker opens, and armed again after); App Lock does not ask again
   on return.
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
8. Previous / Next with subtitles on: the next video starts with its own choice. A video with a track inside it, set
   to Off, then Next to a video whose subtitle track is flagged default: that track shows. Previous / Next onto an MKV:
   its tracks are in the list.

## P4 — Subtitle style (#592, #593, #594, #595, #596, #599, #600)

Built on `hamza/player` after P3; branch `hamza/P4-subtitle-style`. Its PR depends on P3. Everything here styles
**subtitle files** (VidoraX's overlay). Tracks inside the video are drawn by the player and follow Android's caption
settings (see P3), which the style sheet says.

### What the user sees

| # | Feature | Where | How (evidence) |
| --- | --- | --- | --- |
| #592 | Subtitle Size | Subtitles → Style | Small, Medium, Large, Extra large: 0.8×, 1×, 1.25×, 1.5× the base, which is about 5.5 % of the picture's height (12–30 dp), so text is smaller on the card and larger in full screen. `subtitle-style.ts`, `page/SubtitleOverlay.tsx` (`subtitleFontSize`). |
| #593 | Subtitle Color | Style | The design's swatches first (screen 21: black #000000, white, yellow #FFD60A, red #D92D20), then green and cyan. Black text gets a light box / outline so it still reads. |
| #594 | Subtitle Font | Style | Only fonts the app already has: System (Roboto), Inter (the app's font), Nastaliq (Noto Nastaliq Urdu, bundled for the reader and loaded when first needed), and Android's Serif, Monospace and Condensed. Nastaliq applies to Urdu / Arabic lines; Latin lines in the same subtitle keep the system font. Its lines get twice the font size as line height so its tall letters aren't clipped. Until it has loaded, the system font is used. No font file added. |
| #595 | Subtitle Background/Outline | Style | Box (60 % dark), Outline, Shadow, None. React Native on Android has no text stroke, so Outline is a tight shadow all round. Device check below. |
| #596 | Subtitle Position | Style | Bottom or Top, then "Away from the edge" / "Toward the edge" in 2 % steps (0–40 % of the picture), shown as "4% from the edge". Subtitles keep clear of what is over the picture: the card's timeline and top row, the full-screen top bar while the controls show, and P2's info box. |
| #599 | Dual Subtitles | Subtitles → Second subtitle; Style → Second subtitle | A second subtitle file shown with the first, remembered per video (in P3's record, no new key). **Checklist #599 says only "show two languages together", so the layout is VidoraX's:** "Next to the first" (one block; the second on the side away from the edge, above a bottom subtitle) or "Top of the picture". When the first is a track inside the video, the player draws it where VidoraX can't measure, so the second goes to the top. Only files can be second (the sheet says why); the first is not offered as the second. `subtitle-layout.ts` (`planSubtitleBlocks`). |
| #600 | RTL Subtitles | automatic | Each line's direction comes from its letters: more right-to-left letters than left-to-right means RTL (so "WiFi کا پاس ورڈ 1234 ہے" is RTL and "Hello دوست" LTR). Ties go by the first letter; a line of only numbers is LTR. Each line is checked on its own, because dual-language cues mix lines. An RTL line starts with a right-to-left mark, so Android lays it out right to left with the English word and the number in their places (`writingDirection` is iOS-only), and it is aligned right. LTR lines are centred. `subtitle-layout.ts` (`lineDirection`, `subtitleLines`). |

**Live preview:** the Style sheet shows a sample, plus the second one when a second subtitle is on. It sits on a fixed
dark picture, so colours look the same in all six themes, and every change applies at once. Reset style restores the
defaults: white, medium, system font, box, bottom 4 %. The style is app-wide and remembered (MMKV
`vidorax.mmkv.player.subtitleStyle.v1`; a damaged field falls back alone). The sheet itself uses theme colours: chips,
swatch rings, buttons.

### Decisions

- **Screen 21's "RTL support" switch is not built:** right-to-left is detected per line, and turning it off would only
  draw Urdu wrongly.
- **One sync offset for both subtitles** (P3's, per video). A second file from another source may need its own offset;
  that would be a second value in the same record.
- **The six colours** are the design's four plus green and cyan.
- **Fonts:** nothing new bundled.

### Files

- Logic (unit-tested): `src/player/subtitles/subtitle-style.ts`, `subtitle-layout.ts`; `subtitle-record.ts`
  (`secondary`, optional, read back from old records as absent).
- Runtime: `subtitle-style-preference.ts`; `use-player-subtitles.ts` (the second subtitle; file reading and timing
  moved into `useSubtitleFileLines`, used for both).
- Screen: `page/SubtitleOverlay.tsx` (styled, per-line direction, dual blocks), `page/SubtitleStyleSheet.tsx`,
  `page/SubtitleSheets.tsx` (files only, excluded keys), `PlayerScreen.tsx`.
- Options: `src/player/options/p4-subtitle-style.ts` (+ one import), `player-options.ts` (`secondLabel`, two `ui`
  commands). MMKV key: `playerSubtitleStyle`. Strings: 44 new `videoPlayer.*` keys (English and Urdu).

### Gate

| Check | Result |
| --- | --- |
| `npm run typecheck` | 0 errors |
| Unit tests | 2133 / 2133 (15 new: `subtitles/subtitle-style.test.ts` 13, `options/p4-subtitle-style.test.ts` 2) |
| `npm run lint` | 0 errors; 91 warnings, none in a file P4 changed |
| Against the base | none of Faran's files; `package.json` / lockfile, `android/`, `modules/`, manifests, `app.json` unchanged |
| Media3 | `1.9.0`, unchanged |

### Device checks for Faran (release build; not possible here)

1. Style sheet in all six themes and in Urdu: the chips, the colour rings (black visible on Dark / Midnight), the
   buttons; the preview looks the same in every theme.
2. Each size and colour on the card and in full screen; Outline and Shadow read on a bright scene. Outline is a shadow
   on Android, so check it really outlines.
3. Nastaliq with an Urdu SRT: the letters aren't clipped (line height), Latin lines stay in the system font, the
   first subtitle after choosing it may show in the system font for a moment while the font loads.
4. RTL: an Urdu SRT with lines like "WiFi کا پاس ورڈ 1234 ہے" and "ٹرین 7:45 پر Lahore سے چلے گی". The words read
   right to left, the English word and the numbers stay in order, the line is right-aligned, and punctuation sits at
   the left end. An English line in the same file stays centred.
5. Position: Top and Bottom, Away / Toward the edge; with the controls showing (card and full screen) the subtitle
   stays clear of the timeline / top bar; with the info overlay on in full screen, a top subtitle sits below its box.
6. Dual: an English and an Urdu file. "Next to the first" (both at the bottom, Urdu above or below as chosen first /
   second), "Top of the picture"; a track inside the video as the first with a file as the second (the second at the
   top, no overlap).
7. Reset style; close and reopen the app: the style is kept; another video keeps its own second subtitle.

## P5 — Repeat & loops (#539, #540, #541, #722)

Built on `hamza/player` after P4; branch `hamza/P5-repeat`. Its PR depends on P4.

**#535 End of Playback Action had no choices before P5.** The checklist ticks it for "Replay handling at end": a
finished video stops on its last frame and shows Replay. There was no setting and no code by that name. P5 adds the
setting **"When the video ends"** with that behaviour as **Stop, the default**, so nothing changes until the user picks
**Repeat one** (#539) or **Repeat all** (#540). It is app-wide and remembered (MMKV
`vidorax.mmkv.player.endOfPlayback.v1`). It lives in the ⋮ options sheet under Playback (screen 25, "Player settings",
isn't built).

### What the user sees

| # | Feature | Where | How (evidence) |
| --- | --- | --- | --- |
| #539 | Repeat One | Options → Playback → When the video ends | The same video again from the start, through the session's own `replay()` (so each play counts as watched, as a manual Replay does). `src/player/end-of-playback.ts` (`decideEndOfPlayback`), `src/screens/player/page/use-repeat.ts`. |
| #540 | Repeat All | the same | The next video of the play queue (`play-queue.ts` `ids`, the list the video was opened from), and the first after the last. A video opened with no list (download details, a shelf) repeats itself. The next video opens like Next does (`appRouter.setParams`). |
| #541 | A-B Repeat | The "A–B repeat" tile; Options → Playback → A–B repeat | The tile sets **A** at the playing position, then **B**; the loop starts at once. Once a loop is on, the tile opens the A-B sheet: Set A, Set B (at the position playing now), Clear, Save loop. A and B show on the timeline (card and full screen) as white ticks with the part between them tinted, and an "A–B ✕" button next to the time clears them. B before A is swapped; a point past the end is moved to the end; A and B closer than 0.5 s are refused, with a message. Playing into B (or seeking past it) jumps back to A; before A the video plays on into the loop. The position is read every 100 ms while the loop plays, and the jump goes 50 ms early, so it doesn't overshoot B. The loop belongs to the video: another video starts with none. `src/player/ab-repeat.ts`, `page/use-repeat.ts`, `components/TimelineLoopMarks.tsx`, `components/PlayerTimeline.tsx`. |
| #722 | Save Loop | A-B sheet → Save loop; Saved loops | Saves the loop with a name (suggested "Loop 3"; up to 80 characters, Urdu included), **per video**, in MMKV (`vidorax.mmkv.player.savedLoops.v1`, last 300 videos, up to 50 loops each; one more is refused with a message, never dropped). The list shows the video's loops in timeline order. Tap one to play it (it becomes the A-B loop, from A). Rename (pencil) or Delete (bin, with a confirm). `src/player/saved-loops.ts`, `repeat-preference.ts`, `page/RepeatSheets.tsx`. |

### What decides the end (one function)

`decideEndOfPlayback` (`src/player/end-of-playback.ts`), in this order:

1. An A-B loop that is on: back to A, playing.
2. Repeat one: the same video again.
3. Repeat all: the next video of the queue; after the last one, the first.
4. Otherwise: stop, as before P5.

P6 adds Auto Play Next to the same function.

**How it runs.** The Player screen listens to the player's own `playToEnd`, as `use-player-session.ts` does. That file
is Faran's and isn't changed. The decision runs in a microtask, so the session's handler has always marked the video
finished first, and a repeat happens before the next render, so the Replay button doesn't flash. It acts only through
what the session already offers: `replay()`, its exact seek, `play()`, and Next's `setParams`. A loop that wraps at
the very end (B at the end) goes through `replay()` and then seeks to A. `replay()` resets the session's "finished"
guard, so once the loop is cleared the real end still shows Replay. P5 doesn't set
`player.loop`: expo-video sends `playToEnd` on each loop, and the session would then mark a playing video finished.

### Decisions

- **The setting's home is the options sheet** (Playback), until screen 25 is built.
- **The in-app mini player keeps today's end** (stop, with Replay). Leaving the Player for the mini player unmounts the
  screen that runs the end. Moving to another video from the mini player would also need the session host, which
  isn't part of this package.
- **Repeat all in the background or in picture-in-picture.** The session host starts a newly opened video only with the
  app in front. So after an automatic move to the next video, the Player plays it once it has loaded, if VidoraX is not
  in front (`useContinueAfterAutoAdvance`). That can only happen in picture-in-picture or with background play on,
  because otherwise the video was paused when VidoraX left the screen. Device check 5.
- **A–B on the timeline reads left to right** in Urdu too (it is a time line), as P3's sync buttons do.

### Files

- Logic (unit-tested): `src/player/ab-repeat.ts`, `end-of-playback.ts`, `saved-loops.ts`, `repeat-labels.ts`.
- Store: `src/player/repeat-preference.ts` (zustand + MMKV); MMKV keys `playerEndOfPlayback`, `playerSavedLoops`.
- Screen: `src/screens/player/page/use-repeat.ts`, `page/RepeatSheets.tsx` (When the video ends, the A-B sheet, the
  loop-name dialog), `components/TimelineLoopMarks.tsx`, `components/PlayerTimeline.tsx` and `page/PlayerCardOverlay.tsx`
  (optional `loopMarkers`, `onClearLoop`), `PlayerScreen.tsx` (the tile, the rows, the sheets).
  `page/player-page-actions.ts`: `abRepeat` removed from `NOT_YET_ACTIONS`.
- Options: `src/player/options/p5-repeat.ts` (+ one import), `player-options.ts` (optional `repeat` context and two
  optional `ui` commands). Strings: 40 new `videoPlayer.*` keys (English and Urdu).

### Gate

| Check | Result |
| --- | --- |
| `npm run typecheck` | 0 errors |
| Unit tests | 2158 / 2158 (25 new: `ab-repeat.test.ts` 7, `end-of-playback.test.ts` 7, `saved-loops.test.ts` 8, `options/p5-repeat.test.ts` 3) |
| `npm run lint` | 0 errors; 91 warnings, none in a file P5 changed |
| Against the base | none of Faran's files; `play-queue.ts` untouched; `package.json` / lockfile, `android/`, `modules/`, manifests, `app.json` unchanged |
| Media3 | `1.9.0`, unchanged |

### Device checks for Faran (release build; not possible here)

1. Options → Playback → When the video ends: Stop (default) behaves as before: last frame and Replay, also with a list
   (opened from the library) that has a next video.
2. Repeat one: the video starts again by itself, with no Replay flash; the watch history counts it again.
3. Repeat all from the library list: the next video opens and plays; after the last one, the first. A video from
   download details (no list) repeats itself.
4. A–B: tap the tile twice while playing; the ticks and tint show on the card's bar and in full screen; the loop
   repeats cleanly (no visible overshoot past B). B before A, and B at the very end (the loop wraps at the end). Clear
   from the "A–B ✕" button and from the sheet. Another video starts with no loop. With B at the end: let it wrap a few
   times, clear it, play to the end. Replay must show and the watch history must count it.
5. Repeat all in picture-in-picture, and with background play on and the screen off: the next video plays.
6. Save loop with an Urdu name; the list after reopening the app; play, rename, delete (confirm); 50 loops.
7. The A-B sheet and When the video ends in all six themes and in Urdu; TalkBack reads Set A / Set B with the time.

## P6 — Queue & auto-next (#619, #620, #542, #534, #733)

Built on `hamza/player` after P5; branch `hamza/P6-queue`. Its PR depends on P5. It extends `src/player/play-queue.ts`
and keeps every function that was there working as before. The headset-key tests below call them as they're called
today.

### What the user sees

| # | Feature | Where | How (evidence) |
| --- | --- | --- | --- |
| #619 | Play Queue | The page's "Up next" row (it said "Not available yet"); Options → Playback → Up next | A sheet listing the queue in play order, with the video playing marked "Now playing". Each video shows its length and "File missing" when gone; tap a video to play it. Up / down moves it one place; × removes it (not the one playing). Shuffle and Auto play next switches sit at the top. It draws up to 100 rows: 5 before the video playing and the rest after, with "Showing 100 of 240" when there are more. **The queue survives a restart** (MMKV `vidorax.mmkv.player.queue.v1`, up to 2,000 ids, with the shuffle state and the video playing). `page/QueueSheet.tsx`, `src/player/play-queue.ts`, `play-queue-persistence.ts`. |
| #620 | Play Next | Library → long-press a video → Play next / Add to queue | **Play next** puts the video right after the one playing; a video already queued moves there. **Add to queue** adds it at the end, once ("Already in the queue"). Both show only while a video is open in the Player or the mini player, and not for that video itself; with no queue yet, one starts with the video playing. A toast confirms. `src/screens/library/hooks/useQueueSheetActions.ts`, `LibraryScreen.tsx` (one line), `play-queue.ts` (`playNextInQueue`, `addToPlayQueue`). |
| #542 | Shuffle | Queue sheet; Options → Playback → Shuffle | On: the video playing keeps playing and comes first, and the rest are shuffled. Off: the original order comes back, with videos added meanwhile in their places and removed ones gone. The shuffle is seeded (mulberry32 plus Fisher–Yates), so the same seed gives the same order; tests use fixed seeds. `play-queue.ts` (`seededShuffle`, `shuffleAroundCurrent`, `setPlayQueueShuffle`, `unshuffledOrder`). |
| #534 | Auto Play Next | Queue sheet; Options → Playback → Auto play next | **Off by default:** before P6 a finished video always stopped. On: when a video ends, the next one in the queue plays (no wrap; that's Repeat all). With no queue, the next video in the same library folder plays, by name ("Episode 2" before "Episode 10"), skipping missing files; library videos in no folder share the top level. MMKV `vidorax.mmkv.player.autoPlayNext.v1`. `end-of-playback.ts`, `queue-media-index.ts` (`nextInFolder`), `queue-media.ts`, `page/use-queue.ts`. |
| #733 | Next Episode Prompt | Over the picture, bottom end; Options → Playback → Next episode card (on) | A card "Next: <title>", "Plays in 7 s", **Play now** and **Cancel**. It shows only when the end of the video is about to play the next one anyway (Auto Play Next or Repeat all), and the next video's name looks like the next episode: "S01E02" → "S01E03" (or "S02E01"), "1x02" → "1x03", "Ep 3" / "Episode 4" / "E04" / Urdu "قسط 5" → the next number of the same show, or the same name with one number one higher ("Drama 12" → "Drama 13"). Cancel hides it, and that video then stops at its end. `src/player/episode-name.ts`, `next-episode-prompt.ts`, `page/NextEpisodeCard.tsx`. |

### What decides the end (one function, now complete)

`decideEndOfPlayback` (`src/player/end-of-playback.ts`), in the order asked for:

1. An A-B loop: back to A.
2. Repeat one: the same video again.
3. Repeat all (the queue): the next video, and the first after the last.
4. Auto Play Next: the next video of the queue; with no queue, the next in the folder.
5. The End of Playback Action: Stop.

A "next" cancelled on the Next Episode card stops instead. A queue holding only this video counts as no queue.

**Unchanged with the defaults:** the End of Playback Action is Stop and Auto Play Next is off. So a library list with a
next video still stops at the end, as before; a test checks exactly that.

### Timing of #733 (my choice: the checklist gives none)

Checklist #733 says only "to move quickly through episodes", so the timing is mine:

- The card shows in the **last 10 s** of a video at least **30 s** long, counting down the seconds left.
- It follows the position, so pausing pauses the countdown and seeking back hides the card.
- At 0 the video ends and the end decision plays the next one.
- It never shows over Repeat one, an A-B loop or Stop.
- It is hidden while the controls are locked and in picture-in-picture.

### The existing play-queue functions (Faran's headset keys)

- `usePlayQueueStore` keeps `ids` as the play order. So `queueNeighbours(ids, id)` and `usePlayQueueNeighbours` follow
  Shuffle, Play next and reordering without any change on the caller's side (tested).
- `setPlayQueue(x)` still leaves `ids` equal to a copy of `x` (or empty for `undefined`). **It now also ends a
  shuffle**, because the list is a new one (tested).
- New state fields beside `ids`: `original`, `shuffled`, `seed`, `currentId`. `play-queue.ts` still has no storage
  import; saving lives in `play-queue-persistence.ts`.

### Decisions

- **`openPlayer` keeps the queue when it reopens the video the queue was playing without a list.** That covers the
  mini player (it called `openPlayer(id)` and so emptied the queue: Previous / Next used to vanish) and the last video
  after a restart. Every other open without a list still has no queue, as before.
- **Opening a video from a list still replaces the queue,** as before. So a queue built with Play next / Add to queue
  is replaced by the next tap on a library video.
- **Device videos in a restored queue:** they play from a list kept in memory, so after a restart P6 lists the device
  videos again, quietly. Without the permission that list is empty, and those entries fail to open as before.
- **The queue sheet draws up to 100 rows** around the video playing, so a long library list stays quick.
- **Up next on the page** still says "Auto play next" under it (the existing string). It opens the queue sheet.
- The settings live in the options sheet (Playback) until screen 25 is built.
- The in-app mini player still stops at the end (as in P5).

### Files

- Logic (unit-tested): `src/player/play-queue.ts` (extended), `end-of-playback.ts` (Auto Play Next, folder, cancel),
  `episode-name.ts`, `next-episode-prompt.ts`, `queue-media-index.ts`.
- Runtime: `play-queue-persistence.ts`, `auto-next-preference.ts`, `queue-media.ts`; `src/navigation/helpers/open-player.ts`
  (keeps the queue for its own video, starts the saving).
- Screen: `page/use-queue.ts`, `page/QueueSheet.tsx`, `page/NextEpisodeCard.tsx`, `page/use-repeat.ts` (takes the P6
  inputs, exposes `upcoming`), `PlayerScreen.tsx`; `page/player-page-actions.ts` (`upNext` out of `NOT_YET_ACTIONS`).
- Library: `src/screens/library/hooks/useQueueSheetActions.ts`, `LibraryScreen.tsx`.
- Options: `src/player/options/p6-queue.ts` (+ one import), `player-options.ts` (optional `queue` context and four
  optional `ui` commands). MMKV keys `playerQueue`, `playerAutoPlayNext`, `playerNextEpisodePrompt`. Strings: 31 new
  `videoPlayer.*` keys (English and Urdu).

### Gate

| Check | Result |
| --- | --- |
| `npm run typecheck` | 0 errors |
| Unit tests | 2198 / 2198 (40 new: `play-queue.test.ts` 15, `end-of-playback-precedence.test.ts` 9, `episode-name.test.ts` 8, `queue-media-index.test.ts` 5, `options/p6-queue.test.ts` 3) |
| `npm run lint` | 0 errors; 91 warnings, none in a file P6 changed |
| Against the base | none of Faran's files; `package.json` / lockfile, `android/`, `modules/`, manifests, `app.json` unchanged; no SQLite change |
| Media3 | `1.9.0`, unchanged |

### Device checks for Faran (release build; not possible here)

1. Headset / Bluetooth Next and Previous (your P15 keys) with a library list, after Shuffle, after Play next and
   after reordering: they follow the queue sheet's order.
2. Queue sheet: tap a video, move up / down, remove; "Now playing" can't be removed; six themes and Urdu; TalkBack
   reads "Move … up" and the rest.
3. Library → long-press → Play next and Add to queue while a video plays in the mini player; reopen the Player:
   the queue has them, Previous / Next are still there (they used to vanish after the mini player).
4. Shuffle on and off: the video playing keeps playing; off restores the order.
5. Restart the app (swipe it away) with a queue: open the last video from Continue watching, and the queue and
   Shuffle are as they were. With a device video in the queue, it still plays.
6. Auto Play Next off (default): a library list stops at the end, as before. On: the next one plays; the last one
   stops. A video from download details (no queue) goes on to the next in its folder.
7. Next Episode card: a folder with "Show S01E01.mp4", "Show S01E02.mp4" and Auto Play Next on. The card shows 10 s
   before the end and counts down; Play now; Cancel (the video stops at its end); pause and seek back (it hides).
   No card for "Holiday.mp4" → "Work.mp4". Check it's clear of the controls on the card and in full screen.
8. Auto Play Next in picture-in-picture and with background play on and the screen off: the next video plays.

## P7 — Playlists (#617, #618, #629)

Built on `hamza/player` after P5 (`ff07f45`), on the local branch `wip/P7-playlists`, to be cherry-picked on top of P6
(`hamza/P6-queue`). **Its PR depends on P6:** a playlist plays through the play queue P6 extends, and P6 switches
Shuffle on (see Playing). **P7 bumps the SQLite schema once, 8 → 9** (see Schema).

### What the user sees

| # | Feature | Where | How (evidence) |
| --- | --- | --- | --- |
| #617 | Create Playlist | Library: long-press a video → **Add to playlist** or **Select**. Library header → Playlists → **New playlist**. Player: ⋮ → Tools → **Add to playlist** | **The add sheet** lists the playlists, most recently changed first, each with its number of videos and a ✓ when it already has the video. It also offers **New playlist**: a name dialog, suggested "Playlist 1", up to 80 characters, Urdu allowed. The new playlist is made with the videos already in it. **Select** starts a selection mode with that video. Tapping a video selects it (a ✓ mark over the thumbnail; TalkBack says "selected"). A bar shows "3 selected", **Add to playlist** and **Cancel**, and Back leaves the mode. **Adding** puts the videos at the end, in the order the Library shows them. A video already in the playlist stays where it is, and the message says so ("2 added to “Mix”, 1 already there"). **The Player** adds the video playing: a library video or a video on this phone, never a file another app opened or a stream. Evidence: `src/screens/playlists/components/AddToPlaylistSheet.tsx`, `PlaylistNameModal.tsx`, `src/screens/library/hooks/useLibraryPlaylists.ts`, `components/LibrarySelectionBar.tsx`, `LibrarySelectMark.tsx`, `src/player/options/p7-playlists.ts`, `src/screens/player/page/use-player-playlist-add.ts`, `src/storage/repositories/playlists.queries.ts` (`addPlaylistItems`). |
| #618 | Edit Playlist | Library header → Playlists (the icon next to "Videos on this device") → a playlist | **The Playlists screen** lists each playlist's name and number of videos. **A playlist:** **Play** and **Shuffle**; tap a video to play from it. ↑ / ↓ move a video one place (the first video's ↑ and the last's ↓ are faded and do nothing), and ✕ takes it out of the playlist. ⋮ has **Rename**, **Export M3U8** and **Delete playlist**. Delete asks first: "Only the playlist is deleted. Its videos stay in your library and on your phone." **Removing or deleting never touches a video file:** the queries delete playlist rows only. **A missing video** is greyed with "Missing: the video was deleted or moved", and playing skips it. Evidence: `src/screens/playlists/PlaylistsScreen.tsx`, `PlaylistScreen.tsx`, `components/PlaylistEntryRow.tsx`, `src/playlists/use-playlists.ts`, `playlist-entries.ts`, `play-plan.ts`, `play-playlist.ts`, `playlists-service.ts`. |
| #629 | Playlist Import/Export | Playlists → **Import M3U**; a playlist → ⋮ → **Export M3U8** | **Export** writes an M3U8 file named after the playlist (Urdu kept): UTF-8, `#EXTM3U`, then `#EXTINF:<seconds or -1>,<title>` and the file name for each video. It saves through the app's save flow: a folder picker, or the share sheet. **Import** reads M3U or M3U8 from the system picker, which offers every file type because phones label playlist files inconsistently. The text can be UTF-8, UTF-16 or a Windows code page. Playlists are local only: web links are skipped and counted. Each line is matched to a library video by path, then by file name. The new playlist takes the file's name, made unique if needed ("Mix (2)"). A summary shows how many videos were added, the lines that weren't found, and the web links skipped. Evidence: `src/playlists/m3u.ts`, `import-match.ts`, `playlist-names.ts`, `playlists-service.ts` (`exportPlaylist`, `importPlaylistFile`), `src/screens/playlists/components/ImportResultModal.tsx`. |

### Schema (DATABASE_VERSION 8 → 9)

There is one bump, in `src/storage/constants/database.ts`: `DATABASE_VERSION = 9`, a v9 line in the comment above it,
and `TABLE_NAMES.playlists` / `TABLE_NAMES.playlistItems`. The DDL is in `src/storage/sqlite/playlist-schema.ts`
(`applyPlaylistTables`):

```sql
CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_playlists_updated_at ON playlists(updated_at DESC);

CREATE TABLE IF NOT EXISTS playlist_items (
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  file_name TEXT NOT NULL DEFAULT '',
  duration REAL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (playlist_id, media_id)
);
CREATE INDEX IF NOT EXISTS idx_playlist_items_position ON playlist_items(playlist_id, position);
CREATE INDEX IF NOT EXISTS idx_playlist_items_media ON playlist_items(media_id);
```

**How it runs**
- Upgrade: `migrateDatabase` has `if (currentVersion < 9) { await applyPlaylistTables(db); PRAGMA user_version = 9 }`.
- Fresh install: `applySchema` calls `applyPlaylistTables` before it sets the version.
- Both only create new tables (`IF NOT EXISTS`). No existing table is altered and no row is touched, so running it
  twice changes nothing.

**Why the app database (`vidorax.db`)**
- The videos in a playlist are library videos, and the library (downloads catalog, media folders) is in the app
  database for every browser profile.
- `applyBrowserTables` also runs on every browser-profile database (`browser-database.ts`), so P7 is kept out of it.
- `BROWSER_PROFILE_DATABASE_VERSION` is unchanged.

**The columns**
- `media_id` is plain text: a download id, or `device:<MediaStore id>` for a video on the phone. Library videos are not
  SQLite rows, so it can't be a foreign key. An entry whose video is gone stays, and shows as missing.
- The only foreign key is item → playlist, with `ON DELETE CASCADE` (`PRAGMA foreign_keys = ON` is set on open).
  `deletePlaylist` also deletes the items itself, in the same transaction.
- `title`, `file_name` and `duration` are what was known when the video was added. They name a missing entry and fill
  in the export.
- `PRIMARY KEY (playlist_id, media_id)` means a video is in a playlist only once. The play queue finds the playing video
  with `indexOf`, so a second copy would send Next back to the first one.
- Positions are 0, 1, 2… and are rewritten after a removal or a move. There is no UNIQUE on position, so swapping two
  needs no temporary value.

**Code:** `playlists.repository.ts` uses `getDatabase()`, the app database, like `media-folder.repository.ts`. The SQL
is in `playlists.queries.ts`, over a minimal database type.

### Playing

`playPlaylist(entries, { startId?, shuffle? })` in `src/playlists/play-playlist.ts` is the only place a playlist
starts playing.
- It calls `openPlayer(firstId, ids)`, which sets `play-queue.ts`'s list. So Previous / Next, P5's Repeat all and P6's
  Auto Play Next all work on the playlist. There is no second queue.
- Entries that can't play are left out of `ids`, and each id appears once. `planPlaylistPlay` (`play-plan.ts`, pure)
  picks the first video and the list.
- **Shuffle** starts at a random video and switches on P6's queue shuffle (#542) around it. The rest play in a random
  order, and Shuffle off in the queue sheet gives the playlist's order back. (Wired when P7 was put on top of P6:
  `playPlaylist` calls `openPlayer`, then `setPlayQueueCurrent(start)` and `setPlayQueueShuffle(true)`.)

`resolvePlaylistEntries` (`playlist-entries.ts`) decides what can play:
- **A library video** plays when the library still lists it and its file isn't missing. This is `canAttemptPlayback`,
  as on the Library's cards, so "unverified" may play.
- **A video the library no longer has** is missing: deleted in VidoraX, or removed by `reconcileV2Library`.
- **A video on this phone** (`device:` id) plays only once VidoraX has listed it in this run (`knownDeviceVideo`). The
  Player finds the file from that list.
  - When a playlist has phone videos VidoraX doesn't know yet, the playlist screen lists the first 500 phone videos
    itself. This never asks for permission; without access the list is just empty.
  - A phone video that is still not listed shows the title it had when added, with "A video on this phone: open “Videos
    on this device” in the Library to play it".

### M3U / M3U8

**Export: one line format**
- `#EXTM3U`, then for each video `#EXTINF:<whole seconds, or -1>,<title>` and the video's **file name** as the path
  line. That is a path relative to the playlist file. Lines end in LF; UTF-8, no BOM.
- Why the file name:
  - Library files are private to VidoraX: other apps can't open those paths, and `MediaLibraryItem` has no path on
    purpose.
  - The files are not in one shared folder.
  - So the file name is what another player can resolve. Save the playlist next to the videos, or next to copies of
    them (Movies/VidoraX after "Save to device"), and it plays there.
- Missing videos are exported too, under the names they had.
- Line breaks in names become spaces, and a name that starts with `#` is written `./#…`.
- MIME type: `application/vnd.apple.mpegurl`, the type registered for .m3u8.
- File name: the playlist's name with `\ / : * ? " < > |` and control characters removed (Urdu kept), plus `.m3u8`.
  `exportFileName` would have turned an Urdu name into `vidorax-export-<date>`.

**Reading**
- A BOM is dropped. Lines may end in CRLF, CR or LF, mixed in one file.
- Blank lines and `#` comments are skipped.
- The `#EXTINF` title is everything after the first comma outside double quotes, so titles with commas work, and so do
  attributes like `tvg-name="a, b"`.
- `file://` URIs are percent-decoded; a stray `%` is kept. Plain Windows and POSIX paths are kept as written.
  `content://` document URIs are reduced to the document's path.
- `http://`, `https://` and other network addresses (`rtsp://`, `ftp://`) are skipped and counted.
- The file is decoded with P3's subtitle decoder: UTF-8, UTF-16, or Windows-1256 / 1252 for an old .m3u with Urdu
  names. Files up to 4 MB.

**Matching** (`matchImportEntries`), in this order:
1. **By path.** The line's last folders and file name must equal the end of where VidoraX plays the video from
   (`getInternalPlaybackUri`: its file, or the document in a folder the user picked), at least two segments long (a
   folder and the name). Missing videos have no such path, so they match by name only.
2. **By file name**, extension included: `clip.mp4` does not match `clip.mkv`.

Both ignore case and Unicode composition.
- When two videos share a name, a playable one is taken first.
- Videos on the phone are candidates by their MediaStore title, when VidoraX may read them.
- A video named twice is added once, and the summary says "Listed more than once: 2".
- The lines that match nothing are listed after the import. If nothing matched, no playlist is made.

### Decisions

- **New names, because "playlist" was taken** by Playlist Download (`/downloads/playlist`, `lightPlaylist`).
  - Strings: a new `playlists` namespace (`catalogs/playlists.en.ts` / `.ur.ts`). The Player row's label is
    `playlists.addToPlaylist`, so `videoPlayer.*` is untouched.
  - Routes: `/playlists` and `/playlists/[id]`.
- **A playlist holds each video once.** Adding it again is counted, never inserted.
- **Names don't have to be unique.** Only an imported playlist gets a suffix when its name is taken.
- **The Player's command is one optional context field**, `PlayerOptionContext.playlists` (`canAdd`, `openAddSheet`),
  instead of a `ui` command plus a context flag. That is one line in `PlayerScreen.tsx`'s options context.
- **Missing videos can't be selected in the Library**, because their cards can't be tapped (as before). "Select" from a
  missing video's menu starts with nothing selected.
- **The add sheet is P3's `PlayerSheetFrame`:** a bottom sheet that scrolls, so a long list of playlists fits. The
  Library uses it too.
- **The Library's long-press menu is getting long.** It now has up to 10 rows, 12 with P6's two. It is `ActionSheetModal`:
  no scroll, at most 70 % of the screen. On a short phone Delete and Cancel may fall below the edge. The shared
  component isn't changed here (device check 3); the fix is to make it scroll.
- **The playlist screen draws every entry in one scroll view** (`DsRowGroup`). That is fine for hundreds; a FlatList
  is the next step for thousands.

### Files

- Logic (unit-tested): `src/playlists/m3u.ts`, `import-match.ts`, `playlist-names.ts`, `playlist-entries.ts`,
  `play-plan.ts`; `src/storage/repositories/playlists.queries.ts`; `src/storage/sqlite/playlist-schema.ts`.
- Storage: `src/storage/constants/database.ts` (v9, table names), `sqlite/schema.ts` (`applySchema`),
  `sqlite/migrations.ts` (the v9 block), `repositories/playlists.repository.ts`.
- Runtime: `src/playlists/play-playlist.ts`, `playlists-service.ts`, `playlist-library.ts`, `playlist-changes.ts`,
  `use-playlists.ts`.
- Screens: `src/screens/playlists/` (`PlaylistsScreen`, `PlaylistScreen`, `components/AddToPlaylistSheet`,
  `PlaylistNameModal`, `PlaylistEntryRow`, `ImportResultModal`). Routes: `src/app/(app)/playlists/index.tsx` and
  `[id].tsx`, `route-names.ts` (`playlists`, `playlist`), `route-paths.ts` (`playlists`, `playlistPath`),
  `route-access.ts`, `src/app/(app)/_layout.tsx` (two `Stack.Screen`s).
- Library: `LibraryScreen.tsx` (header button, one spread line in the menu, the bar, the sheet, tap / long press while
  selecting), `hooks/useLibraryPlaylists.ts`, `components/LibrarySelectionBar.tsx`, `LibrarySelectMark.tsx`, and the
  optional `selected` / `selectedIds` props in `LibraryCard.tsx`, `LibraryGridTile.tsx`, `LibraryList.tsx`.
- Player: `src/player/options/p7-playlists.ts` (+ one import in `index.ts`), `player-options.ts` (the optional
  `playlists` field), `src/screens/player/page/use-player-playlist-add.ts`. In `PlayerScreen.tsx`, the fenced
  `// ── P7 Playlists ──` block, plus one token in `anyModalOpen`, one context line and the sheet.
- Strings: 59 new `playlists.*` keys (English and Urdu), in a new catalog wired into `en.ts` / `ur.ts`.

### Gate

| Check | Result |
| --- | --- |
| `npm run typecheck` | 0 errors |
| Unit tests | 2194 / 2194 (36 new: `playlists.queries.test.ts` 14 — fresh install, v8 upgrade with rows in six tables, idempotent, the operations, delete touching nothing else; `m3u.test.ts` 9; `playlists.test.ts` 10; `options/p7-playlists.test.ts` 3) |
| `npm run lint` | 0 errors; 91 warnings, none new (`LibraryList.tsx`'s `columnWrapperStyle` warning is older; its line moved) |
| Against the base | none of Faran's files; `play-queue.ts` untouched; `package.json` / lockfile, `android/`, `modules/`, manifests, `app.json` unchanged; no new dependency or permission |
| Schema | `DATABASE_VERSION` 8 → 9, once; `BROWSER_PROFILE_DATABASE_VERSION` unchanged |
| Media3 | `1.9.0`, unchanged |

### Device checks for Faran (release build; not possible here)

1. **Upgrade.** Install the previous build (database v8) and add downloads, folders, bookmarks, notes and a saved page.
   Then install this build: everything is still there and Playlists opens empty. Check a fresh install too.
2. **Library.** Long-press → Add to playlist → New playlist with an Urdu name: the playlist shows 1 video. Add the same
   video again: "Already in". Select, tap several videos: the bar counts them, and Add to playlist adds them in the
   Library's order. Back leaves the selection; Back on another tab doesn't.
3. **The long-press menu on a small phone.** It now has up to 10 rows: Delete and Cancel must still be reachable.
4. **Player.** ⋮ → Tools → Add to playlist, for a library video and for a phone video. The row is hidden for a file
   opened from another app and for a stream.
5. **Playing.** Play, and tap a video to play from it. Previous / Next step through the playlist in order, and P5's
   Repeat all wraps inside it. Shuffle plays in order until P6.
6. **Editing.** ↑ / ↓ with TalkBack ("Move “x” up"), remove, rename, delete with the confirm. Afterwards the video files
   are still in the Library.
7. **Missing.** Delete a video in the Library, or delete its file outside VidoraX and pull to refresh. The entry is
   greyed with "Missing…", doesn't play, and Next skips it.
8. **Phone videos.** Add one, close the app, reopen the playlist: it plays if VidoraX has access, because the playlist
   lists phone videos itself. Without access, the message shows.
9. **Export.** The saved file's name is `<name>.m3u8` (not `.m3u8.m3u` or `.txt`), and its content is right. Open it in
   VLC next to the video files. Try Urdu names.
10. **Import.** Import VidoraX's own export. Then an M3U from VLC or a PC: Windows paths, `file://` URIs, CRLF, and a
    Windows-1256 .m3u with Urdu names. Web links are counted, and the not-found list shows.
11. **Themes and Urdu.** All six themes, and Urdu (right to left): Playlists, a playlist, the add sheet, the selection
    bar, the import summary.
