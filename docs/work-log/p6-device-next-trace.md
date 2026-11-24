# P6: Device videos don't switch (Up next / ⏮ restart the same video)

**Repro (phone):** Device videos → quiet.mp4 → Up next → tap two-audio.mp4 → quiet.mp4 restarts. Also ⏮ near the
start. Seen before and after Faran's P14–P19 merge. Faran suspects the `device:<id>` route param.

## Root cause, found and fixed (Faran, 2026-11-24)

Found on the Pixel_8 emulator with a release build that had the `[P6-DEVNEXT]` lines switched on for the test. The
route, the queue, the session and the device lookup were all right, as the trace below says. Opening two-audio.mp4
showed `session_shown` with two-audio's own `_ID`, then at once `go_to_media from=two-audio target=left-only`, then
`go_to_media from=left-only target=quiet`: each video that opened moved itself on to the next.

- **Why:** each session's player starts empty (`useVideoPlayer(null)` in `use-player-session.ts`) and prepares an
  empty playlist, which ExoPlayer reports as ended. expo-video then sends `playToEnd` (its `setStatus` sends it
  whenever the state is ENDED) before the video is loaded. The session's own handler ignored it (no source yet), but
  P5's end of playback (`use-repeat.ts`) acted on it.
- **Why it looked like device videos:** it shows only with Auto Play Next or Repeat all on (the video jumps on, then
  the next one too, until a video sits behind a slower load; quiet.mp4 "restarted" because the chain ended on it) or
  Repeat one (the video restarts). With Stop, the default, the stray end does nothing. The device-video queue was
  where Auto Play Next had been switched on.
- **Fix:** `isRealPlayToEnd` (`src/player/end-of-playback.ts`): an end counts only when the session is ready, has no
  error and the player knows the video's length. Used by `use-repeat.ts` and by the session runner's mini-player end
  (`src/player/session-host/use-session-end-of-playback.ts`). Unit tests in `end-of-playback.test.ts`.
- **Check 145** passed on the emulator after the fix (Up next, ⏮, ⏭, Auto Play Next, opening from Device videos with
  Auto Play Next on).
- The `[P6-DEVNEXT]` logger (`src/player/p6-devnext-diagnostics.ts` and its calls in `PlayerScreen.tsx`) was removed
  with the fix, as its header asked; the tests in `src/player/p6-device-next.test.ts` stay.

The rest of this file is Hamza's trace from before the device run.

**Result (before the device run):** the cause is **not found**. Every JavaScript step below handles `device:<id>` exactly as it handles a
library id. That was checked by reading the code and by `node:test` cases that walk the same path
(`src/player/p6-device-next.test.ts`, all passing). Two steps can only be seen on a device: expo-router's own
native-stack state, and the native player. The `[P6-DEVNEXT]` development-build log lines now cover them. No fix was
made by guessing.

The example ids below are `A = device:1000000034` (quiet.mp4) and `B = device:1000000035` (two-audio.mp4).

## 1. The route from Device videos

| Step | File · function | Value |
| --- | --- | --- |
| MediaStore row | `modules/vidorax-media/android/.../library/DeviceVideos.kt` `list` (l. 87–94) | `id = "1000000034"` (`_ID` as a string), `uri = content://media/external/video/media/1000000034` |
| Native → JS | `VidoraMediaModule.kt` `listDeviceVideos` (l. 389) | `limit` clamped to 1–500 |
| Listing | `src/player/device-media.ts` `listDeviceVideos(limit = 200)` → `rememberDeviceVideos` | in-memory map `"device:1000000034" → {uri, title, …}` |
| Tap a row | `src/screens/device-videos/DeviceVideosScreen.tsx:77` | `openPlayer("device:1000000034", items.map(deviceMediaId))` |
| Id | `device-media.ts` `deviceMediaId` | `"device:" + video.id` = `device:1000000034` |
| Queue | `src/navigation/helpers/open-player.ts` `openPlayer` → `play-queue.ts` `playQueueOnOpen` / `setPlayQueue` | `ids = ["device:1000000034", "device:1000000035", …]` (the listed page only, up to 200) |
| Route | `src/navigation/constants/route-paths.ts` `playerPath` | `/player/device%3A1000000034` (`encodeURIComponent`) |
| Push | `navigation.push` → `safePush` → `router.push` | the app stack's `player/[id]` screen |

## 2. How the Player parses and resolves it

| Step | File · function | Value |
| --- | --- | --- |
| Param | `PlayerScreen.tsx` `PlayerScreen`: `useLocalSearchParams()` (expo-router 57.0.11 decodes each value once) | `device:1000000034` |
| Parse | `src/player/media-id.ts` `parseRouteMediaId` (decodes again, then `assertSafeMediaId`) | `device:1000000034` (no `/`, no scheme, ≤ 128 chars: accepted) |
| Session | `session-host/use-full-player-session.ts` layout effect on `[mediaId]` → `player-session-store.ts` `openPlayerSession` | `shouldReuseSession` compares mediaIds; a different id → new `request = {key: n+1, mediaId}` |
| Runner | `session-host/PlayerSessionHost.tsx` `<PlayerSessionRunner key={request.key}>` | a new runner → a new `useVideoPlayer` |
| Resolve | `use-player-session.ts` effect on `[mediaId, …]` → `resolvePlaybackSource` → `resolve-playback-source.runtime.ts` `getLocalRecord` | `isDeviceMediaId` → `knownDeviceVideo(mediaId)` → `localUri = content://…/1000000034` |
| Load | `use-player-session.ts` `player.replaceAsync({ uri })` (`shouldAssignPlaybackSource`, per generation) | `content://media/external/video/media/1000000034` |
| Shown | `useFullPlayerSession` returns `live` only when `live.requestedMediaId === mediaId`; `<PlayerSessionView key={live.key}>` | the view remounts per session |

## 3. Queue items for device videos

`src/player/play-queue.ts` stores **ids only**: plain `device:<id>` strings, with no uri and no other key. They are the
same strings the route carries, because both come from `deviceMediaId`. The Up next rows
(`src/screens/player/page/QueueSheet.tsx`) are keyed `key={id}`. A title comes from `queue-media.ts` `titleOf` →
`knownDeviceVideo`. After a restart, `play-queue-persistence.ts` lists device videos again (`listDeviceVideos(1000)`,
which the native side clamps to 500).

## 4. What Up next, ⏮ and ⏭ call

| Control | Path | Id |
| --- | --- | --- |
| Up next row | `QueueSheet` `onPlay(id)` → `PlayerScreen` `goToMedia(id)` → `router.setParams({ id })` | `device:1000000035`, raw (not `%3A`) |
| On-screen ⏮ / ⏭ | `onPrevious` / `onNext` → `goToMedia(previousId / nextId)` from `usePlayQueueNeighbours(activeMediaId)` | the queue neighbour; **no 3 s rule** on the screen buttons |
| Headset / notification ⏮ | `src/player/engine/use-headset-keys.ts` → `player-keys.ts` `previousTarget(position, hasPrevious)` | `previous` within 3 s when there is one; otherwise **restart** (Faran's P15) |
| Auto Play Next, Repeat all, the card | `src/screens/player/page/use-repeat.ts` / `NextEpisodeCard` → `goToMedia(id)` | the same `goToMedia` |

`setParams` (expo-router `global-state/router.js`) dispatches `SET_PARAMS` to the focused route, which is the Player.
The new value is read back through `useLocalSearchParams` (decoded once) and `parseRouteMediaId`, giving
`device:1000000035`.

## 5. How the Player decides the source changed

- `useFullPlayerSession`: `useLayoutEffect(() => openPlayerSession(mediaId), [mediaId])`.
- `PlayerScreen`: `useFocusEffect(() => openPlayerSession(mediaId), [mediaId])`.
- `openPlayerSession`: a new key unless `request.mediaId === mediaId` and there is no error.
- `PlayerSessionHost`: the runner is keyed by `request.key`, so a new id means a new player.
- `use-player-session.ts`: the resolve effect depends on `[mediaId, loadNonce, player, …]`, and `replaceAsync` runs per
  generation.
- `PlayerSessionView` is keyed by `live.key`.

Nothing here compares a uri, title, size or other value that two device videos could share.

## Hypotheses

| # | Hypothesis | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 | **Id mismatch**: the queue holds a raw id or uri while the route holds `device:<id>` | **Ruled out** | Both come from `deviceMediaId`; `queueNeighbours` finds them (test: "Up next → B", "⏭ with [A, B]") |
| 2 | **Encoding**: `:` encoded differently when building and parsing | **Ruled out in JS** | `device%3A…` and `device:…` both parse to `device:…`, stored encoded or decoded (test: "a device id survives the route"). Only expo-router's native state could differ; the `route` log line shows it |
| 3 | **Same screen reused**, and the source effect doesn't follow the parsed id | **Ruled out** | The screen stays mounted by design, but `useFullPlayerSession` follows `mediaId`, and the runner and view are keyed (test: a new session key for B) |
| 4 | **Device lookup fallback**: `knownDeviceVideo` misses, falling back to the current source | **Ruled out as this symptom** | A miss returns `null` → `MEDIA_NOT_FOUND` (an error screen), never the previous source. In the repro, B was just listed |
| 5 | **Same key**: "source changed" compares something equal for two device videos | **Ruled out** | Keys are the request key and mediaId; each device video has its own `content://…/<_ID>` |
| 6 | **⏮ near the start** | **By design, in one case** | With no video before A, ⏮ (headset / notification) restarts A (`previousTarget(1, false) === 'restart'`). The on-screen ⏮ calls `goToMedia(previousId)` and is disabled with no previous. With one (`[B, A]`), it goes to B (test) |

## Tests (`src/player/p6-device-next.test.ts`)

- **Cases:**
  - Device, library and playlist sources each: Up next → B; ⏮ at 1 s with `[B, A]`; ⏭ with `[A, B]`; the same video
    keeps its session.
  - ⏮ with nothing before A restarts it (by design).
  - The `device:` round trip.
  - The `[P6-DEVNEXT]` helpers: silent outside development builds, no full uri, no stack paths.
- **They pass on the current code.** These are not failing-first tests: they show those layers are not the cause.
- **What was asked for and isn't possible here:** a Jest test that renders the whole Player with expo-video, the
  router and the device list mocked. The repo has no Jest and no React renderer (tests run on `node:test`), and this
  work may add no npm package.

## What the device run must show (`[P6-DEVNEXT]`, development builds only)

Filter the lines with `adb logcat | grep P6-DEVNEXT` (or the Metro console). Each line names an event:

| Line | When | Fields |
| --- | --- | --- |
| `route` | the Player's route id changes | `raw` (as the router gives it), `parsed` |
| `go_to_media` | Up next / on-screen ⏮ ⏭ / Auto Play Next / the card | `from`, `fromKey`, `target`, `targetSource` (the MediaStore `_ID`), `queue.length`, `queue.head` (first 20), `queue.targetIndex` |
| `session_request` | any session is opened or replaced, by anything | `fromKey`, `fromMediaId`, `toKey`, `toMediaId`, `caller` (function names) |
| `session_shown` | the session the Player shows changes | `routeMediaId`, `key`, `requestedMediaId`, `sessionMediaId`, `source` (the `_ID`) |

**How to read them:**

| What the lines show | Meaning | Where the fix goes |
| --- | --- | --- |
| No `go_to_media` after the tap / ⏮ | the tap never reached the Player (⏮ from the headset or notification takes P15's restart path) | the control's handler |
| `go_to_media` with `targetIndex: -1` or a `target` that isn't `device:` | the queue or the row gave a wrong id | the queue / Up next |
| `go_to_media target=B`, then `route raw=A` (or no `route` line) | the router kept or restored A's param | the route (`setParams` → `replace` / `push`) |
| `route parsed=B`, `session_request toMediaId=B`, then `session_request toMediaId=A` | something reopened A; `caller` names it | that caller |
| `session_shown requestedMediaId=B` with `source` = A's `_ID` | the wrong file was resolved for B | `knownDeviceVideo` / native listing |
| `session_shown` B with B's `_ID`, but A's picture | the native player kept A's media | `use-player-session.ts` / expo-video (Faran's) |
