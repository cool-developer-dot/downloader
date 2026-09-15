/**
 * Phase 5B — General-web source reliability.
 * Consumes Phase 5A ownership; verifies sources; builds variant offers.
 *
 * Reuses Phase 4B verification primitives (MIME/signature/identity/cache/ranking).
 * Does NOT reopen ownership selection.
 */

import type { MediaAnalysisResult } from '@/api/types';
import type { MediaRequestContext } from '@/downloads/types/request-context';
import {
  applyPrimarySummary,
  createVariant,
  resolveContainer,
  resolveExtension,
  resolveMediaType,
  parseFileSize,
} from '@/downloads/analyze/format';
import { isLikelyMediaSegment } from '../services/false-positive.filter';
import { buildRequestContextFromDetectedMedia } from '../services/request-context.service';
import { fetchManifestResource } from '../services/manifest.service';
import { parseHlsManifest } from '../parsers/hls.parser';
import { parseHlsPlaylist } from '@/downloads/engine/hls/playlist';
import { DownloadEngineError } from '@/downloads/engine/errors';
import {
  isFragmentedDashManifest,
  parseDashManifest,
  selectDownloadableStandaloneDash,
} from '../parsers/dash.parser';
import type { DetectedMedia } from '../types';
import { generalPageMediaContextStore } from '../general-media';
import { isInitOrFragmentMediaPath } from '../general-media/general-network-resource';
import {
  isAuthLikeFailure,
  maybeBuildSessionRetryContext,
  resolveAccessClassAfterFailure,
  logSessionMedia,
} from '../session-media';
import {
  isCombinedDownloadActionable,
  resolveSocialAudioState,
} from '../social-source/audio-evidence';
import {
  qualityFromDetectedMedia,
  resolveCredibleSizeBytes,
  resolveQualityLabelFromEvidence,
} from '../social-source/quality-evidence';
import {
  buildResourceIdentityKey,
  preserveExecutableUrl,
  hashIdentity,
} from '../social-source/resource-identity';
import {
  verifySocialSourceCandidate,
} from '../social-source/social-source-reliability.service';
import {
  buildVerificationCacheKey,
  getCachedVerifiedVariant,
  joinOrStartVerification,
  setCachedVerifiedVariant,
} from '../social-source/verification-session';
import { selectPreferredVariant, dedupeVariants } from '../social-source/variant-policy';
import type { VerifiedSocialMediaVariant } from '../social-source/types';
import { hashIdentity as diagHash, logGeneralSource } from './general-source-diagnostics';
import {
  hashHandoffIdentity,
  logAutomaticHandoff,
} from '../services/automatic-handoff-diagnostics';
import {
  hlsSizeBytesAlwaysOmitted,
  isHlsDrmOrUnsupportedEncryption,
  looksLikeHlsCandidate,
  qualityLabelFromHlsVariant,
  resolveHlsAudioState,
} from './hls-evidence';
import type {
  GeneralSourceRejectionReason,
  GeneralSourceTransport,
  GeneralSourceVerifyScope,
  VerifiedGeneralMediaOffer,
  VerifiedGeneralMediaVariant,
} from './types';

export type BuildGeneralOfferInput = {
  scope: GeneralSourceVerifyScope;
  candidates: DetectedMedia[];
  pageUrl: string;
  signal?: AbortSignal;
  activeCandidateIds?: string[];
};

export type BuildGeneralOfferResult =
  | { ok: true; offer: VerifiedGeneralMediaOffer; analysis: MediaAnalysisResult }
  | {
      ok: false;
      reason: GeneralSourceRejectionReason;
      analysis?: MediaAnalysisResult;
    };

function isGeneralScopeCurrent(scope: GeneralSourceVerifyScope): boolean {
  const ctx = generalPageMediaContextStore.get(scope.tabId);
  if (!ctx) {
    return false;
  }
  if (ctx.navigationEpoch !== scope.navigationEpoch) {
    return false;
  }
  if (ctx.pageGeneration !== scope.pageGeneration) {
    return false;
  }
  if (
    scope.mediaIdentity &&
    ctx.currentMediaIdentity &&
    scope.mediaIdentity !== ctx.currentMediaIdentity
  ) {
    return false;
  }
  return true;
}

function resolveTransport(
  media: DetectedMedia,
  mime: string | null,
): GeneralSourceTransport {
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

function toSocialCacheVariant(
  variant: VerifiedGeneralMediaVariant,
): VerifiedSocialMediaVariant {
  return variant as unknown as VerifiedSocialMediaVariant;
}

function fromSocialCacheVariant(
  variant: VerifiedSocialMediaVariant,
): VerifiedGeneralMediaVariant {
  return variant as unknown as VerifiedGeneralMediaVariant;
}

function buildProgressiveVariant(input: {
  media: DetectedMedia;
  executableUrl: string;
  mimeType: string | null;
  contentLength: number | null;
  acceptRanges: boolean;
  status: number | null;
  redirectCount: number;
  signatureKind: string | null;
  usedRangeProbe: boolean;
  requestContext: MediaRequestContext;
  mediaIdentity: string;
  sourceGeneration: number;
  audioStateOverride?: VerifiedGeneralMediaVariant['audioState'];
  width?: number | null;
  height?: number | null;
  bitrate?: number | null;
  qualityLabel?: string | null;
  transport?: GeneralSourceTransport;
  container?: string | null;
  sizeBytes?: number | null;
  downloadableOverride?: boolean;
}): VerifiedGeneralMediaVariant {
  const audioState =
    input.audioStateOverride ?? resolveSocialAudioState(input.media);
  const transport =
    input.transport ?? resolveTransport(input.media, input.mimeType);
  const qualityLabel =
    input.qualityLabel ??
    resolveQualityLabelFromEvidence({
      width: input.width ?? input.media.width,
      height: input.height ?? input.media.height,
    }) ??
    qualityFromDetectedMedia(input.media);
  const sizeBytes =
    input.sizeBytes !== undefined
      ? input.sizeBytes
      : resolveCredibleSizeBytes(input.contentLength, input.media.estimatedFileSize);
  const resolvedContainer =
    input.container ??
    resolveContainer(input.media.extension, input.mimeType) ??
    input.media.container;
  const container = resolvedContainer;

  const resourceIdentity = buildResourceIdentityKey({
    contentIdentity: input.mediaIdentity,
    executableUrl: input.executableUrl,
    transport,
    width: input.width ?? input.media.width,
    height: input.height ?? input.media.height,
    bitrate: input.bitrate ?? input.media.bitrate,
    container,
  });

  const downloadable =
    input.downloadableOverride ??
    (isCombinedDownloadActionable(audioState) &&
      transport !== 'adaptive_video_only' &&
      !input.media.isDrm);

  return {
    variantId: `gvar_${hashIdentity(resourceIdentity)}`,
    resourceIdentity,
    executableUrl: input.executableUrl,
    transport,
    container: container === 'unknown' ? null : String(container),
    mimeType: input.mimeType,
    width: input.width ?? input.media.width,
    height: input.height ?? input.media.height,
    bitrate: input.bitrate ?? input.media.bitrate,
    qualityLabel,
    sizeBytes,
    audioState,
    downloadable,
    verificationEvidence: {
      httpStatus: input.status,
      mimeType: input.mimeType,
      contentLength: input.contentLength,
      acceptRanges: input.acceptRanges,
      redirectCount: input.redirectCount,
      signatureKind: input.signatureKind,
      usedRangeProbe: input.usedRangeProbe,
    },
    requestContext: input.requestContext,
    verifiedAt: Date.now(),
    sourceGeneration: input.sourceGeneration,
  };
}

type HlsManifestFetch =
  | { ok: true; text: string; finalUrl: string; status: number }
  | {
      ok: false;
      reason: 'AUTH_REQUIRED' | 'MANIFEST_INVALID';
      status: number | null;
      authLike: boolean;
    };

async function fetchBoundedHlsManifest(
  url: string,
  requestContext: MediaRequestContext,
  pageUrl: string,
  signal?: AbortSignal,
): Promise<HlsManifestFetch> {
  const outcome = await fetchManifestResource(url, signal, {
    accept:
      'application/vnd.apple.mpegurl, application/x-mpegURL, text/plain, */*',
    referer: pageUrl,
    requestContext,
  });

  if (!outcome.ok) {
    // Distinguish auth-like failures from permanent "not a manifest" —
    // the offer builder retries auth-like with WebView cookies.
    if (outcome.authLike || outcome.htmlLike) {
      return {
        ok: false,
        reason: 'AUTH_REQUIRED',
        status: outcome.status,
        authLike: true,
      };
    }
    return {
      ok: false,
      reason: 'MANIFEST_INVALID',
      status: outcome.status,
      authLike: false,
    };
  }

  const lowerScheme = outcome.finalUrl.toLowerCase();
  if (
    lowerScheme.startsWith('blob:') ||
    lowerScheme.startsWith('data:') ||
    lowerScheme.startsWith('javascript:') ||
    lowerScheme.startsWith('file:')
  ) {
    return {
      ok: false,
      reason: 'MANIFEST_INVALID',
      status: outcome.status,
      authLike: false,
    };
  }
  return {
    ok: true,
    text: outcome.text,
    finalUrl: outcome.finalUrl,
    status: outcome.status,
  };
}

/**
 * Some MPD files are just a pack of complete MP4/WebM BaseURLs (no
 * SegmentTemplate). Treat those as progressive files. Fragmented DASH
 * remains DASH_UNSUPPORTED — no mux path.
 */
async function tryStandaloneDashAsProgressive(
  media: DetectedMedia,
  input: {
    pageUrl: string;
    requestContext: MediaRequestContext;
    mediaIdentity: string;
    sourceGeneration: number;
    signal?: AbortSignal;
  },
): Promise<
  | { ok: true; variants: VerifiedGeneralMediaVariant[] }
  | { ok: false; reason: GeneralSourceRejectionReason }
  | null
> {
  const url = preserveExecutableUrl(media.finalUrl || media.url);
  const outcome = await fetchManifestResource(url, input.signal, {
    accept: 'application/dash+xml, application/xml, text/xml, */*',
    referer: input.pageUrl,
    requestContext: input.requestContext,
  });
  if (!outcome.ok) {
    if (outcome.authLike || outcome.htmlLike) {
      return { ok: false, reason: 'AUTH_REQUIRED' };
    }
    return null;
  }
  if (isFragmentedDashManifest(outcome.text)) {
    return null;
  }
  const parsed = parseDashManifest(outcome.text, outcome.finalUrl);
  if (!parsed || parsed.isEncrypted) {
    return parsed?.isEncrypted ? { ok: false, reason: 'DRM_UNSUPPORTED' } : null;
  }
  const files = selectDownloadableStandaloneDash(parsed, outcome.text);
  if (files.length === 0) {
    return null;
  }

  const variants: VerifiedGeneralMediaVariant[] = [];
  for (const rep of files.slice(0, 6)) {
    if (!rep.baseUrl) {
      continue;
    }
    const asProgressive: DetectedMedia = {
      ...media,
      url: rep.baseUrl,
      sourceUrl: media.sourceUrl,
      finalUrl: rep.baseUrl,
      mimeType: rep.mimeType ?? media.mimeType,
      container:
        (rep.mimeType ?? '').toLowerCase().includes('webm') ? 'webm' : 'mp4',
      category: rep.contentType === 'audio' ? 'audio' : 'video',
      streamType: 'DIRECT',
      streamProtocol: null,
      width: rep.width ?? media.width,
      height: rep.height ?? media.height,
      bitrate: rep.bandwidth ?? media.bitrate,
      videoOnly: false,
      hasSeparateAudio: false,
    };
    const result = await verifySocialSourceCandidate(asProgressive, {
      pageUrl: input.pageUrl,
      requestContext: input.requestContext,
      signal: input.signal,
    });
    if (!result.ok) {
      continue;
    }
    variants.push(
      buildProgressiveVariant({
        media: asProgressive,
        executableUrl: preserveExecutableUrl(result.verification.finalUrl),
        mimeType: result.verification.mimeType,
        contentLength: result.verification.contentLength,
        acceptRanges: result.verification.acceptRanges,
        status: result.verification.status,
        redirectCount: result.verification.redirectCount,
        signatureKind: result.signatureKind,
        usedRangeProbe: result.usedRangeProbe,
        requestContext: input.requestContext,
        mediaIdentity: input.mediaIdentity,
        sourceGeneration: input.sourceGeneration,
        width: rep.width,
        height: rep.height,
        bitrate: rep.bandwidth,
      }),
    );
  }

  if (variants.length === 0) {
    return null;
  }
  return { ok: true, variants };
}

/**
 * Verify one owned candidate into zero or more actionable variants.
 * Reuses Phase 4B progressive/WebM/MP4 classification; adds HLS expand.
 */
export async function verifyGeneralSourceCandidate(
  media: DetectedMedia,
  input: {
    pageUrl: string;
    requestContext: MediaRequestContext;
    mediaIdentity: string;
    sourceGeneration: number;
    signal?: AbortSignal;
  },
): Promise<
  | { ok: true; variants: VerifiedGeneralMediaVariant[] }
  | { ok: false; reason: GeneralSourceRejectionReason }
> {
  const url = preserveExecutableUrl(media.finalUrl || media.url);

  if (url.toLowerCase().startsWith('blob:')) {
    return { ok: false, reason: 'BLOB_ONLY' };
  }
  if (isLikelyMediaSegment(url, media.extension)) {
    return { ok: false, reason: 'SEGMENT_RESOURCE' };
  }
  if (isInitOrFragmentMediaPath(url)) {
    return { ok: false, reason: 'INIT_SEGMENT' };
  }
  if (media.isDrm) {
    return { ok: false, reason: 'DRM_UNSUPPORTED' };
  }
  if (media.streamType === 'DASH' || media.container === 'dash') {
    const standalone = await tryStandaloneDashAsProgressive(media, input);
    if (standalone) {
      return standalone;
    }
    return { ok: false, reason: 'DASH_UNSUPPORTED' };
  }

  const hlsLikely = looksLikeHlsCandidate({
    url,
    mimeType: media.mimeType,
    streamType: media.streamType,
    container: media.container,
  });

  if (hlsLikely) {
    const fetched = await fetchBoundedHlsManifest(
      url,
      input.requestContext,
      input.pageUrl,
      input.signal,
    );
    if (!fetched.ok) {
      // Auth-like failure surfaces AUTH_REQUIRED so buildVerifiedGeneralMediaOffer
      // retries with WebView cookies via maybeBuildSessionRetryContext.
      logGeneralSource(
        fetched.reason === 'AUTH_REQUIRED'
          ? 'hls_auth_required'
          : 'hls_manifest_invalid',
        {
          mediaIdentityHash: diagHash(input.mediaIdentity),
          reason: fetched.reason,
        },
      );
      return { ok: false, reason: fetched.reason };
    }
    if (!fetched.text.trimStart().startsWith('#EXTM3U')) {
      logGeneralSource('hls_manifest_invalid', {
        mediaIdentityHash: diagHash(input.mediaIdentity),
        reason: 'MANIFEST_INVALID',
      });
      return { ok: false, reason: 'MANIFEST_INVALID' };
    }
    const parsed = parseHlsManifest(fetched.text, fetched.finalUrl);
    if (!parsed) {
      return { ok: false, reason: 'MANIFEST_INVALID' };
    }
    // Same transport policy as the downloader: VOD, clear, no byte-range or mux path.
    try { parseHlsPlaylist(fetched.text, fetched.finalUrl); } catch (error) {
      const code = error instanceof DownloadEngineError ? error.code : '';
      return { ok: false, reason: code === 'LIVE_HLS_UNSUPPORTED' ? 'LIVE_HLS_UNSUPPORTED' :
        /DRM|ENCRYPT/.test(code) ? 'DRM_UNSUPPORTED' : 'MANIFEST_INVALID' };
    }
    if (parsed.isLive) {
      logGeneralSource('hls_live_rejected', {
        reason: 'LIVE_HLS_UNSUPPORTED',
        mediaIdentityHash: diagHash(input.mediaIdentity),
      });
      return { ok: false, reason: 'LIVE_HLS_UNSUPPORTED' };
    }
    if (isHlsDrmOrUnsupportedEncryption(parsed)) {
      logGeneralSource('hls_drm_rejected', {
        reason: 'DRM_UNSUPPORTED',
        mediaIdentityHash: diagHash(input.mediaIdentity),
      });
      return { ok: false, reason: 'DRM_UNSUPPORTED' };
    }

    if (parsed.isMaster && parsed.variants.length > 0) {
      const variants: VerifiedGeneralMediaVariant[] = [];
      let rejection: GeneralSourceRejectionReason = 'MANIFEST_INVALID';
      for (const stream of parsed.variants.slice(0, 6)) {
        if (input.signal?.aborted) return { ok: false, reason: 'PROBE_FAILED' };
        const child = await fetchBoundedHlsManifest(stream.uri, input.requestContext, input.pageUrl, input.signal);
        if (!child.ok) { rejection = child.reason; continue; }
        try {
          if (parseHlsPlaylist(child.text, child.finalUrl).kind !== 'media') continue;
        } catch (error) {
          const code = error instanceof DownloadEngineError ? error.code : '';
          rejection = code === 'LIVE_HLS_UNSUPPORTED' ? 'LIVE_HLS_UNSUPPORTED' :
            /DRM|ENCRYPT/.test(code) ? 'DRM_UNSUPPORTED' : 'MANIFEST_INVALID';
          continue;
        }
        const audioState = resolveHlsAudioState({
          codecs: stream.codecs,
          audioGroup: stream.audioGroup,
          isEncrypted: parsed.isEncrypted,
        });
        const variant = buildProgressiveVariant({
          media,
          executableUrl: preserveExecutableUrl(child.finalUrl),
          mimeType: 'application/vnd.apple.mpegurl',
          contentLength: null,
          acceptRanges: false,
          status: 200,
          redirectCount: 0,
          signatureKind: 'hls_master',
          usedRangeProbe: true,
          requestContext: input.requestContext,
          mediaIdentity: input.mediaIdentity,
          sourceGeneration: input.sourceGeneration,
          audioStateOverride: audioState,
          width: stream.width,
          height: stream.height,
          bitrate: stream.bandwidth,
          qualityLabel: qualityLabelFromHlsVariant(stream),
          transport: 'hls',
          container: 'hls',
          sizeBytes: hlsSizeBytesAlwaysOmitted(),
          downloadableOverride:
            isCombinedDownloadActionable(audioState) && !media.isDrm,
        });
        variants.push(variant);
      }
      if (!variants.some((v) => v.downloadable)) return { ok: false, reason: rejection };
      logGeneralSource('hls_master_expanded', {
        mediaIdentityHash: diagHash(input.mediaIdentity),
        transport: 'hls',
        quality: String(variants.length),
      });
      return { ok: true, variants };
    }

    if (parsed.isMedia || parsed.playlistType === 'media') {
      const audioState = resolveHlsAudioState({
        codecs: null,
        audioGroup: null,
        isEncrypted: parsed.isEncrypted,
      });
      const variant = buildProgressiveVariant({
        media,
        executableUrl: preserveExecutableUrl(fetched.finalUrl),
        mimeType: 'application/vnd.apple.mpegurl',
        contentLength: null,
        acceptRanges: false,
        status: 200,
        redirectCount: 0,
        signatureKind: 'hls_media',
        usedRangeProbe: true,
        requestContext: input.requestContext,
        mediaIdentity: input.mediaIdentity,
        sourceGeneration: input.sourceGeneration,
        audioStateOverride: audioState === 'UNKNOWN' ? 'UNKNOWN' : audioState,
        transport: 'hls',
        container: 'hls',
        sizeBytes: hlsSizeBytesAlwaysOmitted(),
        downloadableOverride: true,
      });
      logGeneralSource('hls_media_verified', {
        mediaIdentityHash: diagHash(input.mediaIdentity),
        transport: 'hls',
      });
      return { ok: true, variants: [variant] };
    }

    return { ok: false, reason: 'MANIFEST_INVALID' };
  }

  // Progressive / WebM / MP4 — reuse Phase 4B hardened verifier.
  const result = await verifySocialSourceCandidate(media, {
    pageUrl: input.pageUrl,
    requestContext: input.requestContext,
    signal: input.signal,
  });

  if (!result.ok) {
    return { ok: false, reason: result.reason as GeneralSourceRejectionReason };
  }

  if (result.signatureKind === 'webm') {
    logGeneralSource('source_webm_verified', {
      mediaIdentityHash: diagHash(input.mediaIdentity),
      container: 'webm',
    });
  } else if (result.signatureKind === 'mp4') {
    logGeneralSource('source_progressive_verified', {
      mediaIdentityHash: diagHash(input.mediaIdentity),
      container: 'mp4',
    });
  }

  const variant = buildProgressiveVariant({
    media,
    executableUrl: preserveExecutableUrl(result.verification.finalUrl),
    mimeType: result.verification.mimeType,
    contentLength: result.verification.contentLength,
    acceptRanges: result.verification.acceptRanges,
    status: result.verification.status,
    redirectCount: result.verification.redirectCount,
    signatureKind: result.signatureKind,
    usedRangeProbe: result.usedRangeProbe,
    requestContext: input.requestContext,
    mediaIdentity: input.mediaIdentity,
    sourceGeneration: input.sourceGeneration,
  });

  return { ok: true, variants: [variant] };
}

/**
 * Build a verified offer from Phase 5A-correlated candidates only.
 * Ownership confidence REJECTED cannot be resurrected by ranking.
 */
export async function buildVerifiedGeneralMediaOffer(
  input: BuildGeneralOfferInput,
): Promise<BuildGeneralOfferResult> {
  const { scope } = input;

  if (scope.ownershipConfidence === 'REJECTED') {
    logGeneralSource('ownership_rejected_not_resurrected', {
      tabId: scope.tabId,
      pageGeneration: scope.pageGeneration,
      mediaIdentityHash: diagHash(scope.mediaIdentity),
      reason: 'WEAK_OWNERSHIP',
    });
    return { ok: false, reason: 'WEAK_OWNERSHIP' };
  }

  if (!isGeneralScopeCurrent(scope)) {
    logGeneralSource('stale_verification_ignored', {
      tabId: scope.tabId,
      navigationEpoch: scope.navigationEpoch,
      pageGeneration: scope.pageGeneration,
      mediaIdentityHash: diagHash(scope.mediaIdentity),
      reason: 'STALE_PAGE_GENERATION',
    });
    return { ok: false, reason: 'STALE_PAGE_GENERATION' };
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

  // WEAK ownership: avoid expensive multi-candidate storms — verify at most one.
  if (scope.ownershipConfidence === 'WEAK') {
    candidates = candidates.slice(0, 1);
  } else {
    candidates = candidates.slice(0, 6);
  }

  const variants: VerifiedGeneralMediaVariant[] = [];
  let lastReject: GeneralSourceRejectionReason = 'NO_FRESH_SOURCE';
  /** HLS expand may yield multiple variants per cache key. */
  const expandedByKey = new Map<string, VerifiedGeneralMediaVariant[]>();

  for (const media of candidates) {
    if (input.signal?.aborted) {
      return { ok: false, reason: 'STALE_SOURCE_GENERATION' };
    }
    if (!isGeneralScopeCurrent(scope)) {
      return { ok: false, reason: 'STALE_PAGE_GENERATION' };
    }

    const executableUrl = preserveExecutableUrl(media.finalUrl || media.url);
    const cacheKey = buildVerificationCacheKey({
      tabId: scope.tabId,
      navigationEpoch: scope.navigationEpoch,
      socialContextGeneration: scope.pageGeneration,
      contentIdentity: scope.mediaIdentity,
      executableUrl,
    });

    const priorExpand = expandedByKey.get(cacheKey);
    if (priorExpand) {
      variants.push(...priorExpand);
      continue;
    }

    const cached = getCachedVerifiedVariant(cacheKey);
    if (cached) {
      variants.push(fromSocialCacheVariant(cached));
      variants.push(...(cached.alternatives ?? []).map(fromSocialCacheVariant));
      continue;
    }

    const { joined, promise } = joinOrStartVerification(cacheKey, async () => {
      logGeneralSource('candidate_verify_started', {
        tabId: scope.tabId,
        navigationEpoch: scope.navigationEpoch,
        pageGeneration: scope.pageGeneration,
        mediaIdentityHash: diagHash(scope.mediaIdentity),
      });

      if (!isGeneralScopeCurrent(scope)) {
        return null;
      }

      const sessionScope = {
        tabId: scope.tabId,
        navigationEpoch: scope.navigationEpoch,
        pageGeneration: scope.pageGeneration,
        mediaIdentity: scope.mediaIdentity,
      };

      // Phase 6B public-first: probe without cookies unless session-bound evidence.
      let requestContext = await buildRequestContextFromDetectedMedia({
        mediaUrl: executableUrl,
        pageUrl: input.pageUrl,
        requiresCookies: media.requiresCookies,
        requiredHeaders: media.requiredHeaders,
        tabId: scope.tabId,
        navigationEpoch: scope.navigationEpoch,
        pageGeneration: scope.pageGeneration,
        mediaIdentity: scope.mediaIdentity,
        authMode: media.requiresCookies ? undefined : 'PUBLIC',
      });

      if (input.signal?.aborted || !isGeneralScopeCurrent(scope)) {
        return null;
      }

      let result = await verifyGeneralSourceCandidate(media, {
        pageUrl: input.pageUrl,
        requestContext,
        mediaIdentity: scope.mediaIdentity,
        sourceGeneration: scope.pageGeneration,
        signal: input.signal,
      });

      let usedSession = requestContext.authMode !== 'PUBLIC' && requestContext.hasCookies;

      if (
        !result.ok &&
        isAuthLikeFailure({
          status: null,
          rejectionReason: result.reason,
        })
      ) {
        const retry = await maybeBuildSessionRetryContext({
          mediaUrl: executableUrl,
          pageUrl: input.pageUrl,
          requiresCookies: true,
          requiredHeaders: media.requiredHeaders,
          scope: sessionScope,
          failure: { rejectionReason: result.reason },
          alreadyUsedSession: usedSession,
        });

        if (retry && retry.hasCookies) {
          usedSession = true;
          requestContext = retry;
          if (input.signal?.aborted || !isGeneralScopeCurrent(scope)) {
            return null;
          }
          result = await verifyGeneralSourceCandidate(media, {
            pageUrl: input.pageUrl,
            requestContext,
            mediaIdentity: scope.mediaIdentity,
            sourceGeneration: scope.pageGeneration,
            signal: input.signal,
          });
          if (result.ok) {
            logSessionMedia('session_verify_success', {
              tabId: scope.tabId,
              pageGeneration: scope.pageGeneration,
              authMode: requestContext.authMode ?? null,
              cookiePresent: true,
            });
          } else {
            const access = resolveAccessClassAfterFailure({
              failure: { rejectionReason: result.reason },
              usedSession: true,
              sessionHadCookies: true,
            });
            logSessionMedia('session_verify_failed', {
              tabId: scope.tabId,
              accessClass: access,
              reason: result.reason,
            });
          }
        } else if (retry && !retry.hasCookies) {
          logSessionMedia('session_context_unavailable', {
            tabId: scope.tabId,
            cookiePresent: false,
          });
        }
      } else if (result.ok && requestContext.authMode === 'PUBLIC') {
        logSessionMedia('public_verify_success', {
          tabId: scope.tabId,
          pageGeneration: scope.pageGeneration,
          cookiePresent: false,
        });
      }

      if (!result.ok) {
        lastReject = result.reason;
        logGeneralSource('candidate_verify_rejected', {
          tabId: scope.tabId,
          mediaIdentityHash: diagHash(scope.mediaIdentity),
          reason: result.reason,
        });
        return null;
      }

      expandedByKey.set(cacheKey, result.variants);
      const primary =
        result.variants.find((v) => v.downloadable) ?? result.variants[0] ?? null;
      if (!primary) {
        return null;
      }

      const cachedPrimary = { ...toSocialCacheVariant(primary), alternatives: result.variants.filter((v) => v !== primary).map(toSocialCacheVariant) };
      setCachedVerifiedVariant(cacheKey, cachedPrimary);
      logGeneralSource('candidate_verify_succeeded', {
        tabId: scope.tabId,
        mediaIdentityHash: diagHash(scope.mediaIdentity),
        variantId: primary.variantId,
        transport: primary.transport,
        quality: primary.qualityLabel,
        audioState: primary.audioState,
        mime: primary.mimeType,
      });
      logGeneralSource('variant_created', {
        variantId: primary.variantId,
        audioState: primary.audioState,
        quality: primary.qualityLabel,
        transport: primary.transport,
      });
      return cachedPrimary;
    });

    if (joined) {
      logGeneralSource('candidate_verify_joined', {
        tabId: scope.tabId,
        mediaIdentityHash: diagHash(scope.mediaIdentity),
      });
      logAutomaticHandoff('MEDIA_VERIFY_JOINED_INFLIGHT', {
        tabId: scope.tabId,
        contentIdentityHash: hashHandoffIdentity(scope.mediaIdentity),
      });
    }

    const variant = await promise;
    if (variant) {
      const expanded = expandedByKey.get(cacheKey);
      if (expanded?.length) {
        variants.push(...expanded);
      } else {
        variants.push(fromSocialCacheVariant(variant));
        variants.push(...(variant.alternatives ?? []).map(fromSocialCacheVariant));
      }
    } else {
      if (lastReject === 'NO_FRESH_SOURCE') lastReject = 'PROBE_FAILED';
    }
  }

  if (!isGeneralScopeCurrent(scope)) {
    return { ok: false, reason: 'STALE_PAGE_GENERATION' };
  }

  const deduped = dedupeVariants(
    variants.map(toSocialCacheVariant),
  ).map(fromSocialCacheVariant);
  const preferredSocial = selectPreferredVariant(deduped.map(toSocialCacheVariant));
  const preferred = preferredSocial
    ? fromSocialCacheVariant(preferredSocial)
    : null;
  const actionable = deduped.filter((v) => v.downloadable);

  if (!preferred || actionable.length === 0) {
    if (deduped.some((v) => v.audioState === 'VIDEO_ONLY')) {
      return { ok: false, reason: 'VIDEO_ONLY_UNSUPPORTED' };
    }
    return { ok: false, reason: lastReject };
  }

  logGeneralSource('preferred_variant_selected', {
    tabId: scope.tabId,
    variantId: preferred.variantId,
    quality: preferred.qualityLabel,
    audioState: preferred.audioState,
    transport: preferred.transport,
  });

  const offer: VerifiedGeneralMediaOffer = {
    mediaIdentity: scope.mediaIdentity,
    tabId: scope.tabId,
    navigationEpoch: scope.navigationEpoch,
    pageGeneration: scope.pageGeneration,
    variants: deduped,
    preferredVariantId: preferred.variantId,
    verifiedAt: Date.now(),
  };

  logGeneralSource('offer_created', {
    tabId: offer.tabId,
    pageGeneration: offer.pageGeneration,
    mediaIdentityHash: diagHash(offer.mediaIdentity),
  });

  const analysis = generalOfferToAnalysis(offer, preferred, input.candidates[0]!);
  return { ok: true, offer, analysis };
}

export function generalOfferToAnalysis(
  offer: VerifiedGeneralMediaOffer,
  preferred: VerifiedGeneralMediaVariant,
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
      container,
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
      platform: 'WEB',
      downloadable: true,
      unsupportedReason: null,
      variants: [],
    },
    variants,
  );
}
