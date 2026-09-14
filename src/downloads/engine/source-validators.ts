/**
 * Compact helpers for progressive source validators (ETag / Last-Modified / length).
 */

import type { RangeValidators } from './types';

export function normalizeEtag(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/^W\//i, '').replace(/^"|"$/g, '');
}

export function etagsConflict(
  prior: string | null | undefined,
  next: string | null | undefined,
): boolean {
  const a = normalizeEtag(prior);
  const b = normalizeEtag(next);
  if (!a || !b) {
    return false;
  }
  return a !== b;
}

export function lastModifiedConflict(
  prior: string | null | undefined,
  next: string | null | undefined,
): boolean {
  const a = prior?.trim();
  const b = next?.trim();
  if (!a || !b) {
    return false;
  }
  return a !== b;
}

/**
 * Prefer a larger positive contentLength when merging — never let a Range
 * slice Content-Length (e.g. 1 for bytes=0-0) overwrite a known full size.
 */
export function mergeRangeValidatorsWithLength(
  prior: RangeValidators | null | undefined,
  next: RangeValidators | null | undefined,
): RangeValidators | null {
  const etag = next?.etag?.trim() || prior?.etag?.trim() || null;
  const lastModified =
    next?.lastModified?.trim() || prior?.lastModified?.trim() || null;
  const nextLen =
    typeof next?.contentLength === 'number' &&
    Number.isFinite(next.contentLength) &&
    next.contentLength > 0
      ? Math.trunc(next.contentLength)
      : null;
  const priorLen =
    typeof prior?.contentLength === 'number' &&
    Number.isFinite(prior.contentLength) &&
    prior.contentLength > 0
      ? Math.trunc(prior.contentLength)
      : null;
  const contentLength =
    nextLen != null && priorLen != null
      ? Math.max(nextLen, priorLen)
      : (nextLen ?? priorLen);
  if (!etag && !lastModified && contentLength == null) {
    return null;
  }
  return { etag, lastModified, contentLength };
}
