/**
 * Segment-level retry decisions — reuses the engine failure classifier.
 */

import {
  classifyTransferFailure,
  DownloadEngineError,
} from '../errors';
import { isAutoRetryableCode } from '../retry-policy';
import type { DownloadEngineErrorCode } from '../types';
import { HLS_TRANSFER } from './constants';

const NEVER_RETRY_SEGMENT = new Set<DownloadEngineErrorCode>([
  'CANCELLED',
  'INVALID_RESOURCE',
  'AUTH_ERROR',
  'HLS_UNSUPPORTED',
  'HLS_ENCRYPTED',
  'UNSUPPORTED_DRM',
  'UNSUPPORTED_HLS_ENCRYPTION',
  'LIVE_HLS_UNSUPPORTED',
  'UNSUPPORTED_HLS_BYTERANGE',
  'INVALID_HLS_PLAYLIST',
  'INSUFFICIENT_STORAGE',
  'PERMISSION_DENIED',
]);

export function isUnrecoverableHlsCode(code: DownloadEngineErrorCode): boolean {
  return (
    code === 'HLS_UNSUPPORTED' ||
    code === 'HLS_ENCRYPTED' ||
    code === 'UNSUPPORTED_DRM' ||
    code === 'UNSUPPORTED_HLS_ENCRYPTION' ||
    code === 'LIVE_HLS_UNSUPPORTED' ||
    code === 'UNSUPPORTED_HLS_BYTERANGE' ||
    code === 'INVALID_HLS_PLAYLIST' ||
    code === 'INVALID_RESOURCE' ||
    code === 'AUTH_ERROR'
  );
}

export function isSegmentRetryable(error: unknown): boolean {
  if (error instanceof DownloadEngineError && NEVER_RETRY_SEGMENT.has(error.code)) {
    return false;
  }
  const classified = classifyTransferFailure(error);
  if (NEVER_RETRY_SEGMENT.has(classified.error.code)) {
    return false;
  }
  return classified.autoRetryable || isAutoRetryableCode(classified.error.code);
}

export function segmentRetryDelayMs(attempt: number): number {
  const n = Math.max(0, Math.trunc(attempt));
  return Math.min(
    HLS_TRANSFER.segmentRetryMaxMs,
    HLS_TRANSFER.segmentRetryBaseMs * 2 ** n,
  );
}
