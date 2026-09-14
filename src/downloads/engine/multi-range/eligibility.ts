/**
 * Multi-range eligibility — progressive only, never HLS.
 * Confirms Range with a real probe when possible (not Accept-Ranges alone).
 */

import { DOWNLOAD_ENGINE } from '../constants';
import { DownloadEngineError } from '../errors';
import { isPlaylistOrStreamUrl, isSafeHttpUrl } from '../resource-guard';
import type { RangeValidators } from '../types';
import { parseContentRange } from '../range-validation';
import { recommendWorkerCount } from './planner';
import { MULTI_RANGE } from './constants';

export type MultiRangeIneligibleReason =
  | 'HLS'
  | 'UNSAFE_URL'
  | 'UNKNOWN_SIZE'
  | 'TOO_SMALL'
  | 'RANGE_UNSUPPORTED'
  | 'PLATFORM_UNSUPPORTED'
  | 'UNSTABLE_SOURCE'
  | 'PROBE_FAILED';

export type MultiRangeEligibility =
  | {
      eligible: true;
      contentLength: number;
      rangeSupported: true;
      recommendedWorkers: number;
      validators: RangeValidators | null;
    }
  | {
      eligible: false;
      reason: MultiRangeIneligibleReason;
      contentLength: number | null;
      rangeSupported: boolean | null;
      recommendedWorkers: 1;
      validators: RangeValidators | null;
    };

function ineligible(
  reason: MultiRangeIneligibleReason,
  extras?: {
    contentLength?: number | null;
    rangeSupported?: boolean | null;
    validators?: RangeValidators | null;
  },
): MultiRangeEligibility {
  return {
    eligible: false,
    reason,
    contentLength: extras?.contentLength ?? null,
    rangeSupported: extras?.rangeSupported ?? null,
    recommendedWorkers: 1,
    validators: extras?.validators ?? null,
  };
}

/**
 * Confirm the origin honors a tiny closed Range with 206 + Content-Range.
 */
export async function confirmRangeSupport(
  sourceUrl: string,
  signal?: AbortSignal,
  sessionHeaders?: Record<string, string> | null,
): Promise<{
  supported: boolean;
  contentLength: number | null;
  validators: RangeValidators | null;
  status: number | null;
}> {
  let response: Response;
  try {
    const headers =
      sessionHeaders && Object.keys(sessionHeaders).length > 0
        ? { ...sessionHeaders, Range: 'bytes=0-0' }
        : { Range: 'bytes=0-0' };
    response = await fetch(sourceUrl, {
      method: 'GET',
      headers,
      signal,
    });
  } catch {
    if (signal?.aborted) {
      throw new DownloadEngineError('CANCELLED', 'Download cancelled.');
    }
    return {
      supported: false,
      contentLength: null,
      validators: null,
      status: null,
    };
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

    const validators: RangeValidators = {
      etag: response.headers.get('ETag'),
      lastModified: response.headers.get('Last-Modified'),
      contentLength: null,
    };

    if (response.status === 200) {
      const lengthHeader = response.headers.get('Content-Length');
      const length =
        lengthHeader && /^\d+$/.test(lengthHeader)
          ? Number(lengthHeader)
          : null;
      return {
        supported: false,
        contentLength:
          length != null && Number.isFinite(length) && length > 0
            ? Math.trunc(length)
            : null,
        validators,
        status: 200,
      };
    }

    if (response.status !== 206) {
      return {
        supported: false,
        contentLength: null,
        validators,
        status: response.status,
      };
    }

    const parsed = parseContentRange(response.headers.get('Content-Range'));
    if (!parsed || parsed.start !== 0) {
      return {
        supported: false,
        contentLength: parsed?.total ?? null,
        validators,
        status: 206,
      };
    }

    validators.contentLength = parsed.total;
    return {
      supported: true,
      contentLength: parsed.total,
      validators,
      status: 206,
    };
  } finally {
    // body cancelled above
  }
}

export async function evaluateMultiRangeEligibility(options: {
  sourceUrl: string;
  knownFileSize?: number | null;
  platformOs?: string;
  priorValidators?: RangeValidators | null;
  signal?: AbortSignal;
  sessionHeaders?: Record<string, string> | null;
}): Promise<MultiRangeEligibility> {
  const {
    sourceUrl,
    knownFileSize,
    platformOs,
    priorValidators,
    signal,
    sessionHeaders,
  } = options;

  if (!isSafeHttpUrl(sourceUrl)) {
    return ineligible('UNSAFE_URL');
  }
  if (isPlaylistOrStreamUrl(sourceUrl)) {
    return ineligible('HLS');
  }

  // Multi-range uses expo/fetch Range streaming — Android-first (same as Phase 2 append).
  if (platformOs && platformOs !== 'android') {
    return ineligible('PLATFORM_UNSUPPORTED', {
      contentLength:
        typeof knownFileSize === 'number' && knownFileSize > 0
          ? Math.trunc(knownFileSize)
          : priorValidators?.contentLength ?? null,
    });
  }

  const probe = await confirmRangeSupport(sourceUrl, signal, sessionHeaders);
  const contentLength =
    probe.contentLength ??
    (typeof knownFileSize === 'number' && knownFileSize > 0
      ? Math.trunc(knownFileSize)
      : priorValidators?.contentLength ?? null);

  if (!probe.supported) {
    return ineligible('RANGE_UNSUPPORTED', {
      contentLength,
      rangeSupported: false,
      validators: probe.validators,
    });
  }

  if (contentLength == null || contentLength <= 0) {
    return ineligible('UNKNOWN_SIZE', {
      rangeSupported: true,
      validators: probe.validators,
    });
  }

  if (contentLength < MULTI_RANGE.minBytes) {
    return ineligible('TOO_SMALL', {
      contentLength,
      rangeSupported: true,
      validators: probe.validators,
    });
  }

  if (
    priorValidators?.contentLength != null &&
    priorValidators.contentLength > 0 &&
    priorValidators.contentLength !== contentLength
  ) {
    return ineligible('UNSTABLE_SOURCE', {
      contentLength,
      rangeSupported: true,
      validators: probe.validators,
    });
  }

  const recommended = recommendWorkerCount(contentLength);
  if (recommended <= 1) {
    return ineligible('TOO_SMALL', {
      contentLength,
      rangeSupported: true,
      validators: probe.validators,
    });
  }

  return {
    eligible: true,
    contentLength,
    rangeSupported: true,
    recommendedWorkers: Math.min(
      recommended,
      DOWNLOAD_ENGINE.maxRangesPerFile,
    ),
    validators: probe.validators,
  };
}
