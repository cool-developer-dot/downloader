/**
 * Explicit resume capability decisions — Phase 1E.
 */

import { isPlaylistOrStreamUrl } from './resource-guard';
import { isSocialCdnUrl } from './source-capability';
import type { LocalDownloadRecord } from './types';
import { hasResumableMultiRange } from './multi-range';

export type ResumeDecision =
  | 'CONTINUE_FROM_OFFSET'
  | 'RESTART_FROM_ZERO'
  | 'REFRESH_SOURCE_THEN_CONTINUE'
  | 'REFRESH_SOURCE_THEN_RESTART'
  | 'CANNOT_RESUME';

export type ResumeDecisionInput = {
  record: LocalDownloadRecord;
  partialBytes: number;
  sourceLikelyStale: boolean;
  sourceUrlChanged?: boolean;
};

export function decideResumeAction(input: ResumeDecisionInput): ResumeDecision {
  const { record, partialBytes, sourceLikelyStale, sourceUrlChanged } = input;

  if (record.remoteStatus === 'CANCELLED' || record.remoteStatus === 'COMPLETED') {
    return 'CANNOT_RESUME';
  }

  if (isPlaylistOrStreamUrl(record.sourceUrl)) {
    if (!record.hlsTransfer || record.hlsTransfer.completedSegments <= 0) {
      return sourceLikelyStale ? 'REFRESH_SOURCE_THEN_RESTART' : 'RESTART_FROM_ZERO';
    }
    return sourceLikelyStale ? 'REFRESH_SOURCE_THEN_CONTINUE' : 'CONTINUE_FROM_OFFSET';
  }

  if (hasResumableMultiRange(record.multiRange)) {
    return sourceLikelyStale ? 'REFRESH_SOURCE_THEN_CONTINUE' : 'CONTINUE_FROM_OFFSET';
  }

  const hasPauseResume =
    Boolean(record.pauseState?.resumeData) && partialBytes > 0;

  if (sourceUrlChanged) {
    return partialBytes > 0 ? 'REFRESH_SOURCE_THEN_RESTART' : 'REFRESH_SOURCE_THEN_RESTART';
  }

  if (sourceLikelyStale && isSocialCdnUrl(record.sourceUrl)) {
    return hasPauseResume ? 'REFRESH_SOURCE_THEN_CONTINUE' : 'REFRESH_SOURCE_THEN_RESTART';
  }

  if (hasPauseResume) {
    return 'CONTINUE_FROM_OFFSET';
  }

  if (partialBytes > 0) {
    return 'CONTINUE_FROM_OFFSET';
  }

  return 'RESTART_FROM_ZERO';
}
