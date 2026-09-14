import type { MediaRequestContext } from '@/downloads/types/request-context';

import { filterSessionMediaHeaders } from '@/media-detection/session-media/request-header-policy';

/**
 * Builds sanitized download/analyze headers from a media request context.
 * Never logs cookie values. Never auto-includes Authorization.
 */
export function buildDownloadHeaders(
  context?: MediaRequestContext | null,
): Record<string, string> {
  if (!context?.headers) {
    return {};
  }
  return filterSessionMediaHeaders(context.headers, {
    allowAuthorization: false,
  });
}

export function mergeDownloadHeaders(
  base: Record<string, string>,
  context?: MediaRequestContext | null,
): Record<string, string> {
  return { ...base, ...buildDownloadHeaders(context) };
}

/**
 * Merge durable pause headers with a fresh session context.
 * Session Referer/Cookie/User-Agent always win over stale pause metadata.
 */
export function mergeResumeHeaders(
  pauseHeaders: Record<string, string> | null | undefined,
  context?: MediaRequestContext | null,
): Record<string, string> {
  const session = buildDownloadHeaders(context);
  return { ...(pauseHeaders ?? {}), ...session };
}

/**
 * Attach session auth headers to Range requests without clobbering Range/If-Range.
 */
export function mergeRangeRequestHeaders(
  rangeHeaders: Record<string, string>,
  context?: MediaRequestContext | null,
): Record<string, string> {
  const session = buildDownloadHeaders(context);
  const merged: Record<string, string> = { ...session };
  for (const [key, value] of Object.entries(rangeHeaders)) {
    merged[key] = value;
  }
  return merged;
}
