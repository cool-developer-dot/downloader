# External Downloaded File Open — Real Android Acceptance

Phase 1: Completed download → **Open downloaded file** → external Android video player.

All runtime cases below start as **NOT_TESTED**. Mark after device validation.

## Preconditions

- Android device/emulator with a compatible video player installed (for A–D, F–G)
- Fresh completed downloads of valid media
- VidoraX debug/dev build that includes `VidoraFileActions` native module
- Do **not** use `expo prebuild` for this checklist

## Manual A — MP4

**Status:** NOT_TESTED

1. Download a valid MP4 until COMPLETED.
2. Confirm internal **Play** works once (sanity).
3. Tap **Open downloaded file**.

**Expected:**

- External video player opens
- Video plays with correct duration/content
- No VidoraX crash

## Manual B — WebM

**Status:** NOT_TESTED

1. Download a valid WebM until COMPLETED.
2. Tap **Open downloaded file**.

**Expected:**

- Compatible external player opens when installed
- Playback succeeds (or clear no-handler message if none installed)

## Manual C — Internal Play regression

**Status:** NOT_TESTED

1. Same completed video as A.
2. Tap **Play** (VidoraX internal).

**Expected:**

- Internal player works exactly as before
- Not routed through ACTION_VIEW / external chooser

## Manual D — File missing

**Status:** NOT_TESTED

1. Use a COMPLETED record whose file was safely removed / unavailable.
2. Tap **Open downloaded file**.

**Expected:**

- Clear message: downloaded file couldn't be found (localized)
- No crash
- No broken Android intent

## Manual E — No compatible app

**Status:** NOT_TESTED

1. Device/format state with no external handler (where practical).
2. Tap **Open downloaded file**.

**Expected:**

- “No compatible video app is installed.” (localized)
- No crash / no ActivityNotFoundException kill

## Manual F — Large file

**Status:** NOT_TESTED

1. Open a large completed video externally.

**Expected:**

- Launch feels immediate
- No whole-file JS read / Base64 / RAM spike from copying the media

## Manual G — Repeat open

**Status:** NOT_TESTED

1. Open the same completed file externally multiple times.

**Expected:**

- Reliable each time
- No stale permission / URI failure

## Notes

- Root-cause fix (code): ACTION_VIEW now sets `ClipData` + temporary read grant and starts the target activity directly (chooser previously dropped URI grants → external “cannot open / unsupported”).
- Provider: Expo `FileSystemFileProvider` (`${applicationId}.FileSystemFileProvider`), `exported=false`, `grantUriPermissions=true`.
- APK_NOT_BUILT_BY_REQUEST for this phase’s CI/agent work.
