/**
 * Central seek math — single source for clamp, -10, +10.
 */

export function clampSeekTarget(
  targetSeconds: number,
  durationSeconds: number | null | undefined,
): number | null {
  if (!Number.isFinite(targetSeconds)) {
    return null;
  }
  const target = Math.max(0, targetSeconds);
  if (
    durationSeconds == null ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  ) {
    // Duration unknown: allow non-negative seeks only; do not invent an upper bound.
    return target;
  }
  return Math.min(target, durationSeconds);
}

export function seekByDelta(
  currentSeconds: number,
  deltaSeconds: number,
  durationSeconds: number | null | undefined,
): number | null {
  if (!Number.isFinite(currentSeconds) || !Number.isFinite(deltaSeconds)) {
    return null;
  }
  return clampSeekTarget(currentSeconds + deltaSeconds, durationSeconds);
}
