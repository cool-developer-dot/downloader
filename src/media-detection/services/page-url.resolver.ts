import { DETECTION_TIMING } from '../constants';
import { isSafeMediaUrl, normalizeMediaUrl } from '../utils';
import { logMediaDiagnostic } from './media-diagnostics.service';

export type PageUrlResolution = {
  originalPageUrl: string;
  resolvedPageUrl: string;
  redirectChain: string[];
  timedOut: boolean;
  loopDetected: boolean;
  ok: boolean;
};

export type PageUrlResolverOptions = {
  referer?: string | null;
  userAgent?: string | null;
  signal?: AbortSignal;
};

const SHARE_HOST_PATTERNS = [
  /^vt\.tiktok\.com$/i,
  /^vm\.tiktok\.com$/i,
  /^tiktok\.com$/i,
  /^www\.tiktok\.com$/i,
  /^l\.instagram\.com$/i,
  /^instagram\.com$/i,
  /^www\.instagram\.com$/i,
];

function canonicalizeForLoop(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

function isShareOrShortLink(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, '');
    return SHARE_HOST_PATTERNS.some((pattern) => pattern.test(host));
  } catch {
    return false;
  }
}

/**
 * Resolves share/short public page URLs to their canonical HTTPS destination.
 * Does NOT treat the page URL as a media URL.
 */
export async function resolvePageUrl(
  url: string,
  options?: PageUrlResolverOptions,
): Promise<PageUrlResolution> {
  const originalPageUrl = url.trim();
  const chain: string[] = [originalPageUrl];

  if (!isSafeMediaUrl(originalPageUrl)) {
    return {
      originalPageUrl,
      resolvedPageUrl: originalPageUrl,
      redirectChain: chain,
      timedOut: false,
      loopDetected: false,
      ok: false,
    };
  }

  if (!isShareOrShortLink(originalPageUrl)) {
    const normalized = normalizeMediaUrl(originalPageUrl) ?? originalPageUrl;
    return {
      originalPageUrl,
      resolvedPageUrl: normalized,
      redirectChain: [originalPageUrl],
      timedOut: false,
      loopDetected: false,
      ok: true,
    };
  }

  let current = originalPageUrl;
  let redirectCount = 0;
  const seen = new Set<string>([canonicalizeForLoop(current)]);

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    DETECTION_TIMING.redirectTimeoutMs,
  );
  const onAbort = () => controller.abort();
  options?.signal?.addEventListener('abort', onAbort);

  try {
    while (redirectCount < DETECTION_TIMING.redirectMaxHops) {
      const headers: Record<string, string> = {
        Accept: 'text/html,application/xhtml+xml,*/*',
        Range: 'bytes=0-0',
      };
      if (options?.referer && isSafeMediaUrl(options.referer)) {
        headers.Referer = options.referer;
      }
      if (options?.userAgent) {
        headers['User-Agent'] = options.userAgent.slice(0, 512);
      }

      let response: Response;
      try {
        response = await fetch(current, {
          method: 'HEAD',
          redirect: 'manual',
          signal: controller.signal,
          headers,
        });
      } catch {
        try {
          response = await fetch(current, {
            method: 'GET',
            redirect: 'manual',
            signal: controller.signal,
            headers,
          });
        } catch {
          break;
        }
      }

      const status = response.status;
      if (status >= 300 && status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          break;
        }
        let next: string;
        try {
          next = new URL(location, current).toString();
        } catch {
          break;
        }
        if (!isSafeMediaUrl(next)) {
          break;
        }
        const key = canonicalizeForLoop(next);
        if (seen.has(key)) {
          logMediaDiagnostic('page_url_loop', {
            originalPageUrl,
            redirectCount,
          });
          return {
            originalPageUrl,
            resolvedPageUrl: normalizeMediaUrl(current) ?? current,
            redirectChain: chain,
            timedOut: false,
            loopDetected: true,
            ok: false,
          };
        }
        seen.add(key);
        current = next;
        chain.push(next);
        redirectCount += 1;
        continue;
      }

      if (response.url && response.url !== current && isSafeMediaUrl(response.url)) {
        const finalNorm = normalizeMediaUrl(response.url) ?? response.url;
        if (canonicalizeForLoop(finalNorm) !== canonicalizeForLoop(current)) {
          chain.push(finalNorm);
          current = finalNorm;
        }
      }
      break;
    }

    const resolvedPageUrl = normalizeMediaUrl(current) ?? current;
    logMediaDiagnostic('page_url_resolved', {
      originalPageUrl,
      resolvedPageUrl,
      redirectCount: chain.length - 1,
      cookiesRequired: false,
    });

    return {
      originalPageUrl,
      resolvedPageUrl,
      redirectChain: chain,
      timedOut: false,
      loopDetected: false,
      ok: isSafeMediaUrl(resolvedPageUrl),
    };
  } catch {
    const timedOut = controller.signal.aborted && !(options?.signal?.aborted);
    return {
      originalPageUrl,
      resolvedPageUrl: normalizeMediaUrl(current) ?? current,
      redirectChain: chain,
      timedOut,
      loopDetected: false,
      ok: false,
    };
  } finally {
    clearTimeout(timeout);
    options?.signal?.removeEventListener('abort', onAbort);
  }
}

export { isShareOrShortLink };
