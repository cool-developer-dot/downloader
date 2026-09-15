/**
 * Single multi-range part worker — downloads exactly bytes=start-end to its part file.
 * Reuses Phase 2 Range validation + source identity rules.
 */

import { fetch } from 'expo/fetch';
import { File, FileMode } from 'expo-file-system';

import { classifyTransferError, DownloadEngineError } from '../errors';
import { assertValidMediaHttpResponse } from '../http-response-validation';
import { isSafeHttpUrl } from '../resource-guard';
import { validateRangeResumeResponse } from '../range-validation';
import { assertSourceIdentityCompatible } from '../source-identity';
import { mergeRangeValidatorsWithLength } from '../source-validators';
import type { RangeValidators } from '../types';
import { MULTI_RANGE } from './constants';
import { readPartFileSize } from './paths';
import type { PlannedRange } from './planner';
import {
  createTimeoutAbortSignal,
  TRANSFER_TIMEOUTS,
} from '../transfer-timeouts';
import type { StallWatchdog } from '../stall-watchdog';

export type PartProgressEvent = {
  partIndex: number;
  downloadedBytes: number;
  plannedLength: number;
};

function deleteQuiet(file: File): void {
  try {
    if (file.exists) {
      file.delete();
    }
  } catch {
    // ignore
  }
}

function buildHeaders(
  start: number,
  end: number,
  validators?: RangeValidators | null,
  sessionHeaders?: Record<string, string> | null,
): { headers: Record<string, string>; sentIfRange: boolean } {
  const headers: Record<string, string> = {
    ...(sessionHeaders ?? {}),
    Range: `bytes=${start}-${end}`,
  };
  const etag = validators?.etag?.trim();
  const lastModified = validators?.lastModified?.trim();
  let sentIfRange = false;
  if (etag) {
    headers['If-Range'] = etag;
    sentIfRange = true;
  } else if (lastModified) {
    headers['If-Range'] = lastModified;
    sentIfRange = true;
  }
  return { headers, sentIfRange };
}

async function streamToPartFile(
  response: Response,
  destination: File,
  append: boolean,
  maxBytes: number,
  signal: AbortSignal,
  shouldPause: () => boolean,
  onBytes: (writtenThisSession: number) => void,
  stallWatchdog?: StallWatchdog | null,
): Promise<number> {
  if (!append) {
    deleteQuiet(destination);
  }

  const mode = append ? FileMode.Append : FileMode.WriteOnly;
  const sink = destination.open(mode);
  let written = 0;

  try {
    const body = response.body;
    if (!body) {
      // Never buffer an entire part in JS heap.
      throw new DownloadEngineError(
        'TRANSFER_INTERRUPTED',
        'Response body stream is unavailable.',
      );
    }

    const reader = body.getReader();
    try {
      while (true) {
        if (shouldPause()) {
          throw new DownloadEngineError('CANCELLED', 'Download paused.');
        }
        if (signal.aborted) {
          throw new DownloadEngineError('CANCELLED', 'Download cancelled.');
        }
        stallWatchdog?.assertHealthy();
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (!value || value.byteLength === 0) {
          continue;
        }
        let offset = 0;
        while (offset < value.byteLength) {
          if (shouldPause()) {
            throw new DownloadEngineError('CANCELLED', 'Download paused.');
          }
          if (signal.aborted) {
            throw new DownloadEngineError('CANCELLED', 'Download cancelled.');
          }
          if (written >= maxBytes) {
            // Ignore trailing padding; stop cleanly.
            try {
              await reader.cancel();
            } catch {
              // ignore
            }
            return written;
          }
          const room = maxBytes - written;
          const end = Math.min(
            offset + MULTI_RANGE.ioChunkBytes,
            value.byteLength,
            offset + room,
          );
          const slice = value.subarray(offset, end);
          sink.writeBytes(slice);
          written += slice.byteLength;
          offset = end;
          onBytes(written);
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // ignore
      }
    }
  } finally {
    try {
      sink.close();
    } catch {
      // ignore
    }
  }

  return written;
}

/**
 * Download (or resume) one planned range into its dedicated part file.
 * @returns final on-disk part size, or null when paused.
 */
export async function downloadRangePart(options: {
  sourceUrl: string;
  partFile: File;
  range: PlannedRange;
  /** Bytes already on disk for this part (authoritative). */
  existingBytes: number;
  contentLength: number;
  validators: RangeValidators | null;
  signal: AbortSignal;
  shouldPause: () => boolean;
  onProgress: (event: PartProgressEvent) => void;
  onValidators?: (validators: RangeValidators) => void;
  sessionHeaders?: Record<string, string> | null;
  stallWatchdog?: StallWatchdog | null;
}): Promise<number | null> {
  const {
    sourceUrl,
    partFile,
    range,
    contentLength,
    validators,
    signal,
    shouldPause,
    onProgress,
    onValidators,
    sessionHeaders,
    stallWatchdog,
  } = options;

  if (!isSafeHttpUrl(sourceUrl)) {
    throw new DownloadEngineError('INVALID_RESOURCE', 'Invalid download URL.');
  }

  const diskBytes = readPartFileSize(partFile);
  const existingBytes = Math.min(
    Math.max(0, Math.trunc(options.existingBytes)),
    diskBytes > 0 ? diskBytes : Math.max(0, Math.trunc(options.existingBytes)),
  );
  // Disk wins when present.
  const authoritativeExisting = diskBytes > 0 ? diskBytes : existingBytes;

  if (authoritativeExisting >= range.length) {
    onProgress({
      partIndex: range.index,
      downloadedBytes: range.length,
      plannedLength: range.length,
    });
    return range.length;
  }

  // Truncate oversized/corrupt part rather than append past the plan.
  if (diskBytes > range.length) {
    deleteQuiet(partFile);
  }

  const resumeFrom = Math.min(
    diskBytes > 0 && diskBytes <= range.length ? diskBytes : 0,
    range.length,
  );
  if (resumeFrom > 0 && resumeFrom !== diskBytes && diskBytes > 0) {
    // Persist/disk disagreement — prefer disk if within plan.
  }

  const absoluteStart = range.rangeStart + resumeFrom;
  const absoluteEnd = range.rangeEnd;
  if (absoluteStart > absoluteEnd) {
    onProgress({
      partIndex: range.index,
      downloadedBytes: range.length,
      plannedLength: range.length,
    });
    return range.length;
  }

  if (shouldPause()) {
    return null;
  }
  if (signal.aborted) {
    throw new DownloadEngineError('CANCELLED', 'Download cancelled.');
  }

  const { headers, sentIfRange } = buildHeaders(
    absoluteStart,
    absoluteEnd,
    validators,
    sessionHeaders,
  );

  onProgress({
    partIndex: range.index,
    downloadedBytes: resumeFrom,
    plannedLength: range.length,
  });

  let response: Response;
  const requestTimeout = createTimeoutAbortSignal(
    MULTI_RANGE.requestTimeoutMs,
    signal,
  );
  try {
    response = await fetch(sourceUrl, {
      method: 'GET',
      headers,
      signal: requestTimeout.signal,
    });
  } catch (error) {
    if (shouldPause()) {
      return null;
    }
    if (signal.aborted) {
      throw new DownloadEngineError('CANCELLED', 'Download cancelled.');
    }
    if (requestTimeout.signal.aborted && !signal.aborted) {
      throw new DownloadEngineError(
        'FIRST_BYTE_TIMEOUT',
        'Download could not start. Retrying…',
      );
    }
    throw classifyTransferError(error);
  } finally {
    requestTimeout.cleanup();
  }

  const finalUrl = response.url || sourceUrl;
  if (!isSafeHttpUrl(finalUrl)) {
    try {
      await response.body?.cancel();
    } catch {
      // ignore
    }
    throw new DownloadEngineError(
      'INVALID_RESOURCE',
      'Download redirect failed security checks.',
    );
  }

  try {
    assertValidMediaHttpResponse(response, { allowPartial: true });
  } catch (error) {
    try {
      await response.body?.cancel();
    } catch {
      // ignore
    }
    throw error;
  }

  let meta: ReturnType<typeof validateRangeResumeResponse>;
  try {
    meta = validateRangeResumeResponse({
      status: response.status,
      contentRange: response.headers.get('Content-Range'),
      etag: response.headers.get('ETag'),
      lastModified: response.headers.get('Last-Modified'),
      contentLength: response.headers.get('Content-Length'),
      offset: absoluteStart,
      sentIfRange,
      knownTotalBytes: contentLength,
      priorValidators: validators,
    });
  } catch (error) {
    try {
      await response.body?.cancel();
    } catch {
      // ignore
    }
    throw error;
  }

  // Closed-range end must match assignment when Content-Range end is present.
  const rawRange = response.headers.get('Content-Range');
  const endMatch = rawRange
    ? /^bytes\s+\d+-(\d+)\//i.exec(rawRange.trim())
    : null;
  if (endMatch?.[1]) {
    const end = Number(endMatch[1]);
    if (Number.isFinite(end) && Math.trunc(end) !== absoluteEnd) {
      try {
        await response.body?.cancel();
      } catch {
        // ignore
      }
      throw new DownloadEngineError(
        'INVALID_RANGE_RESPONSE',
        'The media source returned a Content-Range end outside the assigned part.',
      );
    }
  }

  try {
    assertSourceIdentityCompatible(validators, meta.validators);
    onValidators?.(
      mergeRangeValidatorsWithLength(validators, {
        ...meta.validators,
        contentLength: contentLength,
      }) ?? meta.validators,
    );
  } catch (error) {
    try {
      await response.body?.cancel();
    } catch {
      // ignore
    }
    throw error;
  }

  if (shouldPause()) {
    try {
      await response.body?.cancel();
    } catch {
      // ignore
    }
    return null;
  }

  const remaining = range.length - resumeFrom;
  let sessionWritten = 0;
  try {
    sessionWritten = await streamToPartFile(
      response,
      partFile,
      resumeFrom > 0,
      remaining,
      signal,
      shouldPause,
      (written) => {
        onProgress({
          partIndex: range.index,
          downloadedBytes: resumeFrom + written,
          plannedLength: range.length,
        });
      },
      stallWatchdog,
    );
  } catch (error) {
    if (shouldPause()) {
      return null;
    }
    if (signal.aborted) {
      throw new DownloadEngineError('CANCELLED', 'Download cancelled.');
    }
    throw error instanceof DownloadEngineError
      ? error
      : classifyTransferError(error);
  }

  if (shouldPause()) {
    return null;
  }

  const finalSize = readPartFileSize(partFile);
  const effective = Math.max(finalSize, resumeFrom + sessionWritten);
  onProgress({
    partIndex: range.index,
    downloadedBytes: Math.min(effective, range.length),
    plannedLength: range.length,
  });

  if (effective < range.length) {
    // Incomplete without pause/cancel — treat as interrupt for retry.
    throw new DownloadEngineError(
      'TRANSFER_INTERRUPTED',
      'Range part download ended before the assigned bytes were complete.',
    );
  }

  if (effective > range.length + 1024) {
    deleteQuiet(partFile);
    throw new DownloadEngineError(
      'PART_SIZE_MISMATCH',
      'A download part exceeded its assigned range.',
    );
  }

  return Math.min(effective, range.length);
}
