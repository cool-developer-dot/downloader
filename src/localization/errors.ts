import type { ApiErrorCode } from '@/api/types';
import { isApiError } from '@/api/errors';
import type { DownloadEngineErrorCode } from '@/downloads/engine/types';
import type { PlayerErrorCode } from '@/player/types';

import { translate } from './translate';
import type { TranslationKey } from './types';

const API_ERROR_KEYS: Record<ApiErrorCode, TranslationKey> = {
  NETWORK_ERROR: 'errors.codes.NETWORK_ERROR',
  TIMEOUT: 'errors.codes.TIMEOUT',
  UNAUTHORIZED: 'errors.codes.UNAUTHORIZED',
  FORBIDDEN: 'errors.codes.FORBIDDEN',
  NOT_FOUND: 'errors.codes.NOT_FOUND',
  VALIDATION_ERROR: 'errors.codes.VALIDATION_ERROR',
  CONFLICT: 'errors.codes.UNKNOWN_ERROR',
  SERVER_ERROR: 'errors.codes.SERVER_ERROR',
  UNEXPECTED_RESPONSE: 'errors.codes.UNKNOWN_ERROR',
  UNKNOWN: 'errors.codes.UNKNOWN_ERROR',
};

const DOWNLOAD_ERROR_KEYS: Record<DownloadEngineErrorCode, TranslationKey> = {
  NETWORK_ERROR: 'errors.codes.NETWORK_ERROR',
  NETWORK_TIMEOUT: 'errors.codes.NETWORK_TIMEOUT',
  RATE_LIMITED: 'errors.codes.RATE_LIMITED',
  HTTP_ERROR: 'errors.codes.HTTP_ERROR',
  FILE_SYSTEM_ERROR: 'errors.codes.FILE_SYSTEM_ERROR',
  FILE_WRITE_FAILED: 'errors.codes.FILE_WRITE_FAILED',
  FILE_APPEND_FAILED: 'errors.codes.FILE_APPEND_FAILED',
  FILE_FINALIZE_FAILED: 'errors.codes.FILE_FINALIZE_FAILED',
  INSUFFICIENT_STORAGE: 'errors.codes.INSUFFICIENT_STORAGE',
  INVALID_DESTINATION: 'errors.codes.INVALID_DESTINATION',
  PERMISSION_DENIED: 'errors.codes.PERMISSION_DENIED',
  PARTIAL_FILE_CORRUPT: 'errors.codes.PARTIAL_FILE_CORRUPT',
  FINAL_FILE_INVALID: 'errors.codes.FINAL_FILE_INVALID',
  CANCELLED: 'errors.codes.CANCELLED',
  INVALID_RESOURCE: 'errors.codes.INVALID_RESOURCE',
  TRANSFER_INTERRUPTED: 'errors.codes.TRANSFER_INTERRUPTED',
  PAUSE_FAILED: 'errors.codes.PAUSE_FAILED',
  RESUME_FAILED: 'errors.codes.RESUME_FAILED',
  RESUME_UNSUPPORTED: 'errors.codes.RESUME_UNSUPPORTED',
  RESUME_STATE_MISSING: 'errors.codes.RESUME_STATE_MISSING',
  RESUME_STATE_CONFLICT: 'errors.codes.RESUME_STATE_CONFLICT',
  QUEUE_ADMISSION_FAILED: 'errors.codes.QUEUE_ADMISSION_FAILED',
  PARTIAL_FILE_MISSING: 'errors.codes.PARTIAL_FILE_MISSING',
  RANGE_REJECTED: 'errors.codes.RANGE_REJECTED',
  INVALID_RANGE_RESPONSE: 'errors.codes.INVALID_RANGE_RESPONSE',
  SOURCE_CHANGED: 'errors.codes.SOURCE_CHANGED',
  RETRY_EXHAUSTED: 'errors.codes.RETRY_EXHAUSTED',
  MERGE_FAILED: 'errors.codes.MERGE_FAILED',
  PART_SIZE_MISMATCH: 'errors.codes.PART_SIZE_MISMATCH',
  FINAL_SIZE_MISMATCH: 'errors.codes.FINAL_SIZE_MISMATCH',
  CANCEL_FAILED: 'errors.codes.CANCEL_FAILED',
  WORKER_NOT_FOUND: 'errors.codes.WORKER_NOT_FOUND',
  AUTH_ERROR: 'errors.codes.AUTH_ERROR',
  SESSION_CONTEXT_LOST: 'errors.codes.SESSION_CONTEXT_LOST',
  SESSION_CHANGED: 'errors.codes.SESSION_CHANGED',
  SESSION_EXPIRED: 'errors.codes.SESSION_EXPIRED',
  AUTH_CONTEXT_UNAVAILABLE: 'errors.codes.AUTH_CONTEXT_UNAVAILABLE',
  HLS_UNSUPPORTED: 'errors.codes.HLS_UNSUPPORTED',
  HLS_ENCRYPTED: 'errors.codes.HLS_ENCRYPTED',
  UNSUPPORTED_DRM: 'errors.codes.UNSUPPORTED_DRM',
  UNSUPPORTED_HLS_ENCRYPTION: 'errors.codes.UNSUPPORTED_HLS_ENCRYPTION',
  LIVE_HLS_UNSUPPORTED: 'errors.codes.LIVE_HLS_UNSUPPORTED',
  UNSUPPORTED_HLS_BYTERANGE: 'errors.codes.UNSUPPORTED_HLS_BYTERANGE',
  INVALID_HLS_PLAYLIST: 'errors.codes.INVALID_HLS_PLAYLIST',
  FIRST_BYTE_TIMEOUT: 'errors.codes.NETWORK_TIMEOUT',
  TRANSFER_STALLED: 'errors.codes.TRANSFER_INTERRUPTED',
  PROBE_TIMEOUT: 'errors.codes.TIMEOUT',
  PROBE_TOO_LARGE: 'errors.codes.INVALID_RESOURCE',
  HLS_MANIFEST_TIMEOUT: 'errors.codes.NETWORK_TIMEOUT',
  HLS_SEGMENT_TIMEOUT: 'errors.codes.NETWORK_TIMEOUT',
  UNKNOWN_ERROR: 'errors.codes.UNKNOWN_ERROR',
};

export function localizeApiErrorCode(code: string): string {
  const key = API_ERROR_KEYS[code as ApiErrorCode] ?? 'errors.codes.UNKNOWN_ERROR';
  return translate(key);
}

export function localizeDownloadErrorCode(code: string): string {
  const key =
    DOWNLOAD_ERROR_KEYS[code as DownloadEngineErrorCode] ?? 'errors.codes.UNKNOWN_ERROR';
  return translate(key);
}

export function localizePlayerError(
  code: PlayerErrorCode,
): { title: string; message: string } {
  return {
    title: translate(`player.errors.${code}.title` as TranslationKey),
    message: translate(`player.errors.${code}.message` as TranslationKey),
  };
}

export function localizeUnknownError(error: unknown): string {
  if (isApiError(error)) {
    return localizeApiErrorCode(error.code);
  }

  if (error && typeof error === 'object' && 'code' in error) {
    const code = String((error as { code?: unknown }).code ?? '');
    if (code in DOWNLOAD_ERROR_KEYS) {
      return localizeDownloadErrorCode(code);
    }
    if (code in API_ERROR_KEYS) {
      return localizeApiErrorCode(code);
    }
  }

  return translate('errors.unexpected');
}
