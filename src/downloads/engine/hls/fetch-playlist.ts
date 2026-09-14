/**
 * Safe HLS playlist HTTP fetch — SSRF + size bounded + streaming read.
 */

import { readBoundedResponseText } from '@/downloads/network/bounded-response-reader';

import { DownloadEngineError } from '../errors';
import { isSafeHttpUrl } from '../resource-guard';
import { logTrafficRequest, sanitizeAuditUrl } from '../audit-diagnostics.service';
import { HLS_TRANSFER } from './constants';
import { parseHlsPlaylist, type HlsResolvedPlaylist } from './playlist';
import {
  createTimeoutAbortSignal,
  TRANSFER_TIMEOUTS,
} from '../transfer-timeouts';
import type { StallWatchdog } from '../stall-watchdog';

function isPlausibleHlsManifestPrefix(text: string): boolean {
  const trimmed = text.trimStart();
  if (!trimmed) {
    return false;
  }
  if (trimmed.startsWith('#EXTM3U')) {
    return true;
  }
  const lower = trimmed.slice(0, 256).toLowerCase();
  if (lower.startsWith('<!doctype html') || lower.startsWith('<html')) {
    return false;
  }
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return false;
  }
  return trimmed.startsWith('#');
}

export async function fetchAndParseHlsPlaylist(
  url: string,
  signal: AbortSignal,
  headers?: Record<string, string>,
  options?: {
    stallWatchdog?: StallWatchdog | null;
    generation?: number;
    /** Session-bound: re-resolve headers for each redirect target URL. */
    resolveRedirectHeaders?: (redirectUrl: string) => Promise<Record<string, string>>;
  },
): Promise<{ playlist: HlsResolvedPlaylist; finalUrl: string }> {
  if (!isSafeHttpUrl(url)) {
    throw new DownloadEngineError('INVALID_RESOURCE', 'Invalid HLS URL.');
  }

  const watchdog = options?.stallWatchdog;
  if (watchdog) {
    watchdog.startHlsManifestPhase({
      generation: options?.generation,
      timeoutMs: TRANSFER_TIMEOUTS.hlsManifestTimeoutMs,
    });
  }

  const timeout = createTimeoutAbortSignal(
    TRANSFER_TIMEOUTS.hlsManifestTimeoutMs,
    signal,
  );

  try {
    let currentUrl = url;
    let currentHeaders = headers ?? {};
    let response: Response | null = null;
    const maxRedirects = options?.resolveRedirectHeaders ? 5 : 0;

    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      response = await fetch(currentUrl, {
        method: 'GET',
        redirect: options?.resolveRedirectHeaders ? 'manual' : 'follow',
        headers: {
          Accept:
            'application/vnd.apple.mpegurl, application/x-mpegURL, text/plain, */*',
          ...currentHeaders,
        },
        signal: timeout.signal,
      });

      if (signal.aborted || timeout.signal.aborted) {
        throw new DownloadEngineError('CANCELLED', 'Download cancelled.');
      }

      if (
        options?.resolveRedirectHeaders &&
        response.status >= 300 &&
        response.status < 400
      ) {
        const location = response.headers.get('Location');
        if (!location || hop >= maxRedirects) {
          throw new DownloadEngineError(
            'INVALID_RESOURCE',
            'HLS redirect failed security checks.',
          );
        }
        const nextUrl = new URL(location, currentUrl).toString();
        if (!isSafeHttpUrl(nextUrl)) {
          throw new DownloadEngineError(
            'INVALID_RESOURCE',
            'HLS redirect failed security checks.',
          );
        }
        currentHeaders = await options.resolveRedirectHeaders(nextUrl);
        currentUrl = nextUrl;
        continue;
      }
      break;
    }

    if (!response) {
      throw new DownloadEngineError('NETWORK_ERROR', 'HLS playlist fetch failed.');
    }

    if (response.status === 404) {
      throw new DownloadEngineError(
        'INVALID_HLS_PLAYLIST',
        'The HLS playlist could not be found.',
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new DownloadEngineError(
        'AUTH_ERROR',
        'Authentication is required to download this stream.',
      );
    }
    if (response.status === 408 || response.status === 429) {
      throw new DownloadEngineError('HTTP_ERROR', `HTTP ${response.status}`);
    }
    if (response.status >= 500) {
      throw new DownloadEngineError('HTTP_ERROR', `HTTP ${response.status}`);
    }
    if (!response.ok) {
      throw new DownloadEngineError('HTTP_ERROR', `HTTP ${response.status}`);
    }

    const finalUrl = response.url || currentUrl;
    if (!isSafeHttpUrl(finalUrl)) {
      throw new DownloadEngineError(
        'INVALID_RESOURCE',
        'HLS redirect failed security checks.',
      );
    }

    const headerLength = Number(response.headers.get('content-length'));
    if (
      Number.isFinite(headerLength) &&
      headerLength > HLS_TRANSFER.maxPlaylistBytes
    ) {
      try {
        await response.body?.cancel();
      } catch {
        // ignore
      }
      throw new DownloadEngineError(
        'INVALID_HLS_PLAYLIST',
        'HLS playlist exceeds the supported size.',
      );
    }

    watchdog?.assertHealthy(options?.generation);

    const { text, bytesConsumed, abortedAtByteLimit } = await readBoundedResponseText(
      response,
      HLS_TRANSFER.maxPlaylistBytes,
      timeout.signal,
    );

    const sanitized = sanitizeAuditUrl(finalUrl);
    logTrafficRequest({
      trafficClass: 'hls_manifest',
      method: 'GET',
      host: sanitized.host,
      pathPattern: sanitized.pathPattern,
      responseStatus: response.status,
      contentType: response.headers.get('Content-Type')?.split(';')[0] ?? null,
      contentLength: Number.isFinite(headerLength) ? headerLength : null,
      bytesActuallyConsumed: bytesConsumed,
    });

    if (abortedAtByteLimit || bytesConsumed > HLS_TRANSFER.maxPlaylistBytes) {
      throw new DownloadEngineError(
        'INVALID_HLS_PLAYLIST',
        'HLS playlist exceeds the supported size.',
      );
    }

    if (!text || !text.trim()) {
      throw new DownloadEngineError('INVALID_HLS_PLAYLIST', 'Empty HLS playlist.');
    }

    if (!isPlausibleHlsManifestPrefix(text)) {
      throw new DownloadEngineError(
        'INVALID_HLS_PLAYLIST',
        'The response was not a valid HLS playlist.',
      );
    }

    const playlist = parseHlsPlaylist(text, finalUrl);
    return { playlist, finalUrl };
  } catch (error) {
    if (error instanceof DownloadEngineError) {
      throw error;
    }
    if (
      signal.aborted ||
      timeout.signal.aborted ||
      (error instanceof Error && error.name === 'AbortError')
    ) {
      if (timeout.signal.aborted && !signal.aborted) {
        throw new DownloadEngineError(
          'HLS_MANIFEST_TIMEOUT',
          'HLS playlist request timed out.',
        );
      }
      throw new DownloadEngineError('CANCELLED', 'Download cancelled.');
    }
    throw new DownloadEngineError(
      'NETWORK_ERROR',
      error instanceof Error ? error.message : 'Failed to fetch HLS playlist.',
    );
  } finally {
    timeout.cleanup();
  }
}
