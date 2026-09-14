# Pause / Resume Runtime Hardening

## 1. Pre-fix architecture

Pause/Resume already existed end-to-end:

`DownloadCard / Details / Queue` → Zustand `pause`/`resume` → `downloadEngine.pause`/`resume` → progressive / HLS worker → local `.part` + pauseState / hlsTransfer → status hint → store projection → UI.

Catalog `DownloadStatus` stays coarse (`QUEUED` | `DOWNLOADING` | `PAUSED` | …). Phase 1C `DownloadExecutionState` is the fine-grained engine truth (`STARTING`, `FINALIZING`, `WAITING_FOR_WIFI`, …).

## 2. Root cause

Proven combination (not a single Phase 7 classification bug):

1. **ENGINE_STATE_NOT_PROPAGATED** — successful `pause()` often set a status hint without applying execution `PAUSED` and/or without emitting an authoritative status event with `executionState: 'PAUSED'`.
2. **STORE_STATE_NOT_PROPAGATED** — `bind-engine-to-store` blocked `DOWNLOADING|QUEUED → PAUSED` status events (intended for stale post-resume emits) and also ignored `localState === 'paused'` progress while catalog was still `DOWNLOADING`.
3. Progress projection then remapped catalog status from stale execution `DOWNLOADING`, **overwriting** a brief store `PAUSED` patch → Resume disappeared; Pause looked available but the worker was already settled (**ACTION_HANDLER dead tap**).
4. **PAUSE/RESUME_BUTTON_VISIBILITY_REGRESSION** — `getSupportedActions` gated Pause/Resume on `!isPlaylistOrStreamUrl`, hiding controls for HLS even though the HLS worker supports pause/resume via `hlsTransfer`.
5. **FINALIZING_ACTION_VISIBILITY_BUG** — `FINALIZING` catalogs as `DOWNLOADING`, so Pause was shown during finalization.
6. Queue row used `!isHls && status === 'DOWNLOADING'` and had **no Resume** wiring.

Phase 7A `classifyLibraryDownloadState('PAUSED')` correctly returns `active_transitional`. Phase 7C `withCompletedFileOperation` does not wrap pause/resume.

## 3. Runtime action-capability policy

Central resolver: `resolveDownloadRuntimeActions({ status, executionState })`.

| Condition | canPause | canResume | canCancel | canRetry |
| --- | --- | --- | --- | --- |
| COMPLETED / CANCELLED | no | no | no | no |
| FAILED | no | no | no | yes |
| execution FINALIZING | no | no | yes | no |
| PAUSED (not resume-advanced) | no | yes | yes | no |
| DOWNLOADING | yes | no | yes | no |
| QUEUED (+ PREPARING / WIFI / STARTING / RETRYING) | no | no | yes | no |

Distinct from Phase 7A `resolveCompletedActions()`.

## 4. UI state mapping

`getSupportedActions` / `getPrimaryAction` / `QueueActiveRow` / Details all consume the resolver (plus completed open/share/remove). No URL heuristics. No button-local `isPaused` state.

## 5. Pause flow

UI Pause → store `pause(id)` (mutating lock) → `downloadEngine.pause(id)` → clear retry timer → worker.pause or pending cancel → persist `localState: 'paused'` + remote `PAUSED` → `applyExecutionTransition(PAUSED)` → emit status PAUSED → bind-engine patches store → Resume.

Blocked when execution is already `FINALIZING` / `COMPLETED` / `CANCELLED` (completion wins).

## 6. Resume flow

UI Resume → store `resume(id)` → engine validates pauseState / hlsTransfer / multi-range → `applyExecutionTransition(QUEUED)` + emit → release lock → scheduler enqueue → STARTING / DOWNLOADING → Pause.

## 7. Progressive behavior

Preserves `.part`, byte offset, validators, Range `bytes={offset}-`. Matching 206 appends. HTTP 200 does not append (existing validation throws / safe restart path).

## 8. HLS behavior

HLS worker `pause` aborts segment loop and settles paused with `hlsTransfer` checkpoint. Resume requires `hlsTransfer`. No downloader rewrite.

## 9. Wi-Fi behavior

Resume may land in `WAITING_FOR_WIFI` via scheduler policy. Not terminal; Cancel remains available via QUEUED catalog mapping.

## 10. Retry races

Pause clears `retryTimers`. `RETRYING → PAUSED` is an allowed execution transition so Pause wins over auto-retry restart.

## 11. Completion races

`FINALIZING → PAUSED` is illegal. Pause early-returns when execution is FINALIZING. No `COMPLETED → PAUSED`.

## 12. Session-bound behavior

Pause persistence never writes Cookie / Authorization. Same-process resume re-resolves ephemeral context (Phase 6C). Process death keeps `SESSION_CONTEXT_LOST`.

## 13. Process-death behavior

Unchanged recovery: persisted PAUSED hydrates as PAUSED; no automatic resume unless existing recovery policy says so.

## 14. Phase 7 regression review

PAUSED remains `active_transitional`. Completed-file Play/Open/Share/Save/Delete stay separate. Export/delete operation lock does not wrap transfer actions.

## 15. Persistence

Durable PAUSED catalog writes remain on status change (existing `patchItem` durable rules).

## 16. Error mapping

Pause/resume failures surface store `error` / safe engine messages. No secret leakage in logs (`logPauseResume` / hardening diagnostics).

## 17. Manual acceptance

See `mobile/docs/testing/PAUSE-RESUME-REAL-ANDROID-ACCEPTANCE.md` (all cases `NOT_TESTED` until device run).
