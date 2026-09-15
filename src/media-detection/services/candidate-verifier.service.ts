import type { MediaRequestContext } from '@/downloads/types/request-context';
import { mergeDownloadHeaders } from '@/downloads/engine/download-headers';
import { isNonMediaDocumentMime } from '@/downloads/analyze/format';

import { probeMediaMime, isVerifiedMediaMime } from './mime-probe.service';
import { isFalsePositive } from './false-positive.filter';
import { logMediaDiagnostic } from './media-diagnostics.service';
import { isSafeMediaUrl } from '../utils';

export type CandidateVerification = {
  ok: boolean;
  finalUrl: string;
  mimeType: string | null;
  contentLength: number | null;
  acceptRanges: boolean;
  status: number | null;
  redirectCount: number;
  confidenceBoost: number;
  rejectionReason: string | null;
  contentDisposition?: string | null;
};

export type VerifyCandidateOptions = {
  referer?: string | null;
  userAgent?: string | null;
  requestContext?: MediaRequestContext | null;
  signal?: AbortSignal;
};

/**
 * Bounded local verification for promising HTTP media candidates.
 */
export async function verifyMediaCandidate(
  url: string,
  options?: VerifyCandidateOptions,
): Promise<CandidateVerification> {
  if (!isSafeMediaUrl(url) || isFalsePositive({ url })) {
    return reject(url, 'unsafe_or_false_positive');
  }

  const referer = options?.requestContext?.referer ?? options?.referer ?? null;
  const userAgent = options?.requestContext?.userAgent ?? options?.userAgent ?? null;

  // One metadata request path; HEAD fallback and redirects preserve the same context.
  const probe = await probeMediaMime(url, options?.signal, {
    referer,
    headers: mergeDownloadHeaders(userAgent ? { 'User-Agent': userAgent } : {}, options?.requestContext),
  });
  const redirect = { finalUrl: probe?.finalUrl ?? url, redirectCount: probe?.finalUrl && probe.finalUrl !== url ? 1 : 0 };

  if (!probe || !probe.ok) {
    logMediaDiagnostic('candidate_rejected', {
      url: redirect.finalUrl,
      reason: 'mime_unverified',
      redirectCount: redirect.redirectCount,
    });
    return reject(redirect.finalUrl, 'mime_unverified', redirect.redirectCount, probe?.status ?? null);
  }

  // Phase 4B: HTTP 200 + HTML/JSON is not media.
  if (isNonMediaDocumentMime(probe.mimeType)) {
    const reason = probe.mimeType?.includes('json')
      ? 'json_response'
      : probe.mimeType?.includes('html')
        ? 'html_response'
        : 'non_media_mime';
    logMediaDiagnostic('candidate_rejected', {
      url: redirect.finalUrl,
      reason,
      mimeType: probe.mimeType,
      redirectCount: redirect.redirectCount,
    });
    return reject(redirect.finalUrl, reason, redirect.redirectCount, probe.status);
  }

  // Accept verified media MIME or generic octet-stream (signature handled upstream for social).
  if (
    probe.mimeType && !isVerifiedMediaMime(probe.mimeType) &&
    probe.mimeType !== 'application/octet-stream'
  ) {
    logMediaDiagnostic('candidate_rejected', {
      url: redirect.finalUrl,
      reason: 'mime_not_media',
      mimeType: probe.mimeType,
      redirectCount: redirect.redirectCount,
    });
    return reject(redirect.finalUrl, 'mime_not_media', redirect.redirectCount, probe.status);
  }

  logMediaDiagnostic('candidate_verified', {
    url: redirect.finalUrl,
    mimeType: probe.mimeType,
    contentLength: probe.contentLength,
    acceptRanges: probe.acceptRanges,
    redirectCount: redirect.redirectCount,
    cookiesRequired: options?.requestContext?.cookiesRequired ?? false,
    hasCookies: options?.requestContext?.hasCookies ?? false,
  });

  return {
    ok: true,
    finalUrl: redirect.finalUrl,
    mimeType: probe.mimeType,
    contentLength: probe.contentLength,
    acceptRanges: probe.acceptRanges,
    status: probe.status,
    redirectCount: redirect.redirectCount,
    confidenceBoost: 0.15,
    rejectionReason: null,
    contentDisposition: probe.contentDisposition,
  };
}

function reject(
  url: string,
  reason: string,
  redirectCount = 0,
  status: number | null = null,
): CandidateVerification {
  return {
    ok: false,
    finalUrl: url,
    mimeType: null,
    contentLength: null,
    acceptRanges: false,
    status,
    redirectCount,
    confidenceBoost: 0,
    rejectionReason: reason,
  };
}
