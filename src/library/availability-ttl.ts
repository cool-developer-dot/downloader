import { LIBRARY_RECONCILE_TTL_MS } from './constants';

/**
 * Filesystem availability cache policy.
 * List render / search must never bypass this and stat the disk.
 */
export function isAvailabilityCacheFresh(input: {
  cachedAt: number;
  nowMs: number;
  ttlMs?: number;
  force?: boolean;
}): boolean {
  if (input.force === true) {
    return false;
  }
  return input.nowMs - input.cachedAt < (input.ttlMs ?? LIBRARY_RECONCILE_TTL_MS);
}
