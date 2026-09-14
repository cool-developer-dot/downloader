import type { DownloadItem, DownloadStatus } from '@/api';
import type { TransferProgressSnapshot } from '@/downloads/engine/types';

export type LocalTransferEvidence = {
  /** Store item if present. */
  local: DownloadItem | null | undefined;
  /** Live transfer overlay from engine → store. */
  transfer: TransferProgressSnapshot | null | undefined;
  /** Engine queue snapshot flags. */
  engine?: {
    hasActiveWorker?: boolean;
    isQueued?: boolean;
    isSuppressed?: boolean;
    generation?: number;
    /** Verified final file exists and is usable. */
    verifiedCompletedFile?: boolean;
    /** COMPLETED claimed but file missing/unusable. */
    completedFileMissing?: boolean;
  };
};

export type ReconcileDecision = {
  /** Merged item to keep in the store. */
  item: DownloadItem;
  /** Prefer scheduling a corrective backend sync for this id. */
  needsBackendReconcile: boolean;
  reason: string;
};

const TERMINAL: ReadonlySet<DownloadStatus> = new Set([
  'COMPLETED',
  'CANCELLED',
]);

function maxProgress(...values: (number | null | undefined)[]): number {
  let max = 0;
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      max = Math.max(max, Math.trunc(value));
    }
  }
  return Math.max(0, Math.min(100, max));
}

function withProgress(remote: DownloadItem, progress: number): DownloadItem {
  return {
    ...remote,
    progress: maxProgress(remote.progress, progress),
  };
}

/**
 * Deterministic merge of remote ledger snapshot vs local engine evidence.
 * Does NOT use "latest timestamp wins" as the sole rule.
 */
export function reconcileDownloadState(
  remote: DownloadItem,
  evidence: LocalTransferEvidence,
): ReconcileDecision {
  const local = evidence.local ?? null;
  const transfer = evidence.transfer ?? null;
  const engine = evidence.engine ?? {};

  const progress = maxProgress(
    remote.progress,
    local?.progress,
    transfer?.progress,
  );

  const transferring =
    engine.hasActiveWorker === true ||
    transfer?.localState === 'transferring' ||
    (local?.status === 'DOWNLOADING' && transfer?.localState !== 'paused');

  const locallyPaused =
    local?.status === 'PAUSED' &&
    !transferring &&
    transfer?.localState !== 'transferring';

  // 1) Local CANCELLED always wins — never resurrect from stale remote.
  if (local?.status === 'CANCELLED' || engine.isSuppressed) {
    if (remote.status === 'CANCELLED') {
      return {
        item: withProgress(
          { ...remote, status: 'CANCELLED', errorMessage: null },
          progress,
        ),
        needsBackendReconcile: false,
        reason: 'terminal-cancelled-aligned',
      };
    }
    return {
      item: withProgress(
        {
          ...remote,
          status: 'CANCELLED',
          errorMessage: null,
          progress,
        },
        progress,
      ),
      needsBackendReconcile: true,
      reason: 'local-cancelled-wins',
    };
  }

  // 2) Verified local COMPLETED wins over stale non-terminal remote.
  if (
    (local?.status === 'COMPLETED' || engine.verifiedCompletedFile) &&
    !engine.completedFileMissing
  ) {
    if (remote.status === 'COMPLETED') {
      return {
        item: {
          ...remote,
          status: 'COMPLETED',
          progress: 100,
          errorMessage: null,
          errorCode: null,
          downloadedAt: local?.downloadedAt ?? remote.downloadedAt,
        },
        needsBackendReconcile: false,
        reason: 'completed-aligned',
      };
    }
    if (!TERMINAL.has(remote.status) || remote.status === 'CANCELLED') {
      // CANCELLED remote vs local completed is rare; prefer verified file.
      return {
        item: {
          ...remote,
          status: 'COMPLETED',
          progress: 100,
          errorMessage: null,
          errorCode: null,
          downloadedAt:
            local?.downloadedAt ??
            remote.downloadedAt ??
            new Date().toISOString(),
        },
        needsBackendReconcile: true,
        reason: 'verified-completed-wins',
      };
    }
  }

  // 3) COMPLETED claimed locally but file missing — keep remote history,
  //    do not invent Open/Share capability (transfer overlay stays missing).
  if (
    local?.status === 'COMPLETED' &&
    engine.completedFileMissing &&
    remote.status === 'COMPLETED'
  ) {
    return {
      item: {
        ...remote,
        status: 'COMPLETED',
        progress: 100,
        downloadedAt: remote.downloadedAt ?? local.downloadedAt,
      },
      needsBackendReconcile: false,
      reason: 'completed-file-missing-keep-history',
    };
  }

  // 4) Active worker / transferring local wins over stale PAUSED/QUEUED remote.
  if (
    transferring &&
    (remote.status === 'QUEUED' ||
      remote.status === 'PAUSED' ||
      remote.status === 'FAILED')
  ) {
    return {
      item: {
        ...remote,
        status: 'DOWNLOADING',
        progress,
        errorMessage: null,
        errorCode: null,
        fileSize:
          transfer?.totalBytes != null && transfer.totalBytes > 0
            ? String(Math.trunc(transfer.totalBytes))
            : remote.fileSize,
      },
      needsBackendReconcile: true,
      reason: 'active-worker-wins',
    };
  }

  // 5) Local PAUSED with no active worker wins over stale DOWNLOADING remote.
  if (locallyPaused && remote.status === 'DOWNLOADING') {
    return {
      item: {
        ...remote,
        status: 'PAUSED',
        progress,
      },
      needsBackendReconcile: true,
      reason: 'local-paused-wins',
    };
  }

  // 6) After retry: local QUEUED/DOWNLOADING wins over stale remote FAILED.
  if (
    (local?.status === 'QUEUED' || local?.status === 'DOWNLOADING') &&
    remote.status === 'FAILED'
  ) {
    return {
      item: {
        ...remote,
        status: local.status,
        progress,
        errorMessage: null,
        errorCode: null,
      },
      needsBackendReconcile: local.status === 'QUEUED',
      reason: 'retry-local-wins',
    };
  }

  // 7) Local FAILED sticky vs stale non-FAILED unless remote is terminal/queued retry.
  if (
    local?.status === 'FAILED' &&
    remote.status !== 'FAILED' &&
    remote.status !== 'QUEUED' &&
    !TERMINAL.has(remote.status)
  ) {
    return {
      item: {
        ...remote,
        status: 'FAILED',
        progress,
        errorMessage: local.errorMessage,
        errorCode: local.errorCode,
      },
      needsBackendReconcile: true,
      reason: 'local-failed-sticky',
    };
  }

  // 8) Queued locally (waiting for slot) vs stale DOWNLOADING remote.
  if (
    engine.isQueued &&
    local?.status === 'QUEUED' &&
    remote.status === 'DOWNLOADING' &&
    !transferring
  ) {
    return {
      item: {
        ...remote,
        status: 'QUEUED',
        progress,
        errorMessage: null,
        errorCode: null,
      },
      needsBackendReconcile: true,
      reason: 'local-queued-waiting',
    };
  }

  // Default: accept remote ledger, keep monotonic progress.
  return {
    item: withProgress(remote, progress),
    needsBackendReconcile: false,
    reason: 'remote-accepted',
  };
}

/** Snapshot equality for backend sync dedupe. */
export function isSameSyncSnapshot(
  a: {
    status?: DownloadStatus;
    progress?: number;
    errorCode?: string | null;
    errorMessage?: string | null;
    workerState?: string | null;
  },
  b: {
    status?: DownloadStatus;
    progress?: number;
    errorCode?: string | null;
    errorMessage?: string | null;
    workerState?: string | null;
  },
): boolean {
  return (
    a.status === b.status &&
    a.progress === b.progress &&
    (a.errorCode ?? null) === (b.errorCode ?? null) &&
    (a.errorMessage ?? null) === (b.errorMessage ?? null) &&
    (a.workerState ?? null) === (b.workerState ?? null)
  );
}

/**
 * Whether a pending backend sync payload would illegally resurrect a terminal job.
 */
export function shouldBlockSyncAgainstTerminal(
  localTerminal: DownloadStatus | null | undefined,
  payload: { status?: DownloadStatus; progress?: number },
): boolean {
  if (!localTerminal || !TERMINAL.has(localTerminal)) {
    return false;
  }
  if (payload.status && payload.status !== localTerminal) {
    return true;
  }
  // Progress-only after terminal is stale worker noise.
  if (!payload.status && payload.progress !== undefined) {
    return true;
  }
  return false;
}
