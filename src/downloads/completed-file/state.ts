/**
 * Phase 7A — Library download state grouping.
 * Does not redefine Phase 1 states — only groups them for presentation.
 */

import type { LibraryDownloadStateGroup } from './types';

const ACTIVE = new Set([
  'PREPARING',
  'QUEUED',
  'WAITING_FOR_WIFI',
  'STARTING',
  'DOWNLOADING',
  'FINALIZING',
  'PAUSED',
  'RETRYING',
  // Catalog / worker aliases that remain transitional:
  'WAITING',
  'VERIFYING',
  'COMPLETING',
  'TRANSFERRING',
  'PAUSING',
  'RETRY_WAIT',
  'IDLE',
]);

/**
 * Classify a download status / worker state into Library presentation groups.
 */
export function classifyLibraryDownloadState(
  status: string | null | undefined,
  workerState?: string | null,
): LibraryDownloadStateGroup {
  const statusKey = typeof status === 'string' ? status.trim().toUpperCase() : '';
  const workerKey =
    typeof workerState === 'string' ? workerState.trim().toUpperCase() : '';

  if (statusKey === 'COMPLETED' || workerKey === 'COMPLETED') {
    // Worker COMPLETED without catalog COMPLETED still maps completed only when status agrees.
    if (statusKey && statusKey !== 'COMPLETED') {
      if (statusKey === 'FAILED') {
        return 'failed';
      }
      if (statusKey === 'CANCELLED') {
        return 'cancelled';
      }
      return 'active_transitional';
    }
    return 'completed';
  }

  if (statusKey === 'FAILED' || workerKey === 'FAILED') {
    return 'failed';
  }

  if (statusKey === 'CANCELLED' || workerKey === 'CANCELLED') {
    return 'cancelled';
  }

  if (ACTIVE.has(statusKey) || ACTIVE.has(workerKey)) {
    return 'active_transitional';
  }

  if (!statusKey && !workerKey) {
    return 'unknown';
  }

  return 'active_transitional';
}

export function isCompletedLibraryGroup(group: LibraryDownloadStateGroup): boolean {
  return group === 'completed';
}
