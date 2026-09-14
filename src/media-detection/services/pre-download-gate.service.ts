/**
 * Pre-download verification gate.
 * Progressive media: reject HTML/JSON/tiny non-video bodies before enqueue.
 * HLS: bounded manifest validation — never progressive MP4/WebM signature checks.
 */

import { buildDownloadHeaders } from '@/downloads/engine/download-headers';
import {
  DownloadEngineError,
  toUserFacingErrorMessage,
} from '@/downloads/engine/errors';
import { fetchAndParseHlsPlaylist } from '@/downloads/engine/hls/fetch-playlist';
import { MIN_VALID_MEDIA_BYTES } from '@/downloads/engine/media-signature';
import {
  isPlaylistOrStreamUrl,
  isSafeHttpUrl,
  shouldUseHlsTransfer,
} from '@/downloads/engine/resource-guard';
import {
  assertSessionContextReady,
  isSocialCdnUrl,
} from '@/downloads/engine/source-capability';
import type { MediaRequestContext } from '@/downloads/types/request-context';

import { verifyMediaCandidate } from './candidate-verifier.service';
import { isLikelyExpiredMediaUrl } from './expiring-url.service';

/** Typical CDN error/challenge body sizes — never valid progressive video. */
const TINY_ERROR_BODY_MAX = 4096;

export type PreDownloadTransport = 'HLS' | 'PROGRESSIVE' | 'AUDIO';

export type PreDownloadGateResult =
  | {
      ok: true;
      finalUrl: string;
      mimeType: string | null;
      contentLength: number | null;
      requestContext: MediaRequestContext;
      transport: PreDownloadTransport;
    }
  | {
      ok: false;
      reason: string;
      userMessage: string;
      refreshable: boolean;
    };

export type PreDownloadGateInput = {
  sourceUrl: string;
  requestContext: MediaRequestContext;
  /** When the CDN URL was last verified (ms). */
  verifiedAtMs?: number;
  signal?: AbortSignal;
  /**
   * Verified transport from analyze / Phase 5B.
   * When HLS, skip progressive size/signature rules and validate the playlist.
   */
  transport?: PreDownloadTransport | null;
};

function isTinyErrorSize(bytes: number | null | undefined): boolean {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) {
    return false;
  }
  return bytes <= TINY_ERROR_BODY_MAX;
}

function isNonMediaMime(mime: string | null): boolean {
  if (!mime) {
    return false;
  }
  const lower = mime.toLowerCase();
  return (
    lower.includes('text/html') ||
    lower.includes('application/json') ||
    lower.includes('text/plain')
  );
}

function resolveGateTransport(
  sourceUrl: string,
  transport?: PreDownloadTransport | null,
): PreDownloadTransport {
  if (transport === 'HLS') {
    return 'HLS';
  }
  if (transport === 'AUDIO') {
    return 'AUDIO';
  }
  if (transport === 'PROGRESSIVE') {
    // Safety: URL still wins if the selected URL is clearly a playlist.
    return shouldUseHlsTransfer({ sourceUrl, streamType: null })
      ? 'HLS'
      : 'PROGRESSIVE';
  }
  return shouldUseHlsTransfer({ sourceUrl, streamType: null })
    ? 'HLS'
    : 'PROGRESSIVE';
}

async function runHlsManifestGate(
  sourceUrl: string,
  ctx: MediaRequestContext,
  signal?: AbortSignal,
): Promise<PreDownloadGateResult> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const headers = buildDownloadHeaders(ctx);
    const { playlist, finalUrl } = await fetchAndParseHlsPlaylist(
      sourceUrl,
      controller.signal,
      headers,
    );

    if (playlist.kind !== 'master' && playlist.kind !== 'media') {
      return {
        ok: false,
        reason: 'invalid_hls_playlist',
        userMessage: 'The source did not return a valid video.',
        refreshable: true,
      };
    }

    return {
      ok: true,
      finalUrl,
      mimeType: 'application/vnd.apple.mpegurl',
      // Playlist byte size is not media size — never feed progressive min-byte gates.
      contentLength: null,
      requestContext: ctx,
      transport: 'HLS',
    };
  } catch (error) {
    if (error instanceof DownloadEngineError) {
      const encrypted =
        error.code === 'HLS_ENCRYPTED' ||
        error.code === 'UNSUPPORTED_HLS_ENCRYPTION' ||
        error.code === 'UNSUPPORTED_DRM';
      return {
        ok: false,
        reason: error.code.toLowerCase(),
        userMessage: encrypted
          ? toUserFacingErrorMessage(error.code)
          : error.message?.trim() || 'The source did not return a valid video.',
        refreshable: !encrypted,
      };
    }
    return {
      ok: false,
      reason: 'hls_manifest_failed',
      userMessage: 'The source did not return a valid video.',
      refreshable: true,
    };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Full pre-download gate — must pass before Download is enabled or enqueued.
 */
export async function runPreDownloadGate(
  input: PreDownloadGateInput,
): Promise<PreDownloadGateResult> {
  const trimmed = input.sourceUrl.trim();
  if (!trimmed || !isSafeHttpUrl(trimmed)) {
    return {
      ok: false,
      reason: 'invalid_url',
      userMessage: 'The source did not return a valid video.',
      refreshable: false,
    };
  }

  const ctx = input.requestContext;
  const verifiedAt = input.verifiedAtMs ?? ctx.capturedAt ?? Date.now();
  const transport = resolveGateTransport(trimmed, input.transport);

  if (isLikelyExpiredMediaUrl(trimmed, verifiedAt)) {
    return {
      ok: false,
      reason: 'expired_url',
      userMessage: 'Video session expired. Open/play the video once and retry.',
      refreshable: true,
    };
  }

  try {
    assertSessionContextReady(trimmed, ctx);
  } catch {
    return {
      ok: false,
      reason: 'session_missing',
      userMessage: 'Open and play the video once to refresh the download.',
      refreshable: true,
    };
  }

  const headers = buildDownloadHeaders(ctx);
  if (isSocialCdnUrl(trimmed) && !headers.Referer && !headers['User-Agent']) {
    return {
      ok: false,
      reason: 'headers_missing',
      userMessage: 'The source rejected the download request.',
      refreshable: true,
    };
  }

  // Verified / URL-detected HLS → bounded playlist validation only.
  // Progressive video signature / min-byte rules must never apply to #EXTM3U bodies.
  if (transport === 'HLS' || isPlaylistOrStreamUrl(trimmed)) {
    return runHlsManifestGate(trimmed, ctx, input.signal);
  }

  const verification = await verifyMediaCandidate(trimmed, {
    requestContext: ctx,
    signal: input.signal,
  });

  if (!verification.ok) {
    return {
      ok: false,
      reason: verification.rejectionReason ?? 'verification_failed',
      userMessage: 'The source did not return a valid video.',
      refreshable: true,
    };
  }

  if (isNonMediaMime(verification.mimeType)) {
    return {
      ok: false,
      reason: 'non_media_mime',
      userMessage: 'The source did not return a valid video.',
      refreshable: true,
    };
  }

  if (isTinyErrorSize(verification.contentLength)) {
    return {
      ok: false,
      reason: 'tiny_content_length',
      userMessage: 'The source did not return a valid video.',
      refreshable: true,
    };
  }

  if (
    verification.contentLength != null &&
    verification.contentLength > 0 &&
    verification.contentLength < MIN_VALID_MEDIA_BYTES
  ) {
    return {
      ok: false,
      reason: 'below_minimum_bytes',
      userMessage: 'The source did not return a valid video.',
      refreshable: true,
    };
  }

  return {
    ok: true,
    finalUrl: verification.finalUrl,
    mimeType: verification.mimeType,
    contentLength: verification.contentLength,
    requestContext: ctx,
    transport: transport === 'AUDIO' ? 'AUDIO' : 'PROGRESSIVE',
  };
}
