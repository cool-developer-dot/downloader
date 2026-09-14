import { PLAYBACK_MIN_RESUME_SECONDS } from '../constants';
import { isNearEndComplete } from './completion';

export type ResumeEligibilityInput = {
  positionSeconds: number;
  durationSeconds: number;
  completed: boolean;
};

/**
 * Resume is offered only for meaningful unfinished mid-roll progress.
 * Not for 0:02, completed, or near-end positions.
 */
export function isResumeEligible(input: ResumeEligibilityInput): boolean {
  const { positionSeconds, durationSeconds, completed } = input;
  if (completed) {
    return false;
  }
  if (
    !Number.isFinite(positionSeconds) ||
    !Number.isFinite(durationSeconds) ||
    positionSeconds < PLAYBACK_MIN_RESUME_SECONDS
  ) {
    return false;
  }
  if (isNearEndComplete({ positionSeconds, durationSeconds })) {
    return false;
  }
  return true;
}
