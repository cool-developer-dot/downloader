/**
 * Active-transfer action capabilities (Pause / Resume / Cancel / Retry).
 *
 * Distinct from Phase 7A `resolveCompletedActions()` — completed-file Play/Open/
 * Share/Save/Delete must never replace these runtime controls.
 *
 * Catalog DownloadStatus remains coarse; optional executionState refines
 * FINALIZING / STARTING / WAITING_FOR_WIFI without inventing UI-only states.
 */

import type { DownloadStatus } from '@/api';

import type { DownloadExecutionState } from './execution/download-execution-state';

export type DownloadRuntimeActions = {
  canPause: boolean;
  canResume: boolean;
  canCancel: boolean;
  canRetry: boolean;
  /**
   * Why Pause is withheld on a row that is otherwise pausable. Lets the UI
   * explain the gap instead of silently dropping the control.
   */
  pauseBlockedReason: 'SOURCE_NOT_RESUMABLE' | null;
};

export type ResolveDownloadRuntimeActionsInput = {
  status: DownloadStatus | string | null | undefined;
  /** Phase 1 execution state when known (preferred over catalog alone). */
  executionState?: DownloadExecutionState | string | null;
  workerState?: string | null;
  /** True when bytes are moving on this download. Omit = treat DOWNLOADING as active. */
  hasActiveTransfer?: boolean;
  /**
   * Engine-owned source capability (`TransferProgressSnapshot.supportsResume`).
   * Omit/null = unknown, which keeps Pause available. Only an explicit `false`
   * withholds Pause, because pausing a source that refuses Range requests
   * discards the bytes already downloaded.
   */
  sourceSupportsResume?: boolean | null;
};

function normalizeStatus(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function isResumeAdvanced(execution: string): boolean {
  return (
    execution === 'PREPARING' ||
    execution === 'QUEUED' ||
    execution === 'WAITING_FOR_WIFI' ||
    execution === 'STARTING' ||
    execution === 'DOWNLOADING' ||
    execution === 'FINALIZING' ||
    execution === 'RETRYING'
  );
}

/** Capability-independent state resolution — see `resolveDownloadRuntimeActions`. */
function resolveStateActions(
  input: ResolveDownloadRuntimeActionsInput,
): Omit<DownloadRuntimeActions, 'pauseBlockedReason'> {
  const status = normalizeStatus(input.status);
  const execution = normalizeStatus(input.executionState ?? undefined);

  const none: Omit<DownloadRuntimeActions, 'pauseBlockedReason'> = {
    canPause: false,
    canResume: false,
    canCancel: false,
    canRetry: false,
  };

  const worker = normalizeStatus(input.workerState ?? undefined);
  const transferActive =
    input.hasActiveTransfer === true ||
    worker === 'TRANSFERRING' ||
    (input.hasActiveTransfer !== false &&
      (execution === 'DOWNLOADING' || status === 'DOWNLOADING'));

  if (!status) {
    return none;
  }

  if (status === 'COMPLETED' || execution === 'COMPLETED') {
    return none;
  }

  if (status === 'FAILED' || execution === 'FAILED') {
    return { ...none, canRetry: true };
  }

  if (status === 'CANCELLED' || execution === 'CANCELLED') {
    return none;
  }

  // Finalization committed — never expose Pause/Resume.
  if (execution === 'FINALIZING') {
    return { ...none, canCancel: true };
  }

  // PAUSED is active/resumable — never treat as completed-file actions.
  // If execution already advanced (resume admitted), follow execution.
  if (status === 'PAUSED' || execution === 'PAUSED') {
    if (status === 'PAUSED' && isResumeAdvanced(execution)) {
      if (execution === 'DOWNLOADING') {
        return {
          canPause: true,
          canResume: false,
          canCancel: true,
          canRetry: false,
        };
      }
      return {
        canPause: false,
        canResume: false,
        canCancel: true,
        canRetry: false,
      };
    }
    return {
      canPause: false,
      canResume: true,
      canCancel: true,
      canRetry: false,
    };
  }

  if (status === 'DOWNLOADING') {
    if (
      execution === 'WAITING_FOR_WIFI' ||
      execution === 'STARTING' ||
      execution === 'PREPARING' ||
      execution === 'QUEUED' ||
      execution === 'RETRYING'
    ) {
      return {
        canPause: false,
        canResume: false,
        canCancel: true,
        canRetry: false,
      };
    }
    if (input.hasActiveTransfer === false && execution !== 'DOWNLOADING') {
      return {
        canPause: false,
        canResume: false,
        canCancel: true,
        canRetry: false,
      };
    }
    if (!transferActive && input.hasActiveTransfer === false) {
      return {
        canPause: false,
        canResume: false,
        canCancel: true,
        canRetry: false,
      };
    }
    return {
      canPause: true,
      canResume: false,
      canCancel: true,
      canRetry: false,
    };
  }

  // Coarse catalog QUEUED covers PREPARING / WAITING_FOR_WIFI / STARTING / RETRYING.
  // Preserve established semantics: Cancel only (do not fake Pause on STARTING).
  if (status === 'QUEUED') {
    return {
      canPause: false,
      canResume: false,
      canCancel: true,
      canRetry: false,
    };
  }

  return none;
}

/**
 * Resolve Pause/Resume/Cancel/Retry from authoritative Phase 1 status
 * (+ execution state when available). No URL heuristics. No progress heuristics.
 *
 * Pause is additionally withheld when the engine reports the source cannot
 * resume from a partial file: those sources answer a Range request with a full
 * 200 body, so a pause costs the user every byte already transferred. Resume
 * stays available on an already-PAUSED row so such a row is never stranded.
 */
export function resolveDownloadRuntimeActions(
  input: ResolveDownloadRuntimeActionsInput,
): DownloadRuntimeActions {
  const state = resolveStateActions(input);

  if (state.canPause && input.sourceSupportsResume === false) {
    return {
      ...state,
      canPause: false,
      pauseBlockedReason: 'SOURCE_NOT_RESUMABLE',
    };
  }

  return { ...state, pauseBlockedReason: null };
}

/** Map runtime capabilities to Downloads card action ids (transfer only). */
export function runtimeActionsToCardActions(
  actions: DownloadRuntimeActions,
): Array<'pause' | 'resume' | 'cancel' | 'retry'> {
  const out: Array<'pause' | 'resume' | 'cancel' | 'retry'> = [];
  if (actions.canPause) {
    out.push('pause');
  }
  if (actions.canResume) {
    out.push('resume');
  }
  if (actions.canCancel) {
    out.push('cancel');
  }
  if (actions.canRetry) {
    out.push('retry');
  }
  return out;
}
