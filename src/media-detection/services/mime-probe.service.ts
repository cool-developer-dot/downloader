import { DETECTION_TIMING } from '../constants';
import { isMediaMimeType } from '../parsers/extension.parser';
import { isSafeMediaUrl, normalizeMediaUrl } from '../utils';

export type MimeProbeResult = {
  originalUrl: string;
  finalUrl: string;
  mimeType: string | null;
  contentLength: number | null;
  acceptRanges: boolean;
  contentDisposition?: string | null;
  ok: boolean;
  status: number | null;
};

type CacheEntry = {
  result: MimeProbeResult;
  expiresAt: number;
};

const probeCache = new Map<string, CacheEntry>();
let activeProbes = 0;
const waitQueue: Array<() => void> = [];

/**
 * Bounded HEAD / Range probe to discover Content-Type for extensionless URLs.
 * Never downloads full media bodies.
 */
export async function probeMediaMime(
  url: string,
  signal?: AbortSignal,
  options?: { referer?: string | null; headers?: Record<string, string> },
): Promise<MimeProbeResult | null> {
  if (!isSafeMediaUrl(url)) {
    return null;
  }

  if (signal?.aborted) return null;
  const authenticated = Object.keys(options?.headers ?? {}).some((key) => /^(cookie|authorization)$/i.test(key));
  const cacheKey = `${url}|${options?.referer ?? ''}|${options?.headers?.['User-Agent'] ?? ''}`;
  const cached = authenticated ? null : probeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  try { await acquireProbeSlot(signal); } catch { return null; }
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    DETECTION_TIMING.mimeProbeTimeoutMs,
  );
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);

  try {
    const headers: Record<string, string> = {
      Accept: 'video/*, application/vnd.apple.mpegurl, application/dash+xml, */*',
      ...(options?.headers ?? {}),
    };
    if (options?.referer && isSafeMediaUrl(options.referer) && !headers.Referer) {
      headers.Referer = options.referer;
    }

    let response: Response | null = null;
    try {
      response = await fetch(url, {
        method: 'HEAD',
        redirect: 'follow',
        signal: controller.signal,
        headers,
      });
    } catch {
      response = null;
    }

    if (!response || !response.ok || !response.headers.get('content-type') || /^(text\/html|application\/json)/i.test(response.headers.get('content-type') ?? '')) {
      try {
        response = await fetch(url, {
          method: 'GET',
          redirect: 'follow',
          signal: controller.signal,
          headers: {
            ...headers,
            Range: 'bytes=0-0',
          },
        });
      } catch {
        return null;
      }
    }

    if (!response) {
      return null;
    }

    const finalRaw = response.url || url;
    if (!isSafeMediaUrl(finalRaw)) {
      return null;
    }

    const finalUrl = normalizeMediaUrl(finalRaw) ?? finalRaw;
    const contentType = response.headers.get('content-type');
    const mimeType = contentType
      ? contentType.split(';')[0]?.trim().toLowerCase() || null
      : null;

    // Prefer Content-Range total on 206; Content-Length is often the slice size (e.g. 1).
    let contentLength: number | null = null;
    const contentRange = response.headers.get('content-range');
    if (contentRange) {
      const match = /bytes\s+\d+-\d+\/(\d+|\*)/i.exec(contentRange);
      const raw = match?.[1];
      if (raw && raw !== '*') {
        const n = Number(raw);
        if (Number.isFinite(n) && n > 1) {
          contentLength = Math.trunc(n);
        }
      }
    }
    if (contentLength == null) {
      const lengthHeader = response.headers.get('content-length');
      const parsed = lengthHeader ? Number(lengthHeader) : null;
      if (parsed != null && Number.isFinite(parsed) && parsed > 1) {
        // On 206, Content-Length is the returned slice — ignore tiny probe lengths.
        if (response.status === 206 && parsed <= 4096) {
          contentLength = null;
        } else {
          contentLength = Math.trunc(parsed);
        }
      }
    }

    const acceptRangesHeader = response.headers.get('accept-ranges');
    const acceptRanges =
      acceptRangesHeader != null && !/^none$/i.test(acceptRangesHeader.trim());

    const result: MimeProbeResult = {
      originalUrl: url,
      finalUrl,
      mimeType,
      contentLength,
      acceptRanges,
      ok: response.ok || response.status === 206,
      status: response.status,
      contentDisposition: response.headers.get('content-disposition'),
    };

    if (result.ok && !authenticated && isVerifiedMediaMime(mimeType)) probeCache.set(cacheKey, {
      result,
      expiresAt: Date.now() + DETECTION_TIMING.probeCacheTtlMs,
    });

    // Bound cache size
    if (probeCache.size > 200) {
      const first = probeCache.keys().next().value;
      if (first) {
        probeCache.delete(first);
      }
    }

    return result;
  } catch {
    return null;
  } finally {
    // HEAD fallback may receive a full 200 body when Range is ignored.
    controller.abort();
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
    releaseProbeSlot();
  }
}

export function clearMimeProbeCache(): void {
  probeCache.clear();
}

export function isVerifiedMediaMime(mime: string | null | undefined): boolean {
  return isMediaMimeType(mime);
}

async function acquireProbeSlot(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted || waitQueue.length >= 48) throw new Error('probe_unavailable');
  if (activeProbes < DETECTION_TIMING.maxConcurrentProbes) {
    activeProbes += 1;
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const resume = () => {
      signal?.removeEventListener('abort', onAbort);
      activeProbes += 1;
      resolve();
    };
    const onAbort = () => {
      const idx = waitQueue.indexOf(resume);
      if (idx >= 0) {
        waitQueue.splice(idx, 1);
      }
      reject(new Error('aborted'));
    };
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    waitQueue.push(resume);
  });
}

function releaseProbeSlot(): void {
  activeProbes = Math.max(0, activeProbes - 1);
  const next = waitQueue.shift();
  if (next) {
    next();
  }
}
