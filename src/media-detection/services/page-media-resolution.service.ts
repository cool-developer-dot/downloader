import type { MediaAnalysisResult } from '@/api/types';
import { buildAnalysisFromVerification } from '@/downloads/analyze/analyze-from-verification';

import type { DetectedMedia } from '../types';
import { isSameDocumentUrl } from '../utils';
import { getMsePlaybackContext } from '../engine/mse-playback-context';
import { describePlatformPage } from '../platform';
import { useMediaDetectionStore } from '../stores';
import { verifyMediaCandidate } from './candidate-verifier.service';
import {
  filterCorrelatedCandidates,
  pickBestCorrelatedMedia,
} from './media-correlation.service';
import { logPasteMediaDiagnostic } from './paste-media-diagnostics.service';
import {
  logPageFlow,
  safePageHostname,
} from './page-flow-diagnostics.service';
import {
  pendingMediaResolutionService,
  type PendingMediaResolution,
} from './pending-media-resolution.service';
import {
  platformResolutionStatusCopy,
  requiresPageMediaResolution,
  resolvePastePlatformKind,
} from './platform-page-url';
import { resolvePageUrl } from './page-url.resolver';
import { buildRequestContextFromDetectedMedia } from './request-context.service';
import type { MediaRequestContext } from '@/downloads/types/request-context';

export const PAGE_RESOLUTION_TIMING = {
  /** First wait for passive detection before playback hint. */
  waitForMediaMs: 8_000,
  /** Additional wait after playback hint before timeout. */
  playbackWaitMs: 30_000,
  /** Faster playback hint for Tier-1 social platforms. */
  earlyPlaybackHintMs: 4_000,
  pollIntervalMs: 300,
} as const;

export { classifyPasteInput, requiresPageMediaResolution } from './platform-page-url';

export type PageResolutionStartResult = {
  kind: 'page';
  originalUrl: string;
  canonicalUrl: string;
  platform: ReturnType<typeof resolvePastePlatformKind>;
  statusMessage: string;
};

export type PageResolutionCandidateResult = {
  ok: true;
  media: DetectedMedia;
  mediaUrl: string;
  requestContext: MediaRequestContext;
  analysis: MediaAnalysisResult;
} | {
  ok: false;
  reason: string;
};

/**
 * Resolve canonical page URL and register a pending resolution session.
 * Does NOT treat the page URL as downloadable media.
 */
export async function startPageMediaResolution(
  originalUrl: string,
  signal?: AbortSignal,
): Promise<PageResolutionStartResult> {
  const trimmed = originalUrl.trim();
  const platform = resolvePastePlatformKind(trimmed);

  logPasteMediaDiagnostic('input', { hostname: safeHostname(trimmed) });
  logPageFlow('input', { hostname: safePageHostname(trimmed) });
  logPasteMediaDiagnostic('platform', { platform });
  logPageFlow('classified', { platform, kind: 'page' });

  const resolved = await resolvePageUrl(trimmed, { signal });
  const canonicalUrl = resolved.ok ? resolved.resolvedPageUrl : trimmed;

  logPasteMediaDiagnostic('canonical', {
    hostname: safeHostname(canonicalUrl),
    redirectCount: resolved.redirectChain.length - 1,
    ok: resolved.ok,
  });
  logPageFlow('canonical', {
    hostname: safePageHostname(canonicalUrl),
    ok: resolved.ok,
  });

  const session = pendingMediaResolutionService.start({
    originalUrl: trimmed,
    canonicalUrl,
    platform,
  });

  logPasteMediaDiagnostic('resolver_started', {
    platform,
    hostname: safeHostname(canonicalUrl),
  });
  logPageFlow('session_created', {
    sessionId: session.id,
    platform,
    hostname: safePageHostname(canonicalUrl),
  });

  return {
    kind: 'page',
    originalUrl: trimmed,
    canonicalUrl,
    platform,
    statusMessage: platformResolutionStatusCopy(platform, 'loading'),
  };
}

/**
 * Attempt to complete pending resolution from the live detection store.
 */
export async function tryCompletePageResolutionFromStore(
  session: PendingMediaResolution,
  signal?: AbortSignal,
): Promise<PageResolutionCandidateResult | null> {
  const pageUrl = session.canonicalUrl;
  if (!pageUrl) {
    return null;
  }

  const store = useMediaDetectionStore.getState();
  const currentBrowserUrl = store.lastNavigation;
  if (
    currentBrowserUrl &&
    !isSameDocumentUrl(currentBrowserUrl, pageUrl) &&
    !isSameDocumentUrl(currentBrowserUrl, session.originalUrl)
  ) {
    return null;
  }

  const mse = getMsePlaybackContext(pageUrl);
  const candidates = store.detectedMedia.filter(
    (media) =>
      media.pageUrl &&
      (isSameDocumentUrl(media.pageUrl, pageUrl) ||
        isSameDocumentUrl(media.pageUrl, session.originalUrl)) &&
      !media.url.startsWith('blob:'),
  );

  if (!candidates.length) {
    return null;
  }

  const correlated = filterCorrelatedCandidates(candidates, {
    pageUrl,
    msePlaybackActive: mse.msePlaybackActive,
    msePlaybackAgeMs: mse.msePlaybackAgeMs,
  });
  const best = pickBestCorrelatedMedia(correlated, {
    pageUrl,
    msePlaybackActive: mse.msePlaybackActive,
    msePlaybackAgeMs: mse.msePlaybackAgeMs,
  });

  if (!best) {
    logPasteMediaDiagnostic('candidate', {
      platform: session.platform,
      reject: true,
      reason: 'low_correlation',
    });
    return null;
  }

  logPasteMediaDiagnostic('candidate', {
    hostname: safeHostname(best.url),
    platform: session.platform,
    streamType: best.streamType,
    mimeType: best.mimeType,
    confidence: best.confidence,
  });

  return completePageResolutionWithMedia(session, best, signal);
}

export async function completePageResolutionWithMedia(
  session: PendingMediaResolution,
  media: DetectedMedia,
  signal?: AbortSignal,
): Promise<PageResolutionCandidateResult> {
  const mediaUrl = media.finalUrl?.trim() || media.url?.trim() || '';
  const pageUrl = session.canonicalUrl ?? media.pageUrl ?? session.originalUrl;

  const requestContext = await buildRequestContextFromDetectedMedia({
    mediaUrl,
    pageUrl,
    requiresCookies: media.requiresCookies,
    requiredHeaders: media.requiredHeaders,
  });

  const verification = await verifyMediaCandidate(mediaUrl, {
    requestContext,
    signal,
  });

  if (!verification.ok) {
    logPasteMediaDiagnostic('failure', {
      platform: session.platform,
      reason: verification.rejectionReason,
      stage: 'verify',
    });
    return {
      ok: false,
      reason: verification.rejectionReason ?? 'verification_failed',
    };
  }

  logPasteMediaDiagnostic('verified', {
    hostname: safeHostname(verification.finalUrl),
    mimeType: verification.mimeType,
    platform: session.platform,
    hasReferer: Boolean(requestContext.referer),
    hasCookies: requestContext.hasCookies,
    hasUserAgent: Boolean(requestContext.userAgent),
  });

  const analysis = buildAnalysisFromVerification(verification, media, pageUrl);

  const variants = analysis.variants ?? [];
  const hasDownloadable =
    analysis.downloadable || variants.some((variant) => variant.downloadable);
  if (!hasDownloadable) {
    logPasteMediaDiagnostic('failure', {
      platform: session.platform,
      reason: analysis.unsupportedReason ?? 'no_media',
      stage: 'analyze',
    });
    return {
      ok: false,
      reason: analysis.unsupportedReason ?? 'no_media',
    };
  }

  pendingMediaResolutionService.markVerified();

  logPasteMediaDiagnostic('download_handoff', {
    platform: session.platform,
    streamType: variants[0]?.streamType ?? null,
    mimeType: analysis.mimeType,
  });

  return {
    ok: true,
    media,
    mediaUrl: verification.finalUrl,
    requestContext,
    analysis,
  };
}

export function describePendingResolutionMessage(
  session: PendingMediaResolution | null,
): string | null {
  if (!session) {
    return null;
  }

  switch (session.status) {
    case 'resolving_redirect':
      return platformResolutionStatusCopy(session.platform, 'resolving');
    case 'loading_page':
      return platformResolutionStatusCopy(session.platform, 'loading');
    case 'waiting_media':
      return platformResolutionStatusCopy(session.platform, 'waiting');
    case 'waiting_playback':
      return platformResolutionStatusCopy(session.platform, 'playback');
    case 'timeout':
      return 'No video detected yet. Play the video in the browser, then try again.';
    case 'failed':
      return session.failureReason ?? 'Could not resolve media from this page.';
    default:
      return null;
  }
}

export function isSocialPlatform(session: PendingMediaResolution | null): boolean {
  return session?.platform === 'tiktok' || session?.platform === 'instagram';
}

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export { describePlatformPage };
