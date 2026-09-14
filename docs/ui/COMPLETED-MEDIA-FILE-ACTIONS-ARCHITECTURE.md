# Completed Media File Actions — Architecture

Phases:

1. External Open (ACTION_VIEW)
2. Share actual media (ACTION_SEND + EXTRA_STREAM) — this document’s Phase 2 section
3. Notifications — not implemented here

## 1. Completed media source of truth

`resolveCompletedMedia(downloadId)`:

- COMPLETED catalog + engine refresh
- Reject `.part`
- Managed path + `verifyCompletedFile`
- Returns `{ finalPath, contentUri, mimeType, intentMime, displayName, exists, readable, size, descriptor }`

Play / Open / Share all use this identity (downloadId only).

## 2. URI resolution

Android: Expo `File.contentUri` →

`content://${applicationId}.FileSystemFileProvider/...`

## 3. FileProvider / content URI boundary

Reuse Expo `FileSystemFileProvider`:

- `exported=false`
- `grantUriPermissions=true`
- `files-path` + `cache-path` (no `root-path`)

## 4. MIME resolution

`resolveExternalHandoffMime` — Phase 7A MIME first, then extension. Share MIME must never be `text/plain`.

## 5. ACTION_SEND contract

Native `VidoraFileActions.shareContentUri`:

- `Intent.ACTION_SEND`
- `type` = media MIME (`video/mp4`, `video/webm`, …)
- `EXTRA_STREAM` = content URI
- Optional `EXTRA_SUBJECT` = display title only
- **Never** `EXTRA_TEXT` = filename

## 6. EXTRA_STREAM / attachment contract

Attachment = actual completed media URI.

Filename/title may appear as subject/caption only — not as the sole payload.

## 7. Read permission

`FLAG_GRANT_READ_URI_PERMISSION` + `ClipData` with the same URI.

Best-effort `grantUriPermission` to resolved SEND targets for chooser OEM quirks.

No write grant.

## 8. Chooser behavior

`Intent.createChooser` → system Sharesheet (WhatsApp, Telegram, …). No forced target app.

## 9. Cancellation

User dismissing the chooser is **not** an error. Download unchanged.

## 10. Failure handling

Missing file → localized unavailable message, no chooser.

Native/share failure → `files.shareFailed` (“Unable to share this video.”).

## 11. Entry-point unification

Canonical API: `shareCompletedFile(downloadId)`

Wired from:

- Downloads list
- Download Details
- Library item actions

Legacy `shareLocalDownload` Android path no longer falls back to RN `Share.share`.

## 12. No-copy policy

Direct content URI of the completed private file. No full-video JS copy for Share.

## 13. Security boundary

- downloadId → managed path only
- Trusted FileProvider authority only
- No arbitrary UI paths
- No `.part` / incomplete shares
- No Cookie / Authorization / sourceUrl in intents

## 14. Android manual acceptance

`docs/testing/SHARE-COMPLETED-MEDIA-REAL-ANDROID-ACCEPTANCE.md`

---

## Phase 1 Open (summary)

`ACTION_VIEW` + ClipData + direct startActivity. See prior Phase 1 notes.

## Phase 2 Share — exact root cause fixed

React Native Android `ShareModule` hard-codes `text/plain` and sets only `EXTRA_TEXT` / `EXTRA_SUBJECT` — **it never attaches `url` as EXTRA_STREAM**.

Any Android path that called:

```ts
Share.share({ url: contentUri, message: fileName, title: fileName })
```

shared **only the filename as text**.

Fix: always use native `ACTION_SEND` + `EXTRA_STREAM` + content:// for completed media; never RN Share on Android for files.
