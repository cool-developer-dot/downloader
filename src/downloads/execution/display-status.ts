import type { QueueWaitingReason } from '../scheduler/waiting-reason';
import type { DownloadExecutionState } from './download-execution-state';
import type { DownloadExecutionDisplayState } from './types';

export type DisplayStatusInput = {
  /** Canonical engine execution state when available (Phase 1C). */
  executionState?: DownloadExecutionState | null;
  /** Customer-facing DownloadStatus. */
  status: 'QUEUED' | 'DOWNLOADING' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | null;
  /** Operational worker state when known (never shown raw to customer). */
  workerState?: string | null;
  /** Live transfer local state when known. */
  localState?: string | null;
  waitingReason?: QueueWaitingReason | null;
  /** React Native AppState: active | inactive | background. */
  appState: 'active' | 'inactive' | 'background' | string;
  /** True when FGS / ledger says this id is under protected execution. */
  backgroundServiceActive?: boolean;
  /** True when a JS (or native) transfer worker owns this id. */
  hasActiveExecution?: boolean;
  retryDelay?: boolean;
};

/**
 * Derive customer-facing execution display state.
 * Pure. Not persisted. Does not expose TRANSFERRING / RETRY_WAIT enums.
 */
export function deriveDownloadExecutionDisplayState(
  input: DisplayStatusInput,
): DownloadExecutionDisplayState {
  const execution = input.executionState;

  if (execution === 'COMPLETED' || input.status === 'COMPLETED') {
    return 'COMPLETED';
  }
  if (execution === 'CANCELLED' || input.status === 'CANCELLED') {
    return 'CANCELLED';
  }
  if (execution === 'PAUSED' || input.status === 'PAUSED') {
    return 'PAUSED';
  }
  if (execution === 'FAILED' || input.status === 'FAILED') {
    if (
      input.retryDelay ||
      execution === 'RETRYING' ||
      input.waitingReason === 'RETRY_DELAY' ||
      (input.workerState ?? '').toUpperCase() === 'RETRY_WAIT'
    ) {
      return 'WAITING_FOR_RETRY';
    }
    return 'FAILED';
  }

  if (execution === 'FINALIZING') {
    return 'FINALIZING';
  }

  if (execution === 'STARTING') {
    return 'STARTING';
  }

  if (execution === 'WAITING_FOR_WIFI') {
    return 'WAITING_FOR_WIFI';
  }

  if (execution === 'PREPARING') {
    return 'PREPARING';
  }

  if (execution === 'DOWNLOADING' || input.status === 'DOWNLOADING' || input.hasActiveExecution) {
    const ws = (input.workerState ?? '').toUpperCase();
    const ls = (input.localState ?? '').toLowerCase();
    if (ws === 'VERIFYING' || ws === 'COMPLETING' || ls === 'finalizing') {
      return 'FINALIZING';
    }
    if (ws === 'STARTING') {
      return 'STARTING';
    }
    const appBackground =
      input.appState === 'background' || input.appState === 'inactive';
    if (appBackground && input.backgroundServiceActive === true) {
      return 'DOWNLOADING_BACKGROUND';
    }
    return 'DOWNLOADING_FOREGROUND';
  }

  if (execution === 'QUEUED' || input.status === 'QUEUED' || input.status == null) {
    if (input.retryDelay || input.waitingReason === 'RETRY_DELAY') {
      return 'WAITING_FOR_RETRY';
    }
    if (input.waitingReason === 'RECOVERY_PENDING') {
      return 'PREPARING';
    }
    if (input.waitingReason === 'OFFLINE') {
      return 'WAITING_FOR_CONNECTION';
    }
    if (input.waitingReason === 'WAITING_FOR_WIFI') {
      return 'WAITING_FOR_WIFI';
    }
    if (input.waitingReason === 'CAPACITY') {
      return 'WAITING_CAPACITY';
    }
    return 'QUEUED';
  }

  return 'QUEUED';
}
