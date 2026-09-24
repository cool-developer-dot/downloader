/**
 * Phase 5B — General-web source reliability.
 * Consumes Phase 5A ownership; verifies sources; builds variant offers.
 *
 * Reuses Phase 4B verification primitives (MIME/signature/identity/cache/ranking).
 * Does NOT reopen ownership selection.
 */

import type { ProbeFailure, ProbeResult } from '@modules/vidorax-media/src/VidoraMedia.types';

import type { MediaAnalysisContainer, MediaAnalysisResult } from '@/api/types';
import type { MediaRequestContext } from '@/downloads/types/request-context';
import { getV2Engine } from '@/downloads/v2/engine-port';
import { toV2RequestContext } from '@/downloads/v2/enqueue-request';
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
import { isDashMimeType, parseDashManifest } from '../parsers/dash.parser';
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
  /**
   * The source the ownership pass chose as the current main video. Variants of that video win the
   * preferred-variant ranking, so an ad or a second player on the page can never be offered instead.
   */
  ownedResourceUrl?: string | null;
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

/** The native classifier's DASH verdict in this layer's terms: protected, live, unsupported, transient or stale. */
export function dashRejectionFor(reason: ProbeFailure): GeneralSourceRejectionReason {
  switch (reason) {
    case 'DRM_PROTECTED':
      return 'DRM_UNSUPPORTED';
    case 'LIVE_UNSUPPORTED':
      return 'LIVE_UNSUPPORTED';
    case 'NETWORK':
    case 'HTTP_ERROR':
      return 'PROBE_FAILED';
    case 'HTTP_403':
      return 'AUTH_REQUIRED';
    case 'HTTP_404':
      return 'EXPIRED_SOURCE';
    case 'UNSUPPORTED_FORMAT':
    case 'NOT_MEDIA':
    case 'POLICY_BLOCKED':
    default:
      return 'DASH_UNSUPPORTED';
  }
}

/**
 * The native classifier's refusal of a single file in this layer's terms, or null when the answer is about the
 * moment (network, server error, an expired or session-bound link): the engine retries and renews those itself.
 */
export function progressiveRefusalFor(reason: ProbeFailure): GeneralSourceRejectionReason | null {
  switch (reason) {
    case 'DRM_PROTECTED':
      return 'DRM_UNSUPPORTED';
    case 'LIVE_UNSUPPORTED':
      return 'LIVE_UNSUPPORTED';
    case 'UNSUPPORTED_FORMAT':
      return 'UNSUPPORTED_FORMAT';
    case 'NOT_MEDIA':
      return 'NOT_MEDIA';
    case 'POLICY_BLOCKED':
      return 'UNSUPPORTED_TRANSPORT';
    default:
      return null;
  }
}

/** `claimedFiles`: a DASH manifest's representation files (see {@link dashRepresentationFiles}). */
type CandidateVerification =
  | { ok: true; variants: VerifiedGeneralMediaVariant[]; claimedFiles?: string[] }
  | { ok: false; reason: GeneralSourceRejectionReason; claimedFiles?: string[] };

function isDashSource(media: DetectedMedia): boolean {
  return media.streamType === 'DASH' || media.container === 'dash' || isDashMimeType(media.mimeType);
}

/** A file's identity whatever query it is requested with (a signature, a byte range): scheme://host/path. */
function mediaFileKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${parsed.pathname}`;
  } catch {
    return null;
  }
}

const MAX_CLAIMED_FILES = 64;

/**
 * The files a DASH manifest names as whole-file representations. A page's player fetches them directly, so they are
 * also observed as ordinary files — but each belongs to this manifest's stream and shares its verdict: the qualities
 * of a downloadable manifest already offer them, and the pieces of a refused one (the audio or the video half of a
 * split stream) are not videos of their own. Read with the detection parser from one bounded fetch; empty when the
 * manifest cannot be read.
 */
async function dashRepresentationFiles(
  manifestUrl: string,
  input: { pageUrl: string; requestContext: MediaRequestContext; signal?: AbortSignal },
): Promise<string[]> {
  const fetched = await fetchManifestResource(manifestUrl, input.signal, {
    accept: 'application/dash+xml, application/xml, text/xml, */*',
    referer: input.pageUrl,
    requestContext: input.requestContext,
  });
  if (!fetched.ok) {
    return [];
  }
  const files = new Set<string>();
  for (const representation of parseDashManifest(fetched.text, fetched.finalUrl)?.representations ?? []) {
    const key = representation.baseUrl ? mediaFileKey(representation.baseUrl) : null;
    if (key) {
      files.add(key);
    }
    if (files.size >= MAX_CLAIMED_FILES) {
      break;
    }
  }
  return [...files];
}

/** A classified manifest's files, and its refusal reason — null when the manifest itself is offered. */
type ManifestFiles = { reason: GeneralSourceRejectionReason | null; files: string[] };

const MAX_CLASSIFIED_MANIFESTS = 32;

/**
 * Per classified DASH candidate (its verification cache key). Shared across offer builds: a build that joins an
 * in-flight verification, or reuses a cached one, never runs the classification itself.
 */
const classifiedManifests = new Map<string, ManifestFiles>();

function rememberManifestFiles(cacheKey: string, manifest: ManifestFiles): void {
  classifiedManifests.delete(cacheKey);
  classifiedManifests.set(cacheKey, manifest);
  while (classifiedManifests.size > MAX_CLASSIFIED_MANIFESTS) {
    const oldest = classifiedManifests.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    classifiedManifests.delete(oldest);
  }
}

/**
 * A native classification that has not answered after this long is no verdict. The engine's own timeouts are sized
 * for downloads (20 s connect, 30 s read per request, several requests for a manifest); the "Video available" offer
 * must not wait on them, and a verification left waiting would hold up every later one.
 */
const NATIVE_PROBE_TIMEOUT_MS = 25_000;

function probeWithTimeout(
  engine: NonNullable<ReturnType<typeof getV2Engine>>,
  request: Parameters<NonNullable<ReturnType<typeof getV2Engine>>['probe']>[0],
): Promise<ProbeResult | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), NATIVE_PROBE_TIMEOUT_MS);
  });
  return Promise.race([engine.probe(request), timeout]).finally(() => clearTimeout(timer));
}

/**
 * The engine's own classifier has the last word before a file is offered: one it would refuse — audio only, a
 * container it cannot finish, encrypted, live, not media — never gets a CTA. A transient answer leaves the offer to
 * the checks already made (null), as does a build without the engine or a classification that does not answer.
 */
async function nativeProgressiveRefusal(
  url: string,
  input: { pageUrl: string; requestContext: MediaRequestContext },
): Promise<GeneralSourceRejectionReason | null> {
  const engine = getV2Engine();
  if (!engine) {
    return null;
  }
  try {
    const result = await probeWithTimeout(engine, {
      url,
      kind: 'progressive',
      request: toV2RequestContext(input.requestContext, input.pageUrl),
    });
    if (!result) {
      return null;
    }
    return result.ok ? null : progressiveRefusalFor(result.reason);
  } catch {
    return null;
  }
}

function dashMimeType(container: string): string {
  switch (container) {
    case 'webm':
      return 'video/webm';
    case 'mov':
      return 'video/quicktime';
    default:
      return 'video/mp4';
  }
}

/**
 * A DASH manifest is classified by the native engine — the classifier the download itself uses — never by a second
 * parser here. It is DOWNLOADABLE only when a representation is one complete video file (audio and video muxed, or
 * a manifest that carries no audio), whose own bytes the engine has checked; separate audio/video, segmented,
 * live and protected manifests come back with their own reason, and a temporary failure stays temporary.
 */
async function classifyDashSource(
  media: DetectedMedia,
  input: {
    pageUrl: string;
    requestContext: MediaRequestContext;
    mediaIdentity: string;
    sourceGeneration: number;
    signal?: AbortSignal;
  },
): Promise<CandidateVerification> {
  const engine = getV2Engine();
  if (!engine) {
    return { ok: false, reason: 'DASH_UNSUPPORTED' };
  }
  const manifestUrl = preserveExecutableUrl(media.finalUrl || media.url);
  let result: ProbeResult | null;
  try {
    result = await probeWithTimeout(engine, {
      url: manifestUrl,
      kind: 'dash',
      request: toV2RequestContext(input.requestContext, input.pageUrl),
    });
  } catch {
    return { ok: false, reason: 'PROBE_FAILED' };
  }
  if (!result) {
    return { ok: false, reason: 'PROBE_FAILED' };
  }
  if (!result.ok) {
    const reason = dashRejectionFor(result.reason);
    logGeneralSource('dash_rejected', { mediaIdentityHash: diagHash(input.mediaIdentity), reason });
    // Refused for what the stream is (not for a moment's trouble): the files it names share the verdict.
    const refused = progressiveRefusalFor(result.reason) !== null;
    return { ok: false, reason, claimedFiles: refused ? await dashRepresentationFiles(manifestUrl, input) : [] };
  }

  const audioState = result.audioTracks.length > 0 ? 'INCLUDED' : 'UNKNOWN';
  // The probe classified (and measured) the representation enqueue would pick; with one quality that is exact.
  const exactSize = result.variants.length === 1 ? result.sizeBytes : null;
  const variants = result.variants
    .filter((rep) => !rep.needsAudioMux)
    .map((rep) => {
      const built = buildProgressiveVariant({
        media,
        executableUrl: result.finalUrl,
        mimeType: dashMimeType(result.container),
        contentLength: exactSize,
        acceptRanges: result.resumable,
        status: 200,
        redirectCount: 0,
        signatureKind: 'dash_manifest',
        usedRangeProbe: true,
        requestContext: input.requestContext,
        mediaIdentity: input.mediaIdentity,
        sourceGeneration: input.sourceGeneration,
        audioStateOverride: audioState,
        width: rep.width,
        height: rep.height,
        bitrate: rep.bitrate,
        qualityLabel: rep.height ? `${rep.height}p` : null,
        transport: 'dash',
        container: result.container,
        sizeBytes: exactSize ?? rep.estimatedBytes,
        downloadableOverride: true,
      });
      // Every quality shares the manifest URL: the representation is what makes each one a distinct download.
      const resourceIdentity = `${built.resourceIdentity}#rep:${rep.id}`;
      return {
        ...built,
        resourceIdentity,
        variantId: `gvar_${hashIdentity(resourceIdentity)}`,
        representationId: rep.id,
      };
    });
  if (variants.length === 0) {
    return { ok: false, reason: 'DASH_UNSUPPORTED' };
  }
  logGeneralSource('dash_classified', {
    mediaIdentityHash: diagHash(input.mediaIdentity),
    transport: 'dash',
    quality: String(variants.length),
  });
  // Its qualities offer its files: the same files seen on their own are not offered a second time.
  return { ok: true, variants, claimedFiles: await dashRepresentationFiles(manifestUrl, input) };
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
): Promise<CandidateVerification> {
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
  if (isDashSource(media)) {
    return classifyDashSource(media, input);
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

  const refusal = await nativeProgressiveRefusal(preserveExecutableUrl(result.verification.finalUrl), input);
  if (refusal) {
    logGeneralSource('native_refused', { mediaIdentityHash: diagHash(input.mediaIdentity), reason: refusal });
    return { ok: false, reason: refusal };
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

  // Only current-content owners publish. WEAK (page-level, no player evidence yet) waits: player evidence
  // changes the ownership key and re-runs verification, so nothing is probed or offered before it.
  if (scope.ownershipConfidence !== 'STRONG' && scope.ownershipConfidence !== 'MEDIUM') {
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

  // Manifests first, so the files a manifest names are claimed before any of them could be offered on its own.
  candidates = [...candidates.filter(isDashSource), ...candidates.filter((c) => !isDashSource(c))].slice(0, 6);

  const variants: VerifiedGeneralMediaVariant[] = [];
  let lastReject: GeneralSourceRejectionReason = 'NO_FRESH_SOURCE';
  /** HLS expand may yield multiple variants per cache key. */
  const expandedByKey = new Map<string, VerifiedGeneralMediaVariant[]>();
  /** Files named by a manifest classified in this build → its refusal reason, or null when it is offered. */
  const claimedFiles = new Map<string, GeneralSourceRejectionReason | null>();
  const adoptManifest = (manifest: ManifestFiles) => {
    if (manifest.reason) {
      lastReject = manifest.reason;
    }
    for (const file of manifest.files) {
      claimedFiles.set(file, manifest.reason);
    }
  };

  for (const media of candidates) {
    if (input.signal?.aborted) {
      return { ok: false, reason: 'STALE_SOURCE_GENERATION' };
    }
    if (!isGeneralScopeCurrent(scope)) {
      return { ok: false, reason: 'STALE_PAGE_GENERATION' };
    }

    const executableUrl = preserveExecutableUrl(media.finalUrl || media.url);
    // A file of a classified stream follows it, even when an earlier build verified the file on its own.
    const fileKey = mediaFileKey(executableUrl);
    if (fileKey && claimedFiles.has(fileKey)) {
      const reason = claimedFiles.get(fileKey) ?? null;
      if (reason) {
        lastReject = reason;
      }
      logGeneralSource('claimed_by_manifest', {
        tabId: scope.tabId,
        mediaIdentityHash: diagHash(scope.mediaIdentity),
        reason,
      });
      continue;
    }
    const cacheKey = buildVerificationCacheKey({
      tabId: scope.tabId,
      navigationEpoch: scope.navigationEpoch,
      socialContextGeneration: scope.pageGeneration,
      contentIdentity: scope.mediaIdentity,
      executableUrl,
    });

    // A manifest classified earlier in this scope claims its files again; a refused one is not fetched again.
    const known = classifiedManifests.get(cacheKey);
    if (known) {
      adoptManifest(known);
      if (known.reason) {
        continue;
      }
    }

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

    const { joined, promise } = joinOrStartVerification(cacheKey, async (jobSignal) => {
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

      if (jobSignal.aborted || !isGeneralScopeCurrent(scope)) {
        return null;
      }

      let result = await verifyGeneralSourceCandidate(media, {
        pageUrl: input.pageUrl,
        requestContext,
        mediaIdentity: scope.mediaIdentity,
        sourceGeneration: scope.pageGeneration,
        signal: jobSignal,
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
          if (jobSignal.aborted || !isGeneralScopeCurrent(scope)) {
            return null;
          }
          result = await verifyGeneralSourceCandidate(media, {
            pageUrl: input.pageUrl,
            requestContext,
            mediaIdentity: scope.mediaIdentity,
            sourceGeneration: scope.pageGeneration,
            signal: jobSignal,
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

      if (result.claimedFiles?.length) {
        rememberManifestFiles(cacheKey, { reason: result.ok ? null : result.reason, files: result.claimedFiles });
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
    }, input.signal);

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
    // Also reached by a build that joined a verification another build ran.
    const classified = classifiedManifests.get(cacheKey);
    if (classified) {
      adoptManifest(classified);
    }
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
  const preferredSocial = selectPreferredVariant(
    deduped.map(toSocialCacheVariant),
    input.ownedResourceUrl,
  );
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
    const isDash = v.transport === 'dash';
    // A DASH option's URL is the manifest; its container is that of the representation file it downloads.
    const container = isDash
      ? ((v.container ?? 'mp4') as MediaAnalysisContainer)
      : resolveContainer(resolveExtension(v.executableUrl, v.mimeType), v.mimeType);
    const streamType =
      v.transport === 'hls'
        ? ('HLS' as const)
        : isDash
          ? ('DASH' as const)
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
      representationId: v.representationId ?? null,
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
