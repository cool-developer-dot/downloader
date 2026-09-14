/**
 * Multi-range resume helpers — detect durable part checkpoints.
 */

import type { MultiRangeTransferState } from '../types';

export function hasResumableMultiRange(
  state: MultiRangeTransferState | null | undefined,
): boolean {
  return Boolean(
    state &&
      state.contentLength > 0 &&
      Array.isArray(state.parts) &&
      state.parts.length > 1,
  );
}

export function sumMultiRangeDownloaded(
  state: MultiRangeTransferState,
): number {
  return state.parts.reduce(
    (sum, part) => sum + Math.max(0, part.downloadedBytes),
    0,
  );
}
