/**
 * Local job-state coalescer.
 * Catalog + engine remain durable; this never contacts a VidoraX API.
 */
import type { DownloadStatus, DownloadWorkerState } from '@/api';

import { shouldBlockSyncAgainstTerminal } from '../reconciliation';
import {
  defaultWorkerStateForStatus,
  DURABLE_WORKER_STATE_MILESTONES,
} from '../worker-state';

export type BackendSyncSnapshot = {
  status?: DownloadStatus;
  progress?: number;
  fileSize?: string;
  fileName?: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  workerState?: DownloadWorkerState | null;
};

type PendingSync = {
  status?: DownloadStatus;
  progress?: number;
  fileSize?: string;
  fileName?: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  workerState?: DownloadWorkerState | null;
  lastAckedProgress: number;
  lastSent: BackendSyncSnapshot | null;
  localTerminal: DownloadStatus | null;
  syncAttempts: number;
  timer: ReturnType<typeof setTimeout> | null;
  inFlight: boolean;
};

const pendingById = new Map<string, PendingSync>();

function getOrCreate(id: string): PendingSync {
  const existing = pendingById.get(id);
  if (existing) {
    return existing;
  }
  const created: PendingSync = {
    lastAckedProgress: 0,
    lastSent: null,
    localTerminal: null,
    syncAttempts: 0,
    timer: null,
    inFlight: false,
  };
  pendingById.set(id, created);
  return created;
}

function markTerminal(entry: PendingSync, status: DownloadStatus): void {
  if (status === 'CANCELLED' || status === 'COMPLETED') {
    entry.localTerminal = status;
  }
  if (status === 'QUEUED' || status === 'DOWNLOADING' || status === 'PAUSED') {
    if (entry.localTerminal === 'CANCELLED' || entry.localTerminal === 'COMPLETED') {
      return;
    }
    entry.localTerminal = null;
  }
}

function ackLocal(entry: PendingSync, extras?: { progress?: number }): void {
  if (extras?.progress !== undefined) {
    entry.lastAckedProgress = Math.max(entry.lastAckedProgress, extras.progress);
  }
  entry.lastSent = {
    status: entry.status,
    progress: entry.progress,
    fileSize: entry.fileSize,
    fileName: entry.fileName,
    errorCode: entry.errorCode,
    errorMessage: entry.errorMessage,
    workerState: entry.workerState,
  };
  entry.status = undefined;
  entry.progress = undefined;
  entry.fileSize = undefined;
  entry.fileName = undefined;
  entry.errorCode = undefined;
  entry.errorMessage = undefined;
  entry.workerState = undefined;
  entry.syncAttempts = 0;
  if (entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
}

/**
 * Progress coalescing stays local. No remote ledger.
 */
export function syncProgressThrottled(
  id: string,
  progress: number,
  fileSize?: string,
): void {
  const entry = getOrCreate(id);
  if (entry.localTerminal === 'CANCELLED' || entry.localTerminal === 'COMPLETED') {
    return;
  }

  const next = Math.max(0, Math.min(100, Math.trunc(progress)));
  entry.progress =
    entry.progress === undefined ? next : Math.max(entry.progress, next);
  if (fileSize !== undefined) {
    entry.fileSize = fileSize;
  }
  ackLocal(entry, { progress: next });
}

/**
 * Persist an important status transition in local coalescer state only.
 */
export async function syncStatusImmediate(
  id: string,
  status: DownloadStatus,
  extras?: {
    progress?: number;
    fileSize?: string;
    fileName?: string;
    errorCode?: string | null;
    errorMessage?: string | null;
    workerState?: DownloadWorkerState | null;
  },
): Promise<void> {
  const entry = getOrCreate(id);

  if (
    shouldBlockSyncAgainstTerminal(entry.localTerminal, { status }) &&
    status !== entry.localTerminal
  ) {
    return;
  }

  markTerminal(entry, status);

  if (entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
  entry.status = status;
  entry.syncAttempts = 0;

  if (
    extras?.progress !== undefined &&
    extras.progress >= entry.lastAckedProgress
  ) {
    entry.progress = extras.progress;
  }

  if (extras?.fileSize !== undefined) {
    entry.fileSize = extras.fileSize;
  }
  if (extras?.fileName !== undefined) {
    entry.fileName = extras.fileName;
  }
  if (extras?.errorCode !== undefined) {
    entry.errorCode = extras.errorCode;
  }
  if (extras?.errorMessage !== undefined) {
    entry.errorMessage = extras.errorMessage;
  }

  const resolvedWorker =
    extras?.workerState !== undefined
      ? extras.workerState
      : defaultWorkerStateForStatus(status);
  if (
    resolvedWorker != null &&
    DURABLE_WORKER_STATE_MILESTONES.has(resolvedWorker)
  ) {
    entry.workerState = resolvedWorker;
  }

  ackLocal(entry, { progress: extras?.progress });
}

export function clearSyncState(id: string): void {
  const entry = pendingById.get(id);
  if (!entry) {
    return;
  }
  if (entry.timer) {
    clearTimeout(entry.timer);
  }
  pendingById.delete(id);
}

/** Test/debug helper — not for UI. */
export function getSyncDebugState(id: string): {
  pending: boolean;
  localTerminal: DownloadStatus | null;
  lastAckedProgress: number;
  syncAttempts: number;
} | null {
  const entry = pendingById.get(id);
  if (!entry) {
    return null;
  }
  return {
    pending: entry.inFlight,
    localTerminal: entry.localTerminal,
    lastAckedProgress: entry.lastAckedProgress,
    syncAttempts: entry.syncAttempts,
  };
}
