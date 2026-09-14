import { CONFIDENCE } from '../constants';
import type { DetectedMedia, MediaCandidate } from '../types';
import { isSafeMediaUrl, normalizeMediaUrl } from '../utils';

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

export function validateCandidateUrl(
  url: string | null | undefined,
): ValidationResult<string> {
  if (!url) {
    return { ok: false, reason: 'missing_url' };
  }

  const normalized = normalizeMediaUrl(url);
  if (!normalized || !isSafeMediaUrl(normalized)) {
    return { ok: false, reason: 'unsafe_or_malformed_url' };
  }

  return { ok: true, value: normalized };
}

export function validateMediaCandidate(
  candidate: MediaCandidate,
): ValidationResult<MediaCandidate> {
  const urlResult = validateCandidateUrl(candidate.url);
  if (!urlResult.ok) {
    return urlResult;
  }

  const pageResult = validateCandidateUrl(candidate.pageUrl);
  if (!pageResult.ok) {
    return { ok: false, reason: 'unsafe_page_url' };
  }

  if (
    candidate.confidenceHint != null &&
    (candidate.confidenceHint < 0 || candidate.confidenceHint > 1)
  ) {
    return { ok: false, reason: 'invalid_confidence' };
  }

  return {
    ok: true,
    value: {
      ...candidate,
      url: urlResult.value,
      pageUrl: pageResult.value,
    },
  };
}

export function isAcceptableConfidence(confidence: number): boolean {
  return confidence >= CONFIDENCE.minAccept;
}

export function validateDetectedMedia(
  media: DetectedMedia,
): ValidationResult<DetectedMedia> {
  const urlResult = validateCandidateUrl(media.url);
  if (!urlResult.ok) {
    return urlResult;
  }

  if (!media.id) {
    return { ok: false, reason: 'missing_id' };
  }

  if (!isAcceptableConfidence(media.confidence)) {
    return { ok: false, reason: 'low_confidence' };
  }

  return { ok: true, value: { ...media, url: urlResult.value } };
}
