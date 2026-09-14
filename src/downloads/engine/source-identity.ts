/**
 * Compact source-identity probe for progressive resume validators.
 * Best-effort HEAD/GET — never invents ETag/Last-Modified/Content-Length.
 */

import { DownloadEngineError } from './errors';
import { isSafeHttpUrl } from './resource-guard';
import { TRANSFER_TIMEOUTS, createTimeoutAbortSignal } from './transfer-timeouts';
import type { RangeValidators } from './types';
import {
  etagsConflict,
  lastModifiedConflict,
  mergeRangeValidatorsWithLength,
} from './source-validators';

export type SourceIdentityProbe = {
  validators: RangeValidators | null;
  acceptRanges: boolean | null;
};

function parsePositiveLength(raw: string | null): number | null {
  if (!raw || !/^\d+$/.test(raw.trim())) {
    return null;
  }
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.trunc(value);
}

/**
 * Probe source identity. Failures are soft unless the signal is aborted —
 * missing validators still allow first-byte downloads.
 */
export async function probeSourceIdentity(
  sourceUrl: string,
  signal?: AbortSignal,
  sessionHeaders?: Record<string, string> | null,
): Promise<SourceIdentityProbe> {
  if (!isSafeHttpUrl(sourceUrl)) {
    throw new DownloadEngineError('INVALID_RESOURCE', 'Invalid download URL.');
  }

  const baseHeaders: Record<string, string> =
    sessionHeaders && Object.keys(sessionHeaders).length > 0
      ? { ...sessionHeaders }
      : { Accept: '*/*' };

  const probeTimeout = createTimeoutAbortSignal(
    TRANSFER_TIMEOUTS.probeTimeoutMs,
    signal,
  );

  const attempt = async (method: 'HEAD' | 'GET'): Promise<Response> => {
    const headers: Record<string, string> =
      method === 'GET'
        ? { ...baseHeaders, Range: 'bytes=0-0' }
        : { ...baseHeaders };
    return fetch(sourceUrl, {
      method,
      headers,
      signal: probeTimeout.signal,
    });
  };

  try {
    let response: Response;
    try {
      response = await attempt('HEAD');
      // Some CDNs reject HEAD — fall back to a tiny GET Range.
      if (response.status === 405 || response.status === 501) {
        try {
          await response.body?.cancel();
        } catch {
          // ignore
        }
        response = await attempt('GET');
      }
    } catch (error) {
      if (signal?.aborted) {
        throw new DownloadEngineError('CANCELLED', 'Download cancelled.');
      }
      return { validators: null, acceptRanges: null };
    }

    try {
      try {
        await response.body?.cancel();
      } catch {
        // ignore
      }

      if (response.status === 401 || response.status === 403) {
        throw new DownloadEngineError(
          'AUTH_ERROR',
          'Authentication is required to continue downloading.',
          { httpStatus: response.status },
        );
      }
      if (response.status === 404 || response.status === 410) {
        throw new DownloadEngineError(
          'INVALID_RESOURCE',
          'The download source is no longer available.',
          { httpStatus: response.status },
        );
      }

      const accept = response.headers.get('Accept-Ranges');
      const acceptRanges =
        accept != null ? /bytes/i.test(accept) : response.status === 206 ? true : null;

      // Prefer Content-Range total on 206 — Content-Length is only the slice size
      // (e.g. 1 for bytes=0-0) and must never be stored as the full object length.
      const rangeTotal = (() => {
        const range = response.headers.get('Content-Range');
        const match = /\/(\d+)\s*$/i.exec(range ?? '');
        return match?.[1] ? parsePositiveLength(match[1]) : null;
      })();
      const contentLength =
        response.status === 206
          ? rangeTotal ?? parsePositiveLength(response.headers.get('Content-Length'))
          : parsePositiveLength(response.headers.get('Content-Length')) ??
            rangeTotal;

      const validators: RangeValidators = {
        etag: response.headers.get('ETag'),
        lastModified: response.headers.get('Last-Modified'),
        contentLength,
      };

      if (!validators.etag && !validators.lastModified && validators.contentLength == null) {
        return { validators: null, acceptRanges };
      }

      return { validators, acceptRanges };
    } finally {
      // body already cancelled
    }
  } finally {
    probeTimeout.cleanup();
  }
}

/**
 * Compare previously persisted identity with a fresh probe.
 * Returns SOURCE_CHANGED when strong evidence of mutation exists.
 */
export function assertSourceIdentityCompatible(
  prior: RangeValidators | null | undefined,
  next: RangeValidators | null | undefined,
): void {
  if (!prior || !next) {
    return;
  }
  if (etagsConflict(prior.etag, next.etag)) {
    throw new DownloadEngineError(
      'SOURCE_CHANGED',
      'The download source changed and can’t be resumed safely.',
    );
  }
  if (lastModifiedConflict(prior.lastModified, next.lastModified)) {
    throw new DownloadEngineError(
      'SOURCE_CHANGED',
      'The download source changed and can’t be resumed safely.',
    );
  }
  if (
    prior.contentLength != null &&
    prior.contentLength > 0 &&
    next.contentLength != null &&
    next.contentLength > 0 &&
    prior.contentLength !== next.contentLength
  ) {
    throw new DownloadEngineError(
      'SOURCE_CHANGED',
      'The download source changed and can’t be resumed safely.',
    );
  }
}

export { mergeRangeValidatorsWithLength };
