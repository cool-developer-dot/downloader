/**
 * HTTP response guards — reject non-media payloads before commit.
 */

import { DownloadEngineError } from './errors';
import { logDownloadRuntime, safeDownloadHostname } from './download-runtime-diagnostics.service';

const HTML_CONTENT_TYPES = ['text/html', 'application/xhtml'];
const JSON_CONTENT_TYPES = ['application/json', 'text/json'];
const PLAIN_ERROR_TYPES = ['text/plain'];

export type HttpResponseGuardResult =
  | { ok: true; contentType: string | null; contentLength: number | null }
  | { ok: false; code: 'HTTP_FORBIDDEN' | 'URL_EXPIRED' | 'INVALID_CONTENT_TYPE' | 'HTML_RESPONSE' | 'HTTP_ERROR' };

function parseContentLength(raw: string | null): number | null {
  if (!raw || !/^\d+$/.test(raw.trim())) {
    return null;
  }
  const value = Number(raw.trim());
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : null;
}

function classifyContentType(contentType: string | null): HttpResponseGuardResult | null {
  if (!contentType) {
    return null;
  }
  const lower = contentType.toLowerCase().split(';')[0]?.trim() ?? '';
  if (!lower) {
    return null;
  }
  if (HTML_CONTENT_TYPES.some((prefix) => lower.startsWith(prefix))) {
    return { ok: false, code: 'HTML_RESPONSE' };
  }
  if (JSON_CONTENT_TYPES.some((prefix) => lower.startsWith(prefix))) {
    return { ok: false, code: 'INVALID_CONTENT_TYPE' };
  }
  if (PLAIN_ERROR_TYPES.some((prefix) => lower.startsWith(prefix))) {
    return { ok: false, code: 'INVALID_CONTENT_TYPE' };
  }
  return null;
}

/**
 * Validate a fetch Response before streaming bytes to disk.
 * Throws DownloadEngineError on auth/expiry/HTML/JSON responses.
 */
export function assertValidMediaHttpResponse(
  response: Response,
  options?: { allowPartial?: boolean },
): { contentType: string | null; contentLength: number | null } {
  const status = response.status;
  const contentType = response.headers.get('Content-Type');
  const contentLength = parseContentLength(response.headers.get('Content-Length'));
  const finalUrl = response.url;

  logDownloadRuntime('http_response', {
    status,
    hostname: safeDownloadHostname(finalUrl),
    allowPartial: options?.allowPartial ?? false,
  });
  logDownloadRuntime('content_type', { value: contentType?.split(';')[0] ?? null });
  logDownloadRuntime('content_length', { value: contentLength });

  if (finalUrl !== response.url) {
    logDownloadRuntime('redirect', { hostname: safeDownloadHostname(finalUrl) });
  }

  if (status === 401 || status === 403) {
    throw new DownloadEngineError(
      'AUTH_ERROR',
      'Source rejected the download request.',
      { httpStatus: status },
    );
  }
  if (status === 404 || status === 410) {
    throw new DownloadEngineError(
      'INVALID_RESOURCE',
      'Video link expired or is no longer available.',
      { httpStatus: status },
    );
  }

  const allowedPartial = options?.allowPartial === true;
  if (!allowedPartial && status !== 200) {
    if (status === 206) {
      // Range responses validated separately.
    } else if (status >= 400) {
      throw new DownloadEngineError('HTTP_ERROR', 'Download request failed.', {
        httpStatus: status,
      });
    }
  }

  const contentReject = classifyContentType(contentType);
  if (contentReject && !contentReject.ok) {
    const code =
      contentReject.code === 'HTML_RESPONSE'
        ? 'FINAL_FILE_INVALID'
        : 'FINAL_FILE_INVALID';
    throw new DownloadEngineError(
      code,
      contentReject.code === 'HTML_RESPONSE'
        ? 'Downloaded response was not a valid video.'
        : 'Downloaded response was not valid media.',
    );
  }

  return { contentType, contentLength };
}

export function mapValidationReasonToErrorCode(
  reason: string,
): 'FINAL_FILE_INVALID' | 'FINAL_SIZE_MISMATCH' {
  switch (reason) {
    case 'html_payload':
    case 'json':
    case 'unrecognized_signature':
    case 'unreadable':
    case 'init_segment':
    case 'media_fragment':
    case 'mp4_structure_unproven':
      return 'FINAL_FILE_INVALID';
    case 'too_small':
      return 'FINAL_FILE_INVALID';
    default:
      return 'FINAL_FILE_INVALID';
  }
}

export function validationReasonMessage(reason: string): string {
  switch (reason) {
    case 'html_payload':
      return 'Downloaded response was not a valid video.';
    case 'json':
      return 'Downloaded response was not valid media.';
    case 'too_small':
      return 'Download was incomplete. Retry download.';
    case 'unrecognized_signature':
      return 'Downloaded response was not a valid video.';
    case 'init_segment':
    case 'media_fragment':
    case 'mp4_structure_unproven':
      return 'The downloaded file was not a valid video.';
    case 'missing':
      return 'Downloaded file is missing.';
    default:
      return 'The downloaded file was not a valid video.';
  }
}
