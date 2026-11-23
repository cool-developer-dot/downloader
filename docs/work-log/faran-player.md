# Faran — Player packages P14–P19 (work log)

Faran's 30% of the Player work (the split in the "VidoraX Player — Work Split" Claude Doc): the sound and the playback
engine. Built on `faran/player`, one branch and PR per package into `integration/player`, after Hamza's P1–P10 were
reviewed and merged (PRs downloader#40–#49, 2026-11-23: security scan clean, typecheck, 2402/2402 unit tests, lint
0 errors, release build and a device smoke test of the stacked tip `1ad7865`).

## Shared pieces

| Piece | What it is |
| --- | --- |
| `VidoraPlayer` native module | `modules/vidorax-media/.../player/VidoraPlayerModule.kt`, contract `src/VidoraPlayer.types.ts`. Each call takes the expo-video `VideoPlayer` shared object and runs on the main thread, where its ExoPlayer lives. |
| expo-video from source | `package.json` → `expo.autolinking.android.buildFromSource: ["expo-video"]`. Expo SDK 57 links expo-video as a prebuilt AAR; built from source it is a Gradle project (`:expo-video`) that `vidorax-media` can depend on, and that `scripts/patch-expo-video.js` can patch. Same sources, same Media3 1.9.0. |
| `src/player/engine/` | Faran's JavaScript: settings stores (MMKV), pure rules, the `usePlayerEngine` hook the Player screen calls once. |
| `src/screens/player/engine/` | Faran's sheets, drawn by the Player screen next to Hamza's (`PlayerEngineSheets`). |
| `playerEngine` catalog | `src/localization/catalogs/playerEngine.{en,ur}.ts`: every string of P14–P19, English and Urdu. |
| Options sheet | `PlayerOptionContext.engine` (optional) carries each package's part; rows in `src/player/options/p14-…p19-…`. |

## P14 Streams in the player (#663, #670, #672)

| # | Feature | Where | How |
| --- | --- | --- | --- |
| #663 | Network Stream | Player tab header → Network stream (screen 52); `/network-stream` | Type or paste a link, Play. The engine's `probe` classifies it (HLS, DASH, a file; follows redirects) and refuses what downloads refuse: YouTube (checked before any request), protected (DRM) and blocked sites. A live HLS stream (which the downloader can't save) still plays. Without the probe (timeout 15 s, older build) the link's path decides. It plays as an F17 online stream: an in-memory `stream:` id, no library row, no history; the link is never saved. |
| #670 | Adaptive Bitrate | Network stream → Stream quality; Player ⋮ → Video → Stream quality (online streams only) | HLS / DASH already adapt to the connection (ExoPlayer). The cap — Auto, Data saver (480p), up to 720p, up to 1080p — sets ExoPlayer's track selection to a box of the longest side (854 / 1280 / 1920), so portrait streams get the same cap as landscape ones. The row shows the cap and what plays now ("Auto · 720p now", read from ExoPlayer every 4 s while playing). App-wide, MMKV. |
| #672 | Download Integration | Network stream → Download instead; Player ⋮ → Tools → Download this stream | Hands the link (and a Browser offer's Referer) to the downloader's own link flow (`openWithUrl`: check the link, the quality sheet). That flow lives in the tabs, so the Player leaves for the Downloads tab first and `StreamDownloadHandoff` (in the tabs layout) runs the request once the tabs are in front and App Lock is open. |

Tests: `stream-quality.test.ts`, `network-stream.test.ts`, `stream-download-handoff.test.ts`,
`p14-streams.test.ts` (rows, English/Urdu parity), `PlayerTrackLimitsTest.kt` (JVM, Robolectric).

### P14 device test (release build, Pixel_8 AVD, 2026-11-23)

| Check | Result |
| --- | --- |
| Player tab header → Network stream icon → screen 52 | Opens; Download instead, Stream quality (Auto), formats note |
| `https://youtu.be/abc123` → Play | Refused: "YouTube videos can’t be played or saved in VidoraX." (no request made) |
| Mux HLS `x36xhzz.m3u8` → Play | Plays in the Player (media session PLAYING) |
| ⋮ → Video → Stream quality | "Auto · 720p now"; the stream then adapted to 1080p (overlay "· 1080p") |
| Stream quality → Data saver | "Data saver · 480p now" a few seconds later (the cap moved ExoPlayer from 1080p to 480p) |
| ⋮ → Tools → Download this stream | The Player steps aside to the Downloads tab; the downloader's own sheet opens with the stream's 1080/720/480/288/184p variants |

## P15 Headset, keys & remotes (#560, #562, #661, #701, #703, and #520's full stop)

| # | Feature | Where | How |
| --- | --- | --- | --- |
| #560 | Headphone Detection | ⋮ → Playback → Headset, keys & lock screen (on by default) | ExoPlayer's `setHandleAudioBecomingNoisy`: the video pauses when headphones are unplugged or a Bluetooth headset disconnects, so the sound never moves to the speaker. |
| #661 | Headset Button Control | same sheet (on) | Each media session of the player controls a `QueueSessionPlayer` (Media3 `ForwardingSimpleBasePlayer`, through the expo-video hook): ⏭ / ⏮ from a headset, a Bluetooth remote, the media notification or a double press go to the Player's queue (next; previous within 3 s, else back to the start). One press plays / pauses (Media3's own). |
| #562 | Hardware Key Control | same sheet: Volume keys | Player volume (default: one of 15 steps per press, with the Player's own level on the video instead of Android's panel), Skip back / forward by the seek interval, or Android volume. Only while the Player is in front with no sheet open. |
| #701 | External Remote | same sheet (on) | Keyboard / TV remote / game pad: Space, Enter, OK (D-pad centre), K play / pause; ← → J L skip; ↑ ↓ volume; N / P next / previous; F full screen; M mute; Esc leaves full screen. Media keys go through the session (#661). |
| #703 | Show on Lock Screen | same sheet (off) | While the Player is in front, its window shows over the lock screen (`setShowWhenLocked`), so a video playing when the phone locks is still there on wake. Over the lock screen, Back, ⋮, the header ← and the tab bar ask for the phone's unlock first (`requestDismissKeyguard`); leaving the Player turns it off. |
| #520 | Stop (P1's, completed) | ⋮ → Playback → Stop | P1 pauses and goes to 0:00; the session's new `stop()` also ends the background session: the media notification and the playback service go until the video plays again. |

**Shared changes (reviewed for the Browser):** the key channel routes keys by owner (`key-capture-routing.ts`): the
volume keys go to the owner that asked most recently, a combo only to owners that asked for it, so the Player's keys
never reach the Browser's listeners. `useVolumeKeyScroll` and `useKeyboardShortcuts` pass their owners. The native key
channel names the D-pad centre (`center`) and the keypad's Enter.

**expo-video patch:** `scripts/patch-expo-video.js` (postinstall) adds `VideoPlayerHooks`: the media-session player
(P15) and PCM audio processors for the sink (used by P17 / P19). Exact text replacements; it fails the install when
expo-video changes instead of shipping without them.

Tests: `player-keys.test.ts`, `headset-keys.test.ts`, `key-capture-routing.test.ts`, `p15-headset-keys.test.ts`;
JVM `QueueNavigationTest.kt` (Robolectric), `KeyCaptureTest.kt` (new key names).

### P15 device test (release build, Pixel_8 AVD, 2026-11-23)

| Check | Result |
| --- | --- |
| Opening a video with a queue | The session's actions gain "skip to next" (7339995 → 7340027) |
| Space / OK / K, → → ←, from the key channel | Play / pause, +10 s twice, −10 s (session position 14.5 → 34.6 → 24.6 s) |
| Volume Down / Up | Media volume 6 → 5 → 7 (of 15); the Player's own "27%" level shows, not Android's panel |
| `media_session dispatch next` | Next video of the queue (two-audio → left-only) |
| previous after 3 s / two quick previous | Back to 0:00 / the previous video (two-audio) |
| headset hook ×2 / ×1 | Next video / pause |
| Headphone detection | ExoPlayer's AUDIO_BECOMING_NOISY receiver registered in the app's process while playing (the broadcast itself is protected: the shell can't send it) |
| Background play on → Stop | Notification and foreground service gone; Play brings them back |
| Show on lock screen on, PIN set, power off / on | The Player shows over the lock screen (keyguard showing, occluded), video still playing |
| Tab bar over the lock screen | Android's "Enter PIN"; after the PIN the Browser opens |

Note: Android consumes the first navigation key (Space, Enter, arrows) after a touch to leave touch mode, so after
tapping the screen the first key press does nothing; this is the platform's behaviour for every app.

## P16 Speed & pitch (#537, #538, #544, #736)

| # | Feature | Where | How |
| --- | --- | --- | --- |
| #537 | Fine Speed Control | The speed sheet (1.0× chip, full-screen speed button, ⋮ → Playback → Playback speed) | Any speed from 0.25× to 4× on a 0.05 grid (`playback-rates.ts`: rejects, never clamps, anything else). − / + move 0.1 and keep the sheet open; TalkBack adjusts it with swipe up / down. The presets (0.5×–2×) stay one tap. |
| #538 | Pitch Correction | Speed sheet → Natural voice (on) | expo-video's `preservesPitch`, which its Android player leaves off unless told: at 1.5× or 2× voices keep their pitch. |
| #544 | Speed Shortcut | Speed sheet → Speed button | "Opens this list" (default, as before) or "Switches 1.0× ↔ 1.5×" (shortcut 1.25×–2×): one tap on the chip / button changes the speed and says it; a long press on the full-screen button, or ⋮ → Playback speed, opens the sheet. |
| #736 | Per-book Speed | Speed sheet → Remember each video's speed (on) | Each video, audiobook or lecture opens at its own speed (MMKV, the latest 300; 1.0× is not stored). Online streams are never remembered. This also fixes a mismatch: the session showed 1.0× for the next video while the native player kept the previous one's speed — every video now starts at its own speed or 1.0×. |

The Player's old speed list (`PlaybackSpeedSheet`) is replaced by `SpeedSheet`. Long-press 2× (P1 #545) is still a
temporary rate on the player only: it never reaches the session's speed, the chip or the remembered speeds.

Tests: `playback-rates.test.ts`, `speed-settings.test.ts`, `p16-speed.test.ts`.

### P16 device test (release build, Pixel_8 AVD, 2026-11-23)

| Check | Result |
| --- | --- |
| 1.0× chip | The new speed sheet: − 1.0× +, presets, Natural voice, Remember each video's speed, Speed button |
| + twice | "Now 1.2×"; the native player plays at 1.2 (media session speed=1.2) |
| 1.5× on two-audio, close the session (mini player ✕), reopen | Opens at 1.5× (chip and native speed) |
| Next video / back within 3 s | left-only at 1.0×, two-audio at 1.5× again |
| Speed button → Switches 1.0× ↔ 1.5×, two taps on the chip | 1.0, then 1.5 |

Bug found and fixed (commit "P16: keep a speed picked…"): a first open restored 1.0× onto 1.0×, which re-rendered
nothing, so the restore's wait never ended and the next speed picked was not kept.

## P17 Audio tracks & delay (#553, #554, #574) and the Audio chip

| # | Feature | Where | How |
| --- | --- | --- | --- |
| #553 | Audio Track Switch | Screen 19's Audio chip (now shown) → Audio sheet; ⋮ → Audio → Audio track (only with 2+ tracks) | expo-video's `availableAudioTracks` / `audioTrack`, read on each load and change; names from the label, language or name ("English · Commentary", else "Track 2"). Until the player reports one, the file's default track (its first) shows as playing. |
| #554 | Audio Delay | Audio sheet: − / + in 50 ms steps within ±3 s (TalkBack adjustable), Reset; ⋮ → Audio → Audio delay | `VidoraAudioProcessor` (expo-video's sink, through `VideoPlayerHooks.audioProcessors`): silence in front of the sound makes ExoPlayer's audio clock lead what is heard (sound later); dropping sound at the start makes it lag (sound earlier). Applied again after every seek; scaled by the speed so it stays the same in real time. Kept per video (MMKV, latest 300; never streams). |
| #574 | Audio Only Mode | Audio sheet; ⋮ → Audio → Audio only (switch) | The video track is disabled in ExoPlayer's track selection (no video decoding: the battery saving) and the session keeps playing with the screen off, as with background play. The picture's place shows the title and how to turn it back on. For this run only. |

The Audio chip (Hamza's `PAGE_CHIP_FLAGS.audio`) is on and opens the Audio sheet; nothing is left "not available
yet". Faran's sheets now share one open-sheet store (`engine-sheets.ts`), so the chip opens it from anywhere in the
Player screen, and they count as open sheets for the Player's keys.

Tests: `audio-settings.test.ts`, `p17-audio.test.ts`, Hamza's page and customize-controls tests updated for the Audio
chip; JVM `VidoraAudioProcessorTest.kt` (9: pass-through, positive / negative delay, re-applied after a seek, change
while playing, clamp, empty buffers).

### P17 device test (release build, Pixel_8 AVD, 2026-11-23)

| Check | Result |
| --- | --- |
| Opening two-audio.mp4 (English 440 Hz / Urdu 880 Hz tracks) | Plays through the VidoraAudioProcessor; Audio chip shown |
| Audio chip | Audio sheet: English ✓ (default), Urdu; Audio delay 0 ms; Audio only |
| Urdu | A new AAC decoder instance starts at the tap (ExoPlayer re-selected the audio track); Urdu ✓ |
| Audio only | The cover shows the title; the H.264 decoder flushes and does no more work; the sound keeps playing |

Bug found and fixed before commit: Media3 polls each processor with `AudioProcessor.EMPTY_BUFFER`, and writing it into
the processor's empty output (the same shared buffer) threw "The source buffer is this buffer" — every video failed
to play. The processor now does nothing on an empty buffer (two JVM tests added).

## P18 Sleep timer & limits (#644, #730, #712)

| # | Feature | Where | How |
| --- | --- | --- | --- |
| #644 | Sleep Timer | ⋮ → Playback → Sleep timer: 5, 10, 15, 30, 45, 60, 90 or 120 minutes, End of this video, Off | One native countdown (`PlaybackDeadline.kt`, a main-looper Handler, so it also runs with the screen off or in the mini player): over the last 10 s the volume ramps down in 100 ms steps, then the player pauses and the volume is set back. "End of this video" stops at the end instead of repeating or going to the next one (`end-of-playback.ts`: `sleepAtEnd` comes first). For this run only; the row shows the minutes left. |
| #730 | Playback Time Limit | ⋮ → Playback → Daily limit: 15, 30, 45 min, 1, 1.5, 2, 3 h, No limit | Watching is counted every 5 s while a video plays and kept per local day (MMKV, reset at midnight). The timer and the limit share the native countdown (whichever is first). At the limit the video fades out and pauses, the "Today's limit is reached" sheet shows, and Play is refused with a toast for the rest of the day. "15 more minutes" and changing the limit need the App Lock PIN when App Lock is on. |
| #712 | Kid Lock | ⋮ → Playback → Kid lock | Every touch on the Player, Back, the volume keys (owner `player.p18.kidLock` on the key channel) and the tab bar do nothing; a lock button stays on screen and holding it for 3 s (a progress bar fills) unlocks. For this run only. |

The countdown is only re-armed when the deadline moves by more than 1.5 s (`shouldRearm`), so the 5 s watch count
never restarts a fade that is under way.

Tests: `sleep-limits.test.ts` (timer and end of video, local day, saved state, watching and more time, the shared
countdown, the re-arm rule, durations, Kid Lock), `p18-sleep-limits.test.ts` (the three rows), `end-of-playback-precedence.test.ts`
(sleep at the end beats repeat and autoplay); JVM `FadeCurveTest.kt`.

### P18 device test (release build, Pixel_8 AVD, 2026-11-23)

| Check | Result |
| --- | --- |
| Sleep timer 5 min, set 13:53:50 | The sound faded out and the player paused at 13:59:00; the row went back to Off |
| Kid lock on | Tab bar, Back and the volume keys did nothing (volume stayed at 7); a 3.6 s hold on the lock unlocked |
| Daily limit 15 min, 7 min already watched, set 14:00:22 | Faded out and paused at 14:08:41; "Today's limit is reached" sheet; Play refused with a toast |
| "15 more minutes" (App Lock off, so no PIN) | The video played again |

## P19 Audio effects & EQ (#548–#552, #555–#558, #729)

| # | Feature | Where | How |
| --- | --- | --- | --- |
| #549 | Equalizer | Audio sheet → Equalizer (switch and five bands: 60 Hz, 230 Hz, 910 Hz, 3.6 kHz, 14 kHz, −12…+12 dB); ⋮ → Audio → Equalizer | Android's `Equalizer` on the player's own audio session (`AudioEffectsHost.kt`), so only VidoraX's sound changes. The design's five gains are mapped onto the phone's bands on a log-frequency scale, in millibels within the phone's range (`mapGainsToDevice`). A phone without an equalizer shows it as unavailable. |
| #550 | EQ Presets | Audio sheet: Flat, Bass, Vocal, Rock, Pop, Classical, Jazz | Picking one sets the five gains and turns the equalizer on; moving a band makes it Custom. |
| #729 | Save EQ | Audio sheet → Save as a preset (a name of up to 30 characters); delete from the chosen preset | Up to 20 of the user's presets, newest first, app-wide (MMKV). |
| #551 | Bass Boost | Audio sheet → Effects (0–100 %) | Android's `BassBoost` on the same session (created when first turned on, released at 0 %). |
| #552 | Virtualizer | Audio sheet → Effects (0–100 %) | Android's `Virtualizer` on the same session. |
| #548 | Volume Boost | Audio sheet → Effects (Off, 110–200 %); ⋮ → Audio → Volume boost | `SoundShaper.kt` inside `VidoraAudioProcessor`: up to +6 dB with a soft limiter (knee 0.8) so it never clips. |
| #556 | Balance | Audio sheet → Sound (left 100 … centre … right 100) | `SoundShaper`, stereo only. |
| #555 | Mono | Audio sheet → Sound; ⋮ → Audio → Mono | `SoundShaper`: both channels get the average, stereo only. |
| #557 | Night mode audio | Audio sheet → Sound; ⋮ → Audio → Night mode | `SoundShaper`: a compressor (−30 dB threshold, 3:1, +9 dB make-up), so quiet parts are louder and loud parts softer. |
| #558 | Volume normalization | Audio sheet → Sound | `SoundShaper`: a gain towards −20 dBFS (±12 dB) from a 1.5 s loudness window, moving at most 6 dB/s, starting from the first sound (not the silence before it). |

Everything applies at once and is kept app-wide; "Reset sound settings" puts it all back (the user's presets stay).
The effects stay on while the video carries on in the mini player and are released with the player
(`releasePlayer`). The section sits in P17's Audio sheet (design screen 22), and its options-sheet rows follow P17's.

Tests: `audio-effects.test.ts` (settings clean-up, presets, custom, user presets and the cap, band mapping, reset),
`p19-effects.test.ts` (the four rows); JVM `SoundShaperTest.kt` (8: pass-through, mono, balance, stereo only, boost
never clips, soft limit, night mode, normalization).

### P19 device test (release build, Pixel_8 AVD, 2026-11-23)

| Check | Result |
| --- | --- |
| Audio sheet on quiet.mp4 | Equalizer section with the presets and five bands, Effects, Sound |
| Rock | `dumpsys media.audio_flinger`: "1 effects for session 281 … Equalizer … Enabled" (VidoraX's session) |
| Bass boost 70 %, Virtualizer 70 % | "3 effects for session 281": Equalizer, Dynamic Bass Boost, Virtualizer |
| Volume boost 170 %, Mono, Night mode, Normalization on | Playback stays PLAYING, no player or audio-sink errors in logcat |
| App closed and opened again, left-only.mp4 | Every setting kept; "3 effects for session 289" on the new player's session |
| Balance dragged left; 3.6 kHz dragged right; 910 Hz tapped at a quarter | L 60; +6 dB; −6 dB |
| A vertical swipe that starts on a slider | The sheet scrolls; the slider keeps its value |
| Save as a preset "Night Rock", then a band moved, then Night Rock | The chip shows after Jazz; picking it restores +5 / +2 / −2 / +2 / +5; "Delete preset" removes it |
| Reset sound settings | Everything off / flat; `audio_flinger` lists no effects on the session; still PLAYING |

Bugs found and fixed before commit:

- The sliders were drawn and dragged mirrored in English: `useTranslation().rtl` is the RTL layout object (always
  truthy). `EngineSlider` now uses `isRtl`.
- A vertical swipe starting on a slider set its value and the sheet didn't scroll. The slider now only takes a drag
  once it goes sideways (or a tap), and lets the sheet's ScrollView have vertical swipes.
- The preset's name field opened under the keyboard (the Player's sheets have no keyboard handling). It is now a dialog
  of its own (`AppModal` + `TextField`, as P9's bookmark names).

## After P19: TalkBack says which choice is selected

The Speed button rows (P16) and the Sleep timer and Daily limit choices (P18) showed the selected one only with a
check icon. Like the other choice sheets (stream quality, volume keys, audio track), their TalkBack label now ends in
"Selected".

## Integration fixes (found while testing the merged build, 2026-11-23)

| Fix | Why | Device check |
| --- | --- | --- |
| P15 #701: ⏩ reaches the media session | React Native 0.86 takes `KEYCODE_MEDIA_FAST_FORWARD`'s key down for its developer menu even in a release build (`ReactDelegate.onKeyDown` only checks that a dev-support manager exists). Only the key up reached the session, so a remote's or headset's ⏩ did nothing while VidoraX was in front. `MainActivity.onKeyDown` now passes it on in release builds (debug keeps the developer menu). | ⏩ with the Player in front: +15 s (the session's key log shows DOWN and UP); ⏪ −5 s as before |
| A player's native parts go with it | `useVideoPlayer` releases the player in its own unmount cleanup, before the session's `releasePlayer` call ran, so every switch logged `engine_call_failed` and the audio effects were never released explicitly. A third expo-video hook, `VideoPlayerHooks.onRelease` (`scripts/patch-expo-video.js`), runs on the main thread just before the ExoPlayer is released; the module drops the effects, countdown and session player there. JavaScript marks the player in a layout-effect cleanup and skips it from then on. | EQ on, mini player closed: no failed calls, `audio_flinger` shows no effects left; switching videos logs nothing |
| P18 runs with the session | The countdown, counting and the limit lived in the Player screen's view: leaving it for the mini player cancelled the countdown and let Play go past the limit. `useSleepLimitSession` now runs in PlayerSessionHost's runner (full Player, mini player, screen off); the limit sheet and Kid Lock's keys stay on the screen (`useSleepLimitsView`). | At the limit, Play in the mini player is refused at once with the toast; "End of this video" stops at the end and the timer turns Off |

