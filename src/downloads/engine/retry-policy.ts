/**
 * Bounded retry policy — classification lives in errors.ts;
 * delay / budget math lives here so workers stay free of retry scheduling.
 */

import { DOWNLOAD_ENGINE, MAX_AUTO_RETRY_ATTEMPTS } from './constants';
import type { DownloadEngineErrorCode } from './types';

export { MAX_AUTO_RETRY_ATTEMPTS };

/** Codes that may auto-retry (bounded). */
const AUTO_RETRYABLE = new Set<DownloadEngineErrorCode>([
  'NETWORK_ERROR',
  'NETWORK_TIMEOUT',
  'FIRST_BYTE_TIMEOUT',
  'TRANSFER_STALLED',
  'HLS_MANIFEST_TIMEOUT',
  'HLS_SEGMENT_TIMEOUT',
  'RATE_LIMITED',
  'HTTP_ERROR',
  'TRANSFER_INTERRUPTED',
  'UNKNOWN_ERROR',
]);

/** Codes that must never auto-retry (manual may still be allowed). */
const NEVER_AUTO_RETRY = new Set<DownloadEngineErrorCode>([
  'CANCELLED',
  'INVALID_RESOURCE',
  'AUTH_ERROR',
  'SESSION_CONTEXT_LOST',
  'SESSION_CHANGED',
  'SESSION_EXPIRED',
  'AUTH_CONTEXT_UNAVAILABLE',
  'HLS_UNSUPPORTED',
  'HLS_ENCRYPTED',
  'UNSUPPORTED_DRM',
  'UNSUPPORTED_HLS_ENCRYPTION',
  'LIVE_HLS_UNSUPPORTED',
  'UNSUPPORTED_HLS_BYTERANGE',
  'INVALID_HLS_PLAYLIST',
  'SOURCE_CHANGED',
  'INSUFFICIENT_STORAGE',
  'FILE_WRITE_FAILED',
  'FILE_APPEND_FAILED',
  'FILE_FINALIZE_FAILED',
  'INVALID_DESTINATION',
  'PERMISSION_DENIED',
  'PARTIAL_FILE_CORRUPT',
  'FINAL_FILE_INVALID',
  'RESUME_UNSUPPORTED',
  'RESUME_STATE_MISSING',
  'RESUME_STATE_CONFLICT',
  'QUEUE_ADMISSION_FAILED',
  'RESUME_FAILED',
  'PARTIAL_FILE_MISSING',
  'RANGE_REJECTED',
  'INVALID_RANGE_RESPONSE',
  'RETRY_EXHAUSTED',
  'MERGE_FAILED',
  'PART_SIZE_MISMATCH',
  'FINAL_SIZE_MISMATCH',
  'PAUSE_FAILED',
  'CANCEL_FAILED',
  'WORKER_NOT_FOUND',
]);

/** Manual Retry allowed after FAILED (user can free storage / fix transient). */
const MANUAL_RETRY_BLOCKED = new Set<DownloadEngineErrorCode>([
  'CANCELLED',
  'INVALID_RESOURCE',
  'AUTH_ERROR',
  'HLS_ENCRYPTED',
  'UNSUPPORTED_DRM',
  'UNSUPPORTED_HLS_ENCRYPTION',
  'LIVE_HLS_UNSUPPORTED',
  'UNSUPPORTED_HLS_BYTERANGE',
  'INVALID_HLS_PLAYLIST',
  'HLS_UNSUPPORTED',
]);

export function isAutoRetryableCode(code: DownloadEngineErrorCode): boolean {
  if (NEVER_AUTO_RETRY.has(code)) {
    return false;
  }
  return AUTO_RETRYABLE.has(code);
}

export function isManualRetryAllowed(code: DownloadEngineErrorCode | null): boolean {
  if (!code) {
    return true;
  }
  return !MANUAL_RETRY_BLOCKED.has(code);
}

/**
 * Exponential backoff: attempt 1 → 1s, 2 → 2s, 3 → 4s, capped.
 * `retryCount` is the number of auto retries already completed (0 → first retry).
 */
export function computeRetryDelayMs(
  retryCount: number,
  retryAfterMs?: number | null,
): number {
  const attempt = Math.max(0, Math.trunc(retryCount));
  const exponential = Math.min(
    DOWNLOAD_ENGINE.retryBackoffMaxMs,
    DOWNLOAD_ENGINE.retryBackoffBaseMs * 2 ** attempt,
  );
  if (
    typeof retryAfterMs === 'number' &&
    Number.isFinite(retryAfterMs) &&
    retryAfterMs > 0
  ) {
    return Math.min(
      DOWNLOAD_ENGINE.retryBackoffMaxMs,
      Math.max(exponential, Math.trunc(retryAfterMs)),
    );
  }
  return exponential;
}

/** ±20% jitter for schedule-time use — keeps computeRetryDelayMs deterministic. */
export function applyRetryJitter(delayMs: number): number {
  const base = Math.max(0, Math.trunc(delayMs));
  const jitter = Math.floor(base * 0.2 * (Math.random() * 2 - 1));
  return Math.max(
    250,
    Math.min(DOWNLOAD_ENGINE.retryBackoffMaxMs, base + jitter),
  );
}

/**
 * Parse Retry-After: delta-seconds or HTTP-date. Clamped to max backoff.
 */
export function parseRetryAfterMs(
  header: string | null | undefined,
  now = Date.now(),
): number | null {
  if (!header?.trim()) {
    return null;
  }
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isFinite(seconds) || seconds < 0) {
      return null;
    }
    return Math.min(
      DOWNLOAD_ENGINE.retryBackoffMaxMs,
      Math.trunc(seconds * 1000),
    );
  }
  const dateMs = Date.parse(trimmed);
  if (!Number.isFinite(dateMs)) {
    return null;
  }
  const delta = dateMs - now;
  if (delta <= 0) {
    return 0;
  }
  return Math.min(DOWNLOAD_ENGINE.retryBackoffMaxMs, Math.trunc(delta));
}

export function shouldScheduleAutoRetry(options: {
  retryEligible: boolean;
  retryCount: number;
  errorCode: DownloadEngineErrorCode | null;
}): boolean {
  if (!options.retryEligible) {
    return false;
  }
  if (options.retryCount >= DOWNLOAD_ENGINE.maxAutoRetryAttempts) {
    return false;
  }
  if (!options.errorCode || !isAutoRetryableCode(options.errorCode)) {
    return false;
  }
  return true;
}
