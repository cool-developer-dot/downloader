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
