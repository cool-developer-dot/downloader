/**
 * Canonical DownloadWorkerState — single mobile domain definition.
 * Must stay aligned with the local DownloadWorkerState domain enum.
 */

import type { DownloadStatus, DownloadWorkerState } from '@/api';

export const DOWNLOAD_WORKER_STATES = [
  'IDLE',
  'WAITING',
  'STARTING',
  'TRANSFERRING',
  'PAUSING',
  'PAUSED',
  'RETRY_WAIT',
  'VERIFYING',
  'COMPLETING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const satisfies readonly DownloadWorkerState[];

/** Durable milestones persisted to the local catalog (not micro-transitions). */
export const DURABLE_WORKER_STATE_MILESTONES: ReadonlySet<DownloadWorkerState> =
  new Set([
    'WAITING',
    'STARTING',
    'TRANSFERRING',
    'PAUSED',
    'RETRY_WAIT',
    'VERIFYING',
    'FAILED',
    'COMPLETED',
    'CANCELLED',
  ]);

export const WORKER_STATES_FOR_STATUS: Record<
  DownloadStatus,
  readonly DownloadWorkerState[]
> = {
  QUEUED: ['IDLE', 'WAITING', 'STARTING'],
  DOWNLOADING: ['TRANSFERRING', 'PAUSING', 'VERIFYING', 'COMPLETING'],
  PAUSED: ['PAUSED'],
  FAILED: ['FAILED', 'RETRY_WAIT'],
  COMPLETED: ['COMPLETED'],
  CANCELLED: ['CANCELLED'],
};

export function isValidWorkerStateForDownloadStatus(
  status: DownloadStatus,
  workerState: DownloadWorkerState,
): boolean {
  return WORKER_STATES_FOR_STATUS[status].includes(workerState);
}

export function defaultWorkerStateForStatus(
  status: DownloadStatus,
): DownloadWorkerState {
  switch (status) {
    case 'QUEUED':
      return 'WAITING';
    case 'DOWNLOADING':
      return 'TRANSFERRING';
    case 'PAUSED':
      return 'PAUSED';
    case 'FAILED':
      return 'FAILED';
    case 'COMPLETED':
      return 'COMPLETED';
    case 'CANCELLED':
      return 'CANCELLED';
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export function parseDownloadWorkerState(
  value: unknown,
): DownloadWorkerState | null {
  if (
    typeof value === 'string' &&
    (DOWNLOAD_WORKER_STATES as readonly string[]).includes(value)
  ) {
    return value as DownloadWorkerState;
  }
  return null;
}
