# Phase 7C — Export / Delete Reliability

## 1. Pre-7C architecture

Phase 1 owns transfer into app-private storage:

`VidoraXDownloads/{downloadId}/{fileName}`

Phase 7A owns completed-file identity (MIME, name, path, presence).

Phase 7B owns Play / Open / Share over temporary `content://` grants + terminal notifications.

Before 7C:

- No MediaStore / SAF permanent publication
- Delete was store → engine.remove → best-effort file delete (catalog could drop while orphans remained)
- Library action sheet lacked Save / Delete-from-VidoraX semantics tied to public-copy ownership

## 2. Export architecture

Central service: `saveCompletedFileToDevice(downloadId)` in
`src/downloads/completed-file/export/export-service.ts`.

Flow:

`downloadId` → Phase 7A descriptor → COMPLETED + physical verify →
`assertManagedDownloadPath` → destination/MIME → native copy/publish →
non-secret receipt → UX.

Never accepts arbitrary UI paths. Export is **copy/publication**, never move.

Native: `VidoraMediaExport` (`mediaexport/VidoraMediaExportModule.kt`),
registered via `MediaExportNativePackage` in `MainApplication.kt`.

## 3. API-level storage policy

| API | Strategy |
| --- | --- |
| 29+ | MediaStore insert with `IS_PENDING` → stream → publish (`IS_PENDING=0`) |
| 24–28 | `ACTION_CREATE_DOCUMENT` (SAF); user cancel → `LEGACY_EXPORT_CANCELLED` |

No `MANAGE_EXTERNAL_STORAGE`. No arbitrary raw public filesystem writes.

## 4. MediaStore collection policy

| Content | Collection | `RELATIVE_PATH` |
| --- | --- | --- |
| MP4 / WebM / typical video | `video` | `Movies/VidoraX/` |
| Audio | `audio` | `Music/VidoraX/` |
| TS / HLS final `.ts` | `downloads` | `Download/VidoraX/` |
| Unknown | `downloads` | `Download/VidoraX/` + `application/octet-stream` action-local fallback |

TS is never fake-relabeled as Gallery MP4.

## 5. MediaStore transaction

1. Insert pending row (`IS_PENDING=1`)
2. Open output stream
3. Stream private source via `FileInputStream` (64 KiB buffer)
4. Verify copied bytes == expected
5. Publish (`IS_PENDING=0`)
6. On any failure: delete pending row; private file untouched; download stays COMPLETED

## 6. Streaming

Native streams only. No Base64 whole-file bridge through JS. Large files must not explode RN memory.

## 7. Duplicate policy

**Chosen policy (one):**

If an export receipt exists **and** the public URI still exists → **Already saved**
(no endless duplicate copies).

If the public URI was deleted externally → clear stale receipt → allow fresh export.

## 8. Collision policy

Unrelated same-name public items must not be overwritten.

Pure helper: `video.mp4` → `video (1).mp4` → `video (2).mp4` (extension preserved).

MediaStore insert creates a new row rather than truncating an existing item.

## 9. Export receipt

Non-secret fields only (`exportedContentUri`, `exportedDisplayName`, `exportedAt`,
`pendingExportUri`, `pendingExportStartedAt`).

Persisted in existing MMKV:

`vidorax.mmkv.completedFile.exportReceipts.v1`

**Not** a new SQLite / remote DB. Never Cookie / Authorization / signed source URL /
`requestContext`.

Exported URI is a receipt for an optional public copy — **not** the Phase 1
`canonicalPath`.

## 10. Process-death reconciliation

Soft pending marker during export; `reconcilePendingExports()` clears markers and
may delete **incomplete** app-owned pending MediaStore rows.

Never deletes a fully published public item. No permanent “Saving…” after restart.

## 11. Export failure safety

Failure → clear pending → private canonical file remains → status stays COMPLETED →
no ghost success toast. Incomplete pending rows cleaned when owned + proven.

## 12. Save UX

Action: **Save to device**

Success: **Saved to device**

Verified duplicate: **Already saved to device**

Failure: **Unable to save this file** (safe specific reason when useful)

Cancel (legacy SAF): non-fatal.

## 13. Private delete semantics

`deleteCompletedFileFromVidoraX(downloadId)`:

- Only COMPLETED completed-file delete (active jobs use Phase 1 cancel)
- Deletes **private** canonical file + catalog only
- **Never** deletes the public MediaStore/SAF copy
- Dismisses VidoraX completion/failure notifications for that `downloadId`
- Clears export receipt after private delete (public copy remains independently usable)

## 14. Public-copy ownership

Private Phase 1/7A file and optional public copy are independent.

External Gallery/Files delete of the public copy ≠ private download deleted.

Private “Delete from VidoraX” ≠ public copy deleted.

## 15. Delete transaction ordering

**File-first:**

1. Resolve delete plan / lock
2. Delete physical private file when present (success required)
3. Remove catalog + in-memory store
4. Clear receipt / dismiss notification
5. Release lock

Missing physical file → idempotent catalog reconciliation.

## 16. Catalog / filesystem failure matrix

| Physical delete | Catalog remove | Result |
| --- | --- | --- |
| Success | Success | Deleted |
| Fail | (skipped) | Keep catalog; no false success; retry |
| Already missing | Success | Reconciled missing |
| Success | Fail | Recoverable stale catalog; next delete retries catalog; never claim playable |

No Phase 1 `DELETING` transfer state.

## 17. Missing-file reconciliation

`COMPLETED` + missing physical:

- `canPlay` / Open / Share / Save = false
- Delete / Remove from Library still allowed (idempotent)
- Reuse 7A `physicalFilePresent` — no second contradictory state machine

## 18. Stale metadata behavior

Phase 7A normalization remains authority. Bounded refresh on hydrate / explicit
action — no remote HEAD, no per-render `stat`, no continuous scan.

## 19. Partial / temp cleanup rules

Phase 1 owns `.part` / active transfer temps.

7C must **not** delete `.part` for PREPARING / QUEUED / PAUSED / RETRYING /
DOWNLOADING / FINALIZING / etc.

Native export rejects `.part` / `.rangepart` sources.

Failed MediaStore pending rows cleaned by 7C; unexplained valid media orphans are
**not** auto-deleted.

## 20. Operation concurrency

Per-`downloadId` in-memory lock (`operation-lock.ts`):

- Same kind → join in-flight promise
- Export vs Delete → conflict (`EXPORT_IN_PROGRESS` / `DELETE_IN_PROGRESS`)
- No global lock; no timer debounce

## 21. Notification integration

On successful private delete, dismiss known terminal notification IDs:

`vidorax-dl-completed-{id}` / `vidorax-dl-failed-{id}`

Does not delete public media. Does not invent a second notification system.

## 22. Security / privacy

Managed-path validation in JS **and** native (`VidoraXDownloads/{downloadId}/`).

Reject traversal, wrong id directory, secrets paths.

No Cookie / Authorization / signed query in receipts, public names, or Logcat-facing
messages. No FFmpeg / mux / DRM / cloud sync / backend.

## 23. Exact Phase 7C boundaries

**Owns:** Save/Export, MediaStore/SAF, receipt, collision/duplicate policy,
private delete reliability, reconciliation, pending cleanup, Phase 7 integration
verification.

**Does not own:** Phase 1 destination rewrite, detectors, auth, player redesign
(Phase 8), transcoding, public-as-transfer-target downloads.

## 24. Final Phase 7 acceptance plan

Integrated device matrix:

`docs/testing/PHASE-7-COMPLETED-FILE-UX-REAL-ANDROID-ACCEPTANCE.md`

All device cases start **NOT_TESTED**. Static verifier ≠ real Android proof.

Static gate:

`npm run verify:phase7c-export-delete-reliability`
