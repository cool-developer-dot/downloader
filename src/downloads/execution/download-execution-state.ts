/**
 * Phase 1C — canonical download execution state (engine-owned, not catalog status).
 * Catalog DownloadStatus stays coarse; this models what the engine is actually doing.
 */

export type DownloadExecutionState =
  | 'PREPARING'
  | 'QUEUED'
  | 'WAITING_FOR_WIFI'
  | 'STARTING'
  | 'DOWNLOADING'
  | 'FINALIZING'
  | 'PAUSED'
  | 'RETRYING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type DownloadStateTransitionReason =
  | 'worker_admitted'
  | 'first_valid_byte'
  | 'waiting_for_wifi'
  | 'wifi_available'
  | 'scheduler_pending'
  | 'capacity_waiting'
  | 'user_pause'
  | 'user_cancel'
  | 'retry_scheduled'
  | 'transfer_complete'
  | 'finalization_success'
  | 'finalization_failure'
  | 'worker_error'
  | 'recovery'
  | 'resume'
  | 'enqueued'
  | 'terminal'
  | 'stale_generation';

export type DownloadExecutionSnapshot = {
  downloadId: string;
  state: DownloadExecutionState;
  generation: number;
  attemptStartBytes: number;
  firstByteObserved: boolean;
  bytesWritten: number;
  totalBytes: number | null;
  progress: number;
  waitingReason?: import('../scheduler/waiting-reason').QueueWaitingReason | null;
  updatedAt: number;
};

export function createExecutionSnapshot(
  downloadId: string,
  generation: number,
  attemptStartBytes = 0,
): DownloadExecutionSnapshot {
  return {
    downloadId,
    state: 'QUEUED',
    generation,
    attemptStartBytes: Math.max(0, Math.trunc(attemptStartBytes)),
    firstByteObserved: false,
    bytesWritten: Math.max(0, Math.trunc(attemptStartBytes)),
    totalBytes: null,
    progress: 0,
    waitingReason: null,
    updatedAt: Date.now(),
  };
}

export function freshBytesWritten(snapshot: DownloadExecutionSnapshot): number {
  return Math.max(0, snapshot.bytesWritten - snapshot.attemptStartBytes);
}
