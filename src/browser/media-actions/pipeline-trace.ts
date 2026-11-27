import type { DetectedMedia } from '@/media-detection/types';
import { recordPipelineOutcome, traceVerifiedCandidate, type PipelineStage } from '@/media-detection/pipeline/pipeline-outcome';

import type { MediaResolutionOutcome } from './media-resolution-outcome';

/** Where a resolution outcome was decided: the capability gate (classifier verdicts) or ownership/resolution. */
function stageOf(outcome: MediaResolutionOutcome): PipelineStage {
  switch (outcome.kind) {
    case 'PROVEN_UNSUPPORTED':
    case 'SESSION_REQUIRED':
    case 'NETWORK_FAILURE':
      return 'capability';
    case 'STALE_CONTEXT':
      return 'correlation';
    default:
      return 'resolver';
  }
}

/**
 * The verification of the page's selected video ended: record it as OFFERED or with its rejection. A verification
 * still running (or joined to one that is) is not an outcome yet.
 */
export function recordVerificationOutcome(input: {
  tabId: string | null;
  pageUrl: string | null;
  media: Pick<DetectedMedia, 'url' | 'finalUrl'> & Partial<Pick<DetectedMedia, 'detectionSource' | 'contentId'>>;
  outcome: MediaResolutionOutcome;
}): void {
  const { outcome } = input;
  if (outcome.kind === 'TRANSIENT_UNRESOLVED' && outcome.reason === 'VERIFYING') {
    return;
  }
  traceVerifiedCandidate({
    mediaUrl: input.media.finalUrl || input.media.url,
    source: input.media.detectionSource ?? null,
    named: Boolean(input.media.contentId),
    outcome: outcome.kind,
    reason: outcome.reason ?? null,
  });
  recordPipelineOutcome({
    tabId: input.tabId,
    pageUrl: input.pageUrl,
    mediaUrl: input.media.finalUrl || input.media.url,
    stage: outcome.kind === 'RESOLVED_SUPPORTED' ? 'offer' : stageOf(outcome),
    outcome: outcome.kind === 'RESOLVED_SUPPORTED' ? 'OFFERED' : 'REJECTED',
    reason: outcome.kind === 'RESOLVED_SUPPORTED' ? null : (outcome.reason ?? outcome.kind),
  });
}
