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

Built in its own worktree from `hamza/player` at P5 (`ff07f45`), while P6 was being built, on the local branch
`wip/P7-playlists`. It was cherry-picked on top of P6 (`6a1a595`) only after P6 passed its checks; branch
`hamza/P7-playlists`. **Its PR depends on P6:** a playlist plays through the play queue P6 extends, and P6 switches
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

- **The shared action sheet (`src/components/bottom-sheets/ActionSheetModal.tsx`) now scrolls its rows** when they
  don't all fit. It stops at 70 % of the screen and had no scroll, so with P7's two rows, and P6's two while a video
  plays, the Library menu's Delete and Cancel could fall off a short phone. Only the rows scroll; Cancel stays below.
  When everything fits, nothing changes.
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
| Unit tests | 2234 / 2234 on top of P6 (2194 / 2194 on the P5 base; 36 new: `playlists.queries.test.ts` 14 — fresh install, v8 upgrade with rows in six tables, idempotent, the operations, delete touching nothing else; `m3u.test.ts` 9; `playlists.test.ts` 10; `options/p7-playlists.test.ts` 3) |
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
12. **The long-press menu scrolls.** On a short phone, with a video open in the mini player (P6 adds Play next and Add
    to queue, so about 12 rows), long-press a Library video: the rows scroll, and Delete and Cancel can be reached. A
    short menu elsewhere (e.g. Downloads) looks as before.

## P8 Gestures & custom controls (#582, #585, #586, #587, #692)

Built from `hamza/player` at P4 (`d2796bc`) in its own worktree, on local `wip/P8-gestures`, while P5–P7 were built in
parallel. It was cherry-picked on top of P7 (`74fa8a4`) as `hamza/P8-gestures` only after P6 passed its checks.
 Its PR depends on P7
(`hamza/P7-playlists`). Every gesture that existed before P8 keeps its numbers and its behaviour; the new options only
add to them.

### What the user sees

| # | Feature | Where | How (evidence) |
| --- | --- | --- | --- |
| #582 | Horizontal Swipe Seek | On the video (card and full screen); ⋮ → Playback → Gestures → "Swipe sideways to seek" | One finger moved sideways anywhere on the fitted picture shows a pill with the target and the change, "12:34 (+0:45)". The video seeks **once, when the finger lifts**, through the session's exact seek (the timeline's path). A second finger, a lock or a sheet opening cancels the swipe and nothing seeks. Normal: the picture's width is 90 s (half the width = 45 s), in whole seconds, rounded the same way both directions, kept inside 0 … the video's length. Right is forward in every language, as for the double tap and the timeline (neither is mirrored in Urdu). Off while zoomed (one finger moves the picture then), before the video is ready, and for a stream with no length. The start is read from the player's own clock. `src/player/swipe-seek.ts` (`swipeSeekTarget`, `formatSeekDelta`, `formatSwipeSeekLabel`, the pill's store), `use-swipe-seek.ts`, `gesture-zones.ts` (thresholds, `resolveSwipeAxis`), `screens/player/components/PlayerVideoSurface.tsx` (`swipeSeek` pan), `components/SwipeSeekHud.tsx`. |
| #585 | Two Finger Tap | On the video; Gestures → "Two-finger tap: play / pause" | **The checklist row says only "to run a specific function" (مخصوص فنکشن چلانے کے لیے), so it plays / pauses** (screen 20 says "Two-finger tap: pause"). Two fingers down and up within 300 ms, moving less than 12 dp. It does what the play button does (and keeps the controls' timer fresh). It is recognised when the fingers lift, before the single tap can be (the single tap waits for the double tap to fail), so the controls don't also toggle. `PlayerVideoSurface.tsx` (`twoFingerTapGesture`), `PlayerScreen.tsx` (`onTwoFingerTap={onPlayPause}`). |
| #586 | Gesture Sensitivity | ⋮ → Playback → Gesture sensitivity (a sheet); the Gestures sheet (chips) | Low / Normal / High multiply how far a swipe moves the time, the brightness and the volume by **×0.5 / ×1 / ×2**. **Normal is today's mapping exactly:** brightness and volume change by the swipe's distance ÷ the picture's height (`brightnessFromSwipe`, `levelFromSwipeDelta`: a swipe the full height goes from 0 to 100 %), and Normal multiplies the distance by 1, so every number is the same bit for bit. The test checks strict equality (`Object.is`) over 784 start / distance / height combinations, including 0, negative and NaN heights, ±0 and infinite distances. When a swipe starts (10 dp / 16 dp, below) never changes. `gesture-settings.ts` (`GESTURE_SENSITIVITY_FACTORS`, `scaleSwipeDistance`), `use-player-side-gestures.ts` (`sensitivity`), `swipe-seek.ts`. |
| #587 | Disable Gestures | ⋮ → Playback → "Gesture controls" (a switch); ⋮ → Playback → Gestures (a sheet) | A master switch, "Gesture controls" (screen 20), and one switch each for swipe seek, brightness, volume, double tap, long-press 2× (#545), two-finger tap and pinch zoom. A switched-off gesture's recogniser is off on the video. **The single tap is never switched off:** it shows the controls, which are the way back to the switch in full screen. Turning pinch zoom off returns a zoomed picture to fitted. With the double tap off, a double tap on a zoomed picture still resets the zoom (that belongs to pinch zoom) but never seeks or pauses. The master switch keeps each gesture's own choice (greyed in the sheet). **No new lock:** the checklist row says only "to avoid accidental touches" (غلطی سے چھونے سے بچنے کے لیے) and asks for no lock-screen-controls option, and the Player already has a controls lock (the Lock chip and button, `locked` in `PlayerScreen.tsx`), which P8 leaves as it is. `gesture-settings.ts` (`surfaceGestureFlags`), `gesture-settings-preference.ts`, `page/GestureSheets.tsx`. |
| #692 | Customize Controls | ⋮ → Tools → Customize controls | Each control has a switch (show / hide) and, where its group has an order, ↑ / ↓ (move). The groups: **Page: chips** (1.0× · Subs · Audio · Rotate · Lock), **Page: tiles** (10 s, Custom seek, Frame by frame, A–B repeat, Aspect ratio, Mirror / Flip), **Page: cards** (Up next), **Full screen: top bar** (rotation lock, full screen), **Full screen: on the video** (⏪ ⏩, ⏮ ⏭, the lock button) and **Full screen: bottom bar** (volume, 1.0× speed). "On the video" and "cards" only show / hide: their places are fixed. Reset to default puts everything back. Play / pause, Back, ⋮, the title, the timeline, "Save to VidoraX" and the locked screen's unlock pill are never listed. ⋮ is the way back to this sheet and its Reset. Changes apply at once and are remembered app-wide. Faran's 1.0× chip (P16) can be shown, hidden or moved and does what it did. The A–B repeat tile and the Up next card keep their ids (`abRepeat`, `upNext`), so P5 / P6 need nothing here. `src/player/controls-layout.ts`, `controls-layout-preference.ts`, `screens/player/page/player-controls-customize.ts`, `page/CustomizeControlsSheet.tsx`, `PlayerPageBody.tsx`, `components/PlayerControls.tsx`, `components/PlayerTopBar.tsx`, `PlayerScreen.tsx` (the dock). |

### The axis lock (#582)

The brightness (left quarter) and volume (right quarter) swipes have always started after **10 dp** up or down and
given up after **16 dp** sideways first. Swipe seek uses the same two numbers the other way round, over the whole
picture: it starts after **16 dp** sideways and gives up after **10 dp** up or down. So, for one finger, the first
clear movement decides:

- 10 dp up / down before 16 dp sideways: vertical. Brightness or volume at the edges, exactly as before; nothing in the
  middle, as before.
- 16 dp sideways before 10 dp up / down: horizontal, swipe seek.
- both in the same movement (a fast diagonal flick): neither. The edge swipes already ignored that.

Swipe seek never starts sooner than 16 dp, because a lower number would turn a slightly diagonal edge swipe that changes
the brightness today into a seek. The other gestures keep their touches:

- **Long-press 2×** gives up after 12 dp, so it has failed before swipe seek can start. Once 2× has started it owns the
  touch.
- **Pinch zoom:** both swipes are one-finger only, and a second finger cancels a running swipe seek without seeking.
- **Double tap and the single tap** never move far enough to start a swipe.

The thresholds are named constants in `gesture-zones.ts`, used by the edge swipes (same values as before) and by swipe
seek. `resolveSwipeAxis` / `lockSwipeAxis` follow the gesture handler's order (a recogniser checks "give up?" before
"start?") and are tested with real paths.

### Customize Controls: the rules

- A group draws its **available** controls: the code's default order minus those switched off by a flag. The Audio chip
  is unavailable while `PAGE_CHIP_FLAGS.audio` is false: it isn't drawn and isn't listed in the sheet.
- The saved order is applied on top. A saved id that is not available (one that no longer exists, a flagged-off chip, a
  duplicate, a non-string) is skipped. An available id that the saved order doesn't have (a control added later, or a
  flag turned on later) goes to its **default place**: right after the nearest control before it in the default
  order; at the front if there is none.
- So when Faran's P17 sets `audio: true`, the Audio chip appears after Subs, wherever the user put Subs, and is listed
  in the sheet. Nothing else needs to change (tested with an order saved while it was hidden).
- Nothing saved (or Reset) is exactly today's page and full screen: `shownPageChips()`, `PAGE_TILES`, Up next, rotation
  lock and full screen, ⏪ ⏩ ⏮ ⏭, the lock button, volume then speed (tested). What is saved covers only the controls
  the user could see.
- On the page, the chips and tiles now come from this list. In full screen the top bar maps its two buttons in order,
  the controls hide ⏪ ⏩ / ⏮ ⏭ on request, and the dock draws its buttons in order with the info line (#721) after the
  first, which is today's place between volume and speed.

### Options sheet

- **Playback:** Gestures 100 (value "All on" / "5 of 7 on" / "Off"; opens the Gestures sheet), Gesture controls 110 (the
  master switch), Gesture sensitivity 120 (value Low / Normal / High; opens its sheet). P1 has 10–40; P5 / P6 use 50–90.
- **Tools:** Customize controls 80.
- `PlayerOptionContext` gained `gestures` (`enabled`, `sensitivity`, `onCount`, `total`). `PlayerOptionUi` gained
  `openGestures`, `setGesturesEnabled`, `openGestureSensitivity` and `openCustomizeControls`. The four existing test
  helpers build the new field.

### Decisions

- **Swipe seek and the two-finger tap are off by default** (Hamza, 2026-11-23), so nothing changes for existing users;
  they are turned on in ⋮ → Playback → Gestures. Turned on, two touches that used to toggle the controls do something
  else: a two-finger tap (play / pause), and a quick sideways flick of more than 16 dp under 250 ms (a swipe seek).
  Every gesture threshold from before P8 is unchanged (10 / 16 dp edge swipes, 280 ms double tap, 250 ms single tap,
  500 ms / 12 dp long press). The Gestures row reads "5 of 7 on" with the defaults.
- **Swipe seek's scale:** 90 s for the picture's width at Normal, the same feel on the card and in full screen,
  whatever the video's length (the timeline is there for big jumps). Low 45 s, High 180 s.
- **Sensitivity factors:** Low ×0.5, High ×2. They scale how far the value moves, not when a swipe starts. Zoom is not
  scaled.
- **"Normal", not the design's "Medium":** screen 20's Sensitivity row reads "Medium", and the plan says Low / Normal /
  High. One string (`gestureSensitivityNormal`) if it should read "Medium".
- **Customize controls is under Tools:** screen 25 ("Player settings") doesn't show where it goes (its DISPLAY section
  is cut off in the PDF).
- **Full screen:** a button moves only inside its own bar. ⏪ ⏩ sit either side of play / pause, and ⏮ ⏭ and the lock
  have fixed places, so those only show or hide.
- **Icons** are existing design-kit names (gauge, sliders, layout grid…). Screen 20's hand icon would need an edit to
  the shared `DsIcon` map.
- **Two new MMKV keys** (`playerGestures`, `playerControlsLayout`, both `.v1`, app-wide) are added at the end of
  `mmkvKeys`, so they don't collide with keys P5–P7 add next to the other Player keys.
- **TalkBack:** the video's hint gains a sentence for swipe seek and one for the two-finger tap while they're on. With
  the master switch off it says "Tap to show controls. Gestures are off in Video options." A gesture switched off one by
  one is still named in the older part of the hint.
- **Android's edge Back gesture is not avoided.** Swipe seek covers the whole width, so a sideways swipe that starts
  right at a screen edge may be taken by gesture navigation's Back, which closes the Player into the mini player in the
  landscape stage. In immersive full screen the first edge swipe usually brings the system bars back instead. Android
  takes that touch before the app, as it did before P8. If it turns out to matter, swipe seek can refuse to start
  inside the system gesture insets.
- **Hiding every chip or every tile** leaves an empty row and one extra 10 dp gap on the page; the Up next card is left
  out completely when hidden.

### Files

- Logic (unit-tested): `src/player/gesture-zones.ts` (thresholds, axis lock), `gesture-settings.ts` (settings,
  sensitivity, recogniser flags), `swipe-seek.ts`, `controls-layout.ts`,
  `src/screens/player/page/player-controls-customize.ts` (groups, what each part draws).
- Stores (zustand + MMKV): `gesture-settings-preference.ts`, `controls-layout-preference.ts`; labels:
  `gesture-settings-labels.ts`.
- Runtime: `use-swipe-seek.ts`; `use-player-side-gestures.ts` (optional `sensitivity`).
- Screen: `components/PlayerVideoSurface.tsx` (flags, swipe seek, two-finger tap, constants, zoom reset, hint),
  `components/SwipeSeekHud.tsx`, `components/PlayerControls.tsx` / `PlayerTopBar.tsx` (optional props, defaults as
  before), `page/PlayerPageBody.tsx` (optional `layout`), `page/GestureSheets.tsx`, `page/CustomizeControlsSheet.tsx`,
  `PlayerScreen.tsx` (one P8 section, the sheet state in the five sheet lists, the dock).
- Options: `src/player/options/p8-gestures.ts` (+ one import line), `player-options.ts`. MMKV keys: `playerGestures`,
  `playerControlsLayout`. Strings: 55 new `videoPlayer.*` keys (English and Urdu), at the end of both catalogs.

### Gate

| Check | Result |
| --- | --- |
| `npm run typecheck` | 0 errors |
| Unit tests | 2295 / 2295 on top of P7, the whole stack P1–P8 (2194 / 2194 on the P4 base; 61 new: `gesture-zones.test.ts` 11, `gesture-settings.test.ts` 12, `swipe-seek.test.ts` 9, `controls-layout.test.ts` 13, `page/player-controls-customize.test.ts` 11, `options/p8-gestures.test.ts` 5) |
| `npm run lint` | 0 errors; 91 warnings, none in a file P8 changed |
| Against `d2796bc` | `git diff --check` clean; none of Faran's files; `package.json` / lockfile, `android/`, `modules/`, manifests, `app.json` unchanged; no new dependency or permission; no SQLite change |
| Media3 | `1.9.0`, unchanged |

### Device checks for Faran (release build; not possible here)

1. **Nothing changed with the defaults** (swipe seek and the two-finger tap start off). Edge swipes (brightness,
   volume), the double tap (thirds; reset while zoomed), long-press 2×, pinch zoom and pan, and the single tap behave
   exactly as on P4.
2. **Turn swipe seek and the two-finger tap on** (⋮ → Playback → Gestures) for checks 2–6.
   **Axis lock on the left and right edges:** slightly diagonal up / down swipes still change brightness / volume (no
   seek). Mostly sideways swipes seek. A fast diagonal flick does neither.
3. **Swipe seek** on the card and in full screen: the pill shows "12:34 (+0:45)" and follows the finger. The video only
   moves when the finger lifts. Swipe to either end: the target stops at 0:00 / the length. A second finger during the
   swipe cancels it (no seek). Opening a sheet or locking mid-swipe: no seek, the pill goes.
4. **The timelines** still scrub on a horizontal drag (the card's and full screen's) and don't swipe-seek.
5. **Long-press 2×** then moving the finger sideways: stays at 2×, no seek. **Pinch** started with one finger moving
   first: zooms or swipe-seeks, never both. While zoomed, one finger pans the picture (no seek).
6. **Two-finger tap** pauses and plays, and doesn't also toggle the controls. A pinch is never taken for a two-finger
   tap. With the switch off (the default), a two-finger tap toggles the controls as before.
7. **Sensitivity:** Low / Normal / High for seek, brightness and volume (Normal identical to P4).
8. **Gesture controls off:** no gesture works except the tap that shows the controls. Each gesture's own switch.
   Pinch zoom off while zoomed: the picture returns to fitted.
9. **Customize controls:** hide, show and move chips and tiles on the page (the 1.0× chip too), the Up next card,
   the top bar's two buttons, ⏪ ⏩ / ⏮ ⏭ / the lock button, the dock's volume / speed (with the info overlay on, its
   line stays between them / after the first). Reset to default. Close and reopen the app: everything is kept.
10. **The Gestures, Gesture sensitivity and Customize controls sheets** in all six themes and in Urdu (switches, chips,
    ↑ / ↓, the screen 20 card). Back and a tap outside close them. TalkBack reads the ↑ / ↓ names and the new position
    after a move.
11. **Edge swipes with gesture navigation:** a sideways swipe starting within about 24 dp of the left or right edge.
    Check it in the landscape stage (system bars showing: does Back close the Player instead of seeking?) and in
    immersive full screen (the system bars come back). Then check a swipe starting a little further in: it seeks.

## P9 — Library stats & bookmarks (#708, #626, #711, #628, #726, #687, #705)

Built from `hamza/player` at P8 (`1ba7714`) in its own worktree, on the local branch `wip/P9-library-stats`, while P10
was built in parallel from the same base. **Its PR depends on P8 (#47).** **P9 bumps the SQLite schema once, 9 → 10**
(see Schema). No native change, no new dependency or permission; none of Faran's files.

### What the user sees

| # | Feature | Where | How (evidence) |
| --- | --- | --- | --- |
| #708 | Play Count | Download details → Info: "Played · 3 times", "Last played"; the Library's long-press menu line ("Open, share, save, or delete · Played 3 times") | **A play counts once per session, after 30 s of the video actually played, or, for a video shorter than 30 s, when it was watched to its end (its length minus 1 s).** "Actually played" is the position moving forward between two of the Player's playback events by at most 3 s (they come about once a second, so 2× speed is about 2.1 s); a seek forward or back is a jump and adds nothing. `paused`, `completed` (at the video's end) and `playerExited` are samples too, so "pause, seek, resume" is also a jump. A session runs from `playbackStarted` (or the video's first event) to `playerExited` or another video's events; the mini player is the same session; Replay and Repeat one don't start a new one, so a looping video counts once. Unknown length: the 30 s rule; when it ends, where it ended is its length. Not counted: streams, files another app opened, and anything while Disable History is on. It listens app-wide to `subscribePlaybackEvents` (`src/player/playback-events.ts`), so nothing in the Player or its session code changed. Evidence: `src/library/play-count.ts` (`createPlayCountTracker`, `playCountReached`), `src/library/ensure-library-stats.ts`, `src/storage/repositories/library-stats.queries.ts` (`recordPlay`), `src/screens/downloads/components/DownloadPlayCountRows.tsx`, `LibraryScreen.tsx` (the menu line). |
| #626 | Most Played | Library → Sort → **Most played** | A Library sort (`LIBRARY_SORTS` gains `most_played`; the sort sheet lists it last). Play count first; ties by the last counted play, then the last time played at all, then the newest download; never-played videos after every played one. It is part of `applyLibraryQuery`, so it combines with the filters, Quality, the length filter, hidden folders and search. Evidence: `src/library/query.ts` (`sortLibraryItems(items, sort, playCounts?)`), `src/library/library-stats-store.ts` (`playCounts`), `library.constants.ts`, `LibraryHeaderControls.tsx` (`SORT_LABEL_KEYS`). |
| #711 | Duration Filter | Library: a **length chip** after Sort ("Any length", "Under 5 min", "5 to 20 min", "20 to 60 min", "60 min or more") | Its own dimension (a store field, not a `LibraryFilter` value), so it combines with Favorites, Folder, Quality, Most played and search. Buckets include their lower end, on whole seconds (floored, as the Player shows the time): exactly 5:00 is "5 to 20", 20:00 is "20 to 60", 60:00 is "60 min or more"; 4:59.9 is "under 5". **A video whose length isn't known shows only under Any length** (the sheet says so). Reset clears it; it isn't remembered, like the other filters. Evidence: `src/library/duration-buckets.ts`, `query.ts` (`applyLibraryQuery`), `library-stats-store.ts` (`loadLibraryDurations`), `useLibraryScreen.ts`, `LibraryHeaderControls.tsx`. |
| #628 | Include/Exclude Folders | Library → Filter → **Include / exclude folders** (last row; "(2 hidden)" when some are) | A sheet with one switch per folder, "Unfiled / Downloads" first; on = shown. Hidden folders leave the Library list, Most played, search and the Library's Continue watching row. **Choosing a hidden folder in the Folder filter still shows it** (the user asked for that folder). Remembered in MMKV (`libraryExcludedFolders`). It never deletes, moves or re-files a video. When hidden folders leave the list empty, it reads "No videos found" (not "No downloads yet"). Evidence: `src/library/folder-exclusion.ts`, `query.ts`, `library-stats-store.ts` (`setLibraryFolderHidden`), `src/screens/library/components/LibraryFolderVisibilitySheet.tsx`, `useLibraryScreen.ts`, `LibraryHeaderControls.tsx`. |
| #726 | Quick Delete | Player: ⋮ → Tools → **Delete video** (90) | A confirm ("Delete “…” from VidoraX?"; it says whether the next video plays or the Player closes), then **the Library's own delete**, `deleteCompletedFileFromVidoraX` (loaded the same way). Then the next video in the queue plays (`queueNeighbours`, the play order, shuffle included) and the deleted one leaves the queue through P6's `removeFromPlayQueue`; with no next video the session is closed (so the mini player doesn't go on with a deleted file) and the Player closes. A failed delete says "Unable to delete this download" and the video stays. **Offered only for a finished library video**: hidden for gallery videos, files another app opened, streams and videos still downloading. Evidence: `src/player/quick-delete.ts`, `src/screens/player/page/use-player-library-stats.ts`, `src/player/options/p9-library-stats.ts`. |
| #687 | Disable History | Player: ⋮ → Playback → **Don't save watch history** (200, a switch); Settings → Player | **While on, nothing new is recorded: no Watch history entry, no Continue watching, no resume point and no play count.** What was recorded before stays until the user clears it. The gate is in `src/playback/bind-playback-persistence.ts` (not Faran's): its listener drops the event before the coordinator, which is the only writer of the playback records that Watch history, Continue watching, Home's lists, the Library's "Recently watched" and resume all read. The play counter has its own gate. Off by default; MMKV `playerDisableHistory`. Evidence: `src/playback/history-pause-preference.ts`, `bind-playback-persistence.ts` (`isHistoryPaused`), `src/library/play-count.ts`, `src/screens/settings/components/PlayerSection.tsx`. |
| #705 | Video Bookmarks | Player: ⋮ → Tools → **Add bookmark** (40), **Bookmarks** (45; its value is how many); dots on the timeline | **Add** takes the time playing now (the player's own clock) and asks for an optional name ("At 1:23"). **The list** (a bottom sheet) is by time, each row the name or the time; tap one to jump to it (the session's exact seek), ✎ renames it (empty: back to the time), the bin deletes it after a confirm. "Add a bookmark at 1:23" is at the top. Positions are whole milliseconds inside 0 … the length; names up to 80 characters, Urdu kept; up to 100 per video. **The timeline shows each bookmark as a small amber dot with a dark rim**, on the card's bar and the full-screen dock, separate from P5's A-B ticks. For library and phone videos, not for files another app opened or streams. A video deleted from the library takes its bookmarks and play count with it. Evidence: `src/player/video-bookmarks.ts`, `video-bookmarks-store.ts`, `library-stats.queries.ts`, `src/screens/player/page/VideoBookmarksSheet.tsx`, `BookmarkNameModal.tsx`, `components/TimelineBookmarkMarks.tsx`, `PlayerTimeline.tsx` / `PlayerCardOverlay.tsx` (`bookmarkMarkers`). |

### Schema (DATABASE_VERSION 9 → 10)

One bump, in `src/storage/constants/database.ts`: `DATABASE_VERSION = 10`, a v10 line in the comment above it, and
`TABLE_NAMES.mediaPlayStats` / `TABLE_NAMES.videoBookmarks`. The DDL is in `src/storage/sqlite/library-stats-schema.ts`
(`applyLibraryStatsTables`):

```sql
CREATE TABLE IF NOT EXISTS media_play_stats (
  media_id TEXT PRIMARY KEY NOT NULL,
  play_count INTEGER NOT NULL DEFAULT 0,
  last_played_at TEXT,
  duration_ms INTEGER,          -- #711 backfill: the length measured from the file (null: none could be read)
  duration_checked_at TEXT      -- when the backfill last looked
);

CREATE TABLE IF NOT EXISTS video_bookmarks (
  id TEXT PRIMARY KEY NOT NULL,
  media_id TEXT NOT NULL,
  position_ms INTEGER NOT NULL,
  name TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_video_bookmarks_media ON video_bookmarks(media_id, position_ms);
```

**How it runs**
- Upgrade: `migrateDatabase` has `if (currentVersion < 10) { await applyLibraryStatsTables(db); PRAGMA user_version = 10 }`.
- Fresh install: `applySchema` calls `applyLibraryStatsTables` before it sets the version.
- Both only create new tables (`IF NOT EXISTS`). No table is altered and no row is touched, so running it twice changes
  nothing. App database only, like P7: not part of `applyBrowserTables`; `BROWSER_PROFILE_DATABASE_VERSION` unchanged.

**Why a new table for play counts, not columns on `downloads_catalog`**
- `downloads_catalog` doesn't hold every library video. Only the older store path writes it
  (`persistDownloadCatalogItem` in `src/store/downloads/actions.ts`). The v2 engine's videos come in through
  `applyEngineEntries` / `reduceEngineEntries`, which never write the catalog; their rows live in the native library
  database. Phone videos (`device:<MediaStore id>`) are never in it.
- So `media_play_stats` is keyed by the media id the Player plays, whatever its source. `play_count` and
  `last_played_at` are the two asked-for columns; `recordPlay` is `INSERT … ON CONFLICT(media_id) DO UPDATE SET
  play_count = play_count + 1, last_played_at = excluded.last_played_at`.
- `video_bookmarks`, because `bookmarks` is the browser's (`TABLE_NAMES.bookmarks`). `media_id` is plain text in both
  tables, never a foreign key (as P7's `playlist_items`). The index serves "this video's bookmarks, by time".

**The upgrade test** builds a v9 phone (fresh migrate, drop every table that isn't a v9 one, `user_version = 9`) and
puts one real row in **every** table it has, P7's `playlists` and `playlist_items` included. The 21 v9 tables are a
list frozen in the test, so P11's tables won't enter it; the test checks that `sqlite_master` lists exactly those and
that each has a row. It snapshots every row, migrates, checks the version, the new tables (empty) and every old row
unchanged, then runs the migration and the DDL again.

### Decisions

- **Lengths for #711.** Today every Library item's `duration` is null: `useLibraryScreen` assembles with `remoteById:
  {}`, and `enrichLibraryWithPlayback` never sets it. The native library row has `durationMs` (MediaMetadataRetriever
  when the file is added), but `projectV2Download` drops it. P9 doesn't change the projection (its tests compare
  projected rows). Instead, while a length filter is chosen, `loadLibraryDurations` asks the engine
  (`getLibraryItems`, 200 ids at a time, once per video per run) for the videos with no length, and the playback
  record's length is the fallback. Unknown lengths show only under Any length.
- **Lengths backfill (added before the push).** Every Library video is a native library item with its own file
  (older v1 downloads included: `LegacyImport` moves them in under their old ids with `MediaInfo`). What was missing
  was a length for items whose record has none. So a **background backfill** fills them in:
  - **The probe already existed:** `MediaInfo.read(file)` (`library/MediaInfo.kt`, Android's `MediaMetadataRetriever`,
    the reading a download, an import or an edit makes). It wasn't reachable from JavaScript, so a small new Kotlin
    class beside MediaEditor, **`library/LengthProbe.kt`**, looks the id up in the library and reads only the file its
    record points to, if it is there and readable (at most 10 ids per call). One new bridge function,
    `probeLibraryLengths(ids)` in `VidoraMediaModule.kt`, and its optional type in `VidoraMedia.types.ts`. Nothing is
    written natively.
  - **JS** (`src/library/length-backfill.ts`, pure; `library-stats-store.ts` `backfillLibraryLengths`): starts 3 s
    after the Library's list settles, whatever the filter; lengths kept from earlier runs first, then the native
    library's own, then the rest measured **5 at a time with a 1.5 s pause**. Gallery (`device:`) videos are never
    sent. A file that can't be read is left alone for 7 days, never retried in a loop.
  - **Kept in P9's own table:** `media_play_stats.duration_ms` and `duration_checked_at`, in the same 9 → 10 table
    creation (P9 wasn't released, so no new bump). A row made only for a length has `play_count` 0, which Most played
    and the counts ignore; a known length is never replaced by "unknown".
- **Play counts are counted app-wide** (`ensureLibraryStats` at startup, next to the playback persistence binder), not
  in a Player-screen hook, because the session keeps playing in the mini player after the Player closes.
- **Video time, not wall time:** at 2× speed, 30 s of the video takes 15 s.
- **Disable History and resume points:** not recorded while on (they feed Continue watching), as suggested. A video
  watched while it is on resumes from the point saved before, if any. **Not gated:** P6's play queue (its last video,
  so the mini player can come back after a restart) and per-video settings (fit, subtitles, loops). They are settings,
  not history.
- **The play count shows in Download details → Info** (the video's details) and in the Library's long-press menu line,
  because the Library has no details screen of its own. Phone videos (`device:` ids) are counted and stored too, but
  nothing shows their count yet (they have no details screen); Most played covers the Library, which has only
  downloads.
- **Gallery videos can't be deleted from the Player.** The app's delete (`deleteCompletedFileFromVidoraX`) only deletes
  VidoraX's own downloads, and `GalleryCopyRemoval.kt`'s `createDeleteRequest` only removes copies VidoraX recorded
  making. Deleting any other gallery video would need new native code, so the action is hidden for `device:` ids.
- **Hidden folders and the header count:** the Library header's "48 videos" still counts every playable video
  (`playableCount` keeps its meaning). The folder sheet is under Filter, where screen 18 puts "Include / exclude
  folders"; Settings has no folder list.
- **Bookmarks under Tools** (screen 25 is "Player settings" and draws none). Up to 100 per video. Deleting asks first,
  like P5's saved loops.
- **Strings:** a new `libraryStats` namespace (`catalogs/libraryStats.en.ts` / `.ur.ts`), so `videoPlayer.*` and
  `library.*` are untouched. "Unable to delete this download" is the Library's existing `library.deleteFailed`.
- **MMKV keys** `playerDisableHistory` and `libraryExcludedFolders` (both `.v1`) are added at the end of `mmkvKeys`.

### Files

- Logic (unit-tested): `src/library/play-count.ts`, `duration-buckets.ts`, `folder-exclusion.ts`, `query.ts` (Most
  played, the length filter, hidden folders), `types.ts` (`most_played`, optional `LibraryQueryInput` fields,
  `LibraryPlayCount`); `src/player/video-bookmarks.ts`, `quick-delete.ts`;
  `src/storage/repositories/library-stats.queries.ts`; `src/storage/sqlite/library-stats-schema.ts`;
  `src/playback/bind-playback-persistence.ts` (the `isHistoryPaused` gate).
- Storage: `src/storage/constants/database.ts` (v10, table names), `sqlite/schema.ts` (`applySchema`),
  `sqlite/migrations.ts` (the v10 block), `repositories/library-stats.repository.ts`, `constants/mmkv-keys.ts`.
- Runtime: `src/library/ensure-library-stats.ts` (+ two lines in `src/bootstrap/app-initializer.ts`),
  `library-stats-store.ts`, `src/player/video-bookmarks-store.ts`, `src/playback/history-pause-preference.ts`.
- Player: `src/player/options/p9-library-stats.ts` (+ one import in `index.ts`), `player-options.ts` (the optional `p9`
  field), `src/screens/player/page/use-player-library-stats.ts`, `VideoBookmarksSheet.tsx`, `BookmarkNameModal.tsx`,
  `components/TimelineBookmarkMarks.tsx`, `components/PlayerTimeline.tsx` and `page/PlayerCardOverlay.tsx` (optional
  `bookmarkMarkers`). In `PlayerScreen.tsx`: the fenced `// ── P9 Library stats & bookmarks ──` block, three imports,
  one token in `anyModalOpen`, one call in `onLock`, one context line, two timeline props and the two sheets.
- Library: `LibraryScreen.tsx` (the props, the folder sheet, the menu line), `hooks/useLibraryScreen.ts` (a fenced P9
  section, the query fields, Continue watching, `filterActive`, `controlsDirty`, Reset),
  `components/LibraryHeaderControls.tsx` (the length chip and sheet, the folder row, the sort label),
  `components/LibraryFolderVisibilitySheet.tsx`, `constants/library.constants.ts` (the sort option).
- Elsewhere: `src/screens/settings/components/PlayerSection.tsx` (the switch),
  `src/screens/downloads/DownloadDetailsScreen.tsx` (one line in Info) + `components/DownloadPlayCountRows.tsx`.
- Strings: 54 new `libraryStats.*` keys (English and Urdu), in a new catalog wired into `en.ts` / `ur.ts`.

### Gate

| Check | Result |
| --- | --- |
| `npm run typecheck` | 0 errors |
| Unit tests | 2352 / 2352 on `1ba7714` + P9 (2295 / 2295 before; 57 new: `library-stats.queries.test.ts` 14 — fresh install, a v9 upgrade with a row in all 21 tables, idempotent, not in a browser-profile database, play counts, bookmark operations; `play-count.test.ts` 14; `library-stats-query.test.ts` 13 — buckets and their boundaries, hidden folders, Most played, all combined; `video-bookmarks.test.ts` 5; `quick-delete.test.ts` 3; `history-pause.test.ts` 2; `options/p9-library-stats.test.ts` 6) |
| `npm run lint` | 0 errors; 91 warnings, none new (the two in `LibraryHeaderControls.tsx` / `useLibraryScreen.ts` are older) |
| Against `1ba7714` | `git diff --check` clean; none of Faran's files; nothing under `transfer/` or `engine/`; `package.json` / lockfile, `android/`, `modules/`, manifests, `app.json` unchanged; no new dependency or permission |
| Schema | `DATABASE_VERSION` 9 → 10, once; `BROWSER_PROFILE_DATABASE_VERSION` unchanged |
| Media3 | `1.9.0`, unchanged |
| Lengths backfill (after review) | JS: typecheck 0, lint 0 errors (91 older warnings), 2362 / 2362 tests (10 new: `length-backfill.test.ts` 7, `library-stats.queries.test.ts` +3 for the stored lengths, the column list updated). Gradle `:vidorax-media:compileDebugKotlin` BUILD SUCCESSFUL; `testDebugUnitTest` (DownloadRunnerTest left out locally): 1118 tests, 1114 passed, 2 failed (`StoragePathsTest`, `IncomingImportTest`: Windows path separators, already there before), 2 skipped; new `LengthProbeTest` 4 / 4 |

### Device checks for Faran (release build; not possible here)

1. **Upgrade.** Install the P8 build (database v9) with downloads, folders, bookmarks, notes, a saved page and a
   playlist, then this build: everything is still there. Check a fresh install too.
2. **Play count.** Watch a long video for 30 s (no seeking): Download details → Info says "Played · Once", and the
   Library's long-press menu line says "Played once". Open another and only seek around (less than 30 s actually
   played): no count. A 10 s clip played to the end counts; a seek to its end doesn't. 2× speed: counted after about
   15 s. Repeat one: one count per opening. Close into the mini player and keep watching: still one.
3. **Most played.** Library → Sort → Most played: the most-played first, never-played last; together with Favorites, a
   folder, a length and a search.
4. **Length filter.** The chip and its five choices; videos right at 5:00, 20:00 and 60:00. **Backfill:** on a library
   with older downloads, open the Library and wait a few seconds; their lengths fill in (5 at a time) without playing
   them, the Library stays smooth, and they are still there after a restart. A damaged file stays under Any length.
5. **Hidden folders.** Filter → Include / exclude folders: hide a folder and Unfiled; the Library, Most played, search
   and Continue watching leave them out; Folder → that folder still shows it; close and reopen the app: kept. Files and
   folder assignments are unchanged.
6. **Quick delete.** ⋮ → Tools → Delete video, in a queue: confirm → the next video plays, and the deleted one is gone
   from the Library and the queue. The last video in the queue (and a video opened alone): the Player closes, and no
   mini player stays. Cancel changes nothing. Hidden for a gallery video, a file from another app, a stream and a
   video still downloading.
7. **Disable History.** Turn it on (⋮ → Playback, or Settings → Player): watch a new video and an old one; Watch
   history, Continue watching, Home and play counts don't change, and the old video resumes from its earlier point.
   Turn it off: recorded again.
8. **Bookmarks.** Add with and without a name, in Urdu too; the list is by time; tap one to jump; rename (and clear the
   name); delete with the confirm. The dots on the card's bar and the full-screen dock, next to an A-B loop. Close and
   reopen: kept. Delete the video: its bookmarks go.
9. **TalkBack:** the bookmark rows (jump) and their ✎ / bin buttons are separate; the folder switches read the folder's
   name.
10. **Themes and Urdu.** All six themes, and Urdu (right to left): the length chip and sheet, the folder sheet, the
    bookmark sheet and name dialog, the confirms, the Settings row.

## P10 — Screenshot & edit tools (#675, #677, #678, #679, #680)

Built in its own worktree from `hamza/player` at P8 (`1ba7714`), on the local branch `wip/P10-edit-tools`, while P9
was built in parallel from the same base; it was cherry-picked on top of P9 (`d628a8a`) as `hamza/P10-edit-tools`.
**Its PR depends on P9 (`hamza/P9-library-stats`)**: P10 goes on top of it,
and both use the Tools section (P9 has 40–45 and 90, P10 has 50–70). **P10 adds native code** to the media module
(see Native code). It doesn't change the SQLite schema, and it adds no dependency or permission.

### MediaEditor: what it supports

What the Downloader's edits (#374 Trim, #376 Convert) already did, read from `library/MediaEditor.kt`,
`MediaEditService.kt`, `VidoraMediaModule.kt` (`getTrimStart`, `startEdit`, `getEditProgress`, `cancelEdit`),
`src/media-edit/edit-plan.ts`, `edit-job.ts`, `edit-port.ts` and `src/screens/media-edit/`:

- **Edit kinds** (`EditKind`): `trim` (a part, at least 1 s), `mp4` (Convert to MP4), `audio` (audio only, `.m4a`).
- **Track plans** (`TrackPlan`), one per track:
  - `copy`: transmuxed, no quality loss;
  - `h264`: the video re-encoded to H.264;
  - `aac`: the sound re-encoded to AAC;
  - `drop`: left out (the video of an audio-only edit; no sound).
- **Formats and codecs.** The output is always an MP4 container: `video/mp4`, or `audio/mp4` (`.m4a`) for audio only.
  - Video: H.264 or H.265 is copied, anything else is re-encoded to H.264.
  - Sound: AAC is copied, anything else is re-encoded to AAC.
  - A trim copies the video only when it starts on a keyframe. `getTrimStart` finds the keyframe at or before a
    position (`MediaExtractor`, `SEEK_TO_PREVIOUS_SYNC`), and the Trim screen offers "Keep the original quality" (start
    at that keyframe) or "Start exactly here" (re-encode).
- **Bitrate or resolution: not settable before P10.** The Transformer was built with its default encoder factory and
  no effects. P10 adds both, for Compress only (see Native code).
- **Progress:** 0…1 from `Transformer.getProgress`, polled every 500 ms (capped at 0.99 until the file is verified).
  JavaScript polls `getEditProgress()` every 500 ms (`edit-job.ts`).
- **Cancel:** `cancelEdit()` cancels the coroutine, and the edit rejects with `ERR_EDIT_CANCELLED`. Cancel in the edit's
  notification does the same. The partial file is always deleted.
- **One edit at a time**, app-wide: a native `AtomicBoolean` (`ERR_INVALID_STATE`), and one JavaScript job on
  `globalThis` (`edit-job-store.ts`).
- **Storage pre-check:** JavaScript checks `getStorageStats().freeBytes` against the estimate plus 64 MB
  (`hasRoomForEdit`). The native side checks again before writing: the part kept × 1.1 when copied, × 2 when re-encoded,
  plus 64 MB of free space in the work folder → `ERR_NO_SPACE`.
- **Error codes:**
  - `ERR_INVALID_STATE`: another edit runs.
  - `ERR_EDIT_REFUSED`: the verifier rejects the file, or it is protected, unreadable, of unknown length, has no sound
    (audio only) or no video.
  - `ERR_NO_SPACE`.
  - `ERR_EDIT_CANCELLED`.
  - `ERR_NOT_FOUND`: an unknown item, or its file is gone.
  - `ERR_INVALID_REQUEST`: an unknown kind or plan, plans that don't match their kind, a trim under 1 s.
  - `ERR_STORAGE`: the export failed or couldn't start, or the output didn't read back with the tracks and length asked.
- **Sources: library items only.** `MediaEditor.edit` reads `library.get(sourceId)`. A video on the device (MediaStore),
  a file another app opened (until it is saved with "Save to VidoraX" and opened from the Library) and a stream can't
  be edited.
- **Outputs:** always a **new file**, `files/library/<site>/<Safe title>_<short id>.mp4|.m4a` (`StoragePaths.newLibraryFile`,
  unique). It gets a thumbnail (video) and a new library row with the source's site and page, titled
  "<title> (<label>)" (`editOutputTitle`). `library.insert` announces it as `added`, **so it appears in the Library by
  itself**. The original file and its row are only read.
- **Long edits** (any conversion, a trim keeping 30 s or more) run with `MediaEditService` in the foreground, with
  progress and Cancel in a notification.
- **Where the Downloader opens them:** Download details → Edit (`src/screens/downloads/components/DownloadEditActions.tsx`:
  Trim → `/edit-trim?id=…`, Convert → MP4 / audio sheet, Title & artist) and Live convert
  (`screens/downloads/extras/live-convert/LiveConvertScreen.tsx`).

### What the user sees

| # | Feature | Where | How (evidence) |
| --- | --- | --- | --- |
| #675 | Screenshot | ⋮ → Tools → **Screenshot** (library videos, videos on this device, files from other apps; not streams, not audio) | Takes the frame at the moment playing with expo-video's `player.generateThumbnailsAsync(seconds)`, **without `maxWidth` / `maxHeight`**. In the installed expo-video 57.0.2 that is `MediaMetadataRetriever.getFrameAtTime(us, OPTION_CLOSEST)` on the player's own source (`node_modules/expo-video/android/.../MediaMetadataRetriever.kt`), so **the frame comes at the video's own decoded size**, not scaled (the size is in the dialog: "full size (1920 × 1080)"). The `VideoThumbnail` is a native `Bitmap` that JavaScript can't read. It is passed **by reference** (a `SharedRef<Bitmap>`) to the new `saveFrameToGallery`, which saves it as a JPEG (quality 92) in **Pictures/VidoraX** through **the Save-thumbnail path** (`ThumbnailExport`: MediaStore on Android 10+; the public folder and a media scan on 7–9). Then a dialog: "Screenshot saved … Share it?" → **Share** opens the share sheet (one private JPEG copy through the app's FileProvider, as subtitle files are shared). Subtitles aren't in the picture. Name: "<video title> 12m05.4s.jpg" (never the file's name; the Gallery keeps two apart). `src/screens/player/page/use-player-edit-tools.ts` (`screenshot`), `src/player/edit-tools.ts` (`canScreenshot`, `screenshotTitle`), `src/media-edit/player-tools-port.ts`, native `library/ThumbnailExport.kt` (`saveFrame`), `library/FrameExport.kt`. |
| #677 | Trim Video | ⋮ → Tools → **Trim video** (library videos) | Pauses the video, leaves full screen and opens the **Downloader's Trim screen** with `startMs` = the moment playing. The range starts there and ends at the video's end, kept valid by `clampTrimRange` (at least 1 s; near the end the start moves back). The preview starts at the same place. Everything else is the Trim screen as it is: handles, "Set start / end here", keyframe or exact start, progress and Cancel, Save trimmed copy, back to the Player when done. `edit-tools.ts` (`trimRangeFromPosition`, `parseTrimStartParam`), `src/screens/media-edit/TrimScreen.tsx` (optional `startMs`; without it nothing changes). |
| #678 | Extract Audio | ⋮ → Tools → **Extract audio** (library videos) | The `audio` edit at once: the sound alone as a new `.m4a` (AAC copied, other sound re-encoded to AAC), "<title> (audio)". A video with no sound: "This video has no sound". Progress sheet (below). `src/media-edit/player-edit-run.ts`. |
| #679 | Video Converter | ⋮ → Tools → **Video converter** (library videos) | The Downloader's Convert choices in a sheet: **MP4 video** (H.264 / H.265 kept, anything else re-encoded to H.264; AAC sound) or **Audio only (.m4a)**. A choice that doesn't apply says why ("Already an MP4 that plays everywhere"). `page/VideoConverterSheet.tsx`. |
| #680 | Compress Video (new) | ⋮ → Tools → **Compress video** (library videos) | A sheet with **High / Medium / Small**, each with **the output's resolution and estimated size before anything starts** ("720p · about 162.8 MB"), and the video's size now ("Now: 572.2 MB · 1080p"). A preset that wouldn't save 10 % is greyed: "Not smaller than the original". Tap one to start. The new `compress` edit re-encodes the video to H.264 at the preset's bitrate and scales it down (never up); the sound is copied when it is AAC. "<title> (compressed)". `src/media-edit/compress-plan.ts`, `page/CompressVideoSheet.tsx`; native `library/CompressPlan.kt`. |
| all | Progress, Cancel, storage, pause | The edit's sheet | Every edit **writes a new file and never changes or deletes the original**. Before it starts: the item is still in the library, the edit makes sense, and there is room (`hasRoomForEdit`: the estimate + 64 MB; Compress needs its estimate + 10 % + 64 MB, as the native check, not twice the original). Then **the video is paused** and the sheet shows **Extracting audio / Converting to MP4 / Compressing** with the Downloader's `EditJobBanner` (progress %, **Cancel edit**, keep VidoraX open) and **Hide**. **While it runs the Player keeps the video paused**: play again and it pauses with "Paused while the edit runs". The edit rows show its progress and reopen the sheet. One edit at a time, also against an edit started in Download details ("Another edit is running"). The end is announced: "Saved as a new item in Player" (it is in the Library at once), "Edit cancelled. Nothing was saved.", "Not enough free space for this edit." (`ERR_NO_SPACE` too), "The edit failed. The original is unchanged." `player-edit-run.ts` (`runPlayerEdit`, `playerEditMessageKey`), `page/EditProgressSheet.tsx`, `use-player-edit-tools.ts` (the pause hold, `shouldHoldPause`). |

### Compress presets and the size estimate

| Preset | Video | Short side at most | Sound |
| --- | --- | --- | --- |
| High | H.264, 4 Mbit/s | 1080 (1080p) | AAC copied, or re-encoded |
| Medium | H.264, 2 Mbit/s | 720 (720p) | same |
| Small | H.264, 1 Mbit/s | 480 (480p) | same |

- **Estimated size** = ⌈(video bitrate + 128 kbit/s for the sound) × length in seconds ÷ 8 × 1.02⌉ bytes. The 1.02 is
  the MP4 container. Without sound the 128 kbit/s is left out.
  - Example: 10 minutes at Medium = (2 000 000 + 128 000) × 600 ÷ 8 × 1.02 = 162 792 000 bytes (162.8 MB).
  - The same operations run in JavaScript (`compressEstimateBytes`) and Kotlin (`CompressPlan.estimateBytes`), checked
    with the same numbers in both test files.
- **Offered** when the estimate is at most 90 % of the original's size; otherwise greyed.
- **Never scaled up.** The short side shrinks to the preset's only when it is bigger (`Presentation.createForShortSide`,
  which keeps portrait video portrait). A 480p video at Medium keeps 480p and only gets the lower bitrate.
- The encoder may land a little off the target (the platform's encoders, VBR), so the sheet says "about" and notes
  that sizes are estimates.

### Native code

P10 adds Kotlin to `modules/vidorax-media` only, with nothing in `transfer/` or `engine/`. It uses only
`media3-transformer` 1.9.0, already a dependency, and `media3-effect` 1.9.0, which comes with it.
`gradle :vidorax-media:dependencies --configuration debugCompileClasspath` lists
`androidx.media3:media3-effect:1.9.0` under `media3-transformer:1.9.0`. `build.gradle` is unchanged.

| File | New / changed | What |
| --- | --- | --- |
| `library/CompressPlan.kt` | **new** | `CompressSettings` (bitrate, short side), `settings()` (checks 100 kbit/s – 50 Mbit/s and 144 – 4320 px → `ERR_INVALID_REQUEST`), `scaledShortSide` (down only), `estimateBytes` (as JavaScript), `encoderFactory` (`DefaultEncoderFactory` + `VideoEncoderSettings.setBitrate`), `effects` (`Presentation.createForShortSide`). |
| `library/FrameExport.kt` | **new** | Screenshot's Share: writes the frame as one private JPEG, `files/library/.frame-exports/<title>.jpg` (only the latest kept), and opens the share sheet through the module's FileProvider (`SubtitleExport.share`). |
| `library/MediaEditor.kt` | changed, additive | `EditKind.COMPRESS("compress")`; an optional `EditRequest.compress` and `EditRequestRecord.videoBitrate` / `maxShortSide` (with defaults). `toModel()` requires `video = h264` and valid settings for compress. Three one-line hooks run only when `request.compress` is set: the space estimate (bitrate × length), `builder.setEncoderFactory(...)` and `setEffects(...)`. `kinds()` lists the kinds. Trim, MP4 and audio take exactly the paths they took before. |
| `library/ThumbnailExport.kt` | changed, additive | `saveFrame(bitmap, title)`: the Save-thumbnail path (`publish` / `writeLegacy`) for a frame. It never recycles the bitmap, which belongs to expo-video. |
| `VidoraMediaModule.kt` | changed, additive | `saveFrameToGallery(frame: SharedRef<Bitmap>, title)`, `shareFrame(frame, title)`, `getEditKinds()`. |
| `test/.../library/CompressPlanTest.kt` | **new** | 9 Robolectric tests: the request checks, kinds, scaling down only (portrait too), the effects, the estimate (same numbers as JavaScript), and that the encoder factory asks for an encode (`videoNeedsEncoding()`). |
| `test/.../library/FrameExportTest.kt` | **new** | 3 Robolectric tests (native graphics): the share copy is a JPEG at the frame's full size (1920 × 1080 in, 1920 × 1080 out), only the latest copy stays, the title can't make a path, a released frame is refused (also by `saveFrame`), and the bitmap is never recycled. |

**How the frame reaches Kotlin:** a JavaScript shared object (expo-video's `VideoThumbnail`) passed as an argument is
turned into its id by `SharedObjectIdConverter` (`expo-modules-core/android/src/main/cpp/types/FrontendConverter.cpp`,
it reads `__expo_shared_object_id__`). Then `SharedRefTypeConverter` (`kotlin/sharedobjects/SharedObjectTypeConverter.kt`)
looks it up in the app's one shared-object registry and checks that its ref is a `Bitmap`. expo-image takes its own
`Image` refs as `AsyncFunction` arguments the same way (`generateBlurhashAsync`). One module handing another its
object has not been run here: device check 1.

**Why a requested bitrate is enough to force an encode:** `javap` on `media3-transformer-1.9.0` shows
`DefaultEncoderFactory.videoNeedsEncoding()` returning `requestedVideoEncoderSettings != VideoEncoderSettings.DEFAULT`,
and `TransformerUtil.shouldTranscodeVideo` re-encodes when that is true. So an H.264 source isn't simply copied.

### Decisions

- **Compress is a new edit kind in MediaEditor** rather than a separate class. It then gets the one-edit lock, the
  progress, Cancel, the notification (`MediaEditService` reads `MediaEditor.progress()`), the output check and the new
  library row for free. What it changes lives in the new `CompressPlan.kt`.
- **The presets** (4 / 2 / 1 Mbit/s at 1080p / 720p / 480p) are my choice; the checklist names no numbers.
- **The sound in Compress** is copied when it is AAC and re-encoded otherwise, as in Convert. Asking for an audio
  bitrate would re-encode AAC as well, so it isn't set; the estimate counts 128 kbit/s.
- **"Not offered" below a 10 % saving**, so Compress never makes a copy that isn't smaller.
- **The screenshot is saved as a JPEG at quality 92**, the same as Save thumbnail, through that same code. A PNG would be
  lossless but about ten times bigger. The numbers to change: `ThumbnailExport.JPEG_QUALITY` (the Gallery copy, shared
  with Save thumbnail) and `FrameExport.JPEG_QUALITY` (the share copy).
- **Share copies the frame into a private file** instead of sharing the Gallery item: on Android 7–9 the media scan
  can return a `file://` URI, which Android refuses to share. It is the share path subtitle files already use.
- **Pause while an edit runs:** paused when it starts, and paused again (with a toast) if anything plays a video in
  the full Player while an edit started there runs. The editor and the player would share the phone's video decoders.
  The mini player isn't held. `shouldHoldPause` is the one place to change this.
- **The editors are hidden, not greyed**, where they can't work: videos on this device, files from other apps (until
  "Save to VidoraX" and opened from the Library), streams, audio files, a download still being played from its partial
  file. Within a library video, a choice that doesn't apply says why when pressed, as in the Downloader.
- **Extract audio starts at once**, like Convert → Audio only in Download details; Video converter shows the same two
  choices, so audio is reachable from both rows.
- **Strings:** 33 new `videoPlayer.*` keys, English and Urdu, at the end of both catalogs. The messages after an edit
  reuse the Downloader's `mediaEdit.*` strings, and the permission message reuses `thumbnailSave.needsPermission`.
  "720p" is built in code (`compressResolutionLabel`), not translated.
- **Icons:** camera, scissors, music, refresh-cw, archive (existing design-kit names).

### Files

- Logic (unit-tested, pure): `src/media-edit/compress-plan.ts`, `src/media-edit/player-edit-run.ts`,
  `src/player/edit-tools.ts`; `src/media-edit/edit-plan.ts` (`EditKind` + `compress`, two branches).
- Ports and state: `src/media-edit/player-tools-port.ts` (frame export, `getEditKinds`, the edit's origin).
- Screen: `src/screens/player/page/use-player-edit-tools.ts`, `PlayerEditToolsSheets.tsx`, `VideoConverterSheet.tsx`,
  `CompressVideoSheet.tsx`, `EditProgressSheet.tsx`. `PlayerScreen.tsx`: one fenced P10 block, plus `anyModalOpen`,
  `onLock`, `optionsContext.editTools` and the sheets at the end.
- Reused, changed additively: `src/screens/media-edit/TrimScreen.tsx` (optional `startMs`),
  `src/screens/media-edit/useRunEdit.ts` (one label for `compress`).
- Options: `src/player/options/p10-edit-tools.ts` (+ one import line), `player-options.ts` (optional `editTools`).
- Types: `modules/vidorax-media/src/VidoraMedia.types.ts` (`EditRequest.kind` + `compress`, `videoBitrate`,
  `maxShortSide`; `saveFrameToGallery`, `shareFrame`, `getEditKinds`).
- Native: see Native code.
- Strings: `src/localization/catalogs/videoPlayer.en.ts` / `.ur.ts`, 33 keys.

### Gate

| Check | Result |
| --- | --- |
| `npm run typecheck` | 0 errors |
| Unit tests (JS) | 2402 / 2402 on top of P9 with its lengths backfill (2392 / 2392 before the backfill), the whole stack P1–P10 (2335 / 2335 on P8 `1ba7714` alone, 2295 before; 40 new: `media-edit/compress-plan.test.ts` 12, `player/edit-tools.test.ts` 13, `media-edit/player-edit-run.test.ts` 10, `player/options/p10-edit-tools.test.ts` 5). `row-revision.test.ts` passed in the full run |
| `npm run lint` | 0 errors; 91 warnings, none in a file P10 changed |
| Gradle `:vidorax-media:compileDebugKotlin` | BUILD SUCCESSFUL (Windows, JDK 17) |
| Gradle `:vidorax-media:testDebugUnitTest --continue` | As expected on Windows, the test compile fails on `DownloadRunnerTest` (a backtick name with `"` is not a legal class-file path). Run again with only that file left out of the test compile (an init script in the scratchpad, not committed): **1126 tests, 1121 passed, 3 failed, 2 skipped**. **New: `CompressPlanTest` 9 / 9, `FrameExportTest` 3 / 3**; `MediaEditorTest` 6 / 6, `MediaEditServiceTest` 4 / 4. The 3 failures are Windows-only, in code P10 doesn't touch: `StoragePathsTest.storedPathsAreRelativeToFilesDir` and `IncomingImportTest.aFileIsCopiedIntoTheLibraryUnderDevice` (both expect `/` in a path; line 113 checks `"/library/device/"`), and `HlsTransferTest.pausedAndResumedThreeTimesInParallelIsByteIdenticalToAnUninterruptedDownload` (`AccessDeniedException`: Windows can't replace a checkpoint file that's still open; in `transfer/`) |
| Gradle, re-run on the stacked branch (P1–P10, `c3cee83`) | `compileDebugKotlin`: BUILD SUCCESSFUL. `testDebugUnitTest` (same init script): 1126 tests, 1121 passed, 3 failed, 2 skipped; `CompressPlanTest` 9 / 9, `FrameExportTest` 3 / 3, `MediaEditorTest` 6 / 6, `MediaEditServiceTest` 4 / 4. Failures: `StoragePathsTest` and `IncomingImportTest` (Windows paths, as above) and `ParallelTransferTest.withTheWriteCacheOnEveryPartStillLandsExactlyAndAPauseClaimsOnlyWhatIsOnDisk` (`Required value was null`, in `transfer/`); that suite passes 25 / 25 run on its own, and `HlsTransferTest` passed this time: the transfer tests are timing-sensitive on Windows, and P9 / P10 don't touch `transfer/` |
| Gradle, on the stack rebuilt on P9's lengths backfill (P1–P10, `3f114d2`) | `compileDebugKotlin`: BUILD SUCCESSFUL. `testDebugUnitTest` (same init script): 1130 tests (P9's `LengthProbeTest` 4 added), 1127 passed, 3 failed, 2 skipped; `CompressPlanTest` 9 / 9, `FrameExportTest` 3 / 3, `LengthProbeTest` 4 / 4, `MediaEditorTest` 6 / 6, `MediaEditServiceTest` 4 / 4. Failures: `StoragePathsTest`, `IncomingImportTest` (Windows paths) and `DownloadEngineLiveTest.aRecordingInterruptedByAProcessDeathIsFinalizedOnTheNextStart` (in `engine/`, untouched), which passes 8 / 8 run on its own: one more timing-sensitive test on Windows |
| Against `1ba7714` | `git diff --check` clean; none of Faran's files; nothing in `transfer/` or `engine/`; `package.json` / lockfile, `build.gradle`, manifests and `app.json` unchanged; no new dependency or permission; no SQLite change (`DATABASE_VERSION` still 9) |
| Media3 | `1.9.0`, unchanged |

### Device checks for Faran (release build; not possible here)

1. **Screenshot, full size:** first, that saving works at all (expo-video's frame handed to VidoraMedia's
   `saveFrameToGallery`: "Screenshot saved to Gallery", not "Couldn't save the screenshot"). Then a 1080p and a 4K
   library video, paused and playing. The dialog shows the video's size
   (1920 × 1080 / 3840 × 2160), and the picture in Gallery → Pictures/VidoraX is that size and is the frame on screen
   (OPTION_CLOSEST). A **portrait phone recording** (rotation metadata) comes out upright. Two screenshots of the same
   second are both kept.
2. **Screenshot sources:** a video on this device and a file opened from another app (Files → Open with VidoraX) both
   work. A stream and an audio file have no Screenshot row. Library files whose names have spaces or Urdu letters work
   (expo-video opens `file://` paths as the seek preview does).
3. **Screenshot on Android 9 or older:** the storage permission is asked once; refusing gives "Allow storage access to
   save to the Gallery".
4. **Share:** Share opens the share sheet with the JPEG, and WhatsApp / Gmail / Quick Share receive it. Done closes the
   dialog.
5. **Trim video** from 1:23 in full screen: the Player leaves full screen and pauses; the Trim screen's range starts at
   1:23 and its preview shows 1:23. Keyframe / exact choices, Save, Cancel. Back returns to the Player. The trimmed copy
   is in the Library.
6. **Extract audio:** the progress sheet, then "Saved as a new item in Player". The `.m4a` plays. A video without sound
   says "This video has no sound".
7. **Video converter:** a WebM / VP9 video → MP4 (re-encoded); an H.264 MP4 says "Already an MP4 that plays
   everywhere"; Audio only works.
8. **Compress:** a 1080p video at High / Medium / Small. The sizes in the sheet against the files made (expect within
   about ±15 %), the resolution (1080p / 720p / 480p; a 720p source at High stays 720p), a portrait video stays portrait.
   A low-bitrate video greys High ("Not smaller than the original"). The copy plays, with sound.
9. **Cancel** during each edit (in the sheet, and in the notification): "Edit cancelled. Nothing was saved."; no partial
   file appears in the Library.
10. **Low storage:** fill the phone so that less than the estimate + 64 MB is free (Compress: its estimate + 10 % +
    64 MB): "Not enough free space for this edit." before anything starts.
11. **The pause hold:** during an edit, press play (button, double tap, headset): the video pauses again with "Paused
    while the edit runs". Hide the sheet; the edit rows show "45%" and reopen it. After the edit ends, play works.
12. **One at a time:** start an edit in Download details, then try one in the Player: "Another edit is running".
13. **The rows' visibility:** library video (all five), video on this device and file from another app (Screenshot
    only), stream and audio file (none), an unfinished download played from its partial file (Screenshot only).
14. **Long edits in the background:** a 30-minute compress with VidoraX in the background (the notification, Cancel
    there).
15. **Six themes and Urdu:** the Compress sheet, the progress sheet, the converter sheet and the dialog. TalkBack reads
    the presets with their sizes.

## P11 — Privacy & backup (#686, #689, #700)

Built from `hamza/P10-edit-tools` (`4ea8612`, P1–P10) in its own worktree, on the local branch `wip/P11-privacy`, while
P9's duration backfill and P12 were built in parallel. **Its PR depends on P10's PR.** **No SQLite change, no native
code**, no new dependency, permission, manifest or `build.gradle` line; none of Faran's files. Everything is a service
outside the Player (`src/privacy/`, `src/backup/`) that the Player, the Library and Settings call, so the File Manager's
Secure Vault (#908) and Backup (#930) can use it later.

### What existed before P11

- **Private (Downloader H21, #459 / #460 / #463 / #413).** Native `library/PrivateVault.kt`: `moveIn` encrypts a
  library item into `noBackupFilesDir/vault` (AES-256-GCM per file, with a per-file key sealed by an Android Keystore
  master key), verifies the copy (every chunk authenticated, the same SHA-256 as the source) and only then commits it;
  `list`, `thumbnail`, `openForPlayback` (one decrypted temp file in `cacheDir/vault-play`), `clearPlayback`,
  `cleanUp`, `delete`, `exportToGallery` (Movies/VidoraX) and `exportToFolder`. The vault keeps **its own random ids**
  and never the library id. JavaScript (`src/private-vault/*`): `moveToPrivate` (encrypt → delete the original through
  the app's delete path → forget the stored playback position; a copy too many rather than none if the delete can't be
  confirmed), `vault-gate.ts` (the section relocks on every leave and background), `data-loss.ts`, `gallery-copy.ts`
  ("Also remove the Gallery copy", off by default), `vault-export.ts`. Screens `src/screens/private/*`:
  `PrivateScreen` (asks for the App Lock PIN every time, `PrivatePinGate` with the biometric option), the list with
  Play, Export to Gallery, Export to folder and Delete, its **own player** (`VaultPlayerModal`, not the app's Player:
  no position, history, mini player, PiP or notification), and `PrivateMoveDialog` (App Lock check, the data-loss
  notice on every move and "I understand" before the first). Entry: the Library's header lock button and its
  long-press "Move to Private". **It already encrypts; P11 adds no encryption and removes none.**
- **The secure window (B11 #106).** `modules/vidorax-web/.../security/SecureWindow.kt` sets `FLAG_SECURE` on the
  activity's window; JavaScript calls `VidoraWeb.setWindowSecure(secure)`; incognito called it directly from
  `applySecure`. The native side keeps **one owner** (`ownsFlag`): a "clear" from anyone clears it.
- **Settings Backup (#471).** `src/store/settings/backup.ts` (`vidorax.settings` v1: `SettingsState` only, validated
  key by key), Settings → Backup & reset → Export / Import settings (`useSettingsBackupReset.ts`,
  `importSettingsValues`), through `exportTextFile` / `importTextFile` inside `withExpectedSystemScreen`. B20's
  browser backup (`vidorax.backup`) is separate.

### What the user sees

| # | Feature | Where | How (evidence) |
| --- | --- | --- | --- |
| #686 | Move to Private from the Player | Player: ⋮ → Tools → **Move to Private** (85) | Library videos only: a finished download the native library keeps (`canMoveMediaToPrivate`: not `device:` videos, files from other apps, streams, or a build without the vault). It opens **Private's own move dialog** (`usePrivateMove` + `PrivateMoveDialog`, reused): without App Lock it offers to set it up; the confirm always shows the data-loss notice ("If VidoraX is uninstalled or its data is cleared, they are lost for good") and **the first move needs "I understand" ticked**; "Also remove the Gallery copy" when there is one. **The video pauses when the move starts.** Then, as P9's Quick Delete, the next video in the queue plays (`queueNeighbours`), or the Player closes with its session. Evidence: `src/screens/player/page/use-player-private-move.ts`, `src/player/options/p11-privacy.ts`, `src/privacy/private-folder.ts` (`canMoveMediaToPrivate`), `PlayerScreen.tsx` (one P11 block). |
| #686 | Hidden everywhere | — | What the move already removed, and what P11 adds, is in the next table. One choke point: H21's `forgetHistory` now also calls `hidePrivateTracesNow` (`src/privacy/private-traces.runtime.ts`), so **a move from the Library gets the same**. Evidence: `src/privacy/private-traces.ts`, `private-media-guard.ts`, `src/player/playback-events.ts` (one `if`), `src/playback/bind-playback-persistence.ts` (`dropPlaybackSessionFor`). |
| #686 | Move out of Private | Private → ⋮ on a video → **Move out of Private** (before Delete) | A confirm, then **a copy to the Gallery first** (the existing export, with its storage prompt on Android 9 and older), and **only after it was saved is the private copy deleted**. A cancelled, refused or failed copy leaves the private copy as it was; copied but not deleted says "It was saved to your Gallery, but couldn't be removed from Private". An item whose key was lost can only be deleted (no Move out). The video lands in **Movies/VidoraX**: VidoraX lists it under Device videos (`DeviceVideos.kt` lists every
MediaStore video it may read, its own folder included; with Android 14's "selected videos only" it must be
selected); it doesn't return to the Downloads library, and its play count and bookmarks don't come back (they were forgotten on the way in). Evidence: `src/privacy/private-folder.ts` (`moveOutOfPrivate`, `privateFolderItemActions`), `private-folder.runtime.ts`, `src/screens/private/PrivateVaultList.tsx`. |
| #686 | Open only through App Lock; warning before the first move | Private | Unchanged and reused: `PrivateScreen` → `PrivatePinGate` (PIN, or fingerprint / face when App Lock's biometric unlock is on), every time it opens; `PrivateMoveDialog`'s data-loss notice and "I understand". |
| #689 | Block Screen Capture | Settings → Privacy → **Block screenshots in Private** (off by default) | With it on, **no screenshots, no screen recording and a blank recent-apps preview while a Private screen is in front**: its PIN gate, its list, its dialogs and its own player of a private video. Not app-wide, not other videos (the checklist row says "private videos"). Held from the screen's **focus** until it loses focus (`useFocusEffect`), not from unlock: React Native 0.86's `ReactModalHostView` copies `FLAG_SECURE` into a dialog's window only when the dialog is created (read in `node_modules/react-native/.../modal/ReactModalHostView.kt`), so the flag must be on before `VaultPlayerModal` or a confirm opens; and the app going to the background doesn't release it, so the recents picture taken then is blank. **The API is B11's `VidoraWeb.setWindowSecure`**, through a new arbiter: owners `incognito` and `private-folder`, secure while either holds it, the native call made only when the answer changes. Incognito's `applySecure` now calls the arbiter instead of the native function (one line), so neither clears the flag under the other. MMKV `privacyBlockScreenCapture`. Evidence: `src/privacy/secure-window.ts`, `secure-window.runtime.ts`, `screen-capture-preference.ts`, `use-private-folder-capture-block.ts`, `PrivateScreen.tsx` (one line), `src/browser/incognito/incognito.service.ts`, `src/screens/settings/components/BlockScreenCaptureRow.tsx`. |
| #700 | Back up all data | Settings → Backup & reset → **Back up all data** | One JSON file, `vidorax-all-data-<date>.json`, saved in a folder the user picks or shared (the existing `exportTextFile`). What is in it and what never is: "The backup file" below. Evidence: `src/backup/backup-format.ts`, `backup-preferences.ts`, `user-data.queries.ts`, `backup.service.ts`, `src/screens/settings/backup-reset/FullBackupRows.tsx`. |
| #700 | Restore from backup | Settings → Backup & reset → **Restore from backup** | The file is read first and nothing is written: **a preview** lists each section with its count ("Playlists: 3 (41 videos)", "Video bookmarks: 12", "Play counts: 30 videos", settings, Player and Library choices, saved loops, hidden folders), when it was made, and what is never in a backup. **Merge** or **Replace** (or Cancel), then **a confirm** that says what each deletes (Replace is red). A **file from a newer VidoraX is refused** ("Update VidoraX to restore it"); an older Settings Backup file restores its settings; B20's browser backup is sent to the browser's own restore. Evidence: `useFullBackup.ts`, `BackupPreviewModal.tsx`, `backup-restore.ts`, `backup.service.ts` (`restoreAppBackup`). |

### What is hidden where, for a private video

| Place | Before P11 (H21's move) | P11 |
| --- | --- | --- |
| Library list, Downloads, favourites, search | Gone with the library row and the download record (`deleteCompletedFileFromVidoraX`) | Unchanged |
| Watch history, Continue watching, resume | The stored position deleted once | Deleted again after the session is dealt with, **and the session's later events are dropped** (`emitPlaybackEvent` skips ids in `private-media-guard`), **and the coordinator's in-memory session is dropped** (`dropPlaybackSessionFor`). Without that, the next video's start wrote the moved one back (`flushSync('media_change')`; a test shows the gap and the fix) |
| P9 play counts and Most played | Forgotten by P9's listener on the library's "deleted" event | Also forgotten by the move itself, and **no play can be counted after it** (its events are dropped) |
| P9 video bookmarks | Same listener | Also forgotten by the move |
| P7 playlists | **Kept, shown by title as a missing entry** | Taken out of every playlist (`playlistIdsWith` / `removeItem`), silently; open playlist screens reload |
| P6 play queue | **Kept** | Taken out; as the current one, the queue forgets it (the full Player moves on first, as Quick Delete) |
| P5 saved loops, P2 fit, P3 subtitle choices and loaded subtitle copies | **Kept** (per video, MMKV) | Removed (`restoreSavedLoopRecords`, `setVideoFit(…, 'fit')`, `updateVideoSubtitleRecord(…, EMPTY, picked copies)`) |
| H12 tags and notes, artist tag | Forgotten by their listeners | Also forgotten by the move |
| The mini player playing it | Played on with a deleted file | Stops (only when no full Player shows it) |
| The phone's Gallery (and VidoraX's Device videos, which lists every MediaStore video, Movies/VidoraX included) | The Gallery copy stays unless "Also remove the Gallery copy" is ticked (off by default) | **Unchanged: not met by default** — the box is offered in the Player too; see Decisions |
| Backups | — | Never: P11's backup has no Private section, and the moved video's rows are gone before any backup |

### The backup file

`{"format": "vidorax.appBackup", "version": 1, "exportedAt": "…", "sections": {…}}`, pretty-printed JSON.

| Section | What | From |
| --- | --- | --- |
| `settings` | Exactly what Settings Backup (#471) carries, written by `settingsBackupJson`, read back by `parseSettingsBackup` | `SettingsState` |
| `preferences` | An **explicit allow-list** of MMKV keys, each through its own package's normalizer: P1 duration label, seek step; P2 fit per video, notch area, info overlay; P3 / P4 per-video subtitle choices (track, second track, sync offset — **without the subtitle files and their paths**), auto-detect, subtitle style; P5 End of Playback, saved A-B loops; P6 Auto Play Next, Next Episode Prompt; P8 gestures, custom controls; P9 Disable History, hidden folders; the Library's list / grid; P11 Block screenshots in Private | `BACKUP_PREFERENCES` in `backup-preferences.ts` |
| `playlists` | P7 playlists with their videos (id, name, dates; per video: media id, position, the title and file name kept when added, length, date added) | `playlists`, `playlist_items` |
| `videoBookmarks` | P9 (id, media id, position, name, date) | `video_bookmarks` |
| `playStats` | P9 (media id, count, last played) | `media_play_stats` |

**Never in it** (`NEVER_IN_BACKUP`, and a test that no key or value in a file matches App Lock / vault words): media
files; anything of Private (its videos, names, ids, where they are; `vidorax.privateVault.v1`); App Lock (the PIN
and recovery code are in SecureStore, `vidorax.appLock.v1`, never read; fingerprint unlock `vidorax.appLockBiometric.v1`);
the play queue (what is playing now); first-run and migration flags; the downloads and the library themselves; the
browser's data (B20 has its own backup). The theme isn't in it either, as in Settings Backup.

**Versions.** Version 1. A higher version is refused, never half-read. A version below 1, a non-integer, a missing
`sections`: "isn't a VidoraX backup". A Settings Backup file (`vidorax.settings` v1) is the older version: read as a
backup with settings only (the preview says so); one of its newer versions is refused too. Everything in a file is
checked (ids, names by P7's rules, dates, counts, 100 bookmarks per video, 20 MB at most); unknown sections and keys
are ignored, never applied.

**Merge and Replace**

| | Merge | Replace |
| --- | --- | --- |
| Settings | The file's values | The file's values; every other backed-up setting back to its default; the language kept unless the file has one (as Reset Settings) |
| One-value choices | The file's | The file's, or the default when the file lacks it |
| Fit per video | The file's for the videos it names, the phone's for the rest | The file's list |
| Saved loops | The phone's plus the file's it lacks (same id, or same A and B, is the same loop) | The file's |
| Subtitle choices | The file's choice and offset for the videos it names; a subtitle file chosen on the phone stays chosen | The same for the named videos; other videos lose their choices; **subtitle files are never deleted by a restore** |
| Hidden folders | Both lists | The file's |
| Playlists | Same id, else same name (case aside) = the same playlist: the file's videos it lacks go at its end; others are added with their own dates | Every playlist and its videos replaced by the file's |
| Video bookmarks | Added unless the phone has the id, or one at the same moment of the same video, or the video has 100 | Replaced by the file's |
| Play counts | The higher count and the later date (never the sum) | Replaced by the file's |

Both: a section the file doesn't have is left alone; nothing of App Lock or Private is touched; **merging the same file
twice changes nothing the second time**. The database part runs first, in one transaction: if it fails, nothing at all
was changed. Then each preference through its own setter (the stores read MMKV only at start, so writing MMKV alone
would leave the screens stale and the next change would write the old list back), then the settings through
`importSettingsValues`.

### Schema

**No change.** `DATABASE_VERSION` stays 10. The backup reads and writes P7's and P9's tables with named columns only;
nothing about privacy is stored in SQLite (the vault keeps it, and the moved-ids guard is memory only).

### Native code

**None.** The secure window is B11's existing `setWindowSecure`; the vault's existing functions do everything else.
Gradle wasn't run (no Kotlin changed).

### Decisions

- **Block Screen Capture covers the Private Folder only** (its screens and its own player), because #689 says
  "private videos". The app's Player never plays a private video (the vault plays in `VaultPlayerModal`, inside the
  Private screen), so the route's hold covers "the Player while it plays a private video". `isPrivatePlaybackUri` is
  there for a later caller (the File Manager) that would hand a vault file to another player.
- **Move out goes to the Gallery**, not back into the Downloads library: there is no native "back into the library"
  call, and adding one needs `VidoraMediaModule.kt`, which is being changed in parallel. **Stopped there** — for a
  real "back to the library", `PrivateVault.kt` would need a `moveOut(vaultId)` that decrypts into
  `StoragePaths.newLibraryFile` and inserts a `LibraryStore` row (title, mime type, length, size from its metadata),
  plus one `AsyncFunction` in `VidoraMediaModule.kt`.
- **"Is private" for a library id** can only be told for ids moved in this run: the vault never keeps the library id
  (H21's design), and P11 doesn't add a lasting map. After a restart such an id exists nowhere.
- **"Also remove the Gallery copy" stays off by default**, as H21 has it: deleting a public Gallery item is outside
  VidoraX and needs Android's own consent dialog on Android 11+. With it off, the Gallery copy stays visible in the
  phone's Gallery (and in Device videos). Faran may want it on by default for #686.
- **Trailing events are dropped where they are sent** (`emitPlaybackEvent`), one `if` that covers both listeners
  (Watch history and play counts), instead of a gate in each listener; `ensure-library-stats.ts` isn't touched.
- **The backup wraps Settings Backup** rather than replacing it: the settings section is Settings Backup's own format
  and checks, Export / Import settings stay as they are, and a Settings Backup file restores in the new restore.
- **The play queue isn't backed up** (it is what is playing now, not a choice). **The theme isn't** either, as in
  Settings Backup.
- **Replace keeps the phone's subtitle files**: a backup can't carry them, and deleting them would lose them for good.
- **Strings:** 45 new keys in a new namespace `privacyBackup` (English and Urdu), wired at the end of `en.ts` /
  `ur.ts`. The Player row and its dialogs reuse `privateVault.*`.

### Files

- Privacy (pure, tested): `src/privacy/private-folder.ts`, `private-traces.ts`, `private-media-guard.ts`,
  `secure-window.ts`.
- Privacy (app side): `private-folder.runtime.ts`, `private-traces.runtime.ts`, `secure-window.runtime.ts`,
  `screen-capture-preference.ts`, `use-private-folder-capture-block.ts`.
- Backup (pure, tested): `src/backup/backup-format.ts`, `backup-preferences.ts`, `backup-restore.ts`,
  `user-data.queries.ts`. App side: `user-data.repository.ts`, `apply-preferences.runtime.ts`, `backup.service.ts`.
- Screens: `src/screens/player/page/use-player-private-move.ts`; `src/screens/settings/components/BlockScreenCaptureRow.tsx`;
  `src/screens/settings/backup-reset/FullBackupRows.tsx`, `BackupPreviewModal.tsx`, `useFullBackup.ts`.
- Changed, additively: `PlayerScreen.tsx` (one fenced P11 block, plus `anyModalOpen`, `onLock`,
  `optionsContext.privacy` and the dialog at the end); `src/screens/private/PrivateScreen.tsx` (one hook line),
  `PrivateVaultList.tsx` (Move out); `src/private-vault/move-to-private.runtime.ts` (one call in `forgetHistory`);
  `src/player/playback-events.ts` (one `if`); `src/playback/bind-playback-persistence.ts` (`dropPlaybackSessionFor`);
  `src/player/repeat-preference.ts` (`getSavedLoopRecords`, `restoreSavedLoopRecords`);
  `src/browser/incognito/incognito.service.ts` (`applySecure` through the arbiter); `PrivacySection.tsx` and
  `BackupResetSection.tsx` (one row each); `src/storage/constants/mmkv-keys.ts` (`privacyBlockScreenCapture`).
- Options: `src/player/options/p11-privacy.ts` (+ one import line), `player-options.ts` (optional `privacy`).
- Strings: `src/localization/catalogs/privacyBackup.en.ts` / `.ur.ts`, wired in `en.ts` / `ur.ts`.
- Tests: `src/privacy/private-traces.test.ts` 13, `private-folder.test.ts` 10, `secure-window.test.ts` 6,
  `src/backup/backup-format.test.ts` 11, `backup-restore.test.ts` 8, `user-data.queries.test.ts` 9,
  `src/player/options/p11-privacy.test.ts` 6.

### Gate

| Check | Result |
| --- | --- |
| `npm run typecheck` | 0 errors (both configs) |
| Unit tests (JS), stacked on P10 with P9's backfill (`1ad7865`) | 2466 / 2466 (2455 on `4ea8612`); 64 new, the last one added when stacking (`user-data.queries.test.ts`: a Replace restore resets play counts with `UPDATE … play_count = 0` instead of deleting the rows, so P9's measured `duration_ms` stay) |
| Unit tests (JS), on `4ea8612` | 2455 / 2455 (2392 before; 63 new: `privacy/private-traces.test.ts` 13, `privacy/private-folder.test.ts` 10, `privacy/secure-window.test.ts` 6, `backup/backup-format.test.ts` 11, `backup/backup-restore.test.ts` 8, `backup/user-data.queries.test.ts` 9, `player/options/p11-privacy.test.ts` 6). `row-revision.test.ts` passed in the full run |
| `npm run lint` | 0 errors; 91 warnings, the same older ones, none in a file P11 changed |
| Gradle | Not run: no Kotlin changed |
| Against `4ea8612` | `git diff --check` clean; none of Faran's files; nothing in `transfer/` or `engine/`; `package.json` / lockfile, `build.gradle`, manifests and `app.json` unchanged; no new dependency or permission; no SQLite change (`DATABASE_VERSION` still 10); Media3 untouched |

### Device checks for Faran (release build; not possible here)

1. **Move to Private from the Player:** a library video → ⋮ → Tools → Move to Private. Without App Lock: "Set up App
   Lock first". With it, the first time: the data-loss notice and "I understand" must be ticked. The video pauses,
   "Encrypting… 45%", "Moved to Private", then the next video in the queue plays; with none, the Player closes and no
   mini player stays. A video on this device, a file opened from another app and a stream have no such row.
2. **Hidden everywhere**, after moving a video that was in a playlist, the queue, Continue watching, Most played and
   had bookmarks, a saved loop and a non-default fit: it is in none of them (Library, search, Watch history, Continue
   watching, Home's lists, Most played, its play count, playlists, the queue). Then **play the next video and close the
   Player**: the moved one doesn't come back in Watch history or Continue watching. Restart the app: still nowhere.
3. **Move from the Library while it plays in the mini player:** the mini player stops; nothing of it comes back.
4. **The Gallery copy:** with "Also remove the Gallery copy" ticked, Android's dialog, then the copy is gone from the
   Gallery and Device videos; unticked, it stays (as H21).
5. **Move out of Private:** Private → ⋮ → Move out → confirm. It appears in Gallery → Movies/VidoraX (and in VidoraX's
   Device videos) and is gone from Private. On Android 9 or older, refusing storage access keeps it in Private
   ("needs the storage permission"). An unreadable item has no Move out.
6. **Block screenshots in Private**, on: in Private (PIN gate, list, an action sheet, a confirm, and while a private
   video plays in its own player) the power + volume screenshot is refused and a screen recording is black; the
   recent-apps preview of VidoraX in Private is blank. Leave Private: screenshots work again everywhere. Off (the
   default): screenshots work in Private as before.
7. **With incognito:** an incognito tab open in the browser, then go to the Library → Private and back, and the other
   way round: incognito stays protected the whole time, and Private too (with the setting on). After closing incognito
   and leaving Private, screenshots work.
8. **Back up all data:** save to a folder (and share). Open the file: no PIN, recovery code, "appLock", "vault" or a
   private video's name in it. **Share a large backup** (hundreds of playlist videos and bookmarks, several MB): the
   share fallback of `exportTextFile` sends the text as an intent extra, which may hit Android's ~1 MB limit.
9. **Restore:** the preview's counts match; Merge onto the same phone changes nothing; Merge onto a phone with other
   playlists keeps them and adds; Replace removes playlists, bookmarks and play counts not in the file and resets the
   other settings (language kept). The Player's seek step, gestures, subtitle style, loops and hidden folders apply at
   once (no restart). App Lock still asks for the same PIN; Private still has its videos.
10. **Versions:** an old Settings Backup file restores its settings ("An older settings backup"); a file with
    `"version": 2` says "made by a newer version of VidoraX"; a browser backup is sent to the browser's restore.
11. **Six themes and Urdu (RTL):** the Settings rows, the restore preview, the confirms, the Move out sheet and dialog;
    TalkBack reads the switch and the preview.
