/**
 * Phase 4B — Social source reliability.
 * Consumes Phase 4A ownership; verifies sources; builds variant offers.
 */

import type { MediaAnalysisResult } from '@/api/types';
import type { MediaRequestContext } from '@/downloads/types/request-context';
import { sniffMediaSignature } from '@/downloads/engine/media-signature';
import { resolveVideoResource } from '../resource/video-resource';
import {
  MP4_BOX_HEADER_BYTES,
  nextTopLevelBoxOffset,
  walkMp4TopLevelBoxes,
  type Mp4BoxWalkVerdict,
} from '../resource/mp4-box-walk';
import { readBoundedResponseBody } from '@/downloads/network/bounded-response-reader';
import { TRANSFER_TIMEOUTS } from '@/downloads/engine/transfer-timeouts';
import { mergeDownloadHeaders } from '@/downloads/engine/download-headers';
import {
  applyPrimarySummary,
  createVariant,
  isNonMediaDocumentMime,
  resolveContainer,
  resolveExtension,
  resolveMediaType,
  parseFileSize,
} from '@/downloads/analyze/format';
import { isFalsePositive, isLikelyMediaSegment } from '../services/false-positive.filter';
import {
  verifyMediaCandidate,
  type CandidateVerification,
} from '../services/candidate-verifier.service';
import { isVerifiedMediaMime } from '../services/mime-probe.service';
import { buildRequestContextFromDetectedMedia } from '../services/request-context.service';
import { isLikelyExpiredMediaUrl } from '../services/expiring-url.service';
import { isSafeMediaUrl } from '../utils';
import type { DetectedMedia } from '../types';
import { socialPageContextStore } from '../social';
import {
  isCombinedDownloadActionable,
  resolveSocialAudioState,
} from './audio-evidence';
import {
  qualityFromDetectedMedia,
  resolveCredibleSizeBytes,
} from './quality-evidence';
import {
  buildResourceIdentityKey,
  preserveExecutableUrl,
  sameResourceFamily,
} from './resource-identity';
import { logSocialSource } from './social-source-diagnostics';
import {
  buildVerificationCacheKey,
  getCachedVerifiedVariant,
  joinOrStartVerification,
  setCachedVerifiedVariant,
} from './verification-session';
import { selectPreferredVariant, dedupeVariants } from './variant-policy';
import type {
  SocialSourceRejectionReason,
  SocialSourceTransport,
  SocialSourceVerifyScope,
  VerifiedSocialMediaOffer,
  VerifiedSocialMediaVariant,
} from './types';

const MAX_SIGNATURE_BYTES = Math.min(
  TRANSFER_TIMEOUTS.boundedProbeMaxBytes,
  16 * 1024,
);

export type BuildSocialOfferInput = {
  /** The source the ownership pass chose as the current media; its variants win the ranking. */
  ownedResourceUrl?: string | null;
  scope: SocialSourceVerifyScope;
  candidates: DetectedMedia[];
  pageUrl: string;
  signal?: AbortSignal;
  /** When false, skip candidates not in activeCandidateIds. */
  activeCandidateIds?: string[];
};

export type BuildSocialOfferResult =
  | { ok: true; offer: VerifiedSocialMediaOffer; analysis: MediaAnalysisResult }
  | {
      ok: false;
      reason: SocialSourceRejectionReason;
      analysis?: MediaAnalysisResult;
    };

function classifyMimeRejection(
  mime: string | null,
): SocialSourceRejectionReason | null {
  if (!mime) {
    return null;
  }
  const lower = mime.toLowerCase();
  if (lower.includes('text/html') || lower.includes('xhtml')) {
    return 'HTML_RESPONSE';
  }
  if (lower.includes('application/json') || lower.includes('text/json')) {
    return 'JSON_RESPONSE';
  }
  if (isNonMediaDocumentMime(lower)) {
    return 'NOT_MEDIA';
  }
  return null;
}

function resolveTransport(media: DetectedMedia, mime: string | null): SocialSourceTransport {
  if (media.streamType === 'HLS' || media.container === 'hls') {
    return 'hls';
  }
  if (media.videoOnly && media.hasSeparateAudio) {
    return 'adaptive_video_only';
  }
  if (media.category === 'audio') {
    return 'audio_only';
  }
  if (mime && (mime.includes('mpegurl') || mime.includes('dash+xml'))) {
    return mime.includes('dash') ? 'unknown' : 'hls';
  }
  if (media.streamType === 'DIRECT' || media.category === 'video') {
    return 'progressive';
  }
  return 'unknown';
}

/**
 * Strengthen CandidateVerification with MIME policy + optional bounded signature.
 */
export async function verifySocialSourceCandidate(
  media: DetectedMedia,
  input: {
    pageUrl: string;
    requestContext: MediaRequestContext;
    signal?: AbortSignal;
  },
): Promise<
  | { ok: true; verification: CandidateVerification; signatureKind: string | null; usedRangeProbe: boolean }
  | { ok: false; reason: SocialSourceRejectionReason; verification: CandidateVerification }
> {
  const url = preserveExecutableUrl(media.finalUrl || media.url);
  if (!isSafeMediaUrl(url) || url.startsWith('blob:')) {
    return {
      ok: false,
      reason: 'BLOB_ONLY',
      verification: {
        ok: false,
        finalUrl: url,
        mimeType: null,
        contentLength: null,
        acceptRanges: false,
        status: null,
        redirectCount: 0,
        confidenceBoost: 0,
        rejectionReason: 'blob_only',
      },
    };
  }

  if (isLikelyMediaSegment(url, media.extension) || isFalsePositive({ url, mimeType: media.mimeType })) {
    return {
      ok: false,
      reason: 'SEGMENT_RESOURCE',
      verification: {
        ok: false,
        finalUrl: url,
        mimeType: media.mimeType,
        contentLength: null,
        acceptRanges: false,
        status: null,
        redirectCount: 0,
        confidenceBoost: 0,
        rejectionReason: 'segment',
      },
    };
  }

  if (isLikelyExpiredMediaUrl(url, media.detectedAt)) {
    return {
      ok: false,
      reason: 'EXPIRED_SOURCE',
      verification: {
        ok: false,
        finalUrl: url,
        mimeType: null,
        contentLength: null,
        acceptRanges: false,
        status: null,
        redirectCount: 0,
        confidenceBoost: 0,
        rejectionReason: 'expired',
      },
    };
  }

  const verification = await verifyMediaCandidate(url, {
    requestContext: input.requestContext,
    signal: input.signal,
  });

  if (!verification.ok) {
    const status = verification.status;
    const reason: SocialSourceRejectionReason =
      verification.rejectionReason === 'html_response' ? 'HTML_RESPONSE' :
      verification.rejectionReason === 'json_response' ? 'JSON_RESPONSE' :
      status === 401 || status === 403
        ? 'AUTH_RESPONSE'
        : status === 404
          ? 'EXPIRED_SOURCE'
          : 'PROBE_FAILED';
    return { ok: false, reason, verification };
  }

  const mimeReject = classifyMimeRejection(verification.mimeType);
  if (mimeReject) {
    return { ok: false, reason: mimeReject, verification };
  }

  // Always run bounded structural classification for social actionable video —
  // MIME video/mp4 alone is not proof of a complete standalone file.
  let signatureKind: string | null = null;
  let usedRangeProbe = false;
  const mimeOk = isVerifiedMediaMime(verification.mimeType);
  const needsSignature =
    !mimeOk ||
    verification.mimeType === 'application/octet-stream' ||
    !verification.mimeType ||
    (mimeOk &&
      (verification.mimeType?.startsWith('video/') === true ||
        verification.mimeType === 'application/mp4'));

  if (needsSignature) {
    usedRangeProbe = true;
    const totalHint =
      verification.contentLength != null && verification.contentLength > 1
        ? verification.contentLength
        : null;
    const sig = await probeBoundedSignature(
      verification.finalUrl,
      input.requestContext,
      input.signal,
      totalHint,
      verification.mimeType,
    );
    if (!sig.ok) {
      if (sig.kind === 'html') {
        return { ok: false, reason: 'HTML_RESPONSE', verification };
      }
      if (sig.kind === 'json') {
        return { ok: false, reason: 'JSON_RESPONSE', verification };
      }
      if (sig.reason === 'init_segment') {
        logSocialSource('source_init_segment_detected', {
          reason: 'INIT_SEGMENT',
          containerKind: sig.mp4Kind ?? 'INIT_SEGMENT',
        });
        return { ok: false, reason: 'INIT_SEGMENT', verification };
      }
      if (sig.reason === 'media_fragment') {
        logSocialSource('source_fragment_detected', {
          reason: 'MEDIA_FRAGMENT',
          containerKind: sig.mp4Kind ?? 'MEDIA_FRAGMENT',
        });
        return { ok: false, reason: 'MEDIA_FRAGMENT', verification };
      }
      if (sig.kind === 'ts') {
        return { ok: false, reason: 'SEGMENT_RESOURCE', verification };
      }
      if (sig.reason === 'drm_protected') return { ok: false, reason: 'DRM_UNSUPPORTED', verification };
      if (!sig.ok) {
        logSocialSource('source_container_unknown', {
          reason: sig.reason ?? 'NOT_MEDIA',
          containerKind: sig.mp4Kind ?? null,
        });
        return { ok: false, reason: sig.provenUnsupported ? 'NOT_MEDIA' : 'PROBE_FAILED', verification };
      }
    } else {
      signatureKind = sig.kind;
      verification.finalUrl = sig.finalUrl ?? verification.finalUrl;
      verification.mimeType = sig.mimeType ?? verification.mimeType;
      verification.contentLength = sig.totalBytes ?? verification.contentLength;
      if (sig.kind === 'ts') {
        return { ok: false, reason: 'SEGMENT_RESOURCE', verification };
      }
      if (sig.mp4Kind === 'PROGRESSIVE_OR_COMPLETE' || sig.mp4Kind === 'FRAGMENTED_COMPLETE') {
        logSocialSource('source_progressive_verified', {
          containerKind: sig.mp4Kind,
          sizeCategory: sizeCategory(totalHint),
        });
      }
    }
  } else if (!mimeOk) {
    return { ok: false, reason: 'NOT_MEDIA', verification };
  }

  // Tiny error bodies — not credible standalone videos.
  if (
    verification.contentLength != null &&
    verification.contentLength > 0 &&
    verification.contentLength <= 4096
  ) {
    return { ok: false, reason: 'NOT_MEDIA', verification };
  }

  return { ok: true, verification, signatureKind, usedRangeProbe };
}

function sizeCategory(bytes: number | null): string | null {
  if (bytes == null || bytes <= 0) {
    return 'unknown';
  }
  if (bytes < 64 * 1024) {
    return 'lt_64kb';
  }
  if (bytes < 768 * 1024) {
    return 'lt_768kb';
  }
  if (bytes < 5 * 1024 * 1024) {
    return 'lt_5mb';
  }
  return 'gte_5mb';
}

async function probeBoundedSignature(
  url: string,
  requestContext: MediaRequestContext,
  signal?: AbortSignal,
  resourceTotalBytes?: number | null,
  mimeType?: string | null,
): Promise<{
  ok: boolean;
  kind: string;
  reason?: string | null;
  mp4Kind?: string | null;
  provenUnsupported?: boolean;
  finalUrl?: string;
  mimeType?: string | null;
  totalBytes?: number | null;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TRANSFER_TIMEOUTS.probeTimeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  if (signal?.aborted) controller.abort();
  try {
    const headers = mergeDownloadHeaders(
      { Range: `bytes=0-${MAX_SIGNATURE_BYTES - 1}` },
      requestContext,
    );
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers,
    });
    if (!response.ok && response.status !== 206) {
      return { ok: false, kind: 'unknown' };
    }

    // Prefer Content-Range total over Content-Length slice size.
    let total = resourceTotalBytes ?? null;
    const contentRange = response.headers.get('Content-Range');
    if (response.status === 206 && !/^bytes\s+0-\d+\/(?:\d+|\*)$/i.test(contentRange ?? '')) {
      return { ok: false, kind: 'unknown', reason: 'invalid_content_range' };
    }
    if (contentRange) {
      const match = /bytes\s+\d+-\d+\/(\d+|\*)/i.exec(contentRange);
      const raw = match?.[1];
      if (raw && raw !== '*') {
        const n = Number(raw);
        if (Number.isFinite(n) && n > 1) {
          total = Math.trunc(n);
          logSocialSource('source_size_from_content_range', {
            sizeCategory: sizeCategory(total),
          });
        }
      }
    }
    if (response.status === 200) {
      const length = Number(response.headers.get('Content-Length'));
      if (Number.isSafeInteger(length) && length > 0) total = length;
    }

    const { bytes } = await readBoundedResponseBody(
      response,
      MAX_SIGNATURE_BYTES,
      controller.signal,
    );
    const sniff = sniffMediaSignature(bytes, {
      resourceTotalBytes: total,
      coversEntireResource: total != null && bytes.length >= total,
      requireStandaloneMp4: true,
    });
    const finalUrl = response.url || url;
    // A faststart moov larger than the window hides mdat; prove what follows it from box headers.
    let mp4BoxWalk: Mp4BoxWalkVerdict | null = null;
    const walkFrom =
      sniff.reason === 'mp4_structure_unproven' && response.status === 206 && total != null && bytes.length < total
        ? nextTopLevelBoxOffset(bytes)
        : null;
    if (walkFrom != null) {
      mp4BoxWalk = await walkMp4TopLevelBoxes({
        startOffset: walkFrom,
        totalBytes: total,
        readHeader: (offset) => readBoxHeaderAt(finalUrl, offset, requestContext, controller.signal),
      });
      logSocialSource('source_mp4_box_walk', {
        containerKind: mp4BoxWalk.state,
        reason: mp4BoxWalk.state === 'MEDIA_DATA' ? mp4BoxWalk.boxType : mp4BoxWalk.reason,
        sizeCategory: sizeCategory(total),
      });
    }
    const resolved = resolveVideoResource({
      url, finalUrl, bytes, totalBytes: total,
      mimeType: response.headers.get('Content-Type') ?? mimeType,
      contentDisposition: response.headers.get('Content-Disposition'),
      coversEntireResource: total != null && bytes.length >= total,
      mp4BoxWalk,
    });
    const walkDecided = mp4BoxWalk != null && mp4BoxWalk.state !== 'UNRESOLVED';
    return {
      ok: resolved.state === 'VERIFIED',
      kind: sniff.kind,
      reason: resolved.state === 'VERIFIED' ? null : walkDecided ? resolved.reason : sniff.reason ?? resolved.reason,
      mp4Kind:
        mp4BoxWalk?.state === 'MEDIA_DATA'
          ? mp4BoxWalk.boxType === 'moof' ? 'FRAGMENTED_COMPLETE' : 'PROGRESSIVE_OR_COMPLETE'
          : mp4BoxWalk?.state === 'NO_MEDIA_DATA' ? 'INIT_SEGMENT' : sniff.mp4Kind ?? null,
      provenUnsupported: resolved.state === 'PROVEN_UNSUPPORTED',
      finalUrl,
      mimeType: resolved.mimeType,
      totalBytes: total,
    };
  } catch {
    return { ok: false, kind: 'unknown' };
  } finally {
    controller.abort();
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Exactly MP4_BOX_HEADER_BYTES at `offset` via Range, or null when the server does not answer that range. */
async function readBoxHeaderAt(
  url: string,
  offset: number,
  requestContext: MediaRequestContext,
  signal: AbortSignal,
): Promise<Uint8Array | null> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal,
      headers: mergeDownloadHeaders(
        { Range: `bytes=${offset}-${offset + MP4_BOX_HEADER_BYTES - 1}` },
        requestContext,
      ),
    });
    const start = /^bytes\s+(\d+)-\d+\/(?:\d+|\*)$/i.exec(response.headers.get('Content-Range') ?? '')?.[1];
    if (response.status !== 206 || start == null || Number(start) !== offset) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    const { bytes } = await readBoundedResponseBody(response, MP4_BOX_HEADER_BYTES, signal);
    return bytes;
  } catch {
    return null;
  }
}

function buildVariantFromVerification(input: {
  media: DetectedMedia;
  verification: CandidateVerification;
  requestContext: MediaRequestContext;
  contentIdentity: string;
  signatureKind: string | null;
  usedRangeProbe: boolean;
  sourceGeneration: number;
}): VerifiedSocialMediaVariant | null {
  const audioState = resolveSocialAudioState(input.media);
  const transport = resolveTransport(input.media, input.verification.mimeType);
  if (transport === 'unknown' && input.media.isDrm) {
    return null;
  }

  const executableUrl = preserveExecutableUrl(input.verification.finalUrl);
  const qualityLabel = qualityFromDetectedMedia(input.media);
  const sizeBytes = resolveCredibleSizeBytes(
    input.verification.contentLength,
    input.media.estimatedFileSize,
  );
  const container =
    resolveContainer(
      input.media.extension,
      input.verification.mimeType,
    ) || input.media.container;

  const resourceIdentity = buildResourceIdentityKey({
    contentIdentity: input.contentIdentity,
    executableUrl,
    transport,
    width: input.media.width,
    height: input.media.height,
    bitrate: input.media.bitrate,
    container,
  });

  const downloadable =
    isCombinedDownloadActionable(audioState) &&
    transport !== 'adaptive_video_only' &&
    !input.media.isDrm;

  if (audioState === 'VIDEO_ONLY' || transport === 'adaptive_video_only') {
    logSocialSource('source_adaptive_video_only', {
      reason: 'VIDEO_ONLY_UNSUPPORTED',
      audioState,
      transport,
    });
  }

  return {
    variantId: `var_${resourceIdentity.slice(0, 48)}`,
    resourceIdentity,
    executableUrl,
    transport,
    container: container === 'unknown' ? null : String(container),
    mimeType: input.verification.mimeType,
    width: input.media.width,
    height: input.media.height,
    bitrate: input.media.bitrate,
    qualityLabel,
    sizeBytes,
    audioState,
    downloadable,
    verificationEvidence: {
      httpStatus: input.verification.status,
      mimeType: input.verification.mimeType,
      contentLength: input.verification.contentLength,
      acceptRanges: input.verification.acceptRanges,
      redirectCount: input.verification.redirectCount,
      signatureKind: input.signatureKind,
      usedRangeProbe: input.usedRangeProbe,
    },
    requestContext: input.requestContext,
    verifiedAt: Date.now(),
    sourceGeneration: input.sourceGeneration,
  };
}

function isScopeCurrent(scope: SocialSourceVerifyScope): boolean {
  const ctx = socialPageContextStore.get(scope.tabId);
  if (!ctx) {
    // Non-social pages may not have context — allow if generation is 0 sentinel? 
    // For social 4B we require context.
    return false;
  }
  if (ctx.navigationEpoch !== scope.navigationEpoch) {
    return false;
  }
  if (ctx.contextGeneration !== scope.socialContextGeneration) {
    return false;
  }
  const identity =
    ctx.canonicalContentId != null
      ? `${ctx.platform}:${ctx.contentType}:${ctx.canonicalContentId}`
      : ctx.currentVisibleMediaIdentity;
  if (identity && scope.contentIdentity && identity !== scope.contentIdentity) {
    return false;
  }
  return true;
}

/**
 * Build a verified offer from Phase 4A-correlated candidates only.
 */
export async function buildVerifiedSocialMediaOffer(
  input: BuildSocialOfferInput,
): Promise<BuildSocialOfferResult> {
  const { scope } = input;

  // Same rule as general pages: only current-content owners publish. WEAK is network media on the page with no
  // player evidence (an adjacent reel's preload looks exactly like this); player evidence changes the ownership
  // key and re-runs verification, so nothing is probed or offered before it.
  if (scope.ownershipConfidence !== 'STRONG' && scope.ownershipConfidence !== 'MEDIUM') {
    logSocialSource('candidate_verify_rejected', {
      tabId: scope.tabId,
      navigationEpoch: scope.navigationEpoch,
      contextGeneration: scope.socialContextGeneration,
      contentIdentity: scope.contentIdentity,
      reason: 'WEAK_OWNERSHIP',
    });
    return { ok: false, reason: 'WEAK_OWNERSHIP' };
  }

  if (!isScopeCurrent(scope)) {
    logSocialSource('stale_verification_ignored', {
      tabId: scope.tabId,
      navigationEpoch: scope.navigationEpoch,
      contextGeneration: scope.socialContextGeneration,
      contentIdentity: scope.contentIdentity,
      reason: 'STALE_SOCIAL_CONTEXT',
    });
    return { ok: false, reason: 'STALE_SOCIAL_CONTEXT' };
  }

  const activeSet =
    input.activeCandidateIds && input.activeCandidateIds.length > 0
      ? new Set(input.activeCandidateIds)
      : null;

  let candidates = input.candidates.filter((c) => {
    if (activeSet && !activeSet.has(c.id)) {
      return false;
    }
    if (c.url.startsWith('blob:')) {
      return false;
    }
    return true;
  });

  candidates = candidates.slice(0, 6);

  const variants: VerifiedSocialMediaVariant[] = [];
  let lastReject: SocialSourceRejectionReason = 'NO_FRESH_SOURCE';

  for (const media of candidates) {
    if (input.signal?.aborted) {
      return { ok: false, reason: 'STALE_SOURCE_GENERATION' };
    }
    if (!isScopeCurrent(scope)) {
      logSocialSource('stale_verification_ignored', {
        tabId: scope.tabId,
        contentIdentity: scope.contentIdentity,
        reason: 'STALE_SOCIAL_CONTEXT',
      });
      return { ok: false, reason: 'STALE_SOCIAL_CONTEXT' };
    }

    const executableUrl = preserveExecutableUrl(media.finalUrl || media.url);
    const cacheKey = buildVerificationCacheKey({
      tabId: scope.tabId,
      navigationEpoch: scope.navigationEpoch,
      socialContextGeneration: scope.socialContextGeneration,
      contentIdentity: scope.contentIdentity,
      executableUrl,
    });

    const cached = getCachedVerifiedVariant(cacheKey);
    if (cached) {
      variants.push(cached);
      continue;
    }

    const { joined, promise } = joinOrStartVerification(cacheKey, async (jobSignal) => {
      logSocialSource(joined ? 'candidate_verify_joined' : 'candidate_verify_started', {
        tabId: scope.tabId,
        navigationEpoch: scope.navigationEpoch,
        contextGeneration: scope.socialContextGeneration,
        contentIdentity: scope.contentIdentity,
        platform: socialPageContextStore.get(scope.tabId)?.platform,
      });

      if (!isScopeCurrent(scope)) {
        return null;
      }

      const requestContext = await buildRequestContextFromDetectedMedia({
        mediaUrl: executableUrl,
        pageUrl: input.pageUrl,
        requiresCookies: media.requiresCookies,
        requiredHeaders: media.requiredHeaders,
        tabId: scope.tabId,
        navigationEpoch: scope.navigationEpoch,
        pageGeneration: scope.socialContextGeneration,
        mediaIdentity: scope.contentIdentity,
      });

      if (jobSignal.aborted || !isScopeCurrent(scope)) {
        return null;
      }

      const result = await verifySocialSourceCandidate(media, {
        pageUrl: input.pageUrl,
        requestContext,
        signal: jobSignal,
      });

      if (!result.ok) {
        logSocialSource('candidate_verify_rejected', {
          tabId: scope.tabId,
          contentIdentity: scope.contentIdentity,
          reason: result.reason,
          mime: result.verification.mimeType,
          httpStatus: result.verification.status,
        });
        return null;
      }

      const variant = buildVariantFromVerification({
        media,
        verification: result.verification,
        requestContext,
        contentIdentity: scope.contentIdentity,
        signatureKind: result.signatureKind,
        usedRangeProbe: result.usedRangeProbe,
        sourceGeneration: scope.socialContextGeneration,
      });

      if (!variant) {
        return null;
      }

      setCachedVerifiedVariant(cacheKey, variant);
      logSocialSource('candidate_verify_succeeded', {
        tabId: scope.tabId,
        contentIdentity: scope.contentIdentity,
        variantId: variant.variantId,
        mime: variant.mimeType,
        quality: variant.qualityLabel,
        audioState: variant.audioState,
        transport: variant.transport,
      });
      logSocialSource('variant_created', {
        variantId: variant.variantId,
        audioState: variant.audioState,
        quality: variant.qualityLabel,
      });
      return variant;
    }, input.signal);

    if (joined) {
      logSocialSource('candidate_verify_joined', {
        tabId: scope.tabId,
        contentIdentity: scope.contentIdentity,
      });
    }

    const variant = await promise;
    if (variant) {
      variants.push(variant);
    } else {
      lastReject = 'PROBE_FAILED';
    }
  }

  if (!isScopeCurrent(scope)) {
    return { ok: false, reason: 'STALE_SOCIAL_CONTEXT' };
  }

  const deduped = dedupeVariants(variants);
  const preferred = selectPreferredVariant(deduped, input.ownedResourceUrl);
  const actionable = deduped.filter((v) => v.downloadable);

  if (!preferred || actionable.length === 0) {
    // If only VIDEO_ONLY variants exist — unsupported for combined UX.
    if (deduped.some((v) => v.audioState === 'VIDEO_ONLY')) {
      return { ok: false, reason: 'VIDEO_ONLY_UNSUPPORTED' };
    }
    return { ok: false, reason: lastReject };
  }

  const offer: VerifiedSocialMediaOffer = {
    contentIdentity: scope.contentIdentity,
    tabId: scope.tabId,
    navigationEpoch: scope.navigationEpoch,
    socialContextGeneration: scope.socialContextGeneration,
    platform: (socialPageContextStore.get(scope.tabId)?.platform ??
      (scope.contentIdentity.startsWith('tiktok') ? 'tiktok' : 'instagram')) as
      | 'instagram'
      | 'tiktok',
    variants: deduped,
    preferredVariantId: preferred.variantId,
    verifiedAt: Date.now(),
    verificationGeneration: scope.socialContextGeneration,
  };

  logSocialSource('offer_created', {
    tabId: offer.tabId,
    contentIdentity: offer.contentIdentity,
    contextGeneration: offer.socialContextGeneration,
    platform: offer.platform,
  });

  const analysis = offerToAnalysis(offer, preferred, input.candidates[0]!);
  return { ok: true, offer, analysis };
}

/**
 * Map offer → existing MediaAnalysisResult for Phase 3 quality sheet / CTA.
 */
export function offerToAnalysis(
  offer: VerifiedSocialMediaOffer,
  preferred: VerifiedSocialMediaVariant,
  seedMedia: DetectedMedia,
): MediaAnalysisResult {
  const actionable = offer.variants.filter((v) => v.downloadable);
  const variants = actionable.map((v, index) => {
    const extension = resolveExtension(v.executableUrl, v.mimeType);
    const container = resolveContainer(extension, v.mimeType);
    const streamType =
      v.transport === 'hls'
        ? ('HLS' as const)
        : v.transport === 'audio_only'
          ? ('AUDIO' as const)
          : ('PROGRESSIVE' as const);
    const created = createVariant({
      sourceUrl: v.executableUrl,
      streamType,
      container: container === 'unknown' ? 'mp4' : container,
      mimeType: v.mimeType,
      width: v.width,
      height: v.height,
      resolution: v.qualityLabel,
      bitrate: v.bitrate,
      estimatedFileSize: v.sizeBytes,
      downloadable: v.downloadable,
      unsupportedReason: null,
      originalIndex: index,
    });
    if (v.audioState !== 'INCLUDED') {
      return { ...created, codecs: null, audioCodec: null };
    }
    return created;
  });

  const fileSizeStr = parseFileSize(
    preferred.sizeBytes != null ? String(preferred.sizeBytes) : null,
  );
  const mediaType = resolveMediaType(
    (preferred.container as 'mp4') ?? 'mp4',
    preferred.mimeType,
  );

  return applyPrimarySummary(
    {
      title: seedMedia.title,
      sourceUrl: seedMedia.sourceUrl || preferred.executableUrl,
      finalUrl: preferred.executableUrl,
      thumbnailUrl: seedMedia.thumbnailUrl,
      mediaType,
      mimeType: preferred.mimeType,
      container: (preferred.container as MediaAnalysisResult['container']) ?? 'mp4',
      duration: seedMedia.duration,
      width: preferred.width,
      height: preferred.height,
      resolution: preferred.qualityLabel,
      bitrate: preferred.bitrate,
      fps: seedMedia.fps,
      fileSize: fileSizeStr,
      platform: offer.platform === 'tiktok' ? 'TIKTOK' : 'INSTAGRAM',
      downloadable: true,
      unsupportedReason: null,
      variants: [],
    },
    variants,
  );
}

export function findFresherExecutableForVariant(input: {
  contentIdentity: string;
  resourceIdentity: string;
  previousUrl: string;
  candidates: DetectedMedia[];
}): DetectedMedia | null {
  const prevPath = input.resourceIdentity.split('|')[2] ?? null;
  for (const media of input.candidates) {
    const url = media.finalUrl || media.url;
    if (!url || url === input.previousUrl || url.startsWith('blob:')) {
      continue;
    }
    if (sameResourceFamily(url, input.previousUrl)) {
      return media;
    }
    const identity = buildResourceIdentityKey({
      contentIdentity: input.contentIdentity,
      executableUrl: url,
      transport: 'progressive',
      width: media.width,
      height: media.height,
      bitrate: media.bitrate,
      container: media.container,
    });
    if (prevPath && identity.split('|')[2] === prevPath) {
      return media;
    }
  }
  return null;
}
