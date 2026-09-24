/**
 * Platform-neutral general-web candidate ownership / correlation (Phase 5A).
 *
 * Ordering:
 *   CURRENT PAGE/PLAYER → ACTIVE/VISIBLE MEDIA → CORRELATED CANDIDATES
 *
 * Never selects solely by latest URL, largest size, or highest bitrate.
 * Does NOT verify downloadability (Phase 5B).
 */

import type { DetectedMedia, DetectionSource } from '../types';
import { isLikelyMediaSegment } from '../services/false-positive.filter';
import {
  isLikelySocialProfileAsset,
  isLikelySocialThumbnail,
} from '../platform/cdn-hosts';
import { scoreMediaCorrelation } from '../services/media-correlation.service';
import {
  hashHandoffIdentity,
  logAutomaticHandoff,
} from '../services/automatic-handoff-diagnostics';
import { resolveSocialPlatform } from '../social/social-content-identity';
import { hashSafeId, logGeneralMedia, logGeneralCorrelationTrace } from './general-media-diagnostics';
import { generalPageMediaContextStore } from './general-page-context';
import { stableResourcePath } from '../social-source/resource-identity';
import { isSameGeneralContentNavigation } from './general-content-navigation';
import type {
  CorrelatedGeneralMediaCandidateSet,
  GeneralCandidateCorrelation,
  GeneralCorrelationConfidence,
  GeneralOwnershipEvidence,
  GeneralPageMediaContext,
  GeneralRejectionReason,
} from './types';

const RECENT_MS = 45_000;
const MAX_ACTIVE_GENERAL_CANDIDATES = 6;

/** Soft ceiling for "tiny preview" intrinsic dimensions (combined evidence only). */
const TINY_DIM_PX = 240;

export type GeneralCorrelationInput = {
  candidates: DetectedMedia[];
  context: GeneralPageMediaContext | null;
  tabId: string | null;
  navigationEpoch: number;
  pageGeneration?: number;
  pageUrl: string | null;
  msePlaybackActive?: boolean;
  msePlaybackAgeMs?: number | null;
};

function resourcePathKey(url: string): string | null {
  if (url.toLowerCase().startsWith('blob:')) {
    return null;
  }
  try {
    return stableResourcePath(url);
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

const IMAGE_EXTS = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'avif',
  'gif',
  'svg',
  'ico',
  'bmp',
]);

/** Poster / sprite / thumbnail path heuristics — never final video ownership. */
const POSTER_PATH_RE =
  /(?:^|[/?._-])(?:poster|thumb(?:nail)?s?|sprite|preview[_-]?image|cover[_-]?image)(?:[/?._-]|$)/i;

const THUMB_CDN_RE =
  /(?:[?&](?:w|h|width|height|resize|crop|fit|quality)=\d+)/i;

export function isPosterOrImageResource(media: DetectedMedia): boolean {
  if (media.mimeType?.startsWith('image/')) {
    return true;
  }
  const ext = media.extension?.toLowerCase();
  if (ext && IMAGE_EXTS.has(ext)) {
    return true;
  }
  return POSTER_PATH_RE.test(media.url);
}

export function isThumbnailResource(media: DetectedMedia): boolean {
  if (isLikelySocialThumbnail(media.url) || isLikelySocialProfileAsset(media.url)) {
    return true;
  }
  const lower = media.url.toLowerCase();
  if (
    lower.includes('/thumb') ||
    lower.includes('thumbnail') ||
    lower.includes('/sprite') ||
    lower.includes('preview_image')
  ) {
    return true;
  }
  // Image CDN transforms on non-video paths are thumbnail-like.
  if (THUMB_CDN_RE.test(media.url) && isPosterOrImageResource(media)) {
    return true;
  }
  return false;
}

export function isSegmentResource(media: DetectedMedia): boolean {
  return isLikelyMediaSegment(media.url, media.extension);
}

export function isBlobOnlyResource(media: DetectedMedia): boolean {
  return media.url.toLowerCase().startsWith('blob:');
}

export function isUnsupportedScheme(media: DetectedMedia): boolean {
  const lower = media.url.toLowerCase();
  return (
    lower.startsWith('data:') ||
    lower.startsWith('javascript:') ||
    lower.startsWith('file:') ||
    lower.startsWith('content:')
  );
}

/**
 * Combined tiny-preview evidence — never duration-alone.
 */
export function isTinyPreviewContext(context: GeneralPageMediaContext): boolean {
  const w = context.activeVideoWidth;
  const h = context.activeVideoHeight;
  const smallDims =
    (w != null && w > 0 && w < TINY_DIM_PX) ||
    (h != null && h > 0 && h < TINY_DIM_PX) ||
    (w != null && h != null && w > 0 && h > 0 && w * h < TINY_DIM_PX * TINY_DIM_PX);

  if (!smallDims) {
    return false;
  }

  // Small dims alone are insufficient. The preview role is tiny muted playback; unmuting lifts it.
  // Partial visibility is scroll position, not role: the visibility rules own it.
  return (
    context.activeVideoMuted === true &&
    (context.activeVideoPaused === false || context.activeVideoRecentlyPlayed)
  );
}

function matchesActiveCurrentSrc(
  media: DetectedMedia,
  context: GeneralPageMediaContext,
): boolean | null {
  if (context.playerKind === 'iframe') {
    // Iframe src is the player document, never the executable media URL.
    return null;
  }
  if (media.ownerElementIdentity && media.ownerElementIdentity === context.activeMediaElementIdentity) return true;
  const active = context.activeVideoCurrentSrc;
  if (!active) {
    return null;
  }
  if (active.toLowerCase().startsWith('blob:')) {
    // Blob indicates active player — network candidate may still correlate.
    return null;
  }
  return (
    urlsShareResourcePath(media.url, active) ||
    urlsShareResourcePath(media.finalUrl || media.url, active) ||
    urlsShareResourcePath(media.sourceUrl || media.url, active)
  );
}

export type GeneralRequestProvenance = 'OWNER_FRAME' | 'TOP_DOCUMENT' | 'OTHER_FRAME' | 'UNKNOWN';

// The page detector script runs in the top document only (react-native-webview injects into the main frame),
// so whatever it observes — DOM elements, fetch/XHR, resource timing — was requested by the top document.
const TOP_DOCUMENT_SCRIPT_SOURCES: ReadonlySet<DetectionSource> = new Set([
  'dom_video',
  'dom_audio',
  'dom_source',
  'performance_resource',
  'og_meta',
  'js_fetch',
  'js_xhr',
]);

function originOf(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null;
  } catch {
    return null;
  }
}

/**
 * Which document initiated a candidate, by origin. Network candidates carry the request Referer, which
 * browsers reduce to the initiator's origin for cross-origin requests (strict-origin-when-cross-origin), so
 * paths can never be compared. DOM candidates carry their element's document URL; other page-script
 * observations are the top document. Media/CDN hosts are deliberately not compared: page A → player
 * iframe B → CDN C share nothing but the initiator origin.
 */
export function resolveGeneralRequestProvenance(
  media: { frameUrl?: string | null; detectionSource?: DetectionSource },
  context: Pick<GeneralPageMediaContext, 'playerKind' | 'activeVideoCurrentSrc' | 'pageUrl'>,
): GeneralRequestProvenance {
  const initiator =
    originOf(media.frameUrl) ??
    (media.detectionSource && TOP_DOCUMENT_SCRIPT_SOURCES.has(media.detectionSource) ? originOf(context.pageUrl) : null);
  if (!initiator) {
    return 'UNKNOWN';
  }
  if (context.playerKind === 'iframe' && initiator === originOf(context.activeVideoCurrentSrc)) {
    return 'OWNER_FRAME';
  }
  return initiator === originOf(context.pageUrl) ? 'TOP_DOCUMENT' : 'OTHER_FRAME';
}

function buildEvidence(
  media: DetectedMedia,
  input: GeneralCorrelationInput,
  context: GeneralPageMediaContext,
): GeneralOwnershipEvidence {
  const tabMatch = Boolean(input.tabId && input.tabId === context.tabId) && (!media.observedTabId || media.observedTabId === context.tabId);
  const navigationMatch = input.navigationEpoch === context.navigationEpoch && (media.observedNavigationEpoch == null || media.observedNavigationEpoch === context.navigationEpoch);
  const pageGenerationMatch =
    input.pageGeneration == null ||
    input.pageGeneration === context.pageGeneration;
  const candidateGenerationMatch = media.observedPageGeneration == null || media.observedPageGeneration === context.pageGeneration;

  const currentPageMatch =
    Boolean(input.pageUrl) && isSameGeneralContentNavigation(media.pageUrl, context.pageUrl) &&
    (input.pageUrl === context.pageUrl ||
      Boolean(
        input.pageUrl &&
          context.pageUrl &&
          resourcePathKey(input.pageUrl) === resourcePathKey(context.pageUrl),
      ));

  const srcMatch = matchesActiveCurrentSrc(media, context);
  const intersection = context.activeVideoIntersectionRatio;
  const visibleVideoMatch =
    intersection == null
      ? null
      : intersection >= 0.35 &&
        (context.activeVideoRecentlyPlayed || context.activeVideoPaused === false);

  // A paused, never-played element proves nothing about current content until it is visible — whatever its
  // src is. Its own preload is exactly the offscreen media that must not be offered.
  const idleElement =
    context.playerKind !== 'iframe' &&
    Boolean(context.activeMediaElementIdentity) &&
    context.activeVideoPaused !== false &&
    !context.activeVideoRecentlyPlayed &&
    !context.userInteractionSignal;
  const hidden = idleElement && intersection != null && intersection < 0.15;
  const visibilityUnknown = idleElement && intersection == null;

  const preload =
    Boolean(context.activeMediaElementIdentity) &&
    Boolean(context.activeVideoCurrentSrc) &&
    !context.activeVideoIsBlob &&
    context.playerKind !== 'iframe' &&
    srcMatch === false &&
    (intersection == null || intersection >= 0.35);

  // userInteractionSignal is raised by any playback, so it cannot lift a penalty that requires playback; unmuting does.
  const tinyPreview = isTinyPreviewContext(context) && srcMatch === true;

  const poster = isPosterOrImageResource(media);
  const thumbnail = isThumbnailResource(media);

  return {
    tabMatch,
    navigationMatch,
    pageGenerationMatch,
    activeVideoElementMatch: srcMatch,
    visibleVideoMatch,
    currentSrcMatch: srcMatch,
    recentObservation: Date.now() - media.detectedAt < RECENT_MS,
    currentPageMatch,
    userInteractionMatch: context.userInteractionSignal && srcMatch === true,
    preloadPenalty: preload,
    hiddenElementPenalty: hidden,
    visibilityUnknownPenalty: visibilityUnknown,
    tinyPreviewPenalty: tinyPreview,
    adPenalty: context.explicitAdMarker,
    // A resource first seen in an earlier generation (preloaded) is current once the active element plays it.
    staleContextPenalty: !pageGenerationMatch || (!candidateGenerationMatch && srcMatch !== true) || !currentPageMatch,
    segmentPenalty: isSegmentResource(media),
    imagePenalty: poster,
    posterPenalty: poster,
    thumbnailPenalty: thumbnail,
    blobOnlyPenalty: isBlobOnlyResource(media),
    unsupportedSchemePenalty: isUnsupportedScheme(media),
  };
}

function confidenceFromEvidence(
  evidence: GeneralOwnershipEvidence,
  baseReject: boolean,
  baseRejection: string | null,
): {
  confidence: GeneralCorrelationConfidence;
  reason: GeneralRejectionReason | null;
  rank: number;
} {
  if (!evidence.tabMatch) {
    return { confidence: 'REJECTED', reason: 'WRONG_TAB', rank: -1000 };
  }
  if (!evidence.navigationMatch) {
    return { confidence: 'REJECTED', reason: 'STALE_NAVIGATION', rank: -1000 };
  }
  if (evidence.staleContextPenalty) {
    return { confidence: 'REJECTED', reason: 'STALE_PAGE_GENERATION', rank: -1000 };
  }
  if (evidence.blobOnlyPenalty) {
    return { confidence: 'REJECTED', reason: 'BLOB_ONLY', rank: -900 };
  }
  if (evidence.unsupportedSchemePenalty) {
    return { confidence: 'REJECTED', reason: 'UNSUPPORTED_SCHEME', rank: -900 };
  }
  if (evidence.posterPenalty || evidence.imagePenalty) {
    return { confidence: 'REJECTED', reason: 'POSTER_ONLY', rank: -900 };
  }
  if (evidence.thumbnailPenalty) {
    return { confidence: 'REJECTED', reason: 'THUMBNAIL_RESOURCE', rank: -900 };
  }
  if (evidence.segmentPenalty) {
    return { confidence: 'REJECTED', reason: 'SEGMENT_RESOURCE', rank: -900 };
  }
  if (evidence.adPenalty && evidence.currentSrcMatch !== true) {
    return { confidence: 'REJECTED', reason: 'ADVERTISEMENT', rank: -800 };
  }
  if (evidence.adPenalty && evidence.currentSrcMatch === true) {
    // Explicit ad marker on the "active" element — reject ownership steal.
    return { confidence: 'REJECTED', reason: 'ADVERTISEMENT', rank: -800 };
  }
  if (baseReject && baseRejection === 'blob_not_downloadable') {
    return { confidence: 'REJECTED', reason: 'BLOB_ONLY', rank: -900 };
  }
  if (
    baseReject &&
    (baseRejection === 'image_not_video' || baseRejection === 'non_video_candidate')
  ) {
    return {
      confidence: 'REJECTED',
      reason: baseRejection === 'image_not_video' ? 'IMAGE_RESOURCE' : 'NON_VIDEO',
      rank: -900,
    };
  }

  if (evidence.hiddenElementPenalty) {
    return {
      confidence: 'REJECTED',
      reason: evidence.currentSrcMatch === true ? 'OFFSCREEN_PRELOAD' : 'HIDDEN_VIDEO',
      rank: -700,
    };
  }

  if (evidence.preloadPenalty && evidence.currentSrcMatch !== true) {
    return { confidence: 'REJECTED', reason: 'OFFSCREEN_PRELOAD', rank: -650 };
  }

  // Tiny muted loops: never STRONG — keep WEAK so a meaningful player can win.
  if (evidence.tinyPreviewPenalty) {
    return { confidence: 'WEAK', reason: 'TINY_PREVIEW', rank: 80 };
  }

  // Idle element not yet reported visible: WEAK until visibility evidence arrives (it re-runs selection).
  if (evidence.visibilityUnknownPenalty) {
    return { confidence: 'WEAK', reason: null, rank: 150 };
  }

  // STRONG: active visible currentSrc match + user-facing playback evidence
  if (
    evidence.currentSrcMatch === true &&
    evidence.visibleVideoMatch !== false &&
    evidence.tabMatch &&
    evidence.navigationMatch
  ) {
    const rank = evidence.userInteractionMatch ? 950 : 900;
    return { confidence: 'STRONG', reason: null, rank };
  }

  // MEDIUM: page + visibility/src without preload contradiction
  if (
    evidence.tabMatch &&
    evidence.navigationMatch &&
    evidence.currentPageMatch &&
    !evidence.preloadPenalty &&
    (evidence.visibleVideoMatch === true ||
      evidence.currentSrcMatch === true ||
      evidence.userInteractionMatch)
  ) {
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
 * Correlate one candidate against current general page media context.
 */
export function correlateGeneralCandidate(
  media: DetectedMedia,
  input: Omit<GeneralCorrelationInput, 'candidates'> & {
    context: GeneralPageMediaContext;
  },
): GeneralCandidateCorrelation {
  const { context } = input;
  const evidence = buildEvidence(media, { ...input, candidates: [] }, context);
  // New production observations must prove which document requested them.
  // Older fixture/legacy records without provenance retain their existing scoring.
  if (media.observedTabId && (context.playerKind === 'iframe' || (context.activeVideoIsBlob && !media.ownerElementIdentity))) {
    const provenance = resolveGeneralRequestProvenance(media, context);
    const expected = context.playerKind === 'iframe' ? 'OWNER_FRAME' : 'TOP_DOCUMENT';
    const rejectionReason: GeneralRejectionReason | null =
      provenance === expected
        ? context.playerKind === 'iframe' || evidence.recentObservation
          ? null
          : 'WEAK_UNCORRELATED_MEDIA'
        : provenance === 'UNKNOWN'
          ? 'UNPROVEN_FRAME_OWNERSHIP'
          : provenance === 'TOP_DOCUMENT'
            ? 'OUTSIDE_CURRENT_PLAYER'
            : 'FOREIGN_FRAME_MEDIA';
    if (rejectionReason) {
      return { confidence: 'REJECTED', rejectionReason, evidence, rank: -500 };
    }
  }

  const legacy = scoreMediaCorrelation(media, {
    pageUrl: input.pageUrl ?? context.pageUrl,
    msePlaybackActive: input.msePlaybackActive,
    msePlaybackAgeMs: input.msePlaybackAgeMs,
  });

  const ranked = confidenceFromEvidence(
    evidence,
    legacy.reject,
    legacy.rejectionReason,
  );

  // Active blob player + underlying http(s) candidate on same page → MEDIUM floor.
  if (
    context.activeVideoIsBlob &&
    !evidence.visibilityUnknownPenalty &&
    !isBlobOnlyResource(media) &&
    evidence.tabMatch &&
    evidence.navigationMatch &&
    evidence.currentPageMatch &&
    !evidence.imagePenalty &&
    !evidence.segmentPenalty &&
    !evidence.posterPenalty &&
    !evidence.thumbnailPenalty &&
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

  // Visible iframe/embed player: currentSrc is the player frame, not the media URL.
  // Same-page http(s) candidates may still correlate without matching iframe src.
  if (
    context.playerKind === 'iframe' &&
    !isBlobOnlyResource(media) &&
    evidence.tabMatch &&
    evidence.navigationMatch &&
    evidence.currentPageMatch &&
    !evidence.imagePenalty &&
    !evidence.segmentPenalty &&
    !evidence.posterPenalty &&
    !evidence.thumbnailPenalty &&
    !evidence.adPenalty &&
    ranked.confidence !== 'REJECTED'
  ) {
    if (ranked.confidence === 'WEAK') {
      return {
        confidence: 'MEDIUM',
        rejectionReason: null,
        evidence,
        rank: Math.max(ranked.rank, 540) + Math.min(legacy.score, 1) * 20,
      };
    }
  }

  // Never let size/bitrate alone outrank ownership — fold legacy score lightly.
  // Prefer progressive/HLS over DASH when ownership confidence is otherwise equal.
  const familyBoost =
    ranked.confidence === 'REJECTED'
      ? 0
      : media.container === 'dash' || media.streamType === 'DASH'
        ? -40
        : media.container === 'hls' || media.streamType === 'HLS'
          ? 25
          : media.category === 'video' || media.streamType === 'DIRECT'
            ? 20
            : 0;
  const rank =
    ranked.confidence === 'REJECTED'
      ? ranked.rank
      : ranked.rank + Math.min(legacy.score, 1.2) * 15 + familyBoost;

  return {
    confidence: ranked.confidence,
    rejectionReason: ranked.reason,
    evidence,
    rank,
  };
}

const CONFIDENCE_ORDER: Record<GeneralCorrelationConfidence, number> = {
  STRONG: 4,
  MEDIUM: 3,
  WEAK: 2,
  REJECTED: 1,
};

/**
 * Select current media for a general website using ownership evidence.
 * WEAK never replaces an existing STRONG/MEDIUM selection.
 */
export function selectCurrentGeneralMedia(
  input: GeneralCorrelationInput,
): {
  media: DetectedMedia | null;
  group: CorrelatedGeneralMediaCandidateSet;
} {
  const rejected: Array<{
    candidateId: string;
    reason: GeneralRejectionReason;
  }> = [];
  const activeCandidateIds: string[] = [];

  const emptyGroup = (): CorrelatedGeneralMediaCandidateSet => ({
    currentMediaIdentity: null,
    pageGeneration: input.pageGeneration ?? 0,
    navigationEpoch: input.navigationEpoch,
    tabId: input.tabId,
    pageUrl: input.pageUrl,
    activeCandidateIds: [],
    rejected,
    confidence: null,
  });

  if (!input.context) {
    return { media: null, group: emptyGroup() };
  }

  const context = input.context;

  if (input.tabId && input.tabId !== context.tabId) {
    logGeneralMedia('stale_candidate_ignored', {
      tabId: input.tabId,
      navigationEpoch: input.navigationEpoch,
      pageGeneration: context.pageGeneration,
      reason: 'WRONG_TAB',
    });
    return { media: null, group: emptyGroup() };
  }

  if (input.navigationEpoch !== context.navigationEpoch) {
    logGeneralMedia('stale_candidate_ignored', {
      tabId: context.tabId,
      navigationEpoch: input.navigationEpoch,
      pageGeneration: context.pageGeneration,
      reason: 'STALE_NAVIGATION',
    });
    return { media: null, group: emptyGroup() };
  }

  type Ranked = {
    media: DetectedMedia;
    correlation: GeneralCandidateCorrelation;
  };

  const ranked: Ranked[] = [];

  for (const candidate of input.candidates) {
    const correlation = correlateGeneralCandidate(candidate, {
      context,
      tabId: input.tabId,
      navigationEpoch: input.navigationEpoch,
      pageGeneration: input.pageGeneration ?? context.pageGeneration,
      pageUrl: input.pageUrl,
      msePlaybackActive: input.msePlaybackActive,
      msePlaybackAgeMs: input.msePlaybackAgeMs,
    });

    if (correlation.confidence === 'REJECTED') {
      rejected.push({
        candidateId: candidate.id,
        reason: correlation.rejectionReason ?? 'LOW_CORRELATION',
      });
      logGeneralMedia('candidate_rejected', {
        tabId: context.tabId,
        navigationEpoch: context.navigationEpoch,
        pageGeneration: context.pageGeneration,
        candidateFingerprintHash: hashSafeId(candidate.id),
        reason: correlation.rejectionReason,
        confidence: 'REJECTED',
      });
      if (correlation.rejectionReason === 'OFFSCREEN_PRELOAD') {
        logGeneralMedia('preload_suppressed', {
          tabId: context.tabId,
          navigationEpoch: context.navigationEpoch,
          pageGeneration: context.pageGeneration,
          candidateFingerprintHash: hashSafeId(candidate.id),
        });
      }
      if (
        correlation.rejectionReason === 'POSTER_ONLY' ||
        correlation.rejectionReason === 'IMAGE_RESOURCE'
      ) {
        logGeneralMedia('poster_rejected', {
          tabId: context.tabId,
          candidateFingerprintHash: hashSafeId(candidate.id),
          reason: correlation.rejectionReason,
        });
      }
      if (correlation.rejectionReason === 'SEGMENT_RESOURCE') {
        logGeneralMedia('segment_rejected', {
          tabId: context.tabId,
          candidateFingerprintHash: hashSafeId(candidate.id),
        });
      }
      if (correlation.rejectionReason === 'TINY_PREVIEW') {
        logGeneralMedia('tiny_preview_suppressed', {
          tabId: context.tabId,
          candidateFingerprintHash: hashSafeId(candidate.id),
        });
      }
      if (correlation.rejectionReason === 'ADVERTISEMENT') {
        logGeneralMedia('ad_penalized', {
          tabId: context.tabId,
          candidateFingerprintHash: hashSafeId(candidate.id),
        });
      }
      continue;
    }

    if (correlation.rejectionReason === 'TINY_PREVIEW') {
      logGeneralMedia('tiny_preview_suppressed', {
        tabId: context.tabId,
        candidateFingerprintHash: hashSafeId(candidate.id),
        confidence: correlation.confidence,
      });
    }

    ranked.push({ media: candidate, correlation });
    logGeneralMedia('candidate_correlated', {
      tabId: context.tabId,
      navigationEpoch: context.navigationEpoch,
      pageGeneration: context.pageGeneration,
      candidateFingerprintHash: hashSafeId(candidate.id),
      confidence: correlation.confidence,
      mediaIdentityHash: hashSafeId(context.currentMediaIdentity),
    });
    logAutomaticHandoff('MEDIA_CANDIDATE_CORRELATED', {
      tabId: context.tabId,
      candidateIdHash: hashHandoffIdentity(candidate.id),
      contentIdentityHash: hashHandoffIdentity(context.currentMediaIdentity),
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

  // Promotion: STRONG > MEDIUM > WEAK; WEAK never displaces STRONG/MEDIUM.
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
      logGeneralMedia('candidate_promoted', {
        tabId: context.tabId,
        candidateFingerprintHash: hashSafeId(item.media.id),
        confidence: item.correlation.confidence,
      });
      logGeneralMedia('candidate_demoted', {
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
      best = item;
    }
  }

  if (best) {
    for (const item of ranked.slice(0, MAX_ACTIVE_GENERAL_CANDIDATES)) {
      activeCandidateIds.push(item.media.id);
      logGeneralCorrelationTrace('CANDIDATE_RANKED', {
        tabId: context.tabId,
        pageGeneration: context.pageGeneration,
        candidateFingerprintHash: hashSafeId(item.media.id),
        confidence: item.correlation.confidence,
      });
    }
    logGeneralCorrelationTrace('ACTIVE_CANDIDATE_SET', {
      tabId: context.tabId,
      pageGeneration: context.pageGeneration,
      candidateFingerprintHash: hashSafeId(best.media.id),
      confidence: best.correlation.confidence,
    });
  }

  return {
    media: best?.media ?? null,
    group: {
      currentMediaIdentity: context.currentMediaIdentity,
      pageGeneration: context.pageGeneration,
      navigationEpoch: context.navigationEpoch,
      tabId: context.tabId,
      pageUrl: context.pageUrl,
      activeCandidateIds,
      rejected,
      confidence: best?.correlation.confidence ?? null,
    },
  };
}

/**
 * Convenience: resolve active general context + select media.
 * Returns usedGeneralCorrelation=false for social pages (Phase 4A owns those).
 */
export function selectCurrentMediaForActiveGeneralTab(input: {
  candidates: DetectedMedia[];
  tabId: string | null;
  navigationEpoch: number;
  pageUrl: string | null;
  msePlaybackActive?: boolean;
  msePlaybackAgeMs?: number | null;
}): {
  media: DetectedMedia | null;
  group: CorrelatedGeneralMediaCandidateSet;
  usedGeneralCorrelation: boolean;
} {
  const empty = {
    media: null as DetectedMedia | null,
    group: {
      currentMediaIdentity: null,
      pageGeneration: 0,
      navigationEpoch: input.navigationEpoch,
      tabId: input.tabId,
      pageUrl: input.pageUrl,
      activeCandidateIds: [] as string[],
      rejected: [] as Array<{ candidateId: string; reason: GeneralRejectionReason }>,
      confidence: null,
    },
    usedGeneralCorrelation: false,
  };

  if (!input.tabId || !input.pageUrl) {
    return empty;
  }

  if (resolveSocialPlatform(input.pageUrl)) {
    return empty;
  }

  const context =
    generalPageMediaContextStore.get(input.tabId) ??
    generalPageMediaContextStore.syncFromPageUrl({
      tabId: input.tabId,
      pageUrl: input.pageUrl,
      navigationEpoch: input.navigationEpoch,
    });

  if (!context) {
    return empty;
  }

  const result = selectCurrentGeneralMedia({
    candidates: input.candidates,
    context,
    tabId: input.tabId,
    navigationEpoch: input.navigationEpoch,
    pageGeneration: context.pageGeneration,
    pageUrl: input.pageUrl,
    msePlaybackActive: input.msePlaybackActive,
    msePlaybackAgeMs: input.msePlaybackAgeMs,
  });

  return { ...result, usedGeneralCorrelation: true };
}
