import type { PlaybackState } from '../types';
import type { PlaybackRemoteDto } from '../../api/types';
import { computeProgressPercent } from './progress';
import {
  reconcilePlaybackState,
  type PlaybackSummaryLike,
} from './reconcile';

export type PlaybackSummary = {
  mediaId: string;
  positionSeconds: number;
  durationSeconds: number;
  progressPercent: number;
  lastPlayedAt: string | null;
  completed: boolean;
  updatedAt: string;
  pendingSync: boolean;
  clientRevision?: number;
};

function fromLocal(state: PlaybackState): PlaybackSummary {
  return {
    mediaId: state.mediaId,
    positionSeconds: state.positionSeconds,
    durationSeconds: state.durationSeconds,
    progressPercent: computeProgressPercent(
      state.positionSeconds,
      state.durationSeconds,
    ),
    lastPlayedAt: state.lastPlayedAt,
    completed: state.completed,
    updatedAt: state.updatedAt,
    pendingSync: state.pendingSync,
    clientRevision: state.clientRevision,
  };
}

function fromRemote(dto: PlaybackRemoteDto): PlaybackSummary {
  return {
    mediaId: dto.mediaId,
    positionSeconds: dto.positionSeconds,
    durationSeconds: dto.durationSeconds,
    progressPercent: computeProgressPercent(
      dto.positionSeconds,
      dto.durationSeconds,
    ),
    lastPlayedAt: dto.lastPlayedAt,
    completed: dto.completed,
    updatedAt: dto.updatedAt,
    pendingSync: false,
    clientRevision: dto.clientRevision ?? 0,
  };
}

function toSummary(result: PlaybackSummaryLike | null): PlaybackSummary | null {
  if (!result) {
    return null;
  }
  return {
    mediaId: result.mediaId,
    positionSeconds: result.positionSeconds,
    durationSeconds: result.durationSeconds,
    progressPercent: result.progressPercent,
    lastPlayedAt: result.lastPlayedAt,
    completed: result.completed,
    updatedAt: result.updatedAt,
    pendingSync: Boolean(result.pendingSync),
    clientRevision: result.clientRevision ?? 0,
  };
}

/**
 * Prefer newer updatedAt / clientRevision. Never let older remote overwrite newer local.
 * Completion is sticky unless {@link reconcilePlaybackState} allowReplayDowngrade.
 */
export function mergePlaybackStates(
  local: PlaybackState | PlaybackSummary | null | undefined,
  remote: PlaybackRemoteDto | PlaybackSummary | null | undefined,
  options?: { allowReplayDowngrade?: boolean },
): PlaybackSummary | null {
  const result = reconcilePlaybackState({
    local: local
      ? 'pendingSync' in local
        ? fromLocal(local as PlaybackState)
        : (local as PlaybackSummary)
      : null,
    remote: remote
      ? 'mediaId' in remote && 'updatedAt' in remote
        ? 'pendingSync' in remote
          ? (remote as PlaybackSummary)
          : fromRemote(remote as PlaybackRemoteDto)
        : null
      : null,
    allowReplayDowngrade: options?.allowReplayDowngrade === true,
  });
  return toSummary(result.state);
}

/** Merge lists keyed by mediaId — no duplicates. */
export function mergePlaybackSummariesByMediaId(
  lists: Array<readonly PlaybackSummary[]>,
): PlaybackSummary[] {
  const map = new Map<string, PlaybackSummary>();
  for (const list of lists) {
    for (const item of list) {
      const existing = map.get(item.mediaId);
      const merged = mergePlaybackStates(existing ?? null, item);
      if (merged) {
        map.set(item.mediaId, merged);
      }
    }
  }
  return Array.from(map.values());
}

export function remoteDtoToSummary(dto: PlaybackRemoteDto): PlaybackSummary {
  return fromRemote(dto);
}

export function localStateToSummary(state: PlaybackState): PlaybackSummary {
  return fromLocal(state);
}
