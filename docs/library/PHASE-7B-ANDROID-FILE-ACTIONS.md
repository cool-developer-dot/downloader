# Phase 7B — Android File Actions & Download Notifications

## 1. Pre-7B architecture

Phase 7A already owned completed-file identity (`CompletedFileDescriptor`, MIME, path, capabilities).

Downloads Open/Share used Expo `File.contentUri` but:

- Android RN `Share.share` dropped the file URL (text-only)
- Open used `Linking.openURL` without `FLAG_GRANT_READ_URI_PERMISSION` / MIME
- Library exposed Play only (no Open/Share UI)
- Terminal COMPLETED/FAILED notifications already existed via engine bridge + MMKV dedupe, with channel / permission / dedupe-before-success gaps

## 2. Completed-file action service

Central APIs (`src/downloads/completed-file/action-service.ts`):

- `playCompletedFile(downloadId)`
- `openCompletedFile(downloadId)`
- `shareCompletedFile(downloadId)`
- `resolveCompletedFileActionsForId(downloadId)`

Always resolve by **downloadId** → managed catalog/engine record → `assertManagedDownloadPath` → physical verify.

Never accept arbitrary caller filesystem paths.

## 3. Content URI mechanism

Android external handoff uses Expo File System:

`File.contentUri` → `com.anonymous.vidorax.FileSystemFileProvider`

No second app FileProvider was added.

## 4. FileProvider / Expo decision

**Reuse Expo `FileSystemFileProvider`** (merged from `expo-file-system`):

- `exported=false`
- `grantUriPermissions=true`
- paths: `<files-path>` + `<cache-path>` (module XML)

VidoraX does **not** add `root-path` or a custom provider.

## 5. Path validation

`assertManagedDownloadPath` + `verifyCompletedFile` before URI creation.

Native module rejects non-`content://` and `file://` inputs.

## 6. URI grants

Native Open/Share set:

`Intent.FLAG_GRANT_READ_URI_PERMISSION`

No write grants. No chmod. No public temp copies.

## 7. Play

Internal: `/player/{downloadId}` via existing player.

Requires COMPLETED + physical file. No sourceUrl / Cookie / Auth.

## 8. Open

Native `VidoraFileActions.openContentUri`:

`ACTION_VIEW` + `setDataAndType` + content URI + read grant + chooser.

## 9. Share

Native `VidoraFileActions.shareContentUri`:

`ACTION_SEND` + `EXTRA_STREAM` + MIME + read grant + Sharesheet.

No source URL / Cookie / Authorization / requestContext attached.

## 10. MIME behavior

Phase 7A MIME is primary (`resolveExternalHandoffMime`).

Unknown → intent fallback `*/*` only for Intent construction; does not overwrite persisted MIME.

## 11. Notification architecture

Observers only:

engine terminal event → `ensureDownloadNotificationBridge` → `DownloadNotificationService`

Never part of download correctness.

## 12. Notification permission

Preference ∧ Android grant.

One-time contextual request when preference enabled and status undetermined (MMKV prompt marker).

Denied ≠ download failure.

## 13. Notification channel

Stable id: `vidorax_download_events`

Schedules use `trigger: { channelId }` (not Expo fallback).

Importance: DEFAULT. No alarm-like MAX.

## 14. Terminal event source

Single source: `downloadEngine.subscribe` in `ensure-bridge.ts` (`completed` / `failed`).

Not Library mount, not catalog hydration, not DownloadCard render.

FAILED defers 80ms and skips when retry still scheduled.

## 15. Dedupe

`canEmitTerminalNotification` + `markTerminalNotificationEmitted` **after successful schedule**.

Key: `${downloadId}:COMPLETED|FAILED`, TTL 7d, max 200 entries (MMKV).

## 16. Tap routing

Payload: `{ type: 'DOWNLOAD_DETAILS', downloadId, event? }`

→ `/downloads/{id}` when present, else `/downloads`.

Cold start: pending target until navigation ready.

## 17. Error mapping

`CompletedFileActionError` / `mapCompletedActionError`:

FILE_MISSING, NO_COMPATIBLE_APP, URI_CREATION_FAILED, OPEN_FAILED, SHARE_FAILED, …

Notification failure reasons: Session expired / Source unavailable / File validation failed / Network error (safe taxonomy only).

## 18. Security

- No Cookie / Authorization / signed URL / requestContext in intents or notification payloads
- No broad storage permissions added for Open/Share
- No MediaStore / public Downloads
- No base64 whole-file loads

## 19. Phase 6 privacy

Completed local files are independent of ephemeral session auth after COMPLETED.

## 20. Exact 7B boundaries

Owns: Play / Open / Share / content URI grants / completion+failure notifications / permission UX / tap routing / dedupe.

Does **not** own: MediaStore export, Save to Gallery, deletion redesign, FGS redesign, Phase 8 player, FFmpeg.

## 21. Manual acceptance

`mobile/docs/testing/PHASE-7B-ANDROID-FILE-ACTIONS-REAL-ANDROID-ACCEPTANCE.md`
