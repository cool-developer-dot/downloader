/**
 * Deterministic recovery decisions from evidence — not assumptions.
 * Pure helper used by manager.recover() / foreground reconcile / smokes.
 */

import type { DownloadStatus } from '@/api';
import type { LocalTransferState } from './types';

export type RecoveryAction =
  | 'KEEP_DOWNLOADING'
  | 'RECOVER_TO_PAUSED'
  | 'RECOVER_TO_FAILED'
  | 'REENQUEUE'
  | 'KEEP_PAUSED'
  | 'KEEP_FAILED'
  | 'KEEP_COMPLETED'
  | 'MARK_LOCAL_UNAVAILABLE'
  | 'KEEP_CANCELLED'
  | 'NO_ACTION';

export type RecoveryDecision = {
  action: RecoveryAction;
  /** Status to project locally / sync when changing lifecycle. */
  nextStatus?: DownloadStatus;
  errorCode?: string | null;
  errorMessage?: string | null;
  reason: string;
};

export type RecoveryEvidence = {
  remoteStatus: DownloadStatus | null;
  localState: LocalTransferState | null;
  hasActiveWorker: boolean;
  isQueued: boolean;
  isSuppressed: boolean;
  isHls: boolean;
  /** Progressive partial file exists with size > 0 inside job directory. */
  hasValidPartial: boolean;
  /** pauseState.resumeData present or reconstructable from partial. */
  canResume: boolean;
  /** Final file verified for COMPLETED jobs. */
  hasVerifiedFinalFile: boolean;
  /** COMPLETED claimed but file missing/corrupt. */
  completedFileMissing: boolean;
  /** Source URL still passes safety checks. */
  sourceUrlSafe: boolean;
};

/**
 * Decide recovery action for one job after interruption / restart / foreground.
 *
 * Day 2 / scheduler consumers should gate REENQUEUE with:
 *   isAutoResumeEnabled() && evidence supports safe resume
 * Phase 2 keeps this helper evidence-only (no settings import) so UI stays decoupled.
 */
export function decideRecoveryState(evidence: RecoveryEvidence): RecoveryDecision {
  if (evidence.isSuppressed) {
    return {
      action: 'KEEP_CANCELLED',
      nextStatus: 'CANCELLED',
      reason: 'suppressed',
    };
  }

  const status = evidence.remoteStatus;

  if (status === 'CANCELLED') {
    return {
      action: 'KEEP_CANCELLED',
      nextStatus: 'CANCELLED',
      reason: 'cancelled-terminal',
    };
  }

  if (status === 'COMPLETED' || evidence.localState === 'complete') {
    if (evidence.hasVerifiedFinalFile) {
      return {
        action: 'KEEP_COMPLETED',
        nextStatus: 'COMPLETED',
        reason: 'completed-verified',
      };
    }
    if (evidence.completedFileMissing || status === 'COMPLETED') {
      return {
        action: 'MARK_LOCAL_UNAVAILABLE',
        nextStatus: 'COMPLETED',
        reason: 'completed-file-unavailable',
      };
    }
  }

  // Active worker always wins for DOWNLOADING.
  if (
    evidence.hasActiveWorker &&
    (status === 'DOWNLOADING' || evidence.localState === 'transferring')
  ) {
    return {
      action: 'KEEP_DOWNLOADING',
      nextStatus: 'DOWNLOADING',
      reason: 'active-worker',
    };
  }

  // Already queued in memory — do not double-enqueue.
  if (evidence.isQueued) {
    return {
      action: 'NO_ACTION',
      nextStatus: 'QUEUED',
      reason: 'already-queued',
    };
  }

  // Stale DOWNLOADING / transferring without worker.
  if (
    status === 'DOWNLOADING' ||
    evidence.localState === 'transferring'
  ) {
    if (evidence.isHls) {
      // Workspace soft-hold (Wi-Fi policy) / recoverable segment cache.
      if (evidence.hasValidPartial && evidence.sourceUrlSafe) {
        return {
          action: 'RECOVER_TO_PAUSED',
          nextStatus: 'PAUSED',
          reason: 'hls-workspace-resumable',
        };
      }
      return {
        action: 'RECOVER_TO_FAILED',
        nextStatus: 'FAILED',
        errorCode: 'TRANSFER_INTERRUPTED',
        errorMessage: 'This stream download was interrupted and must be retried.',
        reason: 'hls-interrupted',
      };
    }

    if (evidence.hasValidPartial && evidence.canResume) {
      return {
        action: 'RECOVER_TO_PAUSED',
        nextStatus: 'PAUSED',
        reason: 'progressive-partial-resumable',
      };
    }

    return {
      action: 'RECOVER_TO_FAILED',
      nextStatus: 'FAILED',
      errorCode: evidence.hasValidPartial
        ? 'RESUME_STATE_MISSING'
        : 'TRANSFER_INTERRUPTED',
      errorMessage: evidence.hasValidPartial
        ? 'Unable to resume this download.'
        : 'The download was interrupted.',
      reason: evidence.hasValidPartial
        ? 'partial-not-resumable'
        : 'downloading-no-partial',
    };
  }

  // Stale / persisted PAUSED.
  if (status === 'PAUSED' || evidence.localState === 'paused') {
    if (evidence.isHls) {
      // Network-policy soft-hold persists PAUSED + segment workspace.
      if (evidence.hasValidPartial && evidence.sourceUrlSafe) {
        return {
          action: 'KEEP_PAUSED',
          nextStatus: 'PAUSED',
          reason: 'hls-paused-workspace',
        };
      }
      return {
        action: 'RECOVER_TO_FAILED',
        nextStatus: 'FAILED',
        errorCode: 'RESUME_UNSUPPORTED',
        errorMessage: 'This stream download cannot be paused or resumed.',
        reason: 'hls-paused-unsupported',
      };
    }
    if (evidence.hasValidPartial && evidence.canResume) {
      return {
        action: 'KEEP_PAUSED',
        nextStatus: 'PAUSED',
        reason: 'paused-resumable',
      };
    }
    return {
      action: 'RECOVER_TO_FAILED',
      nextStatus: 'FAILED',
      errorCode: 'PARTIAL_FILE_MISSING',
      errorMessage: 'The partial download file is no longer available.',
      reason: 'paused-partial-missing',
    };
  }

  if (status === 'FAILED' || evidence.localState === 'failed') {
    return {
      action: 'KEEP_FAILED',
      nextStatus: 'FAILED',
      reason: 'failed-sticky',
    };
  }

  // Stale QUEUED / not_started intent.
  if (
    status === 'QUEUED' ||
    evidence.localState === 'not_started'
  ) {
    if (!evidence.sourceUrlSafe) {
      return {
        action: 'RECOVER_TO_FAILED',
        nextStatus: 'FAILED',
        errorCode: 'INVALID_RESOURCE',
        errorMessage: 'This media can’t be downloaded.',
        reason: 'queued-unsafe-url',
      };
    }
    return {
      action: 'REENQUEUE',
      nextStatus: 'QUEUED',
      reason: 'queued-reenqueue',
    };
  }

  if (
    evidence.localState === 'missing' ||
    evidence.localState === 'corrupt'
  ) {
    if (status === 'COMPLETED') {
      return {
        action: 'MARK_LOCAL_UNAVAILABLE',
        nextStatus: 'COMPLETED',
        reason: 'completed-local-bad',
      };
    }
    return {
      action: 'RECOVER_TO_FAILED',
      nextStatus: 'FAILED',
      errorCode:
        evidence.localState === 'missing'
          ? 'PARTIAL_FILE_MISSING'
          : 'FINAL_FILE_INVALID',
      errorMessage:
        evidence.localState === 'missing'
          ? 'The partial download file is no longer available.'
          : 'The downloaded file failed integrity checks.',
      reason: 'local-file-bad',
    };
  }

  return {
    action: 'NO_ACTION',
    reason: 'no-op',
  };
}
