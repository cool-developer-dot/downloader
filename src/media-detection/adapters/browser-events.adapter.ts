import { isSafeMediaUrl, normalizeMediaUrl } from '../utils';
import { isSupportedMediaUrl } from '../parsers';

/**
 * Passive observation of navigable / request URLs from the browser event bridge.
 * Does not influence allow/deny navigation policy.
 */
export function observeRequestUrl(
  url: string | null | undefined,
  pageUrl: string | null | undefined,
): { url: string; pageUrl: string } | null {
  if (!url || !pageUrl) {
    return null;
  }

  const normalizedUrl = normalizeMediaUrl(url);
  const normalizedPage = normalizeMediaUrl(pageUrl);

  if (!normalizedUrl || !normalizedPage) {
    return null;
  }

  if (!isSafeMediaUrl(normalizedUrl) || !isSupportedMediaUrl(normalizedUrl)) {
    return null;
  }

  return { url: normalizedUrl, pageUrl: normalizedPage };
}
