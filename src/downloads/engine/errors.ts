import type { DownloadEngineErrorCode } from './types';
import {
  isAutoRetryableCode,
  isManualRetryAllowed,
  parseRetryAfterMs,
} from './retry-policy';

export class DownloadEngineError extends Error {
  readonly code: DownloadEngineErrorCode;
  readonly httpStatus?: number;
  readonly retryAfterSeconds?: number;

  constructor(
    code: DownloadEngineErrorCode,
    message: string,
    extras?: { httpStatus?: number; retryAfterSeconds?: number },
  ) {
    super(message);
    this.name = 'DownloadEngineError';
    this.code = code;
    if (extras?.httpStatus != null) {
      this.httpStatus = extras.httpStatus;
    }
    if (extras?.retryAfterSeconds != null) {
      this.retryAfterSeconds = extras.retryAfterSeconds;
    }
  }
}

export type FailureClassification = {
  error: DownloadEngineError;
  /** Eligible for bounded automatic retry. */
  autoRetryable: boolean;
  /** Eligible for explicit user Retry. */
  manualRetryable: boolean;
  retryAfterMs: number | null;
};

export function toUserFacingErrorMessage(
  code: DownloadEngineErrorCode,
  fallback?: string,
): string {
  switch (code) {
    case 'NETWORK_ERROR':
      return 'Network connection was lost while downloading.';
    case 'NETWORK_TIMEOUT':
      return 'The connection timed out.';
    case 'RATE_LIMITED':
      return 'The server is temporarily busy. Try again shortly.';
    case 'HTTP_ERROR':
      return 'The download source could not be reached.';
    case 'FILE_SYSTEM_ERROR':
    case 'FILE_WRITE_FAILED':
      return 'Unable to save this file.';
    case 'FILE_APPEND_FAILED':
      return 'Unable to continue saving this file.';
    case 'FILE_FINALIZE_FAILED':
      return 'Unable to finalize the downloaded file.';
    case 'INSUFFICIENT_STORAGE':
      return 'Not enough storage space to complete this download.';
    case 'INVALID_DESTINATION':
      return 'Unable to save this file to storage.';
    case 'PERMISSION_DENIED':
      return 'Storage permission is required to save this download.';
    case 'PARTIAL_FILE_CORRUPT':
      return 'The partial download file is damaged and can’t be continued.';
    case 'FINAL_FILE_INVALID':
      return fallback?.trim() || 'The downloaded file was not a valid video.';
    case 'CANCELLED':
      return 'Download cancelled.';
    case 'INVALID_RESOURCE':
      return fallback?.trim() || 'Video link expired or is no longer available.';
    case 'TRANSFER_INTERRUPTED':
      return 'The download was interrupted.';
    case 'PAUSE_FAILED':
      return (
        fallback?.trim() ||
        'Couldn’t pause this download right now. Try again in a moment.'
      );
    case 'RESUME_FAILED':
      return fallback?.trim() || 'Unable to resume this download.';
    case 'RESUME_UNSUPPORTED':
      return (
        fallback?.trim() ||
        'This server doesn’t support resumable downloads.'
      );
    case 'RESUME_STATE_MISSING':
      return fallback?.trim() || 'Unable to resume this download.';
    case 'RESUME_STATE_CONFLICT':
      return fallback?.trim() || 'Unable to resume this download.';
    case 'QUEUE_ADMISSION_FAILED':
      return fallback?.trim() || 'Unable to resume this download.';
    case 'PARTIAL_FILE_MISSING':
      return 'The partial download file is no longer available.';
    case 'RANGE_REJECTED':
      return (
        fallback?.trim() ||
        'This server doesn’t support resumable downloads.'
      );
    case 'INVALID_RANGE_RESPONSE':
      return (
        fallback?.trim() ||
        'The server returned an invalid resume response.'
      );
    case 'SOURCE_CHANGED':
      return 'The source file changed and can’t be safely resumed.';
    case 'RETRY_EXHAUSTED':
      return (
        fallback?.trim() ||
        'This download failed after several automatic retries.'
      );
    case 'MERGE_FAILED':
      return fallback?.trim() || 'Unable to assemble the downloaded file.';
    case 'PART_SIZE_MISMATCH':
      return fallback?.trim() || 'A download part failed integrity checks.';
    case 'FINAL_SIZE_MISMATCH':
      return (
        fallback?.trim() ||
        'Download was incomplete. Retry download.'
      );
    case 'CANCEL_FAILED':
      return fallback?.trim() || 'Couldn’t cancel this download.';
    case 'WORKER_NOT_FOUND':
      return (
        fallback?.trim() ||
        'Couldn’t pause this download right now. Try again in a moment.'
      );
    case 'AUTH_ERROR':
      return fallback?.trim() || 'The source rejected the download request.';
    case 'SESSION_CONTEXT_LOST':
      return (
        fallback?.trim() ||
        'This authenticated download needs the active website session. Open the website and retry.'
      );
    case 'SESSION_CHANGED':
      return (
        fallback?.trim() ||
        'Your website account changed. Open the website and try again.'
      );
    case 'SESSION_EXPIRED':
      return (
        fallback?.trim() ||
        'Your website session expired. Open the website and try again.'
      );
    case 'AUTH_CONTEXT_UNAVAILABLE':
      return (
        fallback?.trim() ||
        'This protected media cannot be downloaded with the available session.'
      );
    case 'HLS_UNSUPPORTED':
      return 'This stream can’t be saved with the current downloader.';
    case 'HLS_ENCRYPTED':
    case 'UNSUPPORTED_HLS_ENCRYPTION':
      return 'Encrypted streams can’t be saved.';
    case 'UNSUPPORTED_DRM':
      return 'DRM-protected streams can’t be saved.';
    case 'LIVE_HLS_UNSUPPORTED':
      return 'Live streams can’t be saved as a single file.';
    case 'UNSUPPORTED_HLS_BYTERANGE':
      return 'Byte-range HLS segments aren’t supported.';
    case 'INVALID_HLS_PLAYLIST':
      return 'This HLS playlist is invalid or incomplete.';
    case 'FIRST_BYTE_TIMEOUT':
      return 'Download could not start. Retrying…';
    case 'TRANSFER_STALLED':
      return 'Download connection was interrupted. Retrying…';
    case 'PROBE_TIMEOUT':
      return 'The media source could not be safely inspected.';
    case 'PROBE_TOO_LARGE':
      return 'The media source could not be safely inspected.';
    case 'HLS_MANIFEST_TIMEOUT':
      return 'HLS playlist request timed out.';
    case 'HLS_SEGMENT_TIMEOUT':
      return 'HLS segment download timed out.';
    case 'UNKNOWN_ERROR':
    default:
      return fallback?.trim() || 'Something went wrong while downloading.';
  }
}

function extractHttpStatus(message: string): number | null {
  const patterns = [
    /\bstatus(?:\s*code)?[:\s]+(\d{3})\b/i,
    /\bHTTP[/ ]?(\d{3})\b/i,
    /\b(\d{3})\s+(?:forbidden|not found|unauthorized|bad request|too many|internal|gateway|unavailable)\b/i,
    /\b(?:error|failed)[:\s]+(\d{3})\b/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(message);
    if (match?.[1]) {
      const code = Number(match[1]);
      if (Number.isInteger(code) && code >= 400 && code <= 599) {
        return code;
      }
    }
  }
  return null;
}

function extractRetryAfterSeconds(message: string): number | undefined {
  const match = /retry[- ]?after[:\s]+(\d+)/i.exec(message);
  if (!match?.[1]) {
    return undefined;
  }
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.trunc(seconds) : undefined;
}

function classifyHttpStatus(status: number, rawMessage: string): DownloadEngineError {
  const retryAfter = extractRetryAfterSeconds(rawMessage);
  if (status === 401 || status === 403) {
    return new DownloadEngineError('AUTH_ERROR', rawMessage, { httpStatus: status });
  }
  if (status === 404 || status === 410) {
    return new DownloadEngineError(
      'INVALID_RESOURCE',
      'The download source is no longer available.',
      { httpStatus: status },
    );
  }
  if (status === 400) {
    return new DownloadEngineError('INVALID_RESOURCE', rawMessage, {
      httpStatus: status,
    });
  }
  if (status === 408) {
    return new DownloadEngineError('NETWORK_TIMEOUT', 'The connection timed out.', {
      httpStatus: status,
    });
  }
  if (status === 429) {
    return new DownloadEngineError(
      'RATE_LIMITED',
      'The server is temporarily busy. Try again shortly.',
      { httpStatus: status, retryAfterSeconds: retryAfter },
    );
  }
  if (status === 503) {
    return new DownloadEngineError('HTTP_ERROR', rawMessage, {
      httpStatus: status,
      retryAfterSeconds: retryAfter,
    });
  }
  if (status === 500 || status === 502 || status === 504) {
    return new DownloadEngineError('HTTP_ERROR', rawMessage, { httpStatus: status });
  }
  if (status >= 500) {
    return new DownloadEngineError('HTTP_ERROR', rawMessage, { httpStatus: status });
  }
  if (status >= 400) {
    return new DownloadEngineError('HTTP_ERROR', rawMessage, { httpStatus: status });
  }
  return new DownloadEngineError('UNKNOWN_ERROR', rawMessage, { httpStatus: status });
}

/**
 * Map native/runtime transfer failures into stable engine codes.
 * Never returns stack traces or raw credential-bearing URLs to callers.
 */
export function classifyTransferError(error: unknown): DownloadEngineError {
  return classifyTransferFailure(error).error;
}

/**
 * Canonical failure classifier for retry decisions.
 */
export function classifyTransferFailure(error: unknown): FailureClassification {
  const classified = normalizeToEngineError(error);
  const retryAfterMs =
    classified.retryAfterSeconds != null
      ? parseRetryAfterMs(String(classified.retryAfterSeconds))
      : null;

  // HTTP 4xx (except 408/429) must not auto-retry even if code is HTTP_ERROR.
  const status = classified.httpStatus;
  let autoRetryable = isAutoRetryableCode(classified.code);
  if (status != null && status >= 400 && status < 500 && status !== 408 && status !== 429) {
    autoRetryable = false;
  }
  if (status === 408 || status === 429 || (status != null && status >= 500)) {
    autoRetryable = true;
  }

  return {
    error: classified,
    autoRetryable,
    manualRetryable: isManualRetryAllowed(classified.code),
    retryAfterMs,
  };
}

function normalizeToEngineError(error: unknown): DownloadEngineError {
  if (error instanceof DownloadEngineError) {
    return error;
  }

  if (error instanceof Error) {
    const name = error.name.toLowerCase();
    const message = error.message.toLowerCase();
    const rawMessage = error.message;

    if (name === 'aborterror' || message.includes('abort')) {
      return new DownloadEngineError('CANCELLED', 'Download cancelled.');
    }

    const httpStatus = extractHttpStatus(rawMessage);
    if (httpStatus != null) {
      return classifyHttpStatus(httpStatus, rawMessage);
    }

    if (message.includes('timed out') || message.includes('timeout')) {
      return new DownloadEngineError('NETWORK_TIMEOUT', 'The connection timed out.');
    }

    if (
      message.includes('network') ||
      message.includes('offline') ||
      message.includes('econnreset') ||
      message.includes('connection reset') ||
      message.includes('connection closed') ||
      message.includes('premature') ||
      message.includes('socket') ||
      message.includes('dns') ||
      message.includes('unable to resolve') ||
      message.includes('unknown host')
    ) {
      return new DownloadEngineError('NETWORK_ERROR', rawMessage);
    }

    if (
      message.includes('no space') ||
      message.includes('enospc') ||
      message.includes('not enough storage') ||
      message.includes('disk full')
    ) {
      return new DownloadEngineError('INSUFFICIENT_STORAGE', rawMessage);
    }

    if (message.includes('eacces') || message.includes('eperm') || message.includes('permission')) {
      return new DownloadEngineError('PERMISSION_DENIED', rawMessage);
    }

    if (
      message.includes('enoent') ||
      message.includes('file system') ||
      message.includes('filesystem') ||
      message.includes('could not write') ||
      message.includes('failed to write') ||
      message.includes('write failed')
    ) {
      return new DownloadEngineError('FILE_WRITE_FAILED', rawMessage);
    }

    if (message.includes('resume') || message.includes('cannot resume')) {
      return new DownloadEngineError('RESUME_UNSUPPORTED', rawMessage);
    }

    if (
      message.includes('ext-x-key') ||
      message.includes('sample-aes') ||
      message.includes('encrypted hls') ||
      message.includes('encrypted stream')
    ) {
      return new DownloadEngineError('UNSUPPORTED_HLS_ENCRYPTION', rawMessage);
    }

    if (message.includes('drm') || message.includes('widevine') || message.includes('fairplay')) {
      return new DownloadEngineError('UNSUPPORTED_DRM', rawMessage);
    }

    if (message.includes('ext-x-byterange') || message.includes('byte-range hls')) {
      return new DownloadEngineError('UNSUPPORTED_HLS_BYTERANGE', rawMessage);
    }

    if (message.includes('live hls') || message.includes('without endlist')) {
      return new DownloadEngineError('LIVE_HLS_UNSUPPORTED', rawMessage);
    }

    if (
      message.includes('unsupported') ||
      message.includes('invalid url') ||
      message.includes('malformed')
    ) {
      return new DownloadEngineError('INVALID_RESOURCE', rawMessage);
    }

    return new DownloadEngineError('UNKNOWN_ERROR', rawMessage);
  }

  return new DownloadEngineError('UNKNOWN_ERROR', 'Unknown download failure.');
}
