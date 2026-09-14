/**
 * Pre-completion HLS verification. Never mark COMPLETED before this succeeds.
 */

import { File } from 'expo-file-system';

import { DownloadEngineError } from '../errors';
import { verifyCompletedFile } from '../file-paths';
import type { HlsSegmentPlan } from './planner';
import { getHlsInitFile, getHlsSegmentFile } from './paths';

export function assertHlsPlanComplete(plan: HlsSegmentPlan): void {
  if (plan.totalSegments <= 0 || plan.mediaSegmentCount <= 0) {
    throw new DownloadEngineError(
      'INVALID_HLS_PLAYLIST',
      'HLS media playlist has no segments.',
    );
  }
  if (plan.initSegmentUrl && !plan.entries.some((entry) => entry.isInitSegment)) {
    throw new DownloadEngineError(
      'FINAL_FILE_INVALID',
      'HLS init segment is missing from the transfer plan.',
    );
  }
  const mediaIndexes = plan.entries
    .filter((entry) => !entry.isInitSegment)
    .map((entry) => entry.index);
  const unique = new Set(mediaIndexes);
  if (unique.size !== mediaIndexes.length) {
    throw new DownloadEngineError(
      'FINAL_FILE_INVALID',
      'HLS segment plan contains duplicate indexes.',
    );
  }
}

export function assertHlsTempSegmentsExist(
  downloadId: string,
  plan: HlsSegmentPlan,
): void {
  for (const entry of plan.entries) {
    const file = entry.isInitSegment
      ? getHlsInitFile(downloadId)
      : getHlsSegmentFile(downloadId, entry.index);
    if (!file.exists) {
      throw new DownloadEngineError(
        'FILE_SYSTEM_ERROR',
        'Missing HLS segment during assembly.',
      );
    }
    const size =
      typeof file.size === 'number' && Number.isFinite(file.size) ? file.size : 0;
    if (size <= 0) {
      throw new DownloadEngineError(
        'FILE_SYSTEM_ERROR',
        'Empty HLS segment during assembly.',
      );
    }
  }
}

export function verifyAssembledHlsFile(
  assembled: File,
  downloadId: string,
): { size: number } {
  const verification = verifyCompletedFile(assembled, null, { downloadId });
  if (!verification.ok) {
    throw new DownloadEngineError(
      'FINAL_FILE_INVALID',
      verification.reason === 'missing'
        ? 'HLS assembly produced no output file.'
        : 'HLS assembly produced an empty or invalid file.',
    );
  }
  return { size: verification.size };
}
