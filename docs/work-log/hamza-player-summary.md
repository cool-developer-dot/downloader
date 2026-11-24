# VidoraX Player: handover (P1–P13)

Hamza's Player work for Faran: what was built, what is open, what to test. Detail per package is in `docs/work-log/hamza-player.md` (on `integration/player` up to P10; P11 and P12 add their sections in #50 / #51). Checklist ticks, ready to paste after device testing: `docs/work-log/hamza-player-checklist-ticks.md` / `.csv`.

**P6 fix (#60, draft): device videos that don't switch.** From Device videos, Up next or ⏮ restarted the same video
instead of switching to the one picked. The cause isn't found yet: every JavaScript step handles `device:<id>` like a
library id (`docs/work-log/p6-device-next-trace.md`, with `node:test` cases in `src/player/p6-device-next.test.ts`).
#60 adds `[P6-DEVNEXT]` log lines (development builds only) for Faran's repro. The fix follows once those lines show
where the switch is lost. Device check 145.

## Packages

| # | Package | Features (checklist #) | Points | PR | Status |
| --- | --- | --- | --- | --- | --- |
| P1 | Playback basics | Stop #520, Custom Seek Interval #527, Frame by Frame #531, Jump to Time #532, Long Press to Fast Forward #545 | 3 | #40 | Merged |
| P2 | Video fit & display | Aspect Ratio #564, Crop to Fill #565, Stretch #566, Mirror/Flip #573, Notch/Cutout Support #576, Info Overlay #721 | 3 | #41 | Merged |
| P3 | Subtitles: load & tracks | Load Subtitle #589, Auto Detect Subtitle #590, Multiple Tracks #598, Subtitle Off #602, Subtitle Formats #603, Subtitle Encoding #601, Subtitle Sync #597 | 6 | #42 | Merged |
| P4 | Subtitle style | Subtitle Size #592, Subtitle Color #593, Subtitle Font #594, Subtitle Background/Outline #595, Subtitle Position #596, Dual Subtitles #599, RTL Subtitles #600 | 4 | #43 | Merged |
| P5 | Repeat & loops | Repeat One #539, Repeat All #540, A-B Repeat #541, Save Loop #722 | 3 | #44 | Merged |
| P6 | Queue & auto-next | Play Queue #619, Play Next #620, Shuffle #542, Auto Play Next #534, Next Episode Prompt #733 | 4 | #45 | Merged |
| P7 | Playlists | Create Playlist #617, Edit Playlist #618, Playlist Import/Export #629 | 4 | #46 | Merged |
| P8 | Gestures & custom controls | Horizontal Swipe Seek #582, Two Finger Tap #585, Gesture Sensitivity #586, Disable Gestures #587, Customize Controls #692 | 4 | #47 | Merged |
| P9 | Library stats & bookmarks | Most Played #626, Play Count #708, Duration Filter #711, Include/Exclude Folders #628, Quick Delete #726, Disable History #687, Video Bookmarks #705 | 4 | #48 | Merged |
| P10 | Screenshot & edit tools | Screenshot #675, Trim Video #677, Extract Audio #678, Video Converter #679, Compress Video #680 | 5 | #49 | Merged |
| P11 | Privacy & backup | Private Folder #686, Block Screen Capture #689, Backup/Restore #700 | 4 | #50 | Merged |
| P12 | Export extras | Create GIF #676, Merge Videos #682, Change Speed Export #684 | 4 | #51 | Merged |
| P13 | Chromecast | Chromecast #667 | 4 | #59 | Open |
| | **Total** | **61 features** | **52** | | P1–P12 merged, P13 open (#59) |

Checklist status of the 61 features (from the tick file): **Built 38, Built with limitation 23, Not planned 0, Not started 0** (#667 Chromecast is Built in P13). Filters #571 / #572 are Not planned and not among the 61: their tile became Mirror / Flip #573.

## Open decisions for Faran

1. **P13 Chromecast (#59):** built with your rules: the Google Cast SDK (`play-services-cast-framework` 22.3.1 from
   Google's Maven, not media3-cast; Media3 stays 1.9.0), no npm package, and a local server that runs only while a local
   file is cast (one file and its subtitles, 128-bit random tokens, Wi-Fi address only). No new permission. Open for you:
   - **Media session while casting:** the local notification (and lock screen) still controls the paused phone player.
     Needed in `use-player-session.ts` (yours, not edited): while `useCastStore`'s `connection === 'connected'` and its
     `castMediaId` is this session's media, hide the media notification, or forward its play / pause / seek to
     `castPlay` / `castPause` / `castSeek` in `src/player/cast/cast.runtime.ts`.
   - **Streams that need the page's headers** (cookies, referrer) are not cast: the receiver can't send them, and a
     proxy would mean changing your P14 stream files. Streams that open without headers go by their own URL, without
     subtitles.
   - **The Cast SDK brings Google's own logging libraries** (`com.google.android.datatransport:transport-backend-cct`,
     `firebase-encoders`), as every Cast app does. VidoraX sends nothing itself. Keep it, or drop Chromecast?
   - Closing the mini player doesn't end a cast; Repeat / Auto Play Next don't run when the TV reaches the end; speed,
     the sleep timer and Kid Lock act on the phone's player only.
2. **P11 Private Folder, Gallery copy:** remove the Gallery copy by default when a video moves to Private? Today it is removed only when "Also remove the Gallery copy" is ticked (H21's default is off, because removing a public file needs Android's consent dialog), so the video stays in the phone's Gallery and in Device videos.
3. **P11 Move out:** back into the Library instead of the Gallery? That needs a small native `moveOut` in `PrivateVault.kt` plus one bridge function.
4. **P11 Block screenshots:** keep it to the Private Folder (as #689 says), or also app-wide / the whole Player? Should the backup also hold the theme and the play queue (both left out)?
5. **P8 gestures:** swipe seek (#582) and the two-finger tap (#585) are off by default so existing users notice nothing. Should they be on?
6. **P3 in-video subtitle tracks:** expo-video draws them itself (Android caption settings), so P4's styling and P3's sync work on subtitle files only. Is native work next to expo-video worth doing to style them?
7. **P3 screen 21:** the Subtitle editor and the subtitle download are in no package (download needs the network). Mark them Not planned?
8. **P5 / P6 mini player:** it still stops at the end, because the repeat and queue logic runs in the full Player screen. Move it to the session host, or does it belong with your session work?
9. **P5 / P6 background and picture-in-picture:** Repeat all and Auto Play Next start the next video from the Player (`useContinueAfterAutoAdvance`). Please confirm it fits P15's media session.
10. **P6 headset keys:** `play-queue.ts`'s functions are unchanged, but the headset tests copy the expected call pattern (`getState().ids` + `queueNeighbours`), not your P15 / P16 code. Please check them against it.
11. **P9 watch history:** Disable History is gated in `src/playback/bind-playback-persistence.ts` (the coordinator is the only writer of resume points, Watch history and Continue watching). Please confirm nothing of yours records history elsewhere.
12. **P10 / P12 Media3 effect:** `Presentation` and `FrameDropEffect` come from `media3-effect` 1.9.0, pulled in by the existing `media3-transformer`, with no `build.gradle` line of its own. Keep it that way, or add the explicit line (a build.gradle change)?
13. **P12 speed:** the pitch changes with the speed (Transformer's default); keeping the pitch would mean a `SonicAudioProcessor`. And if `FrameDropEffect` fails on a device (device checks), the frame-rate cap can be dropped (`frameRateCap` returns null).
14. **P7 shared menu:** the app-wide `ActionSheetModal` now scrolls its rows when they don't fit (nothing changes when they do). Please check it on a short phone.
15. **P6 device videos (#60):** please run the repro on a development build and paste the `[P6-DEVNEXT]` lines
    (device check 145 says how). The trace's last table says what each pattern means and where the fix goes.

## Limitations and Not planned

- **Not planned: Filters #571 / #572** ("depends on device hardware / decoders"). The design's Filters tile is Mirror / Flip #573.
- **Not built: screen 21's Subtitle editor and subtitle download** (no package covers them; download would need the network).
- **Styling in-video subtitle tracks:** tracks inside the video (MKV / MP4 text, HLS / DASH) are drawn by expo-video / Media3 with Android's caption settings: no P4 style, no P3 sync, not the second of two subtitles, mirrored / cropped with the picture. #592–#597 and #599 apply to subtitle files.
- **Gallery delete:** Quick Delete (#726) works on library files only; a gallery video can't be deleted from the Player (it would need new native code). A video moved to Private keeps its Gallery copy unless the user ticks "Also remove the Gallery copy".
- **The mini player stops at the end:** Repeat one / all (#539, #540), A-B loops at the end and Auto Play Next (#534) run in the full Player (also in picture-in-picture and background play).
- **#520 Stop** pauses and goes back to 0:00; the full stop comes in your P15.
- **#590 Auto-detect** looks beside library downloads only (other folders would need a storage permission). **#603** ASS / SSA: text only.
- **#711 lengths** for older downloads are filled in in the background (5 at a time); until then they show only under Any length.
- **Edit and export tools** (#677–#680, #676, #682, #684) take library videos only (the native editor's sources). Screenshot (#675) also works for device videos and files from other apps.
- **Device videos in a restored queue or a playlist** play only once the device video list has been read (first 500).
- **Device videos don't switch (P6, open):** from Device videos, Up next and ⏮ may restart the same video instead of
  switching. The cause is open; diagnostics are in #60.
- **Playlists:** deep links to `/playlists/<id>` aren't registered, and the typed routes weren't regenerated (needs a dev server).
- **Screen 21's "RTL support" switch** isn't built: direction is detected per line.
- **#667 Chromecast:** streams that need the website's headers aren't cast (a proxy would change P14's stream files);
  streams go without subtitles; only subtitle files reach the TV (as WebVTT, text only), not tracks inside the video; the
  media notification still controls the paused phone player while casting (needs P15's session, logged for Faran).

## Device checks (one pass, grouped by package)

Release build, emulator and one real phone, all six themes and Urdu. 144 checks, numbered across packages; each package's section of the work log has the context.

### P1 Playback basics (#40)

1. Portrait: the page matches screen 19 in all six themes (Red: header band, red tab bar); Urdu (RTL rows). The chip row is 1.0× · Subs · Rotate · Lock (no Audio chip until P17).
2. Rotate chip → full screen landscape and back; the picture never goes black or restarts; a paused frame stays.
3. Lock on the page: nothing but the unlock pill responds (header ←, chips, tabs, Back).
4. Hold the picture while playing → 2×, lift → the chosen speed (try 1.5×); hold, then lock / PiP / switch video.
5. Frame by frame on a 24, 30 and 60 fps file: each step moves exactly one frame, back and forward.
6. Jump to time with Urdu digits; Stop after the video ended, then Play.
7. Seek interval 30 s → "30 s" tile, ⏪ / ⏩ icons in full screen, double-tap feedback, TalkBack hint.
8. A tab on the page → the Player continues in the mini player on that tab.
9. PiP from the page with a portrait video and with a landscape one: the window shows only the picture; back to the page afterwards.
10. Options → Jump to time and Options → Seek interval: the options sheet closes and the next sheet opens (two modals in a row on Android); Options → Orientation opens the orientation sheet.
11. TalkBack while locked on the page: only the unlock pill can be reached.
12. Scrubbing on the card: the bar answers a drag that starts a little above it (44 dp touch area).
13. The options sheet in all six themes and in Urdu: section labels, rows, values (10 seconds, Auto); greyed rows while the video is preparing.

### P2 Video fit & display (#41)

14. Aspect ratio from the tile and from Options → Video: all seven on a 16:9, a 4:3, a portrait and a 2.39:1 file, on the card and in full screen. Close and reopen the same video: same fit. Another video: Fit.
15. Crop to fill, then pinch-zoom and pan to each edge: no black edge shows (the pan stops at the visible picture).
16. Mirror / Flip, each mode, also while zoomed: pinch and pan follow the fingers. Next / Previous: back to Normal.
17. A cutout (Developer options → "Simulate a display with a cutout": corner, punch hole, tall): full screen in landscape and in portrait (orientation lock Portrait, then Rotate). The top bar, lock, timeline, frame panel and 2× pill stay clear of it; the picture stays clear by default and fills it with "Use the notch area" on. Also with 3-button navigation.
18. Info overlay on: an H.264 file, an H.265 or VP9 file, an HDR file and a stream. The values are sensible. On the page: a line under the card, controls showing or not. Full screen: the line in the dock while the controls show (it shortens with "…" on a narrow screen, never covering volume or speed), the box at the top end when they hide, clear of the lock pill when locked. In Urdu the box is on the left. TalkBack reads it.
19. Picture-in-picture after choosing Crop, 4:3 and a mirror: the window shows the whole picture, mirrored.
20. All six themes and Urdu: both sheets, the switch rows in the options sheet, the "Mirror / Flip" tile label.
21. Changing the fit or the mirror never blacks out or restarts the picture (the view is laid out again, not remounted).

### P3 Subtitles: load & tracks (#42)

22. Load subtitle with an SRT, a VTT, an ASS and an SSA file (from Downloads and from a cloud provider in the picker); a `.txt` that is not a subtitle (refused, toast); a file over 5 MB (refused). The picker does not open a PiP window while a video plays (PiP is disarmed before the picker opens, and armed again after); App Lock does not ask again on return.
23. A download with "Download subtitles" on (H19): open it, and the `<video>.<lang>.vtt` shows by itself (the app's language first); turn Auto-detect off, and only chosen files remain.
24. An MKV with two subtitle tracks and an HLS stream with subtitles: both appear as "… · in the video", switching works, Off turns them off, a file in between hides them, and the choice is back after closing and reopening the video.
25. A Windows-1256 Urdu SRT (no BOM), a UTF-16 SRT and a UTF-8 SRT with a BOM: automatic shows them right; choosing Windows-1252 on the Urdu file shows the wrong letters, and choosing back fixes it.
26. Sync: +0.5 s, −1 s and Reset while playing; the offset is back after reopening the video.
27. Subtitles on the card (above the card's timeline when the controls show), in full screen, with a cutout (clear of it), in PiP, mirrored (the text is not mirrored), with Crop.
28. Six themes and Urdu: the Subtitles sheet (Subs chip), the track, encoding and sync sheets.
29. Previous / Next with subtitles on: the next video starts with its own choice. A video with a track inside it, set to Off, then Next to a video whose subtitle track is flagged default: that track shows. Previous / Next onto an MKV: its tracks are in the list.

### P4 Subtitle style (#43)

30. Style sheet in all six themes and in Urdu: the chips, the colour rings (black visible on Dark / Midnight), the buttons; the preview looks the same in every theme.
31. Each size and colour on the card and in full screen; Outline and Shadow read on a bright scene. Outline is a shadow on Android, so check it really outlines.
32. Nastaliq with an Urdu SRT: the letters aren't clipped (line height), Latin lines stay in the system font, the first subtitle after choosing it may show in the system font for a moment while the font loads.
33. RTL: an Urdu SRT with lines like "WiFi کا پاس ورڈ 1234 ہے" and "ٹرین 7:45 پر Lahore سے چلے گی". The words read right to left, the English word and the numbers stay in order, the line is right-aligned, and punctuation sits at the left end. An English line in the same file stays centred.
34. Position: Top and Bottom, Away / Toward the edge; with the controls showing (card and full screen) the subtitle stays clear of the timeline / top bar; with the info overlay on in full screen, a top subtitle sits below its box.
35. Dual: an English and an Urdu file. "Next to the first" (both at the bottom, Urdu above or below as chosen first / second), "Top of the picture"; a track inside the video as the first with a file as the second (the second at the top, no overlap).
36. Reset style; close and reopen the app: the style is kept; another video keeps its own second subtitle.

### P5 Repeat & loops (#44)

37. Options → Playback → When the video ends: Stop (default) behaves as before: last frame and Replay, also with a list (opened from the library) that has a next video.
38. Repeat one: the video starts again by itself, with no Replay flash; the watch history counts it again.
39. Repeat all from the library list: the next video opens and plays; after the last one, the first. A video from download details (no list) repeats itself.
40. A–B: tap the tile twice while playing; the ticks and tint show on the card's bar and in full screen; the loop repeats cleanly (no visible overshoot past B). B before A, and B at the very end (the loop wraps at the end). Clear from the "A–B ✕" button and from the sheet. Another video starts with no loop. With B at the end: let it wrap a few times, clear it, play to the end. Replay must show and the watch history must count it.
41. Repeat all in picture-in-picture, and with background play on and the screen off: the next video plays.
42. Save loop with an Urdu name; the list after reopening the app; play, rename, delete (confirm); 50 loops.
43. The A-B sheet and When the video ends in all six themes and in Urdu; TalkBack reads Set A / Set B with the time.

### P6 Queue & auto-next (#45)

44. Headset / Bluetooth Next and Previous (your P15 keys) with a library list, after Shuffle, after Play next and after reordering: they follow the queue sheet's order.
45. Queue sheet: tap a video, move up / down, remove; "Now playing" can't be removed; six themes and Urdu; TalkBack reads "Move … up" and the rest.
46. Library → long-press → Play next and Add to queue while a video plays in the mini player; reopen the Player: the queue has them, Previous / Next are still there (they used to vanish after the mini player).
47. Shuffle on and off: the video playing keeps playing; off restores the order.
48. Restart the app (swipe it away) with a queue: open the last video from Continue watching, and the queue and Shuffle are as they were. With a device video in the queue, it still plays.
49. Auto Play Next off (default): a library list stops at the end, as before. On: the next one plays; the last one stops. A video from download details (no queue) goes on to the next in its folder.
50. Next Episode card: a folder with "Show S01E01.mp4", "Show S01E02.mp4" and Auto Play Next on. The card shows 10 s before the end and counts down; Play now; Cancel (the video stops at its end); pause and seek back (it hides). No card for "Holiday.mp4" → "Work.mp4". Check it's clear of the controls on the card and in full screen.
51. Auto Play Next in picture-in-picture and with background play on and the screen off: the next video plays.
145. **P6 fix (#60), added after check 144: device videos switch** (a development build first, for #60's `[P6-DEVNEXT]` lines; then the build with the fix):
     Device videos → quiet.mp4 → Up next → two-audio.mp4 plays (not quiet.mp4 again). Then, from a device video with one
     before it, ⏮ at about 1 s goes to the previous video; with none before it, ⏮ restarts (P15, by design). Then ⏭,
     Auto Play Next at the end, Repeat all wrapping from the last device video to the first, a playlist with a device video
     in it, and the next-episode card's Play now: each switches. A library video and a playlist of library videos still
     do exactly as before.

### P7 Playlists (#46)

52. **Upgrade.** Install the previous build (database v8) and add downloads, folders, bookmarks, notes and a saved page. Then install this build: everything is still there and Playlists opens empty. Check a fresh install too.
53. **Library.** Long-press → Add to playlist → New playlist with an Urdu name: the playlist shows 1 video. Add the same video again: "Already in". Select, tap several videos: the bar counts them, and Add to playlist adds them in the Library's order. Back leaves the selection; Back on another tab doesn't.
54. **The long-press menu on a small phone.** It now has up to 10 rows: Delete and Cancel must still be reachable.
55. **Player.** ⋮ → Tools → Add to playlist, for a library video and for a phone video. The row is hidden for a file opened from another app and for a stream.
56. **Playing.** Play, and tap a video to play from it. Previous / Next step through the playlist in order, and P5's Repeat all wraps inside it. Shuffle plays in order until P6.
57. **Editing.** ↑ / ↓ with TalkBack ("Move “x” up"), remove, rename, delete with the confirm. Afterwards the video files are still in the Library.
58. **Missing.** Delete a video in the Library, or delete its file outside VidoraX and pull to refresh. The entry is greyed with "Missing…", doesn't play, and Next skips it.
59. **Phone videos.** Add one, close the app, reopen the playlist: it plays if VidoraX has access, because the playlist lists phone videos itself. Without access, the message shows.
60. **Export.** The saved file's name is `<name>.m3u8` (not `.m3u8.m3u` or `.txt`), and its content is right. Open it in VLC next to the video files. Try Urdu names.
61. **Import.** Import VidoraX's own export. Then an M3U from VLC or a PC: Windows paths, `file://` URIs, CRLF, and a Windows-1256 .m3u with Urdu names. Web links are counted, and the not-found list shows.
62. **Themes and Urdu.** All six themes, and Urdu (right to left): Playlists, a playlist, the add sheet, the selection bar, the import summary.
63. **The long-press menu scrolls.** On a short phone, with a video open in the mini player (P6 adds Play next and Add to queue, so about 12 rows), long-press a Library video: the rows scroll, and Delete and Cancel can be reached. A short menu elsewhere (e.g. Downloads) looks as before.

### P8 Gestures & custom controls (#47)

64. **Nothing changed with the defaults** (swipe seek and the two-finger tap start off). Edge swipes (brightness, volume), the double tap (thirds; reset while zoomed), long-press 2×, pinch zoom and pan, and the single tap behave exactly as on P4.
65. **Turn swipe seek and the two-finger tap on** (⋮ → Playback → Gestures) for checks 2–6. **Axis lock on the left and right edges:** slightly diagonal up / down swipes still change brightness / volume (no seek). Mostly sideways swipes seek. A fast diagonal flick does neither.
66. **Swipe seek** on the card and in full screen: the pill shows "12:34 (+0:45)" and follows the finger. The video only moves when the finger lifts. Swipe to either end: the target stops at 0:00 / the length. A second finger during the swipe cancels it (no seek). Opening a sheet or locking mid-swipe: no seek, the pill goes.
67. **The timelines** still scrub on a horizontal drag (the card's and full screen's) and don't swipe-seek.
68. **Long-press 2×** then moving the finger sideways: stays at 2×, no seek. **Pinch** started with one finger moving first: zooms or swipe-seeks, never both. While zoomed, one finger pans the picture (no seek).
69. **Two-finger tap** pauses and plays, and doesn't also toggle the controls. A pinch is never taken for a two-finger tap. With the switch off (the default), a two-finger tap toggles the controls as before.
70. **Sensitivity:** Low / Normal / High for seek, brightness and volume (Normal identical to P4).
71. **Gesture controls off:** no gesture works except the tap that shows the controls. Each gesture's own switch. Pinch zoom off while zoomed: the picture returns to fitted.
72. **Customize controls:** hide, show and move chips and tiles on the page (the 1.0× chip too), the Up next card, the top bar's two buttons, ⏪ ⏩ / ⏮ ⏭ / the lock button, the dock's volume / speed (with the info overlay on, its line stays between them / after the first). Reset to default. Close and reopen the app: everything is kept.
73. **The Gestures, Gesture sensitivity and Customize controls sheets** in all six themes and in Urdu (switches, chips, ↑ / ↓, the screen 20 card). Back and a tap outside close them. TalkBack reads the ↑ / ↓ names and the new position after a move.
74. **Edge swipes with gesture navigation:** a sideways swipe starting within about 24 dp of the left or right edge. Check it in the landscape stage (system bars showing: does Back close the Player instead of seeking?) and in immersive full screen (the system bars come back). Then check a swipe starting a little further in: it seeks.

### P9 Library stats & bookmarks (#48)

75. **Upgrade.** Install the P8 build (database v9) with downloads, folders, bookmarks, notes, a saved page and a playlist, then this build: everything is still there. Check a fresh install too.
76. **Play count.** Watch a long video for 30 s (no seeking): Download details → Info says "Played · Once", and the Library's long-press menu line says "Played once". Open another and only seek around (less than 30 s actually played): no count. A 10 s clip played to the end counts; a seek to its end doesn't. 2× speed: counted after about 15 s. Repeat one: one count per opening. Close into the mini player and keep watching: still one.
77. **Most played.** Library → Sort → Most played: the most-played first, never-played last; together with Favorites, a folder, a length and a search.
78. **Length filter.** The chip and its five choices; videos right at 5:00, 20:00 and 60:00. **Backfill:** on a library with older downloads, open the Library and wait a few seconds; their lengths fill in (5 at a time) without playing them, the Library stays smooth, and they are still there after a restart. A damaged file stays under Any length.
79. **Hidden folders.** Filter → Include / exclude folders: hide a folder and Unfiled; the Library, Most played, search and Continue watching leave them out; Folder → that folder still shows it; close and reopen the app: kept. Files and folder assignments are unchanged.
80. **Quick delete.** ⋮ → Tools → Delete video, in a queue: confirm → the next video plays, and the deleted one is gone from the Library and the queue. The last video in the queue (and a video opened alone): the Player closes, and no mini player stays. Cancel changes nothing. Hidden for a gallery video, a file from another app, a stream and a video still downloading.
81. **Disable History.** Turn it on (⋮ → Playback, or Settings → Player): watch a new video and an old one; Watch history, Continue watching, Home and play counts don't change, and the old video resumes from its earlier point. Turn it off: recorded again.
82. **Bookmarks.** Add with and without a name, in Urdu too; the list is by time; tap one to jump; rename (and clear the name); delete with the confirm. The dots on the card's bar and the full-screen dock, next to an A-B loop. Close and reopen: kept. Delete the video: its bookmarks go.
83. **TalkBack:** the bookmark rows (jump) and their ✎ / bin buttons are separate; the folder switches read the folder's name.
84. **Themes and Urdu.** All six themes, and Urdu (right to left): the length chip and sheet, the folder sheet, the bookmark sheet and name dialog, the confirms, the Settings row.

### P10 Screenshot & edit tools (#49)

85. **Screenshot, full size:** first, that saving works at all (expo-video's frame handed to VidoraMedia's `saveFrameToGallery`: "Screenshot saved to Gallery", not "Couldn't save the screenshot"). Then a 1080p and a 4K library video, paused and playing. The dialog shows the video's size (1920 × 1080 / 3840 × 2160), and the picture in Gallery → Pictures/VidoraX is that size and is the frame on screen (OPTION_CLOSEST). A **portrait phone recording** (rotation metadata) comes out upright. Two screenshots of the same second are both kept.
86. **Screenshot sources:** a video on this device and a file opened from another app (Files → Open with VidoraX) both work. A stream and an audio file have no Screenshot row. Library files whose names have spaces or Urdu letters work (expo-video opens `file://` paths as the seek preview does).
87. **Screenshot on Android 9 or older:** the storage permission is asked once; refusing gives "Allow storage access to save to the Gallery".
88. **Share:** Share opens the share sheet with the JPEG, and WhatsApp / Gmail / Quick Share receive it. Done closes the dialog.
89. **Trim video** from 1:23 in full screen: the Player leaves full screen and pauses; the Trim screen's range starts at 1:23 and its preview shows 1:23. Keyframe / exact choices, Save, Cancel. Back returns to the Player. The trimmed copy is in the Library.
90. **Extract audio:** the progress sheet, then "Saved as a new item in Player". The `.m4a` plays. A video without sound says "This video has no sound".
91. **Video converter:** a WebM / VP9 video → MP4 (re-encoded); an H.264 MP4 says "Already an MP4 that plays everywhere"; Audio only works.
92. **Compress:** a 1080p video at High / Medium / Small. The sizes in the sheet against the files made (expect within about ±15 %), the resolution (1080p / 720p / 480p; a 720p source at High stays 720p), a portrait video stays portrait. A low-bitrate video greys High ("Not smaller than the original"). The copy plays, with sound.
93. **Cancel** during each edit (in the sheet, and in the notification): "Edit cancelled. Nothing was saved."; no partial file appears in the Library.
94. **Low storage:** fill the phone so that less than the estimate + 64 MB is free (Compress: its estimate + 10 % + 64 MB): "Not enough free space for this edit." before anything starts.
95. **The pause hold:** during an edit, press play (button, double tap, headset): the video pauses again with "Paused while the edit runs". Hide the sheet; the edit rows show "45%" and reopen it. After the edit ends, play works.
96. **One at a time:** start an edit in Download details, then try one in the Player: "Another edit is running".
97. **The rows' visibility:** library video (all five), video on this device and file from another app (Screenshot only), stream and audio file (none), an unfinished download played from its partial file (Screenshot only).
98. **Long edits in the background:** a 30-minute compress with VidoraX in the background (the notification, Cancel there).
99. **Six themes and Urdu:** the Compress sheet, the progress sheet, the converter sheet and the dialog. TalkBack reads the presets with their sizes.

### P11 Privacy & backup (#50)

100. **Move to Private from the Player:** a library video → ⋮ → Tools → Move to Private. Without App Lock: "Set up App Lock first". With it, the first time: the data-loss notice and "I understand" must be ticked. The video pauses, "Encrypting… 45%", "Moved to Private", then the next video in the queue plays; with none, the Player closes and no mini player stays. A video on this device, a file opened from another app and a stream have no such row.
101. **Hidden everywhere**, after moving a video that was in a playlist, the queue, Continue watching, Most played and had bookmarks, a saved loop and a non-default fit: it is in none of them (Library, search, Watch history, Continue watching, Home's lists, Most played, its play count, playlists, the queue). Then **play the next video and close the Player**: the moved one doesn't come back in Watch history or Continue watching. Restart the app: still nowhere.
102. **Move from the Library while it plays in the mini player:** the mini player stops; nothing of it comes back.
103. **The Gallery copy:** with "Also remove the Gallery copy" ticked, Android's dialog, then the copy is gone from the Gallery and Device videos; unticked, it stays (as H21).
104. **Move out of Private:** Private → ⋮ → Move out → confirm. It appears in Gallery → Movies/VidoraX (and in VidoraX's Device videos) and is gone from Private. On Android 9 or older, refusing storage access keeps it in Private ("needs the storage permission"). An unreadable item has no Move out.
105. **Block screenshots in Private**, on: in Private (PIN gate, list, an action sheet, a confirm, and while a private video plays in its own player) the power + volume screenshot is refused and a screen recording is black; the recent-apps preview of VidoraX in Private is blank. Leave Private: screenshots work again everywhere. Off (the default): screenshots work in Private as before.
106. **With incognito:** an incognito tab open in the browser, then go to the Library → Private and back, and the other way round: incognito stays protected the whole time, and Private too (with the setting on). After closing incognito and leaving Private, screenshots work.
107. **Back up all data:** save to a folder (and share). Open the file: no PIN, recovery code, "appLock", "vault" or a private video's name in it. **Share a large backup** (hundreds of playlist videos and bookmarks, several MB): the share fallback of `exportTextFile` sends the text as an intent extra, which may hit Android's ~1 MB limit.
108. **Restore:** the preview's counts match; Merge onto the same phone changes nothing; Merge onto a phone with other playlists keeps them and adds; Replace removes playlists, bookmarks and play counts not in the file and resets the other settings (language kept). The Player's seek step, gestures, subtitle style, loops and hidden folders apply at once (no restart). App Lock still asks for the same PIN; Private still has its videos.
109. **Versions:** an old Settings Backup file restores its settings ("An older settings backup"); a file with `"version": 2` says "made by a newer version of VidoraX"; a browser backup is sent to the browser's restore.
110. **Six themes and Urdu (RTL):** the Settings rows, the restore preview, the confirms, the Move out sheet and dialog; TalkBack reads the switch and the preview.

### P12 Export extras (#51)

111. **Create GIF, basic:** a 1080p library video at 1:23, 3 s, 320 px, 10 fps. The sheet says "320 × 180 · 30 frames · about …". The GIF is in Gallery → Pictures/VidoraX as "<title> 1m23.0s.gif", animates and loops in the Gallery, Google Photos and a browser, is 320 × 180, about 3 s, and shows the right moment (OPTION_CLOSEST). Its file size against the estimate.
112. **The biggest GIF:** 15 s, 480 px, 15 fps (225 frames). How long it takes; the progress moves; the size against the estimate ("about 16.9 MB"). Cancel half way (sheet and notification): "Edit cancelled. Nothing was saved.", no GIF in the Gallery.
113. **GIF of a portrait phone recording** (rotation metadata): upright, 480 × 853. A 4K video works (frames decoded at the GIF's size on Android 8.1+).
114. **GIF colours:** a sunset or sky gradient and a face: is the banding acceptable without dithering?
115. **Share the GIF:** WhatsApp / Telegram / Gmail receive an animated GIF. Done closes the dialog.
116. **Android 9 or older:** the storage permission is asked once; refused → "Allow storage access to save to the Gallery". The GIF is saved with it.
117. **Near the end:** start 3 s before the end with 10 s chosen → the start moves back (the sheet shows it).
118. **Merge, sizes:** a 1080p landscape video playing, then a 720p one and a portrait phone video, reordered with ↑ / ↓. The copy is 1920 × 1080; the 720p one fills it; the portrait one has bars at the sides; the order is kept; the length is the sum. Then make the portrait video first: the copy is portrait (1080 × 1920) and the landscape ones get bars above and below.
119. **Merge, sound:** a screen recording without sound between two videos with sound: silence during it, sound in sync otherwise. Two videos without sound: no sound track.
120. **Merge, frame rates:** a 30 fps video first, then a 60 fps one: both play at normal speed, smoothly, and the file reports about 30 fps. A 24 fps video after a 30 fps one plays normally.
121. **Merge, other files:** a WebM / VP9 with an MP4; an HDR video (it may fail: then "The edit failed. The original is unchanged."); 10 videos; the picker lists only videos and greys more than ten.
122. **Change speed:** 2× of the whole video (half as long, sound higher, in sync to the end); 0.5× of a 10 s part (20 s); the extremes 0.25× and 4×; a 60 fps video at 4× plays smoothly at 60 fps. The new length in the sheet against the file.
123. **The pause hold, one at a time, low storage:** play during an export → paused with "Paused while the edit runs"; an edit in Download details blocks one here ("Another edit is running"); a merge bigger than the free space → "Not enough free space for this edit." before anything starts.
124. **New items:** "<title> (merged)" and "<title> (2× speed)" appear in the Library at once and play; the originals are unchanged.
125. **The rows' visibility:** a library video (all three), a video on this device, a file from another app, a stream, an audio file (none). While an export runs, every Tools edit row shows "45%" and opens its progress.
126. **Long exports in the background:** a 30-minute merge with VidoraX in the background (the notification, Cancel there).
127. **Six themes and Urdu (right to left):** the three sheets, the picker, the progress sheet and the dialog; TalkBack reads the chips, the ↑ / ↓ / ✕ buttons and the picker's "Adds it to the merge".

### P13 Chromecast (#59)

A Chromecast (or a TV with Chromecast built in) on the phone's Wi-Fi; a release build too (R8: the Cast options provider
is created by reflection).

128. **The button:** with no Cast device on the Wi-Fi there is no Cast button (card top row, full-screen bar). Switch the
     Chromecast on: the button appears within a few seconds, before ⋮. Leave the Player: discovery stops.
129. **Start:** a library video at 2:00, Cast → the device. "Connecting to …", then "Casting to <device>" on the video
     area, the phone's player paused, and the TV starts at 2:00 with the title.
130. **Phone controls drive the TV:** play / pause (card, full screen, headset), the timeline, ⏪ / ⏩, double-tap seek,
     Jump to time, a bookmark. The timeline shows the TV's position. Long-press 2× and swipe seek do nothing meanwhile.
131. **Volume:** the sheet's − / + change the TV's volume and show the percentage.
132. **Stop casting:** seek on the TV to 5:00, then the sheet's Stop casting → the TV stops, "Stopped casting. Playing on
     this phone.", and the phone plays on from 5:00.
133. **Dropped:** switch the phone's Wi-Fi off while casting → "Lost the connection to the TV. Paused on this phone.",
     paused at the TV's last position; Wi-Fi back on: nothing reconnects by itself.
134. **Previous / Next while casting:** the next video is loaded on the TV (the phone stays paused); Up next too.
135. **Subtitles:** an SRT and an ASS file with a sync offset of +1.5 s: the TV shows them at the same moments as the phone
     (text only). Subtitles off, or a track inside the video: the TV shows none.
136. **Sources:** a video on this device (Device videos), a file opened with VidoraX from another app, a 4 GB file with
     many TV seeks (ranges), an MKV (the TV may refuse it: "The TV couldn't play this video." and the phone takes over).
137. **Blocked:** a video moved to the Private Folder from the Player ("Videos in the Private Folder are never cast."), a
     download still in progress (play while downloading), a stream that needs the website's headers: each with its
     message, and nothing reaches the TV.
138. **A stream without headers** (P14 network stream, an MP4 or HLS link): the TV opens it itself; the phone's server
     doesn't start.
139. **The server:** while casting, `curl -I http://<phone-ip>:<port>/<token>` from a laptop on the Wi-Fi answers 200 with
     `Accept-Ranges: bytes`; a wrong token, another path, or POST → 404. After Stop casting the port is closed.
140. **Only Wi-Fi:** on mobile data only → "Connect this phone to the same Wi-Fi as the TV.", nothing is served.
141. **Leaving the app while casting** (Back to the launcher until the activity closes, then swipe it away): the TV stops
     and the server is gone.
142. **No Google Play services** (an emulator without them): no Cast button, nothing else changes.
143. **Six themes and Urdu (right to left):** the device sheet (devices, connected state, volume, Stop casting), the
     "Casting to …" cover and every message; TalkBack reads the Cast button and the device rows.
144. **The media notification while casting:** note what it shows and does (logged for Faran: it still controls the paused
     phone player).

## Files changed outside the Player

Everything under `src/player/`, `src/screens/player/` and `modules/` is left out here (native files are below). Against the base `9e9f343`, up to P13.

**Existing files changed (all additive):**

- `src/app/(app)/_layout.tsx` (P7)
- `src/bootstrap/app-initializer.ts` (P9)
- `src/browser/incognito/incognito.service.ts` (P11)
- `src/components/bottom-sheets/ActionSheetModal.tsx` (P7)
- `src/design/DsIcon.tsx` (P1, P2, P3)
- `src/design/DsTile.tsx` (P1)
- `src/library/query.ts` (P9)
- `src/library/types.ts` (P9)
- `src/localization/catalogs/videoPlayer.en.ts` (P1, P2, P3, P4, P5, P6, P8, P10, P12)
- `src/localization/catalogs/videoPlayer.ur.ts` (P1, P2, P3, P4, P5, P6, P8, P10, P12)
- `src/localization/en.ts` (P7, P9, P11, P13)
- `src/localization/ur.ts` (P7, P9, P11, P13)
- `src/media-edit/edit-job.ts` (P12)
- `src/media-edit/edit-plan.ts` (P10, P12)
- `src/navigation/components/DsTabBar.tsx` (P1)
- `src/navigation/constants/route-access.ts` (P7)
- `src/navigation/constants/route-names.ts` (P7)
- `src/navigation/constants/route-paths.ts` (P7)
- `src/navigation/helpers/open-player.ts` (P6)
- `src/playback/bind-playback-persistence.ts` (P9, P11)
- `src/private-vault/move-to-private.runtime.ts` (P11)
- `src/screens/downloads/DownloadDetailsScreen.tsx` (P9)
- `src/screens/library/LibraryScreen.tsx` (P6, P7, P9)
- `src/screens/library/components/LibraryCard.tsx` (P7)
- `src/screens/library/components/LibraryGridTile.tsx` (P7)
- `src/screens/library/components/LibraryHeaderControls.tsx` (P9)
- `src/screens/library/components/LibraryList.tsx` (P7)
- `src/screens/library/constants/library.constants.ts` (P9)
- `src/screens/library/hooks/useLibraryScreen.ts` (P9)
- `src/screens/media-edit/TrimScreen.tsx` (P10)
- `src/screens/media-edit/useRunEdit.ts` (P10, P12)
- `src/screens/private/PrivateScreen.tsx` (P11)
- `src/screens/private/PrivateVaultList.tsx` (P11)
- `src/screens/settings/backup-reset/BackupResetSection.tsx` (P11)
- `src/screens/settings/components/PlayerSection.tsx` (P9)
- `src/screens/settings/components/PrivacySection.tsx` (P11)
- `src/storage/constants/database.ts` (P7, P9)
- `src/storage/constants/mmkv-keys.ts` (P1, P2, P3, P4, P5, P6, P8, P9, P11)
- `src/storage/sqlite/migrations.ts` (P7, P9)
- `src/storage/sqlite/schema.ts` (P7, P9)

**Shared Player-core files other code depends on** (under `src/player/`, so not in the list above):

- `src/player/playback-events.ts` (P11): one `if` in `emitPlaybackEvent` drops events for a video once it has been moved
  to Private, so nothing writes it back into Watch history, Continue watching, resume points or play counts.
- `src/player/play-queue.ts` (P6): extended, every existing function unchanged (your headset keys call it).
- `src/player/options/*` (P1 created the registry; each package adds one file and one import).

**New files, by folder:**

- `src/app/(app)/playlists/`: `[id].tsx`, `index.tsx`
- `src/backup/`: `apply-preferences.runtime.ts`, `backup-format.test.ts`, `backup-format.ts`, `backup-preferences.ts`, `backup-restore.test.ts`, `backup-restore.ts`, `backup.service.ts`, `user-data.queries.test.ts`, `user-data.queries.ts`, `user-data.repository.ts`
- `src/library/`: `duration-buckets.ts`, `ensure-library-stats.ts`, `folder-exclusion.ts`, `length-backfill.test.ts`, `length-backfill.ts`, `library-stats-query.test.ts`, `library-stats-store.ts`, `play-count.test.ts`, `play-count.ts`
- `src/localization/catalogs/`: `libraryStats.en.ts`, `libraryStats.ur.ts`, `playerCast.en.ts`, `playerCast.ur.ts` (P13), `playlists.en.ts`, `playlists.ur.ts`, `privacyBackup.en.ts`, `privacyBackup.ur.ts`
- `src/media-edit/`: `compress-plan.test.ts`, `compress-plan.ts`, `export-extras-port.ts`, `gif-plan.test.ts`, `gif-plan.ts`, `merge-plan.test.ts`, `merge-plan.ts`, `player-edit-run.test.ts`, `player-edit-run.ts`, `player-export-run.test.ts`, `player-export-run.ts`, `player-tools-port.ts`, `speed-plan.test.ts`, `speed-plan.ts`
- `src/playback/`: `history-pause-preference.ts`, `history-pause.test.ts`
- `src/playlists/`: `import-match.ts`, `m3u.test.ts`, `m3u.ts`, `play-plan.ts`, `play-playlist.ts`, `playlist-changes.ts`, `playlist-entries.ts`, `playlist-library.ts`, `playlist-names.ts`, `playlists-service.ts`, `playlists.test.ts`, `use-playlists.ts`
- `src/privacy/`: `private-folder.runtime.ts`, `private-folder.test.ts`, `private-folder.ts`, `private-media-guard.ts`, `private-traces.runtime.ts`, `private-traces.test.ts`, `private-traces.ts`, `screen-capture-preference.ts`, `secure-window.runtime.ts`, `secure-window.test.ts`, `secure-window.ts`, `use-private-folder-capture-block.ts`
- `src/screens/downloads/components/`: `DownloadPlayCountRows.tsx`
- `src/screens/library/components/`: `LibraryFolderVisibilitySheet.tsx`, `LibrarySelectMark.tsx`, `LibrarySelectionBar.tsx`
- `src/screens/library/hooks/`: `useLibraryPlaylists.ts`, `useQueueSheetActions.ts`
- `src/screens/playlists/`: `PlaylistScreen.tsx`, `PlaylistsScreen.tsx`, `index.ts`
- `src/screens/playlists/components/`: `AddToPlaylistSheet.tsx`, `ImportResultModal.tsx`, `PlaylistEntryRow.tsx`, `PlaylistNameModal.tsx`
- `src/screens/settings/backup-reset/`: `BackupPreviewModal.tsx`, `FullBackupRows.tsx`, `useFullBackup.ts`
- `src/screens/settings/components/`: `BlockScreenCaptureRow.tsx`
- `src/storage/repositories/`: `library-stats.queries.test.ts`, `library-stats.queries.ts`, `library-stats.repository.ts`, `playlists.queries.test.ts`, `playlists.queries.ts`, `playlists.repository.ts`
- `src/storage/sqlite/`: `library-stats-schema.ts`, `playlist-schema.ts`

## Native files added or changed

All in `modules/vidorax-media` (nothing in `transfer/` or `engine/`), no new dependency, permission, manifest or `build.gradle` change, Media3 1.9.0.

- changed `main/java/com/vidorax/media/VidoraMediaModule.kt` (P9, P10, P12)
- **new** `main/java/com/vidorax/media/library/CompressPlan.kt` (P10)
- **new** `main/java/com/vidorax/media/library/EditSources.kt` (P12)
- **new** `main/java/com/vidorax/media/library/FrameExport.kt` (P10)
- **new** `main/java/com/vidorax/media/library/GifEncoder.kt` (P12)
- **new** `main/java/com/vidorax/media/library/GifExport.kt` (P12)
- **new** `main/java/com/vidorax/media/library/LengthProbe.kt` (P9)
- changed `main/java/com/vidorax/media/library/MediaEditor.kt` (P10, P12)
- **new** `main/java/com/vidorax/media/library/MergePlan.kt` (P12)
- **new** `main/java/com/vidorax/media/library/SpeedPlan.kt` (P12)
- changed `main/java/com/vidorax/media/library/ThumbnailExport.kt` (P10, P12)
- **new** `test/java/com/vidorax/media/library/CompressPlanTest.kt` (P10, P12)
- **new** `test/java/com/vidorax/media/library/FrameExportTest.kt` (P10)
- **new** `test/java/com/vidorax/media/library/GifEncoderTest.kt` (P12)
- **new** `test/java/com/vidorax/media/library/GifExportTest.kt` (P12)
- **new** `test/java/com/vidorax/media/library/LengthProbeTest.kt` (P9)
- **new** `test/java/com/vidorax/media/library/MergePlanTest.kt` (P12)
- **new** `test/java/com/vidorax/media/library/SpeedPlanTest.kt` (P12)
- changed `modules/vidorax-media/src/VidoraMedia.types.ts` (P9, P10, P12)
- P13 Chromecast: changed `android/build.gradle` (the Cast SDK, `consumerProguardFiles`), `android/src/main/AndroidManifest.xml`
  (the Cast options meta-data), `expo-module.config.json` (`VidoraCastModule`); **new** `android/consumer-rules.pro`,
  `main/java/com/vidorax/media/cast/` (`CastController.kt`, `CastFileServer.kt`, `CastOptionsProvider.kt`,
  `CastServing.kt`, `CastSources.kt`, `CastUrls.kt`, `HttpRange.kt`, `VidoraCastModule.kt`, `WifiAddress.kt`),
  `test/java/com/vidorax/media/cast/` (`CastFileServerTest.kt`, `CastServingTest.kt`, `CastSourcesTest.kt`,
  `CastUrlsTest.kt`, `HttpRangeTest.kt`), `src/VidoraCast.types.ts`, `src/VidoraCastModule.ts`

Known older Kotlin test failures on Windows (not from these packages): `StoragePathsTest`, `IncomingImportTest` (path separators), a timing-sensitive `ParallelTransferTest` / `HlsTransferTest` / `DownloadEngineLiveTest` that passes on its own, and `DownloadRunnerTest` left out locally (its test name is illegal on Windows).
