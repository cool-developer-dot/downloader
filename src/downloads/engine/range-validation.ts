/**
 * Pure HTTP Range / Content-Range validation for progressive resume.
 * Never append without a validated 206 whose start equals the on-disk offset.
 */

import { DownloadEngineError } from './errors';
import type { RangeValidators } from './types';
import {
  etagsConflict,
  lastModifiedConflict,
} from './source-validators';

export type ParsedContentRange = {
  start: number;
  end: number | null;
  total: number | null;
};

export function parseContentRange(header: string | null | undefined): ParsedContentRange | null {
  if (!header || typeof header !== 'string') {
    return null;
  }
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(header.trim());
  if (!match?.[1] || !match[2] || !match[3]) {
    return null;
  }
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isFinite(start) || start < 0 || !Number.isFinite(end) || end < start) {
    return null;
  }
  const totalRaw = match[3];
  const total =
    totalRaw === '*'
      ? null
      : (() => {
          const value = Number(totalRaw);
          return Number.isFinite(value) && value > 0 ? Math.trunc(value) : null;
        })();
  return {
    start: Math.trunc(start),
    end: Math.trunc(end),
    total,
  };
}

export type RangeResponseValidation = {
  totalBytes: number | null;
  expectedRemaining: number | null;
  validators: RangeValidators;
};

/**
 * Validate a Range resume response. Never returns success for HTTP 200.
 */
export function validateRangeResumeResponse(options: {
  status: number;
  contentRange: string | null;
  etag?: string | null;
  lastModified?: string | null;
  contentLength?: string | null;
  offset: number;
  sentIfRange: boolean;
  knownTotalBytes?: number | null;
  priorValidators?: RangeValidators | null;
}): RangeResponseValidation {
  const {
    status,
    contentRange,
    offset,
    sentIfRange,
    knownTotalBytes,
    priorValidators,
  } = options;

  if (status === 200) {
    if (sentIfRange) {
      throw new DownloadEngineError(
        'SOURCE_CHANGED',
        'The download source changed and can’t be resumed safely.',
      );
    }
    throw new DownloadEngineError(
      'RESUME_UNSUPPORTED',
      'This media source doesn’t allow resuming a partial download.',
    );
  }

  if (status === 416) {
    throw new DownloadEngineError(
      'RANGE_REJECTED',
      'Unable to resume this download.',
    );
  }

  if (status !== 206) {
    throw new DownloadEngineError(
      'RANGE_REJECTED',
      'This media source doesn’t allow resuming a partial download.',
    );
  }

  const parsed = parseContentRange(contentRange);
  if (!parsed) {
    throw new DownloadEngineError(
      'INVALID_RANGE_RESPONSE',
      'The media source returned an invalid Content-Range header.',
    );
  }

  if (parsed.start !== Math.trunc(offset)) {
    throw new DownloadEngineError(
      'INVALID_RANGE_RESPONSE',
      'The media source returned a Content-Range that does not match the partial file.',
    );
  }

  if (
    knownTotalBytes != null &&
    knownTotalBytes > 0 &&
    parsed.total != null &&
    parsed.total !== Math.trunc(knownTotalBytes)
  ) {
    throw new DownloadEngineError(
      'SOURCE_CHANGED',
      'The download source changed and can’t be resumed safely.',
    );
  }

  if (
    priorValidators?.contentLength != null &&
    priorValidators.contentLength > 0 &&
    // Ignore obviously-wrong slice lengths (e.g. stale bytes=0-0 Content-Length).
    priorValidators.contentLength > Math.trunc(offset) &&
    parsed.total != null &&
    parsed.total !== Math.trunc(priorValidators.contentLength)
  ) {
    throw new DownloadEngineError(
      'SOURCE_CHANGED',
      'The download source changed and can’t be resumed safely.',
    );
  }

  const responseValidators: RangeValidators = {
    etag: options.etag ?? null,
    lastModified: options.lastModified ?? null,
    contentLength: parsed.total,
  };

  if (etagsConflict(priorValidators?.etag, responseValidators.etag)) {
    throw new DownloadEngineError(
      'SOURCE_CHANGED',
      'The download source changed and can’t be resumed safely.',
    );
  }

  if (
    lastModifiedConflict(
      priorValidators?.lastModified,
      responseValidators.lastModified,
    )
  ) {
    throw new DownloadEngineError(
      'SOURCE_CHANGED',
      'The download source changed and can’t be resumed safely.',
    );
  }

  const contentLengthHeader = options.contentLength
    ? Number(options.contentLength)
    : NaN;
  const expectedRemaining =
    parsed.end != null
      ? parsed.end - offset + 1
      : parsed.total != null
        ? parsed.total - offset
        : Number.isFinite(contentLengthHeader) && contentLengthHeader > 0
          ? Math.trunc(contentLengthHeader)
          : null;

  if (
    Number.isFinite(contentLengthHeader) &&
    contentLengthHeader > 0 &&
    expectedRemaining != null &&
    Math.abs(contentLengthHeader - expectedRemaining) > 1024
  ) {
    throw new DownloadEngineError(
      'INVALID_RANGE_RESPONSE',
      'The media source returned an inconsistent Content-Length for this Range.',
    );
  }

  return {
    totalBytes: parsed.total,
    expectedRemaining:
      expectedRemaining != null && expectedRemaining > 0
        ? expectedRemaining
        : null,
    validators: responseValidators,
  };
}
