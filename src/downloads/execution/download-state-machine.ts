import type { DownloadStatus } from '@/api';
import { logDownloadStateTransition } from '../engine/audit-diagnostics.service';
import type { QueueWaitingReason } from '../scheduler/waiting-reason';
import {
  createExecutionSnapshot,
  freshBytesWritten,
  type DownloadExecutionSnapshot,
  type DownloadExecutionState,
  type DownloadStateTransitionReason,
} from './download-execution-state';

const TERMINAL: ReadonlySet<DownloadExecutionState> = new Set([
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

const ALLOWED: Readonly<Record<DownloadExecutionState, readonly DownloadExecutionState[]>> = {
  PREPARING: ['QUEUED', 'FAILED', 'CANCELLED'],
  QUEUED: ['STARTING', 'WAITING_FOR_WIFI', 'PAUSED', 'CANCELLED', 'FAILED', 'RETRYING'],
  WAITING_FOR_WIFI: ['QUEUED', 'CANCELLED', 'PAUSED'],
  STARTING: ['DOWNLOADING', 'RETRYING', 'PAUSED', 'FAILED', 'CANCELLED'],
  DOWNLOADING: ['FINALIZING', 'RETRYING', 'PAUSED', 'FAILED', 'CANCELLED'],
  FINALIZING: ['COMPLETED', 'FAILED'],
  PAUSED: ['QUEUED', 'STARTING'],
  // User Pause during retry must win over a scheduled auto-retry restart.
  RETRYING: ['QUEUED', 'STARTING', 'PAUSED', 'FAILED', 'CANCELLED'],
  COMPLETED: [],
  FAILED: ['QUEUED', 'RETRYING'],
  CANCELLED: [],
};

export function isAllowedExecutionTransition(
  from: DownloadExecutionState,
  to: DownloadExecutionState,
): boolean {
  if (from === to) {
    return true;
  }
  return ALLOWED[from]?.includes(to) ?? false;
}

export function catalogStatusForExecutionState(
  state: DownloadExecutionState,
): DownloadStatus {
  switch (state) {
    case 'PREPARING':
    case 'QUEUED':
    case 'WAITING_FOR_WIFI':
    case 'STARTING':
    case 'RETRYING':
      return 'QUEUED';
    case 'DOWNLOADING':
    case 'FINALIZING':
      return 'DOWNLOADING';
    case 'PAUSED':
      return 'PAUSED';
    case 'COMPLETED':
      return 'COMPLETED';
    case 'FAILED':
      return 'FAILED';
    case 'CANCELLED':
      return 'CANCELLED';
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

export function workerStateForExecutionState(
  state: DownloadExecutionState,
): import('@/api').DownloadWorkerState | null {
  switch (state) {
    case 'STARTING':
      return 'STARTING';
    case 'DOWNLOADING':
      return 'TRANSFERRING';
    case 'FINALIZING':
      return 'VERIFYING';
    case 'PAUSED':
      return 'PAUSED';
    case 'RETRYING':
      return 'RETRY_WAIT';
    case 'FAILED':
      return 'FAILED';
    case 'COMPLETED':
      return 'COMPLETED';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'QUEUED':
    case 'WAITING_FOR_WIFI':
    case 'PREPARING':
      return 'WAITING';
    default:
      return null;
  }
}

export function executionStateFromWaitingReason(
  reason: QueueWaitingReason | null | undefined,
): DownloadExecutionState {
  if (reason === 'WAITING_FOR_WIFI') {
    return 'WAITING_FOR_WIFI';
  }
  if (reason === 'RECOVERY_PENDING') {
    return 'PREPARING';
  }
  return 'QUEUED';
}

export type TransitionResult =
  | { ok: true; snapshot: DownloadExecutionSnapshot; changed: boolean }
  | { ok: false; reason: 'missing' | 'stale_generation' | 'invalid_transition' };

export function transitionDownloadExecutionState(input: {
  snapshot: DownloadExecutionSnapshot;
  to: DownloadExecutionState;
  reason: DownloadStateTransitionReason;
  generation?: number;
  attemptStartBytes?: number;
  bytesWritten?: number;
  totalBytes?: number | null;
  progress?: number;
  waitingReason?: QueueWaitingReason | null;
}): TransitionResult {
  const snapshot = input.snapshot;

  if (
    input.generation != null &&
    input.generation !== snapshot.generation &&
    !TERMINAL.has(snapshot.state)
  ) {
    return { ok: false, reason: 'stale_generation' };
  }

  if (input.generation != null) {
    snapshot.generation = input.generation;
  }
  if (input.attemptStartBytes != null) {
    snapshot.attemptStartBytes = Math.max(0, Math.trunc(input.attemptStartBytes));
  }
  if (input.bytesWritten != null) {
    snapshot.bytesWritten = Math.max(0, Math.trunc(input.bytesWritten));
  }
  if (input.totalBytes !== undefined) {
    snapshot.totalBytes = input.totalBytes;
  }
  if (input.progress != null) {
    snapshot.progress = Math.max(0, Math.min(100, Math.trunc(input.progress)));
  }
  if (input.waitingReason !== undefined) {
    snapshot.waitingReason = input.waitingReason;
  }

  const from = snapshot.state;
  const to = input.to;

  if (from === to) {
    snapshot.updatedAt = Date.now();
    return { ok: true, snapshot, changed: false };
  }

  if (!isAllowedExecutionTransition(from, to)) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      logDownloadStateTransition({
        downloadId: snapshot.downloadId,
        previousState: from,
        nextState: to,
        reason: `rejected:${input.reason}`,
      });
    }
    return { ok: false, reason: 'invalid_transition' };
  }

  snapshot.state = to;
  snapshot.updatedAt = Date.now();

  logDownloadStateTransition({
    downloadId: snapshot.downloadId,
    previousState: from,
    nextState: to,
    reason: input.reason,
    extra: {
      generation: snapshot.generation,
      attemptStartBytes: snapshot.attemptStartBytes,
      bytesWritten: snapshot.bytesWritten,
      totalBytes: snapshot.totalBytes,
    },
  });

  return { ok: true, snapshot, changed: true };
}

/** Idempotent STARTING → DOWNLOADING on first fresh payload byte for this attempt. */
export function markFirstValidByte(input: {
  snapshot: DownloadExecutionSnapshot;
  bytesWritten: number;
  generation: number;
}): TransitionResult {
  if (input.generation !== input.snapshot.generation) {
    return { ok: false, reason: 'stale_generation' };
  }

  input.snapshot.bytesWritten = Math.max(0, Math.trunc(input.bytesWritten));

  if (input.snapshot.firstByteObserved && input.snapshot.state === 'DOWNLOADING') {
    return { ok: true, snapshot: input.snapshot, changed: false };
  }

  const fresh = freshBytesWritten(input.snapshot);
  if (fresh <= 0 || input.snapshot.state !== 'STARTING') {
    return { ok: true, snapshot: input.snapshot, changed: false };
  }

  input.snapshot.firstByteObserved = true;
  return transitionDownloadExecutionState({
    snapshot: input.snapshot,
    to: 'DOWNLOADING',
    reason: 'first_valid_byte',
    generation: input.generation,
    bytesWritten: input.bytesWritten,
  });
}

export function assertExecutionInvariant(input: {
  snapshot: DownloadExecutionSnapshot;
  hasActiveWorker: boolean;
  progress?: number;
}): boolean {
  const { snapshot } = input;
  const progress = input.progress ?? snapshot.progress;

  if (snapshot.state === 'WAITING_FOR_WIFI' && input.hasActiveWorker) {
    return false;
  }
  if (snapshot.state === 'QUEUED' && input.hasActiveWorker) {
    return false;
  }
  if (snapshot.state === 'PAUSED' && input.hasActiveWorker) {
    return false;
  }
  if (snapshot.state === 'CANCELLED' && input.hasActiveWorker) {
    return false;
  }
  if (snapshot.state === 'COMPLETED' && input.hasActiveWorker) {
    return false;
  }
  if (snapshot.state === 'DOWNLOADING' && !snapshot.firstByteObserved) {
    return false;
  }
  if (snapshot.state === 'STARTING' && snapshot.firstByteObserved) {
    return freshBytesWritten(snapshot) <= 0;
  }
  if (progress > 100) {
    return false;
  }
  if (progress > 0 && snapshot.bytesWritten <= 0 && snapshot.state !== 'FINALIZING') {
    return false;
  }
  if (
    snapshot.totalBytes != null &&
    snapshot.totalBytes > 0 &&
    snapshot.bytesWritten >= snapshot.totalBytes &&
    snapshot.state === 'DOWNLOADING'
  ) {
    return false;
  }
  return true;
}

export { createExecutionSnapshot, freshBytesWritten };
