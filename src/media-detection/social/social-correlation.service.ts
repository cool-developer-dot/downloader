/**
 * Platform-neutral social candidate ownership / correlation.
 *
 * Ordering:
 *   CURRENT SOCIAL CONTENT → ACTIVE/VISIBLE PLAYER → CORRELATED RESOURCES
 *
 * Never selects solely by latest URL, largest size, or highest bitrate.
 */

import type { DetectedMedia } from '../types';
import { isLikelyMediaSegment } from '../services/false-positive.filter';
import {
  isLikelySocialProfileAsset,
  isLikelySocialThumbnail,
} from '../platform/cdn-hosts';
import {
  classifyTikTokNetworkResource,
  isLikelyTikTokPreloadRelativeToOwner,
} from './tiktok-media-resource';
import { mergeEligibleWindowCandidates } from '../observation/candidate-observation-window';
import { scoreMediaCorrelation } from '../services/media-correlation.service';
import { logSocialCorrelation, hashSafeId } from './social-correlation-diagnostics';
import { socialPageContextStore } from './social-page-context';
import { resolveSocialPlatform } from './social-content-identity';
import type {
  CandidateOwnershipEvidence,
  CorrelatedCandidateGroup,
  SocialCandidateCorrelation,
  SocialCorrelationConfidence,
  SocialPageContext,
  SocialRejectionReason,
} from './types';

const RECENT_MS = 45_000;

export type SocialCorrelationInput = {
  candidates: DetectedMedia[];
  context: SocialPageContext | null;
  /** Owning tab for this selection — must match context.tabId when set. */
  tabId: string | null;
  navigationEpoch: number;
  pageUrl: string | null;
  msePlaybackActive?: boolean;
  msePlaybackAgeMs?: number | null;
};

function resourcePathKey(url: string): string | null {
  if (url.toLowerCase().startsWith('blob:')) {
    return null;
  }
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`.toLowerCase();
  } catch {
    return null;
  }
}

function urlsShareResourcePath(a: string, b: string): boolean {
  const ka = resourcePathKey(a);
  const kb = resourcePathKey(b);
  if (ka && kb) {
    return ka === kb;
  }
  return a === b;
}

function isImageLike(media: DetectedMedia): boolean {
  if (media.mimeType?.startsWith('image/')) {
    return true;
  }
  const ext = media.extension?.toLowerCase();
  if (
    ext === 'jpg' ||
    ext === 'jpeg' ||
    ext === 'png' ||
    ext === 'webp' ||
    ext === 'avif' ||
    ext === 'gif'
  ) {
    return true;
  }
  return isLikelySocialThumbnail(media.url) || isLikelySocialProfileAsset(media.url);
}

function isSegment(media: DetectedMedia): boolean {
  return isLikelyMediaSegment(media.url, media.extension);
}

function isBlobOnly(media: DetectedMedia): boolean {
  return media.url.toLowerCase().startsWith('blob:');
}

function matchesActiveCurrentSrc(
  media: DetectedMedia,
  context: SocialPageContext,
): boolean | null {
  const active = context.activeVideoCurrentSrc;
  if (!active) {
    return null;
  }
  if (active.toLowerCase().startsWith('blob:')) {
    // Blob indicates active player — network candidate may still correlate via other signals.
    return null;
  }
  return (
    urlsShareResourcePath(media.url, active) ||
    urlsShareResourcePath(media.finalUrl || media.url, active) ||
    urlsShareResourcePath(media.sourceUrl || media.url, active)
  );
}

function buildEvidence(
  media: DetectedMedia,
  input: SocialCorrelationInput,
  context: SocialPageContext,
): CandidateOwnershipEvidence {
  const tabMatch = Boolean(input.tabId && input.tabId === context.tabId);
  const navigationMatch = input.navigationEpoch === context.navigationEpoch;
  const currentPageMatch =
    Boolean(input.pageUrl) &&
    (input.pageUrl === context.pageUrl ||
      Boolean(
        context.canonicalPageUrl &&
          input.pageUrl &&
          input.pageUrl.startsWith(context.canonicalPageUrl.replace(/\/$/, '')),
      ));

  const srcMatch = matchesActiveCurrentSrc(media, context);
  const intersection = context.activeVideoIntersectionRatio;
  const visibleVideoMatch =
    intersection == null
      ? null
      : intersection >= 0.35 &&
        (context.activeVideoRecentlyPlayed || context.activeVideoPaused === false);

  const hidden =
    intersection != null &&
    intersection < 0.15 &&
    context.activeVideoPaused !== false &&
    srcMatch !== true;

  const requestFamily =
    context.platform === 'tiktok'
      ? classifyTikTokNetworkResource(media.finalUrl || media.url)
      : null;
  const tiktokPreload =
    context.platform === 'tiktok' &&
    isLikelyTikTokPreloadRelativeToOwner({
      candidateDetectedAt: media.detectedAt ?? 0,
      ownerObservedAt: context.observedAt,
      activeVideoIsBlob: context.activeVideoIsBlob,
      currentOwnerAssociated: srcMatch === true,
      requestFamily,
      sameGeneration: true,
    });

  // Visible active player exists and this resource is not its currentSrc → neighbor/preload.
  const preload =
    tiktokPreload ||
    (Boolean(context.activeVideoElementIdentity) &&
      Boolean(context.activeVideoCurrentSrc) &&
      !context.activeVideoIsBlob &&
      srcMatch === false &&
      (intersection == null || intersection >= 0.35));

  const socialContentMatch =
    context.canonicalContentId == null
      ? null
      : true; // candidates inherit page context; neighbor without match handled by preload/src

  return {
    tabMatch,
    navigationMatch,
    socialContentMatch,
    activeVideoElementMatch: srcMatch,
    visibleVideoMatch,
    currentSrcMatch: srcMatch,
    recentObservation: Date.now() - media.detectedAt < RECENT_MS,
    currentPageMatch,
    preloadPenalty: preload,
    hiddenElementPenalty: hidden,
    adPenalty: context.explicitAdMarker,
    staleContextPenalty: false,
    segmentPenalty: isSegment(media),
    imagePenalty: isImageLike(media),
    blobOnlyPenalty: isBlobOnly(media),
  };
}

function confidenceFromEvidence(
  evidence: CandidateOwnershipEvidence,
  baseReject: boolean,
  baseRejection: string | null,
): { confidence: SocialCorrelationConfidence; reason: SocialRejectionReason | null; rank: number } {
  if (!evidence.tabMatch) {
    return { confidence: 'REJECTED', reason: 'WRONG_TAB', rank: -1000 };
  }
  if (!evidence.navigationMatch) {
    return { confidence: 'REJECTED', reason: 'STALE_NAVIGATION', rank: -1000 };
  }
  if (evidence.staleContextPenalty) {
    return { confidence: 'REJECTED', reason: 'STALE_SOCIAL_CONTEXT', rank: -1000 };
  }
  if (evidence.blobOnlyPenalty) {
    return { confidence: 'REJECTED', reason: 'BLOB_ONLY', rank: -900 };
  }
  if (evidence.imagePenalty) {
    return { confidence: 'REJECTED', reason: 'IMAGE_RESOURCE', rank: -900 };
  }
  if (evidence.segmentPenalty) {
    return { confidence: 'REJECTED', reason: 'SEGMENT_RESOURCE', rank: -900 };
  }
  if (evidence.adPenalty && evidence.currentSrcMatch !== true) {
    return { confidence: 'REJECTED', reason: 'ADVERTISEMENT', rank: -800 };
  }
  if (baseReject && baseRejection === 'blob_not_downloadable') {
    return { confidence: 'REJECTED', reason: 'BLOB_ONLY', rank: -900 };
  }
  if (baseReject && (baseRejection === 'image_not_video' || baseRejection === 'non_video_candidate')) {
    return {
      confidence: 'REJECTED',
      reason: baseRejection === 'image_not_video' ? 'IMAGE_RESOURCE' : 'NON_VIDEO',
      rank: -900,
    };
  }

  if (evidence.hiddenElementPenalty && evidence.currentSrcMatch !== true) {
    return { confidence: 'REJECTED', reason: 'HIDDEN_VIDEO', rank: -700 };
  }

  if (evidence.preloadPenalty && evidence.currentSrcMatch !== true) {
    return { confidence: 'REJECTED', reason: 'OFFSCREEN_PRELOAD', rank: -650 };
  }

  // STRONG: content context + active visible currentSrc match
  if (
    evidence.currentSrcMatch === true &&
    evidence.visibleVideoMatch !== false &&
    evidence.tabMatch &&
    evidence.navigationMatch
  ) {
    return { confidence: 'STRONG', reason: null, rank: 900 };
  }

  // MEDIUM: active/visible player signals without contradictory src, or MSE + page match
  if (
    evidence.tabMatch &&
    evidence.navigationMatch &&
    evidence.currentPageMatch &&
    !evidence.preloadPenalty &&
    (evidence.visibleVideoMatch === true ||
      evidence.currentSrcMatch === true ||
      evidence.recentObservation)
  ) {
    // Network-only on correct page without active match stays weaker.
    if (evidence.currentSrcMatch === true || evidence.visibleVideoMatch === true) {
      return { confidence: 'MEDIUM', reason: null, rank: 600 };
    }
  }

  if (
    evidence.tabMatch &&
    evidence.navigationMatch &&
    evidence.currentPageMatch &&
    !evidence.preloadPenalty &&
    !evidence.hiddenElementPenalty
  ) {
    return { confidence: 'WEAK', reason: null, rank: 200 };
  }

  if (baseReject) {
    return { confidence: 'REJECTED', reason: 'LOW_CORRELATION', rank: -500 };
  }

  return { confidence: 'WEAK', reason: 'WEAK_UNCORRELATED_MEDIA', rank: 50 };
}

/**
 * Correlate one candidate against current social context.
 */
export function correlateSocialCandidate(
  media: DetectedMedia,
  input: Omit<SocialCorrelationInput, 'candidates'> & { context: SocialPageContext },
): SocialCandidateCorrelation {
  const { context } = input;
  const evidence = buildEvidence(media, { ...input, candidates: [] }, context);

  const legacy = scoreMediaCorrelation(media, {
    pageUrl: input.pageUrl ?? context.pageUrl,
    msePlaybackActive: input.msePlaybackActive,
    msePlaybackAgeMs: input.msePlaybackAgeMs,
  });

  // Blob active player clue: boost network candidate on same page when MSE/blob active.
  if (
    context.activeVideoIsBlob &&
    !isBlobOnly(media) &&
    evidence.currentPageMatch &&
    evidence.tabMatch &&
    evidence.navigationMatch &&
    !evidence.preloadPenalty
  ) {
    // Do not treat as STRONG without more evidence — MEDIUM floor.
  }

  const ranked = confidenceFromEvidence(evidence, legacy.reject, legacy.rejectionReason);

  // Active blob player + underlying http(s) candidate on same page → allow MEDIUM+
  if (
    context.activeVideoIsBlob &&
    !isBlobOnly(media) &&
    evidence.tabMatch &&
    evidence.navigationMatch &&
    evidence.currentPageMatch &&
    !evidence.imagePenalty &&
    !evidence.segmentPenalty &&
    ranked.confidence !== 'REJECTED'
  ) {
    if (ranked.confidence === 'WEAK') {
      return {
        confidence: 'MEDIUM',
        rejectionReason: null,
        evidence,
        rank: Math.max(ranked.rank, 550) + Math.min(legacy.score, 1) * 20,
      };
    }
  }

  // Never let size/bitrate alone outrank ownership — fold legacy score lightly.
  let rank =
    ranked.confidence === 'REJECTED'
      ? ranked.rank
      : ranked.rank + Math.min(legacy.score, 1.2) * 15;

  // Temporal proximity is secondary rank only — never the sole reject for
  // current-generation progressive/Range media.
  if (
    ranked.confidence !== 'REJECTED' &&
    context.platform === 'tiktok' &&
    context.activeVideoIsBlob
  ) {
    const delta = (media.detectedAt ?? 0) - context.observedAt;
    if (delta > 2500) {
      rank -= 40;
    }
  }

  return {
    confidence: ranked.confidence,
    rejectionReason: ranked.reason,
    evidence,
    rank,
  };
}

const CONFIDENCE_ORDER: Record<SocialCorrelationConfidence, number> = {
  STRONG: 4,
  MEDIUM: 3,
  WEAK: 2,
  REJECTED: 1,
};

/**
 * Select current media for a social page using ownership evidence.
 * WEAK never replaces an existing STRONG/MEDIUM selection.
 */
export function selectCurrentSocialMedia(
  input: SocialCorrelationInput,
): {
  media: DetectedMedia | null;
  group: CorrelatedCandidateGroup;
} {
  const rejected: Array<{
    candidateId: string;
    reason: SocialRejectionReason;
  }> = [];
  const activeCandidateIds: string[] = [];

  const emptyGroup = (): CorrelatedCandidateGroup => ({
    currentContentIdentity: null,
    platform: null,
    contextGeneration: 0,
    navigationEpoch: input.navigationEpoch,
    tabId: input.tabId,
    activeCandidateIds: [],
    rejected,
    confidence: null,
  });

  if (!input.context) {
    // Non-social or missing context — caller should fall back to legacy correlation.
    return { media: null, group: emptyGroup() };
  }

  const context = input.context;

  if (input.tabId && input.tabId !== context.tabId) {
    logSocialCorrelation('tab_mismatch_rejected', {
      platform: context.platform,
      tabId: input.tabId,
      navigationEpoch: input.navigationEpoch,
      contextGeneration: context.contextGeneration,
      reason: 'WRONG_TAB',
    });
    return { media: null, group: emptyGroup() };
  }

  if (input.navigationEpoch !== context.navigationEpoch) {
    logSocialCorrelation('stale_event_ignored', {
      platform: context.platform,
      tabId: context.tabId,
      navigationEpoch: input.navigationEpoch,
      contextGeneration: context.contextGeneration,
      reason: 'STALE_NAVIGATION',
    });
    return { media: null, group: emptyGroup() };
  }

  type Ranked = {
    media: DetectedMedia;
    correlation: SocialCandidateCorrelation;
  };

  const ranked: Ranked[] = [];

  for (const candidate of input.candidates) {
    logSocialCorrelation('candidate_observed', {
      platform: context.platform,
      tabId: context.tabId,
      navigationEpoch: context.navigationEpoch,
      contextGeneration: context.contextGeneration,
      contentId: context.canonicalContentId,
      candidateFingerprintHash: hashSafeId(candidate.id),
    });

    const correlation = correlateSocialCandidate(candidate, {
      context,
      tabId: input.tabId,
      navigationEpoch: input.navigationEpoch,
      pageUrl: input.pageUrl,
      msePlaybackActive: input.msePlaybackActive,
      msePlaybackAgeMs: input.msePlaybackAgeMs,
    });

    if (correlation.confidence === 'REJECTED') {
      rejected.push({
        candidateId: candidate.id,
        reason: correlation.rejectionReason ?? 'LOW_CORRELATION',
      });
      logSocialCorrelation('candidate_rejected', {
        platform: context.platform,
        tabId: context.tabId,
        navigationEpoch: context.navigationEpoch,
        contextGeneration: context.contextGeneration,
        candidateFingerprintHash: hashSafeId(candidate.id),
        reason: correlation.rejectionReason,
        confidence: 'REJECTED',
      });
      if (correlation.rejectionReason === 'OFFSCREEN_PRELOAD') {
        logSocialCorrelation('preload_suppressed', {
          platform: context.platform,
          tabId: context.tabId,
          navigationEpoch: context.navigationEpoch,
          contextGeneration: context.contextGeneration,
          candidateFingerprintHash: hashSafeId(candidate.id),
        });
      }
      continue;
    }

    ranked.push({ media: candidate, correlation });
    logSocialCorrelation('candidate_correlated', {
      platform: context.platform,
      tabId: context.tabId,
      navigationEpoch: context.navigationEpoch,
      contextGeneration: context.contextGeneration,
      contentId: context.canonicalContentId,
      candidateFingerprintHash: hashSafeId(candidate.id),
      confidence: correlation.confidence,
    });
  }

  ranked.sort((a, b) => {
    const conf =
      CONFIDENCE_ORDER[b.correlation.confidence] -
      CONFIDENCE_ORDER[a.correlation.confidence];
    if (conf !== 0) {
      return conf;
    }
    return b.correlation.rank - a.correlation.rank;
  });

  // Promotion policy: prefer STRONG > MEDIUM > WEAK; never promote WEAK over MEDIUM/STRONG.
  let best: Ranked | null = null;
  for (const item of ranked) {
    if (!best) {
      best = item;
      continue;
    }
    if (
      CONFIDENCE_ORDER[item.correlation.confidence] >
      CONFIDENCE_ORDER[best.correlation.confidence]
    ) {
      logSocialCorrelation('candidate_promoted', {
        platform: context.platform,
        tabId: context.tabId,
        candidateFingerprintHash: hashSafeId(item.media.id),
        confidence: item.correlation.confidence,
      });
      logSocialCorrelation('candidate_demoted', {
        platform: context.platform,
        tabId: context.tabId,
        candidateFingerprintHash: hashSafeId(best.media.id),
        confidence: best.correlation.confidence,
      });
      best = item;
      continue;
    }
    if (
      item.correlation.confidence === best.correlation.confidence &&
      item.correlation.rank > best.correlation.rank
    ) {
      // Same band — allow rank within band (ownership-weighted, not size-alone).
      best = item;
    }
  }

  if (best) {
    activeCandidateIds.push(best.media.id);
    for (const item of ranked) {
      if (activeCandidateIds.length >= 6) {
        break;
      }
      if (!activeCandidateIds.includes(item.media.id)) {
        activeCandidateIds.push(item.media.id);
      }
    }
  }

  const contentIdentity =
    context.canonicalContentId != null
      ? `${context.platform}:${context.contentType}:${context.canonicalContentId}`
      : context.currentVisibleMediaIdentity;

  return {
    media: best?.media ?? null,
    group: {
      currentContentIdentity: contentIdentity,
      platform: context.platform,
      contextGeneration: context.contextGeneration,
      navigationEpoch: context.navigationEpoch,
      tabId: context.tabId,
      activeCandidateIds,
      rejected,
      confidence: best?.correlation.confidence ?? null,
    },
  };
}

/**
 * Convenience: resolve active social context + select media.
 */
export function selectCurrentMediaForActiveSocialTab(input: {
  candidates: DetectedMedia[];
  tabId: string | null;
  navigationEpoch: number;
  pageUrl: string | null;
  msePlaybackActive?: boolean;
  msePlaybackAgeMs?: number | null;
}): {
  media: DetectedMedia | null;
  group: CorrelatedCandidateGroup;
  usedSocialCorrelation: boolean;
} {
  const platform = input.pageUrl ? resolveSocialPlatform(input.pageUrl) : null;
  if (!platform || !input.tabId) {
    return {
      media: null,
      group: {
        currentContentIdentity: null,
        platform: null,
        contextGeneration: 0,
        navigationEpoch: input.navigationEpoch,
        tabId: input.tabId,
        activeCandidateIds: [],
        rejected: [],
        confidence: null,
      },
      usedSocialCorrelation: false,
    };
  }

  const context =
    socialPageContextStore.get(input.tabId) ??
    socialPageContextStore.syncFromPageUrl({
      tabId: input.tabId,
      pageUrl: input.pageUrl!,
      navigationEpoch: input.navigationEpoch,
    });

  const windowed = context
    ? mergeEligibleWindowCandidates(
        {
          tabId: input.tabId,
          navigationEpoch: input.navigationEpoch,
          generation: context.contextGeneration,
          platform: context.platform,
        },
        input.candidates,
      )
    : input.candidates;

  const result = selectCurrentSocialMedia({
    candidates: windowed,
    context,
    tabId: input.tabId,
    navigationEpoch: input.navigationEpoch,
    pageUrl: input.pageUrl,
    msePlaybackActive: input.msePlaybackActive,
    msePlaybackAgeMs: input.msePlaybackAgeMs,
  });

  return { ...result, usedSocialCorrelation: true };
}
