/**
 * Verifies the direct analyzer's candidates with the classifiers the WebView pipeline uses — nothing new decides
 * whether a source is downloadable:
 *
 * - progressive / HLS / DASH: `verifyGeneralSourceCandidate` (bounded range read + the engine's native probe for
 *   progressive, the engine's HLS/DASH planners for manifests), public first, then once with the browsing session's
 *   cookies when the answer was auth-like (a link the page signed for its session);
 * - a split pair named by the page (an inline manifest's video file + audio file): the engine's `split` probe, which
 *   proves the roles, that nothing is encrypted and that the lengths agree.
 *
 * The verified variants become one offer in the shape the browser's "Video available" bar and quality sheet already
 * use (`MediaAnalysisResult`), so the download goes through the existing hand-off, duplicate check and engine.
 */

import type { ProbeRequest, ProbeResult } from '@modules/vidorax-media/src/VidoraMedia.types';

import type { MediaAnalysisResult } from '@/api/types';
import { applyPrimarySummary, createVariant, derivePlatform } from '@/downloads/analyze/format';
import type { MediaRequestContext } from '@/downloads/types/request-context';
import { toV2RequestContext } from '@/downloads/v2/enqueue-request';

import { extractDetectedMedia } from '../extractors/metadata.extractor';
import {
  generalOfferToAnalysis,
  verifyGeneralSourceCandidate,
  type VerifiedGeneralMediaVariant,
} from '../general-source';
import { pipelineRejectionFor } from '../pipeline/pipeline-outcome';
import { resolveSplitPair, splitPairAnalysis, type SplitPair } from '../pipeline/split-tracks';
import { buildRequestContextFromDetectedMedia } from '../services/request-context.service';
import { isAuthLikeFailure } from '../session-media/auth-failure.classifier';
import type { DetectedMedia } from '../types';

import type { DirectMediaCandidate, PageMediaExtraction } from './extract-page-media';
import type { DirectAnalysisStatus, DirectVerification } from './resolve-direct-page';

export type DirectOffer = {
  analysis: MediaAnalysisResult;
  /** The candidate the offer stands on (title, thumbnail, id for the CTA). */
  media: DetectedMedia;
  requestContext: MediaRequestContext;
  /** The variant a single tap downloads. */
  mediaUrl: string;
  variantIdentity: string;
};

type CandidateResult =
  | { ok: true; variants: VerifiedGeneralMediaVariant[] }
  | { ok: false; reason: string };

export type DirectVerifierDeps = {
  verifyCandidate(
    media: DetectedMedia,
    input: { pageUrl: string; requestContext: MediaRequestContext; mediaIdentity: string; sourceGeneration: number; signal?: AbortSignal },
  ): Promise<CandidateResult>;
  buildContext(input: { mediaUrl: string; pageUrl: string; session: boolean }): Promise<MediaRequestContext>;
  /** The engine's classifier; null when the native module is missing (split pairs cannot be proven then). */
  probe: ((request: ProbeRequest) => Promise<ProbeResult>) | null;
  now(): number;
};

/** Candidates verified per link; three at a time. */
const MAX_VERIFIED_CANDIDATES = 6;
const CONCURRENCY = 3;

export function defaultDirectVerifierDeps(probe: DirectVerifierDeps['probe']): DirectVerifierDeps {
  return {
    verifyCandidate: (media, input) => verifyGeneralSourceCandidate(media, input),
    buildContext: ({ mediaUrl, pageUrl, session }) =>
      buildRequestContextFromDetectedMedia({
        mediaUrl,
        pageUrl,
        requiresCookies: session,
        authMode: session ? 'SESSION_COOKIE' : 'PUBLIC',
      }),
    probe,
    now: Date.now,
  };
}

/** The candidate as the detection pipeline's own record of a source (what verification and the CTA read). */
export function directCandidateMedia(
  candidate: DirectMediaCandidate,
  pageUrl: string,
  extraction: PageMediaExtraction | null,
): DetectedMedia | null {
  const stream = candidate.kind === 'hls' ? 'HLS' : candidate.kind === 'dash' ? 'DASH' : undefined;
  return extractDetectedMedia({
    url: candidate.url,
    pageUrl,
    mimeType:
      candidate.mimeType ??
      (candidate.kind === 'progressive' || candidate.kind === 'split' ? 'video/mp4' : null),
    title: extraction?.title ?? null,
    thumbnailUrl: extraction?.thumbnailUrl ?? null,
    duration: candidate.durationMs != null ? candidate.durationMs / 1000 : null,
    width: candidate.width,
    height: candidate.height,
    bitrate: candidate.bitrate,
    detectionSource: 'page_analysis',
    // The page named it as its video: category is video even when the URL has no extension (the bytes decide).
    videoElementEvidence: true,
    ...(stream ? { streamType: stream, streamProtocol: stream === 'HLS' ? 'hls' : 'dash' } : {}),
    confidenceHint: candidate.evidence === 'declared' || candidate.evidence === 'direct' ? 0.9 : 0.8,
  });
}

function outcomeOfReasons(reasons: string[]): { outcome: Exclude<DirectAnalysisStatus, 'SUPPORTED' | 'STALE'>; reason: string } {
  const typed = reasons.map((reason) => ({ reason, outcome: pipelineRejectionFor(reason) }));
  const pick = (outcome: string) => typed.find((t) => t.outcome === outcome);
  const protectedHit = pick('PROTECTED');
  if (protectedHit) return { outcome: 'PROTECTED', reason: protectedHit.reason };
  const live = pick('LIVE_UNSUPPORTED');
  if (live) return { outcome: 'LIVE_UNSUPPORTED', reason: live.reason };
  const transient = pick('TRANSIENT_FAILURE');
  if (transient) return { outcome: 'TRANSIENT_FAILURE', reason: transient.reason };
  const unsupported =
    pick('UNSUPPORTED') ?? pick('VIDEO_TRACK_MISSING') ?? pick('AUDIO_TRACK_MISSING');
  if (unsupported) return { outcome: 'UNSUPPORTED', reason: unsupported.reason };
  const invalid = pick('INVALID_MEDIA');
  if (invalid) return { outcome: 'INVALID_MEDIA', reason: invalid.reason };
  return { outcome: 'UNRESOLVED', reason: typed[0]?.reason ?? 'NO_VERIFIED_SOURCE' };
}

function preferredVariant(variants: VerifiedGeneralMediaVariant[]): VerifiedGeneralMediaVariant {
  const labelRank = (label: string | null) => (label === 'HD' ? 1 : label === 'SD' ? -1 : 0);
  return [...variants].sort(
    (a, b) =>
      (b.height ?? 0) - (a.height ?? 0) ||
      labelRank(b.qualityLabel) - labelRank(a.qualityLabel) ||
      (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0),
  )[0]!;
}

async function runLimited<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await run(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Whether a split pair is a better picture than the whole files: by height when theirs are known, else only when it is
 * clearly bigger (a whole file's dimensions are often unknown before download; the same picture as two files would
 * only add a merge).
 */
export function isBetterSplit(
  splitHeight: number,
  splitBytes: number | null,
  wholes: readonly Pick<VerifiedGeneralMediaVariant, 'height' | 'sizeBytes'>[],
): boolean {
  const knownHeight = Math.max(0, ...wholes.map((v) => v.height ?? 0));
  if (knownHeight > 0) {
    return splitHeight > knownHeight;
  }
  const biggest = Math.max(0, ...wholes.map((v) => v.sizeBytes ?? 0));
  if (biggest > 0 && splitBytes != null && splitBytes > 0) {
    return splitBytes > biggest * 1.25;
  }
  return splitHeight >= 1080;
}

type GeneralHit = { variant: VerifiedGeneralMediaVariant; candidate: DirectMediaCandidate };
type SplitHit = { pair: SplitPair; candidate: DirectMediaCandidate; context: MediaRequestContext };

/** One offer from what verified: the whole files (best first), plus a better split pair when the page has one. */
async function buildOffer(
  general: GeneralHit[],
  splits: SplitHit[],
  input: { pageUrl: string; extraction: PageMediaExtraction | null; mediaIdentity: string },
  deps: DirectVerifierDeps,
): Promise<Extract<DirectVerification<DirectOffer>, { ok: true }> | null> {
  const { pageUrl, extraction } = input;
  const variants: VerifiedGeneralMediaVariant[] = [];
  const seen = new Set<string>();
  for (const { variant } of general) {
    if (!seen.has(variant.resourceIdentity)) {
      seen.add(variant.resourceIdentity);
      variants.push(variant);
    }
  }
  const bestSplit = [...splits].sort((a, b) => (b.pair.probe.variants[0]?.height ?? 0) - (a.pair.probe.variants[0]?.height ?? 0))[0];
  const platform = derivePlatform(pageUrl);
  const title = extraction?.title ?? null;
  const thumbnailUrl = extraction?.thumbnailUrl ?? null;

  if (variants.length === 0) {
    if (!bestSplit) {
      return null;
    }
    const media = directCandidateMedia(bestSplit.candidate, pageUrl, extraction);
    if (!media) {
      return null;
    }
    return {
      ok: true,
      sourceKind: 'split',
      variantCount: 1,
      offer: {
        analysis: splitPairAnalysis(bestSplit.pair, { title, thumbnailUrl, platform }),
        media,
        requestContext: bestSplit.context,
        mediaUrl: bestSplit.pair.videoUrl,
        variantIdentity: `split:${bestSplit.pair.videoUrl.split('?')[0]}`,
      },
    };
  }

  const preferred = preferredVariant(variants);
  const preferredCandidate = general.find((g) => g.variant === preferred)?.candidate ?? general[0]!.candidate;
  const seed = directCandidateMedia(preferredCandidate, pageUrl, extraction);
  if (!seed) {
    return null;
  }
  let analysis = generalOfferToAnalysis(
    {
      mediaIdentity: input.mediaIdentity,
      tabId: '',
      navigationEpoch: 0,
      pageGeneration: 0,
      variants,
      preferredVariantId: preferred.variantId,
      verifiedAt: deps.now(),
    },
    preferred,
    seed,
  );
  analysis = { ...analysis, platform, title: title ?? analysis.title, thumbnailUrl: thumbnailUrl ?? analysis.thumbnailUrl };

  // A better picture the page offers only as separate video + audio files: listed beside the whole files.
  const splitHeight = bestSplit?.pair.probe.variants[0]?.height ?? 0;
  const transports = new Set<'progressive' | 'hls' | 'dash' | 'split'>(
    variants.map((v) => (v.transport === 'hls' ? 'hls' : v.transport === 'dash' ? 'dash' : 'progressive')),
  );
  if (bestSplit && isBetterSplit(splitHeight, bestSplit.pair.probe.sizeBytes, variants)) {
    const probeVariant = bestSplit.pair.probe.variants[0];
    const splitVariant = createVariant({
      sourceUrl: bestSplit.pair.videoUrl,
      audioSourceUrl: bestSplit.pair.audioUrl,
      streamType: 'PROGRESSIVE',
      container: 'mp4',
      mimeType: 'video/mp4',
      width: probeVariant?.width ?? null,
      height: probeVariant?.height ?? null,
      estimatedFileSize: bestSplit.pair.probe.sizeBytes,
      downloadable: true,
      unsupportedReason: null,
      originalIndex: analysis.variants?.length ?? 0,
    });
    analysis = applyPrimarySummary({ ...analysis, variants: [] }, [...(analysis.variants ?? []), splitVariant]);
    transports.add('split');
  }

  return {
    ok: true,
    sourceKind: transports.size > 1 ? 'mixed' : ([...transports][0] as 'progressive' | 'hls' | 'dash' | 'split'),
    variantCount: analysis.variants?.length ?? 0,
    offer: {
      analysis,
      media: seed,
      requestContext: preferred.requestContext ?? (await deps.buildContext({ mediaUrl: preferred.executableUrl, pageUrl, session: false })),
      mediaUrl: preferred.executableUrl,
      variantIdentity: preferred.resourceIdentity,
    },
  };
}

export async function verifyDirectCandidates(
  input: {
    candidates: DirectMediaCandidate[];
    pageUrl: string;
    extraction: PageMediaExtraction | null;
    signal: AbortSignal;
    /** The content identity the offer is published under (verification cache and resource identities). */
    mediaIdentity: string;
    /**
     * Called once when the whole files are verified while a split pair is still being proven: that offer can be shown
     * at once; the final result may add the split pair's better quality to it.
     */
    onEarlyOffer?: (verification: Extract<DirectVerification<DirectOffer>, { ok: true }>) => void;
  },
  deps: DirectVerifierDeps,
): Promise<DirectVerification<DirectOffer>> {
  const { pageUrl, extraction, signal } = input;
  // Whole files and manifests first; a split pair (two files and a merge) after them.
  const wholes = input.candidates.filter((c) => c.kind !== 'split').slice(0, MAX_VERIFIED_CANDIDATES);
  const pairs = input.candidates.filter((c) => c.kind === 'split').slice(0, Math.max(1, MAX_VERIFIED_CANDIDATES - wholes.length));

  const reasons: string[] = [];
  const general: GeneralHit[] = [];
  const splits: SplitHit[] = [];

  await runLimited(wholes, CONCURRENCY, async (candidate) => {
    if (signal.aborted) {
      return;
    }
    const media = directCandidateMedia(candidate, pageUrl, extraction);
    if (!media) {
      reasons.push('NOT_MEDIA');
      return;
    }
    const verifyWith = async (session: boolean) => {
      const requestContext = await deps.buildContext({ mediaUrl: candidate.url, pageUrl, session });
      return deps.verifyCandidate(
        { ...media, requiresCookies: session },
        { pageUrl, requestContext, mediaIdentity: input.mediaIdentity, sourceGeneration: 0, signal },
      );
    };
    let result = await verifyWith(false);
    // A link the page signed for the browsing session answers only that session.
    if (!result.ok && !signal.aborted && isAuthLikeFailure({ rejectionReason: result.reason })) {
      result = await verifyWith(true);
    }
    if (!result.ok) {
      reasons.push(result.reason);
      return;
    }
    for (const variant of result.variants) {
      if (variant.downloadable) {
        general.push({ variant, candidate });
      }
    }
  });

  if (signal.aborted) {
    return { ok: false, outcome: 'UNRESOLVED', reason: 'ABORTED' };
  }
  if (pairs.length > 0 && general.length > 0 && input.onEarlyOffer) {
    const early = await buildOffer(general, [], input, deps);
    if (early && !signal.aborted) {
      input.onEarlyOffer(early);
    }
  }

  await runLimited(pairs, CONCURRENCY, async (candidate) => {
    if (signal.aborted) {
      return;
    }
    if (!deps.probe || !candidate.audioUrl) {
      reasons.push(deps.probe ? 'SPLIT_FILES_UNKNOWN' : 'ENGINE_UNAVAILABLE');
      return;
    }
    const probe = deps.probe;
    const attempt = async (session: boolean) => {
      const context = await deps.buildContext({ mediaUrl: candidate.url, pageUrl, session });
      const resolved = await resolveSplitPair({
        evidence: { source: 'buffers', videoUrl: candidate.url, audioUrl: candidate.audioUrl, candidateUrls: [], durationMs: candidate.durationMs },
        probe,
        request: toV2RequestContext(context, pageUrl),
        signal,
      });
      return { resolved, context };
    };
    let { resolved, context } = await attempt(false);
    if (!resolved.ok && (resolved.failure.reason === 'HTTP_403' || resolved.failure.reason === 'HTTP_404') && !signal.aborted) {
      ({ resolved, context } = await attempt(true));
    }
    if (resolved.ok) {
      splits.push({ pair: resolved.pair, candidate, context });
    } else {
      reasons.push(resolved.failure.reason);
    }
  });

  if (signal.aborted) {
    return { ok: false, outcome: 'UNRESOLVED', reason: 'ABORTED' };
  }
  const offer = await buildOffer(general, splits, input, deps);
  return offer ?? { ok: false, ...outcomeOfReasons(reasons.length > 0 ? reasons : ['NOT_MEDIA']) };
}
