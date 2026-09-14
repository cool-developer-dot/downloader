/**
 * Pause acknowledgement — transport-stop truth vs native pause API vs PAUSED commit.
 *
 * Production invariant: once an intentional USER_PAUSE has safely stopped the
 * active writer, Pause must succeed and PAUSED must commit. A redundant
 * DownloadTask.pause() false/throw after AbortController already stopped HTTP
 * work is not a user-facing failure.
 */

import type { DownloadPauseState } from 'expo-file-system';

import { DownloadEngineError } from './errors';

export const USER_PAUSE_ABORT_MESSAGE = 'Download paused.';

export type NativeDownloadTaskLike = {
  state?: string;
  pause?: () => unknown;
  savable?: () => DownloadPauseState | null | undefined;
  release?: () => void;
  cancel?: () => void;
};

export type NativePauseAttempt = {
  attempted: boolean;
  nativeOk: boolean;
  /** True when pause() returned false or threw after we still intend USER_PAUSE. */
  redundantFalse: boolean;
};

export type PauseCommitInput = {
  executionState: string | null | undefined;
  workerStillTransferring: boolean;
  pauseRequested: boolean;
  localState: string | null | undefined;
  hasResumeData: boolean;
  hasHlsCheckpoint: boolean;
  hasMultiRangeCheckpoint: boolean;
  partialBytes: number;
  nativePauseReturnedFalse?: boolean;
};

export type PauseCommitDecision =
  | { commit: true; fail: false; reason: string }
  | { commit: false; fail: true; reason: string };

/**
 * Expo DownloadTask.pause() is a native checkpoint helper, not transport truth.
 * AbortController / fetch cancel is what stops OkHttp / the reader.
 * Returning false or throwing after the writer is already down must not fail Pause.
 */
/**
 * Expo DownloadTask.pause() already cancels OkHttp with isPausing=true.
 * Aborting the AbortSignal afterwards calls DownloadTask.cancel(), which
 * sets isCancelling=true / isPausing=false. Native then returns from the
 * read loop WITHOUT resuming the Kotlin coroutine, so downloadAsync()
 * never settles, waitUntilSettled hangs, and the UI mutating spinner sticks.
 *
 * Fetch / HLS / multi-range / append-range workers have no native task and
 * MUST abort the in-flight controller.
 */
export function shouldAbortAbortSignalAfterNativePause(input: {
  hasNativeDownloadTask: boolean;
  nativePauseAttempted: boolean;
}): boolean {
  if (input.hasNativeDownloadTask && input.nativePauseAttempted) {
    return false;
  }
  return true;
}

export function pauseNativeDownloadTask(
  task: NativeDownloadTaskLike | null | undefined,
): NativePauseAttempt {
  if (!task || typeof task.pause !== 'function') {
    return { attempted: false, nativeOk: false, redundantFalse: false };
  }
  try {
    const result = task.pause();
    if (result === false) {
      return { attempted: true, nativeOk: false, redundantFalse: true };
    }
    return { attempted: true, nativeOk: true, redundantFalse: false };
  } catch {
    return { attempted: true, nativeOk: false, redundantFalse: true };
  }
}

export async function awaitNativePauseTask(
  task: NativeDownloadTaskLike | null | undefined,
): Promise<NativePauseAttempt> {
  if (!task || typeof task.pause !== 'function') {
    return { attempted: false, nativeOk: false, redundantFalse: false };
  }
  try {
    const result = task.pause();
    const resolved =
      result != null && typeof (result as { then?: unknown }).then === 'function'
        ? await (result as Promise<unknown>)
        : result;
    if (resolved === false) {
      return { attempted: true, nativeOk: false, redundantFalse: true };
    }
    return { attempted: true, nativeOk: true, redundantFalse: false };
  } catch {
    return { attempted: true, nativeOk: false, redundantFalse: true };
  }
}

/** savable() is valid after pause OR after abort left a checkpoint blob. */
export function captureNativePauseState(
  task: NativeDownloadTaskLike | null | undefined,
): DownloadPauseState | null {
  if (!task || typeof task.savable !== 'function') {
    return null;
  }
  try {
    const saved = task.savable();
    if (saved && typeof saved === 'object' && typeof saved.resumeData === 'string') {
      return saved;
    }
    return saved && typeof saved === 'object' ? saved : null;
  } catch {
    return null;
  }
}

export function isUserPauseAbortError(
  error: unknown,
  pauseRequested: boolean,
): boolean {
  if (!pauseRequested) {
    return false;
  }
  if (error instanceof DownloadEngineError) {
    if (error.code === 'CANCELLED') {
      return true;
    }
    if (error.code === 'PAUSE_FAILED' || error.code === 'PARTIAL_FILE_MISSING') {
      return false;
    }
  }
  if (error instanceof Error) {
    const name = error.name.toLowerCase();
    const message = error.message.toLowerCase();
    if (name === 'aborterror' || message.includes('abort') || message.includes('paused')) {
      return true;
    }
  }
  return true;
}

export function classifyUserPauseAbort(
  error: unknown,
  pauseRequested: boolean,
): 'USER_PAUSE' | 'NOT_USER_PAUSE' {
  return isUserPauseAbortError(error, pauseRequested) ? 'USER_PAUSE' : 'NOT_USER_PAUSE';
}

export function decidePauseCommit(input: PauseCommitInput): PauseCommitDecision {
  const exec = (input.executionState ?? '').toUpperCase();
  if (exec === 'FINALIZING') {
    return { commit: false, fail: true, reason: 'FINALIZING' };
  }
  if (exec === 'COMPLETED') {
    return { commit: false, fail: true, reason: 'COMPLETED' };
  }
  if (exec === 'CANCELLED') {
    return { commit: false, fail: true, reason: 'CANCELLED' };
  }

  if (input.workerStillTransferring) {
    return { commit: false, fail: true, reason: 'transport_still_active' };
  }

  // Redundant native pause false is ignored once transport is down.
  void input.nativePauseReturnedFalse;

  if (input.hasHlsCheckpoint) {
    return { commit: true, fail: false, reason: 'hls_checkpoint' };
  }
  if (input.hasMultiRangeCheckpoint) {
    return { commit: true, fail: false, reason: 'multi_range_checkpoint' };
  }
  if (input.hasResumeData || input.partialBytes > 0) {
    return { commit: true, fail: false, reason: 'durable_checkpoint' };
  }
  if (input.localState === 'paused') {
    return { commit: true, fail: false, reason: 'already_paused' };
  }
  if (input.pauseRequested) {
    return { commit: true, fail: false, reason: 'transport_stopped_user_pause' };
  }
  return { commit: false, fail: true, reason: 'pause_not_settled' };
}

export function nativePauseFalseDoesNotFailUserPause(
  transportStopped: boolean,
  nativePauseReturnedFalse: boolean,
): boolean {
  return transportStopped && nativePauseReturnedFalse;
}

export function shouldAcceptPausedStatusEvent(input: {
  catalogStatus: string | null | undefined;
  eventStatus: string;
  executionState: string | null | undefined;
}): boolean {
  if (input.eventStatus !== 'PAUSED') {
    return true;
  }
  const catalog = (input.catalogStatus ?? '').toUpperCase();
  if (catalog !== 'DOWNLOADING' && catalog !== 'QUEUED') {
    return true;
  }
  const exec = (input.executionState ?? '').toUpperCase();
  // Resume already admitted — ignore a late PAUSED emit from the previous worker.
  if (
    exec === 'QUEUED' ||
    exec === 'WAITING_FOR_WIFI' ||
    exec === 'STARTING' ||
    exec === 'RETRYING' ||
    exec === 'PREPARING' ||
    exec === 'FINALIZING'
  ) {
    return false;
  }
  // DOWNLOADING + PAUSED event without resume-advanced execution: pause ack.
  // Bind still prefers event.executionState === PAUSED from manager commit.
  return exec === 'PAUSED' || exec === '';
}

export function shouldRejectLateTransferringOverPaused(input: {
  catalogStatus: string | null | undefined;
  snapshotLocalState: string | null | undefined;
  snapshotExecutionState?: string | null;
  snapshotWorkerState?: string | null;
}): boolean {
  if ((input.catalogStatus ?? '').toUpperCase() !== 'PAUSED') {
    return false;
  }
  const local = (input.snapshotLocalState ?? '').toLowerCase();
  if (local === 'transferring') {
    return true;
  }
  const exec = (input.snapshotExecutionState ?? '').toUpperCase();
  if (exec === 'DOWNLOADING' || exec === 'STARTING' || exec === 'RETRYING') {
    return true;
  }
  const worker = (input.snapshotWorkerState ?? '').toUpperCase();
  return worker === 'TRANSFERRING' || worker === 'STARTING';
}

export function shouldRejectLateDownloadingStatusOverPaused(input: {
  catalogStatus: string | null | undefined;
  eventStatus: string;
  executionState: string | null | undefined;
}): boolean {
  if ((input.catalogStatus ?? '').toUpperCase() !== 'PAUSED') {
    return false;
  }
  const status = input.eventStatus.toUpperCase();
  if (status !== 'DOWNLOADING' && status !== 'QUEUED') {
    return false;
  }
  const exec = (input.executionState ?? '').toUpperCase();
  if (
    exec === 'DOWNLOADING' ||
    exec === 'STARTING' ||
    exec === 'QUEUED' ||
    exec === 'FINALIZING' ||
    exec === 'RETRYING' ||
    exec === 'PREPARING' ||
    exec === 'WAITING_FOR_WIFI'
  ) {
    return false;
  }
  return true;
}

export function detectPauseSplitBrain(input: {
  executionState: string | null | undefined;
  hasActiveTransport: boolean;
  pauseRequestedOrSettled: boolean;
}): boolean {
  return (
    (input.executionState ?? '').toUpperCase() === 'DOWNLOADING' &&
    !input.hasActiveTransport &&
    input.pauseRequestedOrSettled
  );
}

export function logDownloadRuntimeInvariantViolation(fields: {
  downloadId: string;
  executionState?: string | null;
  hasActiveTransport?: boolean;
  pauseRequestedOrSettled?: boolean;
  reason?: string;
}): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }
  console.log('DOWNLOAD_RUNTIME_INVARIANT_VIOLATION', {
    downloadId: fields.downloadId,
    executionState: fields.executionState ?? null,
    hasActiveTransport: fields.hasActiveTransport ?? false,
    pauseRequestedOrSettled: fields.pauseRequestedOrSettled ?? false,
    reason: fields.reason ?? 'downloading_without_transport_after_pause',
  });
}

export function pauseFailureMessageForUi(): string {
  return 'Couldn’t pause this download right now. Try again in a moment.';
}

export function shouldShowPauseFailureMessage(input: {
  pauseSucceeded: boolean;
  transportStopped: boolean;
  pausedCommitted: boolean;
}): boolean {
  if (input.pauseSucceeded || input.pausedCommitted) {
    return false;
  }
  if (input.transportStopped && input.pausedCommitted) {
    return false;
  }
  return !input.pauseSucceeded;
}
