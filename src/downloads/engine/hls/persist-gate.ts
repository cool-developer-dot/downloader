/**
 * Bounded local HLS persistence — every N segments and/or every X ms.
 * Backend PATCHes remain on the existing progress tracker throttle.
 */

import { HLS_TRANSFER } from './constants';
import type { HlsTransferState } from '../types';

export function createEmptyHlsTransferState(
  totalSegments = 0,
): HlsTransferState {
  return {
    totalSegments,
    completedSegments: 0,
    currentSegment: null,
    downloadedBytes: 0,
    failedSegment: null,
    retryCount: 0,
    lastFailureReason: null,
  };
}

export function createHlsPersistGate(options?: {
  everyNSegments?: number;
  intervalMs?: number;
}) {
  const everyN = options?.everyNSegments ?? HLS_TRANSFER.persistEveryNSegments;
  const intervalMs = options?.intervalMs ?? HLS_TRANSFER.persistIntervalMs;
  let lastCompleted = 0;
  let lastAt = 0;

  return {
    shouldPersist(completedSegments: number, now = Date.now(), force = false): boolean {
      if (force) {
        lastCompleted = completedSegments;
        lastAt = now;
        return true;
      }
      const jumped = completedSegments - lastCompleted >= everyN;
      const timed = now - lastAt >= intervalMs;
      if (jumped || timed) {
        lastCompleted = completedSegments;
        lastAt = now;
        return true;
      }
      return false;
    },
  };
}
