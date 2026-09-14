/**
 * Central reconciliation policy for local vs remote playback state.
 *
 * Device authority: active progress, newer unsynced offline state, local availability.
 * Backend authority: durable account history, ownership, server updatedAt.
 *
 * Completion is sticky unless intentional replayReset is present on the newer side.
 */

import { PLAYBACK_CLIENT_TIMESTAMP_MAX_FUTURE_MS } from '../constants';
import { computeProgressPercent } from './progress';
import type { PlaybackState } from '../types';
import type { PlaybackRemoteDto } from '../../api/types';

export type ReconcileDecision =
  | 'USE_LOCAL'
  | 'USE_REMOTE'
  | 'PUSH_LOCAL'
  | 'NO_CHANGE'
  | 'CONFLICT_RESOLVED';

export type ReconcilePlaybackInput = {
  local: PlaybackState | PlaybackSummaryLike | null | undefined;
  remote: PlaybackRemoteDto | PlaybackSummaryLike | null | undefined;
  /** When true, newer unfinished may clear completed (intentional replay). */
  allowReplayDowngrade?: boolean;
  nowMs?: number;
};

export type PlaybackSummaryLike = {
  mediaId: string;
  positionSeconds: number;
  durationSeconds: number;
  progressPercent: number;
  lastPlayedAt: string | null;
  completed: boolean;
  updatedAt: string;
  pendingSync?: boolean;
  clientRevision?: number;
};

export type ReconcilePlaybackResult = {
  decision: ReconcileDecision;
  state: PlaybackSummaryLike | null;
};

function toMs(iso: string | null | undefined): number {
  if (!iso) {
    return 0;
  }
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

function asSummary(
  value: PlaybackState | PlaybackSummaryLike | PlaybackRemoteDto,
): PlaybackSummaryLike {
  const pendingSync =
    'pendingSync' in value ? Boolean(value.pendingSync) : false;
  const clientRevision =
    'clientRevision' in value && typeof value.clientRevision === 'number'
      ? value.clientRevision
      : 0;
  return {
    mediaId: value.mediaId,
    positionSeconds: value.positionSeconds,
    durationSeconds: value.durationSeconds,
    progressPercent: computeProgressPercent(
      value.positionSeconds,
      value.durationSeconds,
    ),
    lastPlayedAt: value.lastPlayedAt,
    completed: value.completed,
    updatedAt: value.updatedAt,
    pendingSync,
    clientRevision,
  };
}

/**
 * Clamp wildly future client timestamps — they must not dominate forever.
 */
export function clampClientTimestampIso(
  iso: string,
  nowMs = Date.now(),
  maxFutureMs = PLAYBACK_CLIENT_TIMESTAMP_MAX_FUTURE_MS,
): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    return new Date(nowMs).toISOString();
  }
  if (ms > nowMs + maxFutureMs) {
    return new Date(nowMs).toISOString();
  }
  return new Date(ms).toISOString();
}

function pickNewerLastPlayed(
  a: string | null,
  b: string | null,
): string | null {
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }
  return toMs(a) >= toMs(b) ? a : b;
}

function applyCompletionInvariant(
  winner: PlaybackSummaryLike,
  local: PlaybackSummaryLike,
  remote: PlaybackSummaryLike,
  allowReplayDowngrade: boolean,
): PlaybackSummaryLike {
  const lastPlayedAt = pickNewerLastPlayed(
    winner.lastPlayedAt,
    pickNewerLastPlayed(local.lastPlayedAt, remote.lastPlayedAt),
  );
  // Intentional replay is the only path that may clear completed.
  if (allowReplayDowngrade) {
    return { ...winner, lastPlayedAt };
  }
  return {
    ...winner,
    completed: winner.completed || local.completed || remote.completed,
    lastPlayedAt,
  };
}

/**
 * Pure reconciliation — single policy for Coordinator, hooks, and tests.
 */
export function reconcilePlaybackState(
  input: ReconcilePlaybackInput,
): ReconcilePlaybackResult {
  const allowReplay = input.allowReplayDowngrade === true;
  const nowMs = input.nowMs ?? Date.now();

  if (!input.local && !input.remote) {
    return { decision: 'NO_CHANGE', state: null };
  }
  if (!input.local && input.remote) {
    return { decision: 'USE_REMOTE', state: asSummary(input.remote) };
  }
  if (input.local && !input.remote) {
    const local = asSummary(input.local);
    return {
      decision: local.pendingSync ? 'PUSH_LOCAL' : 'USE_LOCAL',
      state: local,
    };
  }

  const local = asSummary(input.local!);
  const remote = asSummary(input.remote!);
  if (local.mediaId !== remote.mediaId) {
    return { decision: 'USE_LOCAL', state: local };
  }

  // Bound future-skewed timestamps on both sides before comparison.
  // Server clocks are trusted in practice; clamping only affects wild future values.
  const localUpdatedAt = clampClientTimestampIso(local.updatedAt, nowMs);
  const remoteUpdatedAt = clampClientTimestampIso(remote.updatedAt, nowMs);
  const localMs = toMs(localUpdatedAt);
  const remoteMs = toMs(remoteUpdatedAt);
  const localRev = local.clientRevision ?? 0;
  const remoteRev = remote.clientRevision ?? 0;

  let winner: PlaybackSummaryLike;
  let decision: ReconcileDecision;

  if (localMs > remoteMs) {
    winner = { ...local, updatedAt: localUpdatedAt };
    decision = local.pendingSync ? 'PUSH_LOCAL' : 'USE_LOCAL';
  } else if (remoteMs > localMs) {
    winner = { ...remote, updatedAt: remoteUpdatedAt };
    decision = 'USE_REMOTE';
  } else if (localRev > remoteRev) {
    winner = { ...local, updatedAt: localUpdatedAt };
    decision = local.pendingSync ? 'PUSH_LOCAL' : 'USE_LOCAL';
  } else if (remoteRev > localRev) {
    winner = { ...remote, updatedAt: remoteUpdatedAt };
    decision = 'USE_REMOTE';
  } else {
    // Equal timestamp+revision: prefer completed sticky + richer progress.
    const completed = local.completed || remote.completed;
    const richer =
      local.positionSeconds >= remote.positionSeconds ? local : remote;
    winner = {
      ...richer,
      completed: allowReplay && !richer.completed ? richer.completed : completed,
      lastPlayedAt: pickNewerLastPlayed(local.lastPlayedAt, remote.lastPlayedAt),
      pendingSync: Boolean(local.pendingSync),
      clientRevision: Math.max(localRev, remoteRev),
      updatedAt: localUpdatedAt,
    };
    decision = 'CONFLICT_RESOLVED';
  }

  const resolved = applyCompletionInvariant(winner, local, remote, allowReplay);

  // If local still pending and we chose local-ish outcome, push.
  if (
    (decision === 'USE_LOCAL' || decision === 'CONFLICT_RESOLVED') &&
    local.pendingSync &&
    resolved.pendingSync !== false
  ) {
    return {
      decision: decision === 'USE_LOCAL' ? 'PUSH_LOCAL' : decision,
      state: { ...resolved, pendingSync: true },
    };
  }

  return { decision, state: resolved };
}

/** Whether local should be pushed to backend after reconcile. */
export function shouldPushLocalAfterReconcile(
  result: ReconcilePlaybackResult,
): boolean {
  return (
    result.decision === 'PUSH_LOCAL' ||
    (result.decision === 'CONFLICT_RESOLVED' &&
      result.state?.pendingSync === true)
  );
}
