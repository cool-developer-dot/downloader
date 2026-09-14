import { downloadEngine } from '@/downloads/engine';
import {
  catalogStatusForExecutionState,
  workerStateForExecutionState,
} from '@/downloads/execution';
import { logDownloadRuntimeTrace } from '@/downloads/engine/audit-diagnostics.service';
import {
  shouldAcceptPausedStatusEvent,
  shouldRejectLateDownloadingStatusOverPaused,
  shouldRejectLateTransferringOverPaused,
} from '@/downloads/engine/pause-ack';
import { useDownloadsStore } from '@/store/downloads';
import type { DownloadStatus } from '@/api';

let bound = false;

/** Terminal remote statuses — stale transfer events must not resurrect them. */
const TERMINAL_STATUSES = new Set<DownloadStatus>([
  'COMPLETED',
  'CANCELLED',
]);

/**
 * One-time bridge: engine events → Zustand downloads store.
 * Projection only — canonical execution semantics live in the engine (Phase 1C).
 */
export function bindDownloadEngineToStore(): void {
  if (bound) {
    return;
  }
  bound = true;

  downloadEngine.subscribe((event) => {
    const store = useDownloadsStore.getState();

    switch (event.type) {
      case 'status': {
        const existing = store.itemsById[event.downloadId];
        if (
          existing &&
          TERMINAL_STATUSES.has(existing.status) &&
          event.status !== existing.status
        ) {
          break;
        }
        if (
          existing?.status === 'FAILED' &&
          event.status !== 'FAILED' &&
          event.status !== 'QUEUED'
        ) {
          break;
        }
        // After Resume has moved catalog + execution past PAUSED, ignore a late
        // PAUSED emit from the previous pause settlement. Accept authoritative
        // pause when executionState is PAUSED (manager commit).
        // Replaces inline execState !== 'PAUSED' && execState !== 'FINALIZING'.
        if (
          (existing?.status === 'QUEUED' || existing?.status === 'DOWNLOADING') &&
          event.status === 'PAUSED'
        ) {
          const execState =
            event.executionState ??
            downloadEngine.getExecutionSnapshot(event.downloadId)?.state ??
            null;
          if (
            !shouldAcceptPausedStatusEvent({
              catalogStatus: existing.status,
              eventStatus: event.status,
              executionState: execState,
            })
          ) {
            break;
          }
        }
        if (
          shouldRejectLateDownloadingStatusOverPaused({
            catalogStatus: existing?.status,
            eventStatus: event.status,
            executionState:
              event.executionState ??
              downloadEngine.getExecutionSnapshot(event.downloadId)?.state ??
              null,
          })
        ) {
          logDownloadRuntimeTrace({
            downloadId: event.downloadId,
            event: 'STALE_EVENT_IGNORED',
            canonicalStatus: 'PAUSED',
            executionState: 'PAUSED',
          });
          break;
        }
        if (
          (existing?.status === 'QUEUED' || existing?.status === 'DOWNLOADING') &&
          event.status === 'FAILED'
        ) {
          break;
        }

        const resolvedWorkerState =
          event.workerState ??
          (event.executionState
            ? workerStateForExecutionState(event.executionState)
            : undefined);

        store.patchItem(event.downloadId, {
          status: event.status,
          ...(resolvedWorkerState != null
            ? { workerState: resolvedWorkerState }
            : {}),
          ...(event.status === 'QUEUED'
            ? {
                errorMessage:
                  event.errorMessage !== undefined ? event.errorMessage : null,
                errorCode: null,
              }
            : event.errorMessage !== undefined
              ? { errorMessage: event.errorMessage }
              : {}),
        });
        break;
      }
      case 'completed': {
        const existing = store.itemsById[event.downloadId];
        if (existing?.status === 'CANCELLED') {
          break;
        }
        store.patchItem(event.downloadId, {
          status: 'COMPLETED',
          progress: 100,
          fileSize: event.fileSize,
          errorMessage: null,
          errorCode: null,
          // completedAt/downloadedAt must remain stable across restarts/hydration.
          downloadedAt: existing?.downloadedAt ?? new Date().toISOString(),
          workerState: 'COMPLETED',
          ...(event.fileName ? { fileName: event.fileName } : {}),
          ...(event.mimeType !== undefined ? { mimeType: event.mimeType } : {}),
          ...(event.container !== undefined
            ? { container: event.container }
            : {}),
        });
        store.setTransferSnapshot({
          downloadId: event.downloadId,
          bytesWritten: Number(event.fileSize) || 0,
          totalBytes: Number(event.fileSize) || 0,
          progress: 100,
          bytesPerSecond: null,
          etaSeconds: 0,
          localUri: event.localUri,
          localState: 'complete',
          errorCode: null,
          errorMessage: null,
          executionState: 'COMPLETED',
        });
        break;
      }
      case 'failed': {
        const existing = store.itemsById[event.downloadId];
        if (existing?.status === 'CANCELLED' || existing?.status === 'COMPLETED') {
          break;
        }
        store.patchItem(event.downloadId, {
          status: 'FAILED',
          errorMessage: event.message,
          errorCode: event.code,
          workerState: 'FAILED',
        });
        break;
      }
      case 'cancelled': {
        store.patchItem(event.downloadId, {
          status: 'CANCELLED',
          errorMessage: null,
          workerState: 'CANCELLED',
        });
        store.clearTransferSnapshot(event.downloadId);
        break;
      }
      default:
        break;
    }
  });

  downloadEngine.subscribeProgress((snapshot) => {
    const store = useDownloadsStore.getState();
    const existing = store.itemsById[snapshot.downloadId];
    if (existing && TERMINAL_STATUSES.has(existing.status)) {
      return;
    }

    if (
      shouldRejectLateTransferringOverPaused({
        catalogStatus: existing?.status,
        snapshotLocalState: snapshot.localState,
        snapshotExecutionState: snapshot.executionState,
        snapshotWorkerState: snapshot.workerState,
      })
    ) {
      logDownloadRuntimeTrace({
        downloadId: snapshot.downloadId,
        event: 'LATE_PROGRESS_REJECTED',
        canonicalStatus: 'PAUSED',
        executionState: 'PAUSED',
        workerGeneration: snapshot.generation ?? null,
      });
      return;
    }

    if (
      existing?.status === 'PAUSED' &&
      snapshot.localState === 'transferring'
    ) {
      logDownloadRuntimeTrace({
        downloadId: snapshot.downloadId,
        event: 'LATE_PROGRESS_REJECTED',
        canonicalStatus: 'PAUSED',
        executionState: 'PAUSED',
        workerGeneration: snapshot.generation ?? null,
      });
      return;
    }

    if (
      existing?.status === 'FAILED' &&
      snapshot.localState === 'transferring'
    ) {
      return;
    }

    const engineExec = downloadEngine.getExecutionSnapshot(snapshot.downloadId);
    const executionState = snapshot.executionState ?? engineExec?.state ?? null;

    // Paused snapshots must not regress an active resume that already moved on.
    // When execution is PAUSED, promote catalog to PAUSED (legitimate pause).
    if (snapshot.localState === 'paused') {
      const resumeAdvanced =
        executionState === 'QUEUED' ||
        executionState === 'WAITING_FOR_WIFI' ||
        executionState === 'STARTING' ||
        executionState === 'DOWNLOADING' ||
        executionState === 'FINALIZING' ||
        executionState === 'RETRYING' ||
        executionState === 'PREPARING';
      if (
        (existing?.status === 'DOWNLOADING' || existing?.status === 'QUEUED') &&
        resumeAdvanced
      ) {
        return;
      }
    }

    // Stale DOWNLOADING/STARTING/FINALIZING execution must not overwrite PAUSED.
    if (
      existing?.status === 'PAUSED' &&
      (snapshot.localState === 'paused' || snapshot.localState === 'not_started') &&
      (executionState === 'DOWNLOADING' ||
        executionState === 'STARTING' ||
        executionState === 'FINALIZING')
    ) {
      store.setTransferSnapshot({
        ...snapshot,
        bytesWritten: Math.max(
          store.transferById[snapshot.downloadId]?.bytesWritten ?? 0,
          snapshot.bytesWritten,
        ),
        progress: Math.max(
          existing.progress ?? 0,
          store.transferById[snapshot.downloadId]?.progress ?? 0,
          Math.trunc(snapshot.progress),
        ),
        totalBytes:
          snapshot.totalBytes != null && snapshot.totalBytes > 0
            ? snapshot.totalBytes
            : store.transferById[snapshot.downloadId]?.totalBytes ??
              snapshot.totalBytes,
        executionState: 'PAUSED',
        localState: 'paused',
      });
      if (existing.workerState !== 'PAUSED') {
        store.patchItem(snapshot.downloadId, { workerState: 'PAUSED' });
      }
      return;
    }

    const priorTransfer = store.transferById[snapshot.downloadId];
    const monotonicBytes = Math.max(
      priorTransfer?.bytesWritten ?? 0,
      snapshot.bytesWritten,
    );
    const monotonicProgress = Math.max(
      existing?.progress ?? 0,
      priorTransfer?.progress ?? 0,
      Math.trunc(snapshot.progress),
    );

    // Live bytes/progress live on transferById — never SQLite-write mid-transfer progress ticks.
    store.setTransferSnapshot({
      ...snapshot,
      bytesWritten: monotonicBytes,
      progress: Math.max(0, Math.min(100, monotonicProgress)),
      totalBytes:
        snapshot.totalBytes != null && snapshot.totalBytes > 0
          ? snapshot.totalBytes
          : priorTransfer?.totalBytes ?? snapshot.totalBytes,
      executionState,
    });

    const updates: {
      progress?: number;
      fileSize?: string;
      status?: DownloadStatus;
      workerState?: import('@/api').DownloadWorkerState;
    } = {};

    if (executionState) {
      const mappedStatus = catalogStatusForExecutionState(executionState);
      if (mappedStatus !== existing?.status) {
        // Never COMPLETED → PAUSED (or other illegal regressions from progress).
        if (
          existing?.status === 'COMPLETED' ||
          existing?.status === 'CANCELLED'
        ) {
          // skip status
        } else if (
          existing?.status === 'PAUSED' &&
          (mappedStatus === 'DOWNLOADING' || mappedStatus === 'QUEUED')
        ) {
          // Late transferring snapshots must not undo a committed PAUSE.
        } else {
          updates.status = mappedStatus;
        }
      }
      const mappedWorker = workerStateForExecutionState(executionState);
      if (mappedWorker && mappedWorker !== existing?.workerState) {
        if (
          !(
            existing?.status === 'PAUSED' &&
            (mappedWorker === 'TRANSFERRING' || mappedWorker === 'STARTING')
          )
        ) {
          updates.workerState = mappedWorker;
        }
      }
    } else if (
      snapshot.workerState &&
      snapshot.workerState !== existing?.workerState
    ) {
      updates.workerState = snapshot.workerState;
    }

    if (
      snapshot.localState === 'paused' &&
      (executionState === 'PAUSED' || !executionState) &&
      existing?.status !== 'PAUSED' &&
      existing?.status !== 'COMPLETED' &&
      existing?.status !== 'CANCELLED' &&
      existing?.status !== 'FAILED'
    ) {
      updates.status = 'PAUSED';
      updates.workerState = 'PAUSED';
    }

    if (snapshot.localState === 'finalizing') {
      updates.progress = 100;
    }

    if (snapshot.localState === 'complete') {
      updates.progress = 100;
      if (snapshot.totalBytes != null && snapshot.totalBytes > 0) {
        updates.fileSize = String(Math.trunc(snapshot.totalBytes));
      }
    }

    if (Object.keys(updates).length > 0) {
      store.patchItem(snapshot.downloadId, updates);
    }
  });
}
