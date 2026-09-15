import { DETECTION_TIMING } from '../constants';
import {
  isDashManifestUrl,
  isDashMimeType,
  parseDashManifest,
  parseHlsManifest,
} from '../parsers';
import { isSafeMediaUrl, normalizeMediaUrl } from '../utils';
import { mergeDownloadHeaders } from '@/downloads/engine/download-headers';
import type { MediaRequestContext } from '@/downloads/types/request-context';
import { readBoundedResponseText } from '@/downloads/network/bounded-response-reader';

/**
 * Rich outcome of a bounded manifest fetch — retains transport evidence so
 * downstream verifiers can differentiate transient auth-like failures
 * (401/403/HTML login body) from permanent "not a manifest" responses.
 * No sensitive headers, cookies, or signed query strings are ever exposed.
 */
export type ManifestFetchOutcome =
  | {
      ok: true;
      status: number;
      finalUrl: string;
      contentType: string | null;
      text: string;
      /** True when body looks like an HTML login/interstitial page. */
      htmlLike: boolean;
    }
  | {
      ok: false;
      status: number | null;
      /** True when 401/403 or login-HTML body observed — retry-with-session eligible. */
      authLike: boolean;
      /** True when a 2xx HTML page came back instead of a manifest body. */
      htmlLike: boolean;
      /** True when fetch itself aborted / networked failed. */
      networkError: boolean;
      /** True when body exceeded manifestMaxBytes / was empty. */
      unsupportedBody: boolean;
      finalUrl: string | null;
      contentType: string | null;
    };

const HTML_LOGIN_PATH_RE = /login|sign[\s_-]?in|authenticate|oauth|sso|passwd|account\/login/i;

function bodyLooksLikeHtml(text: string, contentType: string | null): boolean {
  if (contentType && contentType.toLowerCase().includes('text/html')) {
    return true;
  }
  const head = text.trimStart().slice(0, 256).toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html');
}

/**
 * Fetch an HLS/DASH manifest from React Native (no CORS).
 * Bounded by timeout and max bytes. Re-validates final URL after redirects.
 *
 * Returns a rich outcome. Legacy callers use {@link fetchManifestText}
 * which is a thin wrapper preserving the historical `{text, finalUrl} | null` shape.
 */
export async function fetchManifestResource(
  url: string,
  signal?: AbortSignal,
  options?: {
    accept?: string;
    referer?: string | null;
    requestContext?: MediaRequestContext | null;
  },
): Promise<ManifestFetchOutcome> {
  if (!isSafeMediaUrl(url)) {
    return {
      ok: false,
      status: null,
      authLike: false,
      htmlLike: false,
      networkError: false,
      unsupportedBody: false,
      finalUrl: null,
      contentType: null,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    DETECTION_TIMING.manifestFetchTimeoutMs,
  );

  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  if (signal?.aborted) controller.abort();

  try {
    const headers = mergeDownloadHeaders(
      {
        Accept:
          options?.accept ??
          'application/vnd.apple.mpegurl, application/x-mpegURL, application/dash+xml, text/plain, */*',
      },
      options?.requestContext,
    );
    if (options?.referer && isSafeMediaUrl(options.referer) && !headers.Referer) {
      headers.Referer = options.referer;
    }

    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers,
      signal: controller.signal,
    });

    const status = response.status;
    const finalUrlRaw = response.url || url;
    const finalUrl = isSafeMediaUrl(finalUrlRaw)
      ? (normalizeMediaUrl(finalUrlRaw) ?? finalUrlRaw)
      : null;
    const contentType = response.headers?.get?.('content-type') ?? null;

    if (!response.ok) {
      // Peek at the body (bounded) to detect login-like HTML even on 4xx.
      let htmlLike = false;
      try {
        const { text: preview } = await readBoundedResponseText(response, 512, controller.signal);
        htmlLike = bodyLooksLikeHtml(preview, contentType);
      } catch {
        /* ignore body read failure */
      }
      const authLike =
        status === 401 ||
        status === 403 ||
        htmlLike ||
        (finalUrl != null && HTML_LOGIN_PATH_RE.test(finalUrl));
      return {
        ok: false,
        status,
        authLike,
        htmlLike,
        networkError: false,
        unsupportedBody: false,
        finalUrl,
        contentType,
      };
    }

    if (!finalUrl) {
      return {
        ok: false,
        status,
        authLike: false,
        htmlLike: false,
        networkError: false,
        unsupportedBody: false,
        finalUrl: null,
        contentType,
      };
    }

    const { text, abortedAtByteLimit } = await readBoundedResponseText(response, DETECTION_TIMING.manifestMaxBytes, controller.signal);
    if (!text || abortedAtByteLimit) {
      return {
        ok: false,
        status,
        authLike: false,
        htmlLike: false,
        networkError: false,
        unsupportedBody: true,
        finalUrl,
        contentType,
      };
    }

    const htmlLike = bodyLooksLikeHtml(text, contentType);
    if (htmlLike) {
      const authLike =
        htmlLike || (finalUrl != null && HTML_LOGIN_PATH_RE.test(finalUrl));
      return {
        ok: false,
        status,
        authLike,
        htmlLike: true,
        networkError: false,
        unsupportedBody: false,
        finalUrl,
        contentType,
      };
    }

    return { ok: true, status, finalUrl, contentType, text, htmlLike: false };
  } catch {
    return {
      ok: false,
      status: null,
      authLike: false,
      htmlLike: false,
      networkError: true,
      unsupportedBody: false,
      finalUrl: null,
      contentType: null,
    };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Legacy shape — kept for the many callers that only need `{text, finalUrl}`.
 * All richer transport evidence is available via {@link fetchManifestResource}.
 */
export async function fetchManifestText(
  url: string,
  signal?: AbortSignal,
  options?: {
    accept?: string;
    referer?: string | null;
    requestContext?: MediaRequestContext | null;
  },
): Promise<{ text: string; finalUrl: string } | null> {
  const outcome = await fetchManifestResource(url, signal, options);
  if (!outcome.ok) {
    return null;
  }
  return { text: outcome.text, finalUrl: outcome.finalUrl };
}

export async function fetchHlsManifestText(
  url: string,
  signal?: AbortSignal,
  requestContext?: MediaRequestContext | null,
): Promise<string | null> {
  const result = await fetchManifestText(url, signal, {
    accept: 'application/vnd.apple.mpegurl, application/x-mpegURL, text/plain, */*',
    requestContext,
  });
  if (!result) {
    return null;
  }
  if (!result.text.trimStart().startsWith('#EXTM3U')) {
    return null;
  }
  return result.text;
}

export async function enrichHlsFromUrl(
  url: string,
  signal?: AbortSignal,
  pageUrl?: string | null,
) {
  const fetched = await fetchManifestText(url, signal, {
    accept: 'application/vnd.apple.mpegurl, application/x-mpegURL, text/plain, */*',
    referer: pageUrl ?? null,
  });
  if (!fetched) {
    return null;
  }
  if (!fetched.text.trimStart().startsWith('#EXTM3U')) {
    return null;
  }
  // Parse against final URL so relative variant URIs resolve correctly after redirects.
  const parsed = parseHlsManifest(fetched.text, fetched.finalUrl);
  if (!parsed) {
    return null;
  }
  return { ...parsed, finalUrl: fetched.finalUrl };
}

export async function enrichDashFromUrl(url: string, signal?: AbortSignal) {
  const fetched = await fetchManifestText(url, signal, {
    accept: 'application/dash+xml, application/xml, text/xml, */*',
  });
  if (!fetched) {
    return null;
  }
  const parsed = parseDashManifest(fetched.text, fetched.finalUrl);
  if (!parsed) {
    return null;
  }
  return { ...parsed, finalUrl: fetched.finalUrl };
}

export function shouldEnrichAsDash(
  url: string,
  mimeType?: string | null,
): boolean {
  return isDashManifestUrl(url) || isDashMimeType(mimeType);
}
