import {
  PLAYBACK_COMPLETED_PROGRESS_PERCENT,
  PLAYBACK_COMPLETED_REMAINING_SECONDS,
  PLAYBACK_MIN_DURATION_FOR_REMAINING_RULE,
} from '../constants';
import { computeProgressPercent } from './progress';

export function isNearEndComplete(input: {
  positionSeconds: number;
  durationSeconds: number;
}): boolean {
  const { positionSeconds, durationSeconds } = input;
  if (
    !Number.isFinite(positionSeconds) ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    positionSeconds < 0
  ) {
    return false;
  }

  const progress = computeProgressPercent(positionSeconds, durationSeconds);
  if (progress >= PLAYBACK_COMPLETED_PROGRESS_PERCENT) {
    return true;
  }

  if (durationSeconds >= PLAYBACK_MIN_DURATION_FOR_REMAINING_RULE) {
    const remaining = durationSeconds - positionSeconds;
    if (remaining <= PLAYBACK_COMPLETED_REMAINING_SECONDS) {
      return true;
    }
  }

  return false;
}

/**
 * Resolve completed flag.
 * Native playToEnd (markCompleted) always upgrades.
 * Existing completed is never downgraded by ordinary progress.
 */
export function resolveCompletedState(input: {
  positionSeconds: number;
  durationSeconds: number;
  markCompleted?: boolean;
  existingCompleted?: boolean;
  /** Intentional replay near start — allows clearing sticky completed. */
  replayReset?: boolean;
}): boolean {
  if (input.replayReset === true) {
    return false;
  }
  if (input.existingCompleted === true) {
    return true;
  }
  if (input.markCompleted === true) {
    return true;
  }
  return isNearEndComplete({
    positionSeconds: input.positionSeconds,
    durationSeconds: input.durationSeconds,
  });
}
