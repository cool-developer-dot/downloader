/**
 * Centralized transfer timeout policy for Phase 1D.
 * Single source of truth — do not scatter magic numbers in transfer paths.
 */

import { DOWNLOAD_ENGINE } from './constants';
import { HLS_TRANSFER } from './hls/constants';
import { LOCAL_ANALYZE } from '../analyze/constants';

export type TransferTimeoutPolicy = {
  connectTimeoutMs: number;
  firstByteTimeoutMs: number;
  transferStallInactivityMs: number;
  hlsManifestTimeoutMs: number;
  hlsSegmentTimeoutMs: number;
  probeTimeoutMs: number;
  boundedProbeMaxBytes: number;
  boundedManifestMaxBytes: number;
  signatureProbeMaxBytes: number;
};

/** Mobile-network defaults — connect/first-byte ~20–30s, stall ~45s. */
export const TRANSFER_TIMEOUTS: TransferTimeoutPolicy = {
  connectTimeoutMs: DOWNLOAD_ENGINE.socialConnectTimeoutMs,
  firstByteTimeoutMs: DOWNLOAD_ENGINE.socialFirstByteTimeoutMs,
  transferStallInactivityMs: DOWNLOAD_ENGINE.transferStallInactivityMs,
  hlsManifestTimeoutMs: HLS_TRANSFER.requestTimeoutMs,
  hlsSegmentTimeoutMs: HLS_TRANSFER.requestTimeoutMs,
  probeTimeoutMs: LOCAL_ANALYZE.timeoutMs,
  boundedProbeMaxBytes: 16 * 1024,
  boundedManifestMaxBytes: HLS_TRANSFER.maxPlaylistBytes,
  signatureProbeMaxBytes: 16 * 1024,
};

export function mergeAbortSignals(
  signals: AbortSignal[],
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const listeners: Array<{ signal: AbortSignal; listener: () => void }> = [];

  const abortIfNeeded = () => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };

  for (const parent of signals) {
    if (parent.aborted) {
      controller.abort();
      break;
    }
    const listener = () => abortIfNeeded();
    parent.addEventListener('abort', listener);
    listeners.push({ signal: parent, listener });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      for (const { signal, listener } of listeners) {
        signal.removeEventListener('abort', listener);
      }
    },
  };
}

export function createTimeoutAbortSignal(
  timeoutMs: number,
  parent?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const onParentAbort = () => controller.abort();
  if (parent) {
    if (parent.aborted) {
      controller.abort();
    } else {
      parent.addEventListener('abort', onParentAbort);
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      if (parent) {
        parent.removeEventListener('abort', onParentAbort);
      }
    },
  };
}
