/**
 * One account of what happened to every media source between the WebView and the downloader.
 *
 *   WebView → network observer → detector → correlation → resolver → classifier → capability gate → offer → enqueue
 *
 * Each stage already has its own reason codes (general/social correlation, source verification, the native
 * classifier's refusals, the MSE classifier, hand-off errors, the engine's download failures). This module folds
 * them into the product's typed outcomes, so a source that plays but never becomes a library file always ends with
 * one of them:
 *
 * - STALE: not the current video of the current page — another tab, page or generation, a previous or preloaded
 *   item, an ad, a hidden or thumbnail player, a link that expired, or two tracks that are not one video's.
 * - PROTECTED: DRM, encrypted HLS/DASH/MP4, an EME player.
 * - LIVE_UNSUPPORTED: a live stream — there is no whole video to save.
 * - UNSUPPORTED: a real video outside what VidoraX saves — audio only, multi-period DASH, isolated segments, a
 *   container the engine refuses.
 * - SOURCE_UNRESOLVED: no real source could be tied to the current video (blob/MSE without one, ownership not proven,
 *   a split player whose two files are not known exactly).
 * - VIDEO_TRACK_MISSING / AUDIO_TRACK_MISSING: a split source's video file has no picture / audio file no sound.
 * - SEGMENT_FAILED: an HLS/DASH segment the server would not serve.
 * - MUX_FAILED / TRANSCODE_FAILED: merging / converting the downloaded tracks failed.
 * - TRANSIENT_FAILURE: a temporary network, server or session answer — asking again may succeed.
 * - INVALID_MEDIA: not a video at all (HTML, JSON, images, a malformed manifest, an unsafe URL), or a processed file
 *   that did not read back as the video.
 * - DUPLICATE (not a rejection): the user already has this video.
 *
 * Entries are bounded, hold hostnames and hashes only (never URLs, tokens or cookies), and are logged in debug
 * builds as `[VidoraPipeline]` so one grep reconstructs a page's pipeline on a device.
 */

import { hashHandoffIdentity } from '../services/automatic-handoff-diagnostics';
import { stableResourcePath } from '../social-source/resource-identity';

export type PipelineRejection =
  | 'STALE'
  | 'PROTECTED'
  | 'LIVE_UNSUPPORTED'
  | 'UNSUPPORTED'
  | 'SOURCE_UNRESOLVED'
  | 'VIDEO_TRACK_MISSING'
  | 'AUDIO_TRACK_MISSING'
  | 'SEGMENT_FAILED'
  | 'MUX_FAILED'
  | 'TRANSCODE_FAILED'
  | 'TRANSIENT_FAILURE'
  | 'INVALID_MEDIA';

/**
 * OBSERVED / OFFERED / ENQUEUED are progress; DUPLICATE ends the pipeline without a new download because the user
 * already has the video (reason ALREADY_DOWNLOADING / ALREADY_DOWNLOADED); every other outcome is a final rejection.
 */
export type PipelineOutcome = 'OBSERVED' | 'OFFERED' | 'ENQUEUED' | 'DUPLICATE' | PipelineRejection;

export type PipelineStage =
  | 'webview'
  | 'network'
  | 'detector'
  | 'correlation'
  | 'resolver'
  | 'classifier'
  | 'capability'
  | 'offer'
  | 'enqueue';

export type PipelineOutcomeEntry = {
  at: number;
  tabId: string | null;
  /** Hostname of the page (never the URL). */
  pageHost: string | null;
  pageHash: string | null;
  mediaHost: string | null;
  mediaHash: string | null;
  stage: PipelineStage;
  outcome: PipelineOutcome;
  /** The stage's own reason code, e.g. `VIDEO_ONLY_UNSUPPORTED`. */
  reason: string | null;
};

const PROTECTED_REASONS = new Set([
  'DRM_UNSUPPORTED',
  'DRM_PROTECTED',
  'PROTECTED_UNSUPPORTED',
  'UNSUPPORTED_DRM',
  'ENCRYPTED_HLS',
  'HLS_ENCRYPTED',
  'UNSUPPORTED_HLS_ENCRYPTION',
]);

const UNSUPPORTED_REASONS = new Set([
  'DASH_UNSUPPORTED',
  'VIDEO_ONLY_UNSUPPORTED',
  'UNSUPPORTED_TRANSPORT',
  'UNSUPPORTED_FORMAT',
  'UNSUPPORTED_RESOURCE',
  'MSE_UNSUPPORTED',
  'SEGMENT_RESOURCE',
  'INIT_SEGMENT',
  'MEDIA_FRAGMENT',
  'POLICY_BLOCKED',
  'NON_VIDEO',
  'AUDIO_ONLY',
]);

const STALE_REASONS = new Set([
  'STALE_CONTEXT',
  'STALE_NAVIGATION',
  'STALE_PAGE_GENERATION',
  'STALE_SOURCE_GENERATION',
  'STALE_SOCIAL_CONTEXT',
  'STALE_GENERATION',
  'STALE_TAB',
  'STALE_RESULT',
  'STALE_OFFER',
  'WRONG_TAB',
  'CLOSED_TAB',
  'SOURCE_EXPIRED',
  'EXPIRED_SOURCE',
  'HTTP_404',
  'HIDDEN_VIDEO',
  'OFFSCREEN_PRELOAD',
  'TINY_PREVIEW',
  'ADVERTISEMENT',
  'NEIGHBOR_CONTENT',
  'OTHER_CONTENT',
  'FOREIGN_FRAME_MEDIA',
  'OUTSIDE_CURRENT_PLAYER',
  'page_mismatch',
  'departed_document',
  'deferred_expired',
  'TRACK_MISMATCH',
  'SPLIT_LENGTH_NOT_ELEMENT',
]);

const LIVE_REASONS = new Set(['LIVE_UNSUPPORTED', 'LIVE_HLS_UNSUPPORTED']);

/** Engine download failures and split-track verdicts that are their own outcome. */
const OWN_OUTCOMES = new Set<PipelineRejection>([
  'VIDEO_TRACK_MISSING',
  'AUDIO_TRACK_MISSING',
  'SEGMENT_FAILED',
  'MUX_FAILED',
  'TRANSCODE_FAILED',
  'INVALID_MEDIA',
]);

const UNRESOLVED_REASONS = new Set([
  'WEAK_OWNERSHIP',
  'WEAK_UNCORRELATED_MEDIA',
  'LOW_CORRELATION',
  'UNPROVEN_FRAME_OWNERSHIP',
  'NO_FRESH_SOURCE',
  'NO_SUPPORTED_SOURCE',
  'PLATFORM_UNOBSERVABLE',
  'BLOB_ONLY',
  'UNSUPPORTED_SCHEME',
  'MSE_AWAITING_SOURCE',
  'MSE_SEGMENTS_OBSERVED',
  'NO_CURRENT_OWNER',
  'AMBIGUOUS_WORKER_OWNER',
  'MSE_SPLIT_TRACKS_PENDING',
  'SPLIT_AMBIGUOUS',
  'SPLIT_FILES_UNKNOWN',
  'SOURCE_UNRESOLVED',
]);

const TRANSIENT_REASONS = new Set([
  'PROBE_FAILED',
  'PROBE_TIMEOUT',
  'NETWORK',
  'NETWORK_ERROR',
  'NETWORK_TIMEOUT',
  'HTTP_ERROR',
  'HTTP_403',
  'AUTH_RESPONSE',
  'AUTH_REQUIRED',
  'SESSION_EXPIRED',
  'SESSION_CONTEXT_INVALID',
  'SESSION_CONTEXT_LOST',
  'AUTH_CONTEXT_UNAVAILABLE',
  'ENQUEUE_FAILED',
  'ENGINE_UNAVAILABLE',
]);

const INVALID_REASONS = new Set([
  'HTML_RESPONSE',
  'JSON_RESPONSE',
  'NOT_MEDIA',
  'MANIFEST_INVALID',
  'PROCESSING_FAILED',
  'IMAGE_RESOURCE',
  'POSTER_ONLY',
  'THUMBNAIL_RESOURCE',
  'unsafe_or_missing_url',
  'url_normalize_failed',
  'parser_rejected',
  'non_media',
]);

/**
 * The product outcome for a stage's reason code. Unknown codes are matched by what they name; a code that names
 * nothing recognisable is UNRESOLVED — "not proven", never a claim that the video cannot be downloaded.
 */
export function pipelineRejectionFor(reason: string | null | undefined): PipelineRejection {
  const code = (reason ?? '').trim();
  if (!code) {
    return 'SOURCE_UNRESOLVED';
  }
  if (OWN_OUTCOMES.has(code as PipelineRejection)) return code as PipelineRejection;
  if (PROTECTED_REASONS.has(code)) return 'PROTECTED';
  if (LIVE_REASONS.has(code)) return 'LIVE_UNSUPPORTED';
  if (UNSUPPORTED_REASONS.has(code)) return 'UNSUPPORTED';
  if (STALE_REASONS.has(code)) return 'STALE';
  if (UNRESOLVED_REASONS.has(code)) return 'SOURCE_UNRESOLVED';
  if (TRANSIENT_REASONS.has(code)) return 'TRANSIENT_FAILURE';
  if (INVALID_REASONS.has(code)) return 'INVALID_MEDIA';
  const upper = code.toUpperCase();
  if (/DRM|PROTECT|ENCRYPT|CENC|WIDEVINE|PLAYREADY|FAIRPLAY|AES/.test(upper)) return 'PROTECTED';
  if (/STALE|EXPIRED|WRONG_TAB|PRELOAD|HIDDEN|ADVERT|MISMATCH/.test(upper)) return 'STALE';
  if (/LIVE/.test(upper)) return 'LIVE_UNSUPPORTED';
  if (/UNSUPPORTED|AUDIO|SEGMENT|FRAGMENT/.test(upper)) return 'UNSUPPORTED';
  if (/NETWORK|TIMEOUT|HTTP_5|PROBE_FAIL|SESSION|AUTH|TRANSIENT/.test(upper)) return 'TRANSIENT_FAILURE';
  if (/HTML|JSON|NOT_MEDIA|INVALID|IMAGE|POSTER/.test(upper)) return 'INVALID_MEDIA';
  return 'SOURCE_UNRESOLVED';
}

/**
 * The typed outcome of a download the engine accepted and then failed (its `DownloadErrorCode`). Storage problems and
 * unknown failures are transient from the pipeline's point of view: nothing about the source was proven.
 */
export function pipelineOutcomeForDownloadError(code: string | null | undefined): PipelineOutcome {
  switch (code) {
    case 'DRM_PROTECTED':
      return 'PROTECTED';
    case 'LIVE_UNSUPPORTED':
      return 'LIVE_UNSUPPORTED';
    case 'UNSUPPORTED_FORMAT':
      return 'UNSUPPORTED';
    case 'HTTP_403':
    case 'HTTP_404':
    case 'SOURCE_EXPIRED':
      return 'SOURCE_UNRESOLVED';
    case 'TRACK_MISMATCH':
      return 'STALE';
    case 'VIDEO_TRACK_MISSING':
    case 'AUDIO_TRACK_MISSING':
    case 'SEGMENT_FAILED':
    case 'MUX_FAILED':
    case 'TRANSCODE_FAILED':
    case 'INVALID_MEDIA':
      return code;
    case 'NOT_MEDIA':
    case 'PROCESSING_FAILED':
      return 'INVALID_MEDIA';
    case 'DUPLICATE':
      return 'DUPLICATE';
    default:
      return 'TRANSIENT_FAILURE';
  }
}

export function isPipelineRejection(outcome: PipelineOutcome): outcome is PipelineRejection {
  return outcome !== 'OBSERVED' && outcome !== 'OFFERED' && outcome !== 'ENQUEUED' && outcome !== 'DUPLICATE';
}

/** Debug builds, or a build made with EXPO_PUBLIC_VIDORAX_PIPELINE_TRACE=1 (inlined at bundle time). */
const TRACE_ENABLED =
  (typeof __DEV__ !== 'undefined' && __DEV__) || process.env.EXPO_PUBLIC_VIDORAX_PIPELINE_TRACE === '1';

const BYTE_RANGE_PARAMS = new Set(['bytestart', 'byteend', 'range', 'rn', 'rbuf']);
const MAX_ENTRIES = 200;
/** The same account repeated within this window is one entry (re-renders re-run selection). */
const REPEAT_WINDOW_MS = 5_000;
const MAX_RECENT_KEYS = 256;
const entries: PipelineOutcomeEntry[] = [];
const recentKeys = new Map<string, number>();
const listeners = new Set<(entry: PipelineOutcomeEntry) => void>();

function hostOf(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  try {
    return new URL(url).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/** The `mediaHash` a trace line gives a media URL (byte-range and signature churn ignored). */
export function pipelineMediaHash(url: string | null | undefined): string | null {
  return hashOf(url);
}

/** Trace builds only: the active tab's CTA offer, whenever it changes (which media the "Video available" names). */
export function traceOfferState(fields: { tabId: string | null; status: string; mediaUrl: string | null }): void {
  if (!TRACE_ENABLED) {
    return;
  }
  const line = JSON.stringify({
    tabId: fields.tabId,
    status: fields.status,
    mediaHash: hashOf(fields.mediaUrl),
    // The file name's first characters: the same file served by another CDN edge hashes differently.
    file: fields.mediaUrl ? (fields.mediaUrl.split('?')[0]!.split('/').pop() ?? '').slice(0, 12) : null,
  });
  if (line === lastOfferTrace) {
    return;
  }
  lastOfferTrace = line;
  console.log('[VidoraOffer]', line);
}
let lastOfferTrace: string | null = null;

/**
 * Trace builds only: what the active tab's media-action area shows (the Download button and its file, or a status),
 * next to the page's live video, whenever either changes — the "is the offer the video on screen" check.
 */
export function traceCtaPresentation(fields: {
  shown: boolean;
  notice: string | null;
  mediaUrl: string | null;
  offerIdentity: string | null;
  liveIdentity: string | null;
  liveHidden?: boolean;
  /** The tab's action status (verified / consumed / …). */
  status?: string | null;
}): void {
  if (!TRACE_ENABLED) {
    return;
  }
  const idOf = (identity: string | null) =>
    identity?.startsWith('video:') ? identity.slice('video:'.length, 'video:'.length + 32) : hashHandoffIdentity(identity);
  const line = JSON.stringify({
    shown: fields.shown,
    notice: fields.notice,
    file: fields.shown && fields.mediaUrl ? (fields.mediaUrl.split('?')[0]!.split('/').pop() ?? '').slice(0, 12) : null,
    offer: fields.shown ? idOf(fields.offerIdentity) : null,
    live: idOf(fields.liveIdentity),
    hidden: Boolean(fields.liveHidden),
    status: fields.status ?? null,
    state: fields.shown ? null : idOf(fields.offerIdentity),
  });
  if (line === lastCtaTrace) {
    return;
  }
  lastCtaTrace = line;
  console.log('[VidoraCta]', line);
}
let lastCtaTrace: string | null = null;

function hashOf(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  // Resource identity: a rotated signature or another byte range is the same source, a different content query is
  // not.
  let identity: string | null = null;
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (BYTE_RANGE_PARAMS.has(key.toLowerCase())) {
        parsed.searchParams.delete(key);
      }
    }
    identity = stableResourcePath(parsed.toString());
  } catch {
    identity = null;
  }
  return hashHandoffIdentity(identity ?? url.split('#')[0]!.split('?')[0]!);
}

/**
 * Record what a stage decided about a source. `outcome` may be given directly or derived from `reason` by passing
 * `outcome: 'REJECTED'`.
 */
export function recordPipelineOutcome(input: {
  tabId: string | null;
  pageUrl: string | null;
  mediaUrl: string | null;
  stage: PipelineStage;
  outcome: PipelineOutcome | 'REJECTED';
  reason?: string | null;
}): PipelineOutcomeEntry {
  const outcome = input.outcome === 'REJECTED' ? pipelineRejectionFor(input.reason) : input.outcome;
  const entry: PipelineOutcomeEntry = {
    at: Date.now(),
    tabId: input.tabId,
    pageHost: hostOf(input.pageUrl),
    pageHash: hashOf(input.pageUrl),
    mediaHost: hostOf(input.mediaUrl),
    mediaHash: hashOf(input.mediaUrl),
    stage: input.stage,
    outcome,
    reason: input.reason?.slice(0, 64) ?? null,
  };
  const key = `${entry.tabId}|${entry.pageHash}|${entry.mediaHash}|${entry.stage}|${entry.outcome}|${entry.reason}`;
  const seenAt = recentKeys.get(key);
  if (seenAt != null && entry.at - seenAt < REPEAT_WINDOW_MS) {
    return entry;
  }
  recentKeys.delete(key);
  recentKeys.set(key, entry.at);
  while (recentKeys.size > MAX_RECENT_KEYS) {
    const oldest = recentKeys.keys().next().value;
    if (oldest === undefined) break;
    recentKeys.delete(oldest);
  }
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
  if (TRACE_ENABLED) {
    console.log('[VidoraPipeline]', JSON.stringify(entry));
  }
  for (const listener of listeners) {
    try {
      listener(entry);
    } catch {
      // A diagnostics listener never breaks the pipeline.
    }
  }
  return entry;
}

/** Newest last. */
export function getPipelineOutcomes(tabId?: string | null): readonly PipelineOutcomeEntry[] {
  return tabId == null ? entries.slice() : entries.filter((entry) => entry.tabId === tabId);
}

export function subscribePipelineOutcomes(listener: (entry: PipelineOutcomeEntry) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clearPipelineOutcomesForTests(): void {
  entries.length = 0;
  recentKeys.clear();
  listeners.clear();
}
