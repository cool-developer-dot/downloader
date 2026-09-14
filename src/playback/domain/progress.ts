import { PLAYBACK_COMPLETED_PROGRESS_PERCENT } from '../constants';

export function clampProgressPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 100) {
    return 100;
  }
  return value;
}

export function computeProgressPercent(
  positionSeconds: number,
  durationSeconds: number,
): number {
  if (
    !Number.isFinite(positionSeconds) ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  ) {
    return 0;
  }
  return clampProgressPercent(
    (Math.max(0, positionSeconds) / durationSeconds) * 100,
  );
}

export function isValidProgressNumbers(
  positionSeconds: number,
  durationSeconds: number,
  toleranceSeconds = 2,
): boolean {
  if (
    typeof positionSeconds !== 'number' ||
    typeof durationSeconds !== 'number' ||
    !Number.isFinite(positionSeconds) ||
    !Number.isFinite(durationSeconds) ||
    positionSeconds < 0 ||
    durationSeconds < 0
  ) {
    return false;
  }
  if (
    durationSeconds > 0 &&
    positionSeconds > durationSeconds + toleranceSeconds
  ) {
    return false;
  }
  return true;
}

/** @deprecated Prefer computeProgressPercent — kept for clarity in tests. */
export function progressAtLeastCompletedThreshold(
  progressPercent: number,
): boolean {
  return clampProgressPercent(progressPercent) >= PLAYBACK_COMPLETED_PROGRESS_PERCENT;
}
