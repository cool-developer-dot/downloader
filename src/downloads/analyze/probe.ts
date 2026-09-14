/**
 * Bounded HTTP probe for on-device media analysis.
 * Validates final URL after redirects; never buffers full media bodies.
 */

import { isSafeHttpUrl } from '@/downloads/engine/resource-guard';
import { readBoundedResponseText } from '@/downloads/network/bounded-response-reader';

import {
  logTrafficRequest,
  sanitizeAuditUrl,
} from '@/downloads/engine/audit-diagnostics.service';

import { LOCAL_ANALYZE } from './constants';

export type ProbeHeaders = {
  contentType: string | null;
  contentLength: string | null;
  contentDisposition: string | null;
};

export type HttpProbeResult = {
  finalUrl: string;
  status: number;
  headers: ProbeHeaders;
};

export class LocalAnalyzeNetworkError extends Error {
  readonly kind: 'timeout' | 'unreachable' | 'http' | 'aborted' | 'unsafe';

  constructor(
    kind: LocalAnalyzeNetworkError['kind'],
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'LocalAnalyzeNetworkError';
    this.kind = kind;
  }
}

function readHeaders(headers: Headers): ProbeHeaders {
  return {
    contentType: headers.get('content-type'),
    contentLength: headers.get('content-length'),
    contentDisposition: headers.get('content-disposition'),
  };
}

function mergeSignals(
  external: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const onExternalAbort = () => controller.abort();
  if (external) {
    if (external.aborted) {
      controller.abort();
    } else {
      external.addEventListener('abort', onExternalAbort);
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      if (external) {
        external.removeEventListener('abort', onExternalAbort);
      }
    },
  };
}

function buildRequestHeaders(
  extra?: {
    referer?: string | null;
    userAgent?: string | null;
    requestContext?: import('@/downloads/types/request-context').MediaRequestContext | null;
  },
  overrides?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: '*/*',
    ...overrides,
  };
  const referer =
    extra?.requestContext?.referer?.trim() || extra?.referer?.trim() || null;
  if (referer && isSafeHttpUrl(referer)) {
    headers.Referer = referer;
  }
  const userAgent =
    extra?.requestContext?.userAgent?.trim() || extra?.userAgent?.trim() || null;
  if (userAgent) {
    headers['User-Agent'] = userAgent.slice(0, 512);
  }
  if (extra?.requestContext?.headers?.Cookie && !headers.Cookie) {
    headers.Cookie = extra.requestContext.headers.Cookie;
  }
  return headers;
}

/**
 * HEAD probe with automatic redirect follow; validates final URL.
 * Falls back to GET Range 0-0 when HEAD is rejected.
 */
export async function inspectSource(
  url: string,
  signal?: AbortSignal,
  options?: {
    referer?: string | null;
    userAgent?: string | null;
    requestContext?: import('@/downloads/types/request-context').MediaRequestContext | null;
  },
): Promise<HttpProbeResult> {
  if (!isSafeHttpUrl(url)) {
    throw new LocalAnalyzeNetworkError('unsafe', 'URL failed security checks');
  }

  const { signal: combined, cleanup } = mergeSignals(
    signal,
    LOCAL_ANALYZE.timeoutMs,
  );

  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'HEAD',
        redirect: 'follow',
        signal: combined,
        headers: buildRequestHeaders(options),
      });
    } catch (error) {
      if (combined.aborted) {
        throw new LocalAnalyzeNetworkError(
          signal?.aborted ? 'aborted' : 'timeout',
          'Analysis request timed out',
        );
      }
      throw new LocalAnalyzeNetworkError(
        'unreachable',
        error instanceof Error ? error.message : 'Network unreachable',
      );
    }

    // Some CDNs reject HEAD — try a tiny GET.
    if (response.status === 405 || response.status === 501) {
      try {
        response = await fetch(url, {
          method: 'GET',
          redirect: 'follow',
          signal: combined,
          headers: buildRequestHeaders(options, {
            Range: 'bytes=0-0',
          }),
        });
      } catch (error) {
        if (combined.aborted) {
          throw new LocalAnalyzeNetworkError(
            signal?.aborted ? 'aborted' : 'timeout',
            'Analysis request timed out',
          );
        }
        throw new LocalAnalyzeNetworkError(
          'unreachable',
          error instanceof Error ? error.message : 'Network unreachable',
        );
      }
    }

    const finalUrl = response.url || url;
    if (!isSafeHttpUrl(finalUrl)) {
      throw new LocalAnalyzeNetworkError(
        'unsafe',
        'Redirect target failed security checks',
      );
    }

    const sanitized = sanitizeAuditUrl(finalUrl);
    logTrafficRequest({
      trafficClass: 'metadata_probe',
      method: response.status === 206 ? 'GET' : 'HEAD',
      host: sanitized.host,
      pathPattern: sanitized.pathPattern,
      requestedRange: response.status === 206 ? 'bytes=0-0' : null,
      responseStatus: response.status,
      contentType: response.headers.get('content-type')?.split(';')[0] ?? null,
      contentLength: Number(response.headers.get('content-length')) || null,
      bytesActuallyConsumed: response.status === 206 ? 1 : 0,
    });

    return {
      finalUrl,
      status: response.status,
      headers: readHeaders(response.headers),
    };
  } finally {
    cleanup();
  }
}

export async function fetchBoundedText(
  url: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<{ finalUrl: string; status: number; text: string; headers: ProbeHeaders }> {
  if (!isSafeHttpUrl(url)) {
    throw new LocalAnalyzeNetworkError('unsafe', 'URL failed security checks');
  }

  const { signal: combined, cleanup } = mergeSignals(
    signal,
    LOCAL_ANALYZE.timeoutMs,
  );

  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: combined,
        headers: {
          Accept:
            'application/vnd.apple.mpegurl, application/x-mpegURL, text/plain, */*',
        },
      });
    } catch (error) {
      if (combined.aborted) {
        throw new LocalAnalyzeNetworkError(
          signal?.aborted ? 'aborted' : 'timeout',
          'Analysis request timed out',
        );
      }
      throw new LocalAnalyzeNetworkError(
        'unreachable',
        error instanceof Error ? error.message : 'Network unreachable',
      );
    }

    const finalUrl = response.url || url;
    if (!isSafeHttpUrl(finalUrl)) {
      throw new LocalAnalyzeNetworkError(
        'unsafe',
        'Redirect target failed security checks',
      );
    }

    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      try {
        await response.body?.cancel();
      } catch {
        // ignore
      }
      throw new LocalAnalyzeNetworkError(
        'http',
        'Response exceeds the supported analysis size',
        response.status,
      );
    }

    const { text, bytesConsumed, abortedAtByteLimit } = await readBoundedResponseText(
      response,
      maxBytes,
      combined,
    );
    const sanitized = sanitizeAuditUrl(finalUrl);
    logTrafficRequest({
      trafficClass: 'metadata_probe',
      method: 'GET',
      host: sanitized.host,
      pathPattern: sanitized.pathPattern,
      responseStatus: response.status,
      contentType: response.headers.get('content-type')?.split(';')[0] ?? null,
      contentLength: Number.isFinite(contentLength) ? contentLength : null,
      bytesActuallyConsumed: bytesConsumed,
    });
    if (abortedAtByteLimit || bytesConsumed > maxBytes) {
      throw new LocalAnalyzeNetworkError(
        'http',
        'Response exceeds the supported analysis size',
        response.status,
      );
    }

    return {
      finalUrl,
      status: response.status,
      text,
      headers: readHeaders(response.headers),
    };
  } finally {
    cleanup();
  }
}
