# Share Completed Media — Real Android Acceptance

Phase 2: Completed download → **Share** → Android Sharesheet → **actual video attachment**.

All runtime cases start as **NOT_TESTED**.

## Preconditions

- Android device with WhatsApp / Telegram / Messages (or similar) installed
- Valid completed downloads (MP4; WebM if supported)
- Native build including `VidoraFileActions` (RN `Share.share` alone cannot attach files on Android)
- Do **not** use `expo prebuild` for this checklist

## Root-cause note (code)

React Native’s Android `ShareModule` always uses `text/plain` and only `EXTRA_TEXT` / `EXTRA_SUBJECT` — it **ignores** `url`. Any fallback that called `Share.share({ message: fileName })` produced filename-only shares.

VidoraX Share must use `VidoraFileActions.shareContentUri` → `ACTION_SEND` + `EXTRA_STREAM` + `content://` + read grant.

---

## S1 — Share MP4

**Status:** NOT_TESTED

1. Complete an MP4 download.
2. Tap **Share** (Downloads list, Details, or Library).
3. System chooser opens → pick WhatsApp/Telegram/etc.

**Expected:**

- Actual video attached (not only `video-name.mp4` text)
- Recipient can play the media

---

## S2 — Share WebM

**Status:** NOT_TESTED

Share a completed WebM (if VidoraX produces it).

**Expected:** correct media attachment + MIME (`video/webm`).

---

## S3 — Large file

**Status:** NOT_TESTED

Share a large completed video.

**Expected:** chooser opens without duplicating the full file into JS; no long UI freeze.

---

## S4 — Cancel chooser

**Status:** NOT_TESTED

Share → dismiss chooser.

**Expected:** no error toast; download intact.

---

## S5 — Missing file

**Status:** NOT_TESTED

COMPLETED catalog row whose final file is gone.

**Expected:** clear missing-file message; no chooser with a broken attachment.

---

## S6 — Rapid tap

**Status:** NOT_TESTED

Tap Share repeatedly.

**Expected:** single-flight (no stacked choosers / stuck busy); no corrupted state.

---

## S7 — Multiple entry points

**Status:** NOT_TESTED

Share from every completed-media entry point (Downloads card, Details, Library).

**Expected:** all attach the same real file.

---

## S8 — Regression

**Status:** NOT_TESTED

After Share: **Play**, **Open**, Delete/export still behave as before.

---

## Build

**APK_NOT_BUILT_BY_REQUEST** for agent work. Device testing requires a native rebuild that includes the updated `VidoraFileActionsModule`.
