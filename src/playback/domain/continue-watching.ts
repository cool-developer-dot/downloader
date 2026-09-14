import { PLAYBACK_MIN_RESUME_SECONDS } from '../constants';
import { isNearEndComplete } from './completion';
import type { PlaybackSummary } from './merge';

export function isContinueWatchingEligible(
  summary: Pick<
    PlaybackSummary,
    'positionSeconds' | 'durationSeconds' | 'completed' | 'lastPlayedAt'
  >,
  options?: { localAvailable?: boolean },
): boolean {
  if (summary.completed) {
    return false;
  }
  if (!summary.lastPlayedAt) {
    return false;
  }
  if (options?.localAvailable === false) {
    return false;
  }
  if (
    !Number.isFinite(summary.positionSeconds) ||
    summary.positionSeconds < PLAYBACK_MIN_RESUME_SECONDS
  ) {
    return false;
  }
  if (
    isNearEndComplete({
      positionSeconds: summary.positionSeconds,
      durationSeconds: summary.durationSeconds,
    })
  ) {
    return false;
  }
  return true;
}

export function sortByLastPlayedDesc<
  T extends { lastPlayedAt: string | null; mediaId?: string; id?: string },
>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const ta = a.lastPlayedAt ? Date.parse(a.lastPlayedAt) : 0;
    const tb = b.lastPlayedAt ? Date.parse(b.lastPlayedAt) : 0;
    const sa = Number.isFinite(ta) ? ta : 0;
    const sb = Number.isFinite(tb) ? tb : 0;
    if (sb !== sa) {
      return sb - sa;
    }
    const idA = a.mediaId ?? a.id ?? '';
    const idB = b.mediaId ?? b.id ?? '';
    return idA.localeCompare(idB);
  });
}
