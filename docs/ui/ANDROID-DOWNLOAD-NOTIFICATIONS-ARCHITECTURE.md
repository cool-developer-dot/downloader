# Android Download Notifications — Architecture (Phase 3)

## 1. Notification ownership

**Owner:** `DownloadNotificationService` + `ensureDownloadNotificationBridge`

Observes `downloadEngine` events. Never starts workers, never mutates transfer state.

## 2. Channel model

Stable id: `vidorax_download_events`

Created idempotently (native `NotificationChannel` and/or expo-notifications).

FGS channel id `vidorax_downloads_fgs` reserved for operational FGS when native FGS exists — not a second optional-alerts channel.

## 3. Permission model

Effective alerts = Download Settings preference ∧ OS `POST_NOTIFICATIONS` (API 33+).

One-time contextual request when preference on + undetermined.

Denied → suppress presentation only.

## 4. State → notification mapping

| Engine status | Presentation |
| --- | --- |
| PREPARING / STARTING / QUEUED | Preparing download (indeterminate) |
| WAITING_FOR_WIFI | Waiting for Wi-Fi |
| DOWNLOADING | Downloading + progress |
| FINALIZING | Preparing (indeterminate) — **not** success |
| PAUSED | Download paused |
| RETRYING | Retrying download |
| COMPLETED | Download complete (terminal) |
| FAILED | Download failed (terminal, if no retry) |
| CANCELLED | Dismiss active notification |

## 5. Progress throttling

`shouldPublishProgressTick`: publish on state/percent change or ≥1s interval.

Does **not** throttle internal byte accounting.

## 6. Notification ID strategy

- Expo string: `vidorax-dl-active-{downloadId}` / `completed` / `failed`
- Android int: deterministic hash from downloadId (avoids FGS id `77021`)

Same download always updates the same notification.

## 7. Terminal dedupe

MMKV-backed `canEmitTerminalNotification` / `markTerminalNotificationEmitted` after successful schedule. TTL 7d, max 200 entries.

## 8. Completion timing

Only on engine `completed` event after authoritative COMPLETED commit (post-FINALIZING validation).

## 9. PendingIntent / navigation

Native: `vidorax://downloads/{downloadId}` → MainActivity (IMMUTABLE PendingIntent).

Expo: response listener → `resolveNotificationNavigation` → `/downloads/{id}` or `/downloads`.

Payload: `{ type: 'DOWNLOAD_DETAILS', downloadId }` only — never paths/cookies/URLs.

## 10. App Lock interaction

`setNotificationAuthProbe`: when App Lock enabled + LOCKED, defer navigation.

On UNLOCK: `flushPendingNotificationTarget`.

Lock is never bypassed.

## 11. Completed-media identity reuse

Tap opens download details for the same `downloadId` used by Play/Open/Share (`resolveCompletedMedia`).

## 12. Multiple downloads

Per-download ids + per-download throttle maps → independent notifications.

## 13. Lifecycle / background

Bridge attaches once at bootstrap. Native NotificationManager updates work while process alive.

Optional FGS (if present) remains separate operational surface.

## 14. Permission-denied behavior

No notification. Download queue/worker/completion unaffected.

## 15. Performance boundaries

- No per-byte notification updates
- Channels created once
- No file resolution on progress ticks
- No large bitmaps

## 16. Android manual acceptance

`docs/testing/ANDROID-DOWNLOAD-NOTIFICATIONS-REAL-DEVICE-ACCEPTANCE.md`

## Root causes addressed

1. Native FGS progress module was missing → no progress notifications in practice  
2. Terminal-only optional alerts (COMPLETED/FAILED) without active lifecycle mapping  
3. App Lock auth probe unwired for notification deep links  
4. Channel/permission/progress ID contracts hardened for multi-download independence  
