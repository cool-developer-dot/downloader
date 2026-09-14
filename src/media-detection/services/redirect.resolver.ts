import { DETECTION_TIMING } from '../constants';
import { isSafeMediaUrl, normalizeMediaUrl } from '../utils';

export type RedirectResolution = {
  originalUrl: string;
  finalUrl: string;
  redirectCount: number;
  timedOut: boolean;
  loopDetected: boolean;
  ok: boolean;
};

/**
 * Bounded redirect resolution using HEAD/GET Range.
 * Does not download media bodies. Validates each hop for safety.
 */
export async function resolveRedirects(
  url: string,
  signal?: AbortSignal,
  options?: { referer?: string | null; userAgent?: string | null },
): Promise<RedirectResolution> {
  const originalUrl = url;
  let current = url;
  let redirectCount = 0;
  const seen = new Set<string>();
  seen.add(canonicalizeForLoop(current));

  if (!isSafeMediaUrl(current)) {
    return {
      originalUrl,
      finalUrl: originalUrl,
      redirectCount: 0,
      timedOut: false,
      loopDetected: false,
      ok: false,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    DETECTION_TIMING.redirectTimeoutMs,
  );
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);

  try {
    while (redirectCount < DETECTION_TIMING.redirectMaxHops) {
      const headers: Record<string, string> = {
        Accept: '*/*',
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
        // HEAD may fail — try Range GET once.
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

      if (response.type === 'opaqueredirect') {
        // Opaque — cannot inspect; treat current as final.
        break;
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
          return {
            originalUrl,
            finalUrl: current,
            redirectCount,
            timedOut: false,
            loopDetected: false,
            ok: false,
          };
        }
        const key = canonicalizeForLoop(next);
        if (seen.has(key)) {
          return {
            originalUrl,
            finalUrl: current,
            redirectCount,
            timedOut: false,
            loopDetected: true,
            ok: false,
          };
        }
        seen.add(key);
        current = next;
        redirectCount += 1;
        continue;
      }

      // Follow fetch's automatic final URL when redirect:follow used as fallback.
      if (response.url && response.url !== current && isSafeMediaUrl(response.url)) {
        const finalNorm = normalizeMediaUrl(response.url) ?? response.url;
        if (canonicalizeForLoop(finalNorm) !== canonicalizeForLoop(current)) {
          redirectCount += 1;
          current = finalNorm;
        }
      }
      break;
    }

    const finalUrl = normalizeMediaUrl(current) ?? current;
    return {
      originalUrl,
      finalUrl,
      redirectCount,
      timedOut: false,
      loopDetected: false,
      ok: isSafeMediaUrl(finalUrl),
    };
  } catch (error) {
    const timedOut =
      controller.signal.aborted && !(signal?.aborted);
    return {
      originalUrl,
      finalUrl: normalizeMediaUrl(current) ?? current,
      redirectCount,
      timedOut,
      loopDetected: false,
      ok: false,
    };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
}

function canonicalizeForLoop(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}
