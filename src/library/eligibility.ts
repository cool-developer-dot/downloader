import {
  HLS_WORKSPACE_FOLDER,
  MULTI_RANGE_WORKSPACE_FOLDER,
  TEMP_FILE_MARKERS,
} from './constants';
import type { LocalAvailability } from './types';

const PLAYABLE_STATUSES = new Set(['COMPLETED']);

const EXCLUDED_STATUSES = new Set([
  'QUEUED',
  'DOWNLOADING',
  'PAUSED',
  'RETRY_WAIT',
  'FAILED',
  'CANCELLED',
]);

const NON_COMPLETE_LOCAL_STATES = new Set([
  'not_started',
  'transferring',
  'paused',
  'failed',
  'deleted',
  'corrupt',
  'missing',
]);

function normalizePath(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\\/g, '/');
}

/**
 * True when a URI or file name is an in-progress / workspace artifact
 * (HLS segments, multi-range parts, merge temps, .rangepart).
 */
export function isTempOrWorkspaceArtifact(
  localUri: string | null | undefined,
  fileName: string | null | undefined,
): boolean {
  const uri = normalizePath(localUri);
  const name = normalizePath(fileName);

  if (!uri && !name) {
    return false;
  }

  const haystack = `${uri} ${name}`;
  for (const marker of TEMP_FILE_MARKERS) {
    if (haystack.includes(marker.toLowerCase())) {
      return true;
    }
  }

  if (uri.includes(`/${HLS_WORKSPACE_FOLDER}/`) || name.includes(`/${HLS_WORKSPACE_FOLDER}/`)) {
    return true;
  }
  if (
    uri.includes(`/${MULTI_RANGE_WORKSPACE_FOLDER}/`) ||
    name.includes(`/${MULTI_RANGE_WORKSPACE_FOLDER}/`)
  ) {
    return true;
  }

  if (name.endsWith('.rangepart') || uri.endsWith('.rangepart')) {
    return true;
  }

  return false;
}

export function isCompletedStatus(status: string | null | undefined): boolean {
  if (!status) {
    return false;
  }
  return PLAYABLE_STATUSES.has(status);
}

export function isExcludedStatus(status: string | null | undefined): boolean {
  if (!status) {
    return false;
  }
  return EXCLUDED_STATUSES.has(status);
}

/**
 * Metadata-only eligibility. File verification is a separate step.
 * Rejects non-completed statuses and workspace/partial artifacts.
 */
export function isLibraryCandidate(input: {
  downloadId: string | null | undefined;
  status: string | null | undefined;
  fileName?: string | null;
  localUri?: string | null;
  localState?: string | null;
}): boolean {
  const downloadId = input.downloadId?.trim();
  if (!downloadId) {
    return false;
  }

  if (isExcludedStatus(input.status) || !isCompletedStatus(input.status)) {
    return false;
  }

  if (isTempOrWorkspaceArtifact(input.localUri, input.fileName)) {
    return false;
  }

  if (input.localState && NON_COMPLETE_LOCAL_STATES.has(input.localState)) {
    return false;
  }

  return true;
}

export function isPlayableAvailability(
  availability: LocalAvailability,
): boolean {
  return availability === 'available';
}

/**
 * Whether a play affordance should stay enabled, which is a deliberately looser
 * question than `isPlayableAvailability`.
 *
 * Verification is TTL-based, so `unverified` only means "not checked recently" —
 * blocking it would hide files that are really on disk. Only a known-`missing`
 * file disables the control. The file is verified for real when the player
 * mounts, so an optimistic tap surfaces an error instead of doing nothing.
 */
export function canAttemptPlayback(availability: LocalAvailability): boolean {
  return availability !== 'missing';
}
