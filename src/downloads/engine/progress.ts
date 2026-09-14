import { DOWNLOAD_ENGINE } from './constants';
import type { TransferProgressSnapshot } from './types';

/**
 * Normalize native totalBytes. Unknown/absent Content-Length must stay null —
 * never treat 0 as a known total (that fabricates 0% forever).
 */
export function normalizeTotalBytes(totalBytes: number | null | undefined): number | null {
  if (typeof totalBytes !== 'number' || !Number.isFinite(totalBytes) || totalBytes <= 0) {
    return null;
  }
  return Math.trunc(totalBytes);
}

export function computeProgressPercent(
  bytesWritten: number,
  totalBytes: number | null,
): number {
  const total = normalizeTotalBytes(totalBytes);
  if (total == null) {
    // Unknown size — do not fabricate a percentage.
    return 0;
  }
  const raw = (bytesWritten / total) * 100;
  if (!Number.isFinite(raw)) {
    return 0;
  }
  // Reach 100% when all bytes are transferred; finalization is a separate UI phase.
  if (bytesWritten >= total) {
    return 100;
  }
  return Math.max(0, Math.min(99, Math.floor(raw)));
}

/** Invariant: QUEUED catalog status must not imply an active transfer attempt. */
export function assertProgressStatusInvariant(input: {
  status: string;
  bytesWritten: number;
  executionState?: string | null;
  hasActiveWorker?: boolean;
}): boolean {
  if (
    input.status === 'QUEUED' &&
    input.hasActiveWorker === true &&
    input.executionState !== 'STARTING'
  ) {
    return false;
  }
  if (
    input.status === 'DOWNLOADING' &&
    input.executionState === 'STARTING'
  ) {
    return false;
  }
  return true;
}

export function createProgressTracker() {
  let lastUiEmit = 0;
  let lastBackendEmit = 0;
  let lastBytes = 0;
  let lastSampleAt = Date.now();
  let bytesPerSecond: number | null = null;

  return {
    /**
     * Seed the session speed baseline at the resume offset so the first
     * sample does not treat cumulativeBytes as a single burst from 0.
     */
    seed(bytesWritten: number, now = Date.now()) {
      lastBytes = Math.max(0, Math.trunc(bytesWritten));
      lastSampleAt = now;
      bytesPerSecond = null;
    },
    note(bytesWritten: number, totalBytes: number | null, now = Date.now()) {
      const elapsed = Math.max(1, now - lastSampleAt);
      if (bytesWritten >= lastBytes && elapsed >= 400) {
        bytesPerSecond = ((bytesWritten - lastBytes) * 1000) / elapsed;
        lastBytes = bytesWritten;
        lastSampleAt = now;
      }

      const progress = computeProgressPercent(bytesWritten, totalBytes);
      const etaSeconds =
        bytesPerSecond && bytesPerSecond > 0 && totalBytes != null && totalBytes > bytesWritten
          ? Math.ceil((totalBytes - bytesWritten) / bytesPerSecond)
          : null;

      const snapshotBase = {
        bytesWritten,
        totalBytes,
        progress,
        bytesPerSecond:
          bytesPerSecond != null && Number.isFinite(bytesPerSecond)
            ? Math.max(0, Math.round(bytesPerSecond))
            : null,
        etaSeconds,
      };

      const shouldUpdateUi = now - lastUiEmit >= DOWNLOAD_ENGINE.uiProgressIntervalMs;
      const shouldUpdateBackend =
        now - lastBackendEmit >= DOWNLOAD_ENGINE.backendProgressIntervalMs;

      if (shouldUpdateUi) {
        lastUiEmit = now;
      }
      if (shouldUpdateBackend) {
        lastBackendEmit = now;
      }

      return {
        ...snapshotBase,
        shouldUpdateUi,
        shouldUpdateBackend,
      };
    },
    forceComplete(bytesWritten: number, totalBytes: number | null) {
      return {
        bytesWritten,
        totalBytes: totalBytes ?? bytesWritten,
        progress: 100,
        bytesPerSecond: null,
        etaSeconds: 0,
      };
    },
  };
}

export function toTransferSnapshot(
  downloadId: string,
  partial: {
    bytesWritten: number;
    totalBytes: number | null;
    progress: number;
    bytesPerSecond: number | null;
    etaSeconds: number | null;
  },
  localUri: string | null,
  localState: TransferProgressSnapshot['localState'],
  errorCode: TransferProgressSnapshot['errorCode'] = null,
  errorMessage: string | null = null,
): TransferProgressSnapshot {
  return {
    downloadId,
    bytesWritten: partial.bytesWritten,
    totalBytes: partial.totalBytes,
    progress: partial.progress,
    bytesPerSecond: partial.bytesPerSecond,
    etaSeconds: partial.etaSeconds,
    localUri,
    localState,
    errorCode,
    errorMessage,
  };
}
