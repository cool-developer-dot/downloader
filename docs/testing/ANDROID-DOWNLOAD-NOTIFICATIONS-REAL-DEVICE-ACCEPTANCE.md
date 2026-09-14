# Android Download Notifications — Real Device Acceptance

Phase 3: production Android download notifications.

All runtime cases start as **NOT_TESTED**.

## Preconditions

- Development build with `VidoraDownloadNotifications` native module (not Expo Go for progress bars)
- Android 13+ device for permission cases
- Download notifications preference enabled in Download Settings
- Do **not** use `expo prebuild` for this checklist

## Architecture note

- **Optional presentation** notifications: preference ∧ POST_NOTIFICATIONS
- **FGS** (if/when native `VidoraXDownloadForeground` is present) remains operational and separate
- Permission denied → **downloads still work 100%**; notifications absent only

---

## N1 — Permission granted

**Status:** NOT_TESTED

Android 13+: grant notification permission. Start download.

**Expected:** notification appears; download continues normally.

---

## N2 — Permission denied

**Status:** NOT_TESTED

Deny notification permission. Start download.

**Expected:** QUEUES → STARTS → PROGRESSES → COMPLETES. No crash. No notification.

---

## N3 — Progress

**Status:** NOT_TESTED

Start a large video.

**Expected:** one notification per download; progress updates smoothly; no spam/flicker.

---

## N4 — Pause / Resume

**Status:** NOT_TESTED

Downloading → Pause → notification “Download paused”. Resume → Starting/Downloading. Exactly one notification identity.

---

## N5 — Waiting for Wi-Fi

**Status:** NOT_TESTED

Where Wi-Fi-only applies: notification reflects waiting state. No new downloader behavior.

---

## N6 — Completion

**Status:** NOT_TESTED

Complete download.

**Expected:** only after authoritative COMPLETED: “Download complete” + filename. Not during FINALIZING.

---

## N7 — Tap completion

**Status:** NOT_TESTED

Tap Download complete → VidoraX opens correct download details. App Lock (if enabled) still gates.

---

## N8 — Failure

**Status:** NOT_TESTED

Controlled failed download (no auto-retry): failure notification, no fake success.

---

## N9 — Multiple downloads

**Status:** NOT_TESTED

≥3 downloads: independent notifications; no overwriting.

---

## N10 — Background

**Status:** NOT_TESTED

Start download, background app: existing background-download behavior + useful notification when permitted.

---

## N11 — Process recovery

**Status:** NOT_TESTED

Within existing recovery guarantees: no duplicate IDs / stale duplicates.

---

## N12 — Completion dedupe

**Status:** NOT_TESTED

One completion → exactly one terminal completion notification.

---

## Build

**APK_NOT_BUILT_BY_REQUEST**
