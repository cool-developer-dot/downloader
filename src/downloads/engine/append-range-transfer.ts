/**
 * True HTTP Range resume for progressive downloads (Android).
 *
 * Expo DownloadTask.resumeAsync truncates the destination when the server
 * answers HTTP 200. This module never opens the destination for truncate:
 *
 * 1. Request Range: bytes=N- via expo/fetch
 * 2. Require HTTP 206 + Content-Range start == N (authoritative — not Accept-Ranges)
 * 3. Stream ONLY the remainder into a temp *.rangepart file
 * 4. Re-check original partial is still exactly N bytes
 * 5. Append temp onto the existing partial
 * 6. Remove temp
 *
 * A 200 response to a resume Range request is NEVER appended.
 * If If-Range was sent and the server returns 200 → SOURCE_CHANGED.
 */

import { fetch } from 'expo/fetch';
import { File, FileMode } from 'expo-file-system';

import { hardeningLog } from '../hardening-diagnostics';
import { assertValidMediaHttpResponse } from './http-response-validation';
import { DownloadEngineError, classifyTransferError } from './errors';
import { isSafeHttpUrl } from './resource-guard';
import { validateRangeResumeResponse } from './range-validation';
import { mergeRangeValidatorsWithLength } from './source-validators';
import type { StallWatchdog } from './stall-watchdog';
import type { RangeValidators } from './types';

const APPEND_CHUNK = 256 * 1024;
const WRITE_CHUNK = 256 * 1024;
const PROGRESS_MIN_INTERVAL_MS = 200;

export type AppendRangeProgress = {
  bytesWritten: number;
  totalBytes: number | null;
};

export type AppendRangeTransferOptions = {
  sourceUrl: string;
  destination: File;
  /** On-disk byte offset to resume from (must match destination.size). */
  offset: number;
  signal: AbortSignal;
  headers?: Record<string, string> | null;
  validators?: RangeValidators | null;
  /** Known full object size when available. */
  knownTotalBytes?: number | null;
  shouldPause: () => boolean;
  onProgress: (progress: AppendRangeProgress) => void;
  onValidators?: (validators: RangeValidators) => void;
  stallWatchdog?: StallWatchdog | null;
};

export type AppendRangeResult = {
  file: File;
  validators: RangeValidators;
};

function readSize(file: File): number {
  try {
    if (!file.exists) {
      return 0;
    }
    const size = file.size;
    return typeof size === 'number' && Number.isFinite(size) && size > 0
      ? Math.trunc(size)
      : 0;
  } catch {
    return 0;
  }
}

function deleteQuiet(file: File): void {
  try {
    if (file.exists) {
      file.delete();
    }
  } catch {
    // ignore
  }
}

function buildRangeHeaders(
  offset: number,
  base?: Record<string, string> | null,
  validators?: RangeValidators | null,
): { headers: Record<string, string>; sentIfRange: boolean } {
  const headers: Record<string, string> = {
    ...(base ?? {}),
    Range: `bytes=${offset}-`,
  };
  // Prefer ETag for If-Range; fall back to Last-Modified.
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

function appendTempToDestination(
  destination: File,
  temp: File,
  signal: AbortSignal,
  shouldPause: () => boolean,
): void {
  const source = temp.open(FileMode.ReadOnly);
  const sink = destination.open(FileMode.Append);
  try {
    while (true) {
      if (shouldPause()) {
        throw new DownloadEngineError('CANCELLED', 'Download paused.');
      }
      if (signal.aborted) {
        throw new DownloadEngineError('CANCELLED', 'Download cancelled.');
      }
      const chunk = source.readBytes(APPEND_CHUNK);
      if (!chunk || chunk.byteLength === 0) {
        break;
      }
      sink.writeBytes(chunk);
    }
  } finally {
    try {
      source.close();
    } catch {
      // ignore
    }
    try {
      sink.close();
    } catch {
      // ignore
    }
  }
}

async function streamResponseToTemp(
  response: Response,
  temp: File,
  signal: AbortSignal,
  shouldPause: () => boolean,
  onBytes: (written: number) => void,
  stallWatchdog?: StallWatchdog | null,
  cumulativeOffset = 0,
): Promise<number> {
  deleteQuiet(temp);
  const sink = temp.open(FileMode.WriteOnly);
  let written = 0;

  try {
    const body = response.body;
    if (!body) {
      // Never buffer an entire range response in JS heap.
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
          const end = Math.min(offset + WRITE_CHUNK, value.byteLength);
          sink.writeBytes(value.subarray(offset, end));
          written += end - offset;
          offset = end;
          onBytes(written);
          stallWatchdog?.noteBytes(cumulativeOffset + written);
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
 * Resume by requesting `Range: bytes={offset}-`, downloading the remainder to a
 * temp file after validating 206 + Content-Range, then appending.
 *
 * @returns destination File on completion, or `null` when paused.
 */
export async function resumeAppendRangeTransfer(
  options: AppendRangeTransferOptions,
): Promise<File | null> {
  const {
    sourceUrl,
    destination,
    offset,
    signal,
    headers,
    validators,
    knownTotalBytes,
    shouldPause,
    onProgress,
    onValidators,
    stallWatchdog,
  } = options;

  if (!isSafeHttpUrl(sourceUrl)) {
    throw new DownloadEngineError('INVALID_RESOURCE', 'Invalid download URL.');
  }
  if (offset <= 0) {
    throw new DownloadEngineError(
      'RESUME_FAILED',
      'Unable to resume this download.',
    );
  }

  const diskSize = readSize(destination);
  if (diskSize <= 0) {
    throw new DownloadEngineError(
      'PARTIAL_FILE_MISSING',
      'The partial download file is no longer available.',
    );
  }
  // Destination must still be exactly the paused size — never append onto a
  // truncated/grown file without re-validating.
  if (diskSize !== offset) {
    throw new DownloadEngineError(
      'RESUME_FAILED',
      'Unable to resume this download.',
    );
  }

  if (shouldPause()) {
    return null;
  }
  if (signal.aborted) {
    throw new DownloadEngineError('CANCELLED', 'Download cancelled.');
  }

  const { headers: rangeHeaders, sentIfRange } = buildRangeHeaders(
    offset,
    headers,
    validators,
  );

  onProgress({
    bytesWritten: offset,
    totalBytes:
      typeof knownTotalBytes === 'number' && knownTotalBytes > offset
        ? Math.trunc(knownTotalBytes)
        : null,
  });

  let response: Response;
  try {
    response = await fetch(sourceUrl, {
      method: 'GET',
      headers: rangeHeaders,
      signal,
    });
  } catch (error) {
    if (shouldPause()) {
      return null;
    }
    if (signal.aborted) {
      throw new DownloadEngineError('CANCELLED', 'Download cancelled.');
    }
    throw classifyTransferError(error);
  }

  // Redirect must still pass SSRF / protocol guards.
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
      offset,
      sentIfRange,
      knownTotalBytes,
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

  try {
    hardeningLog('download.resume_source_response', {
      httpStatus: response.status,
      offset,
      expectedSize: meta.totalBytes,
      contentRangeStart: offset,
    });
  } catch {
    // diagnostics must never break transfer
  }

  if (shouldPause()) {
    try {
      await response.body?.cancel();
    } catch {
      // ignore
    }
    return null;
  }

  try {
    onValidators?.(
      mergeRangeValidatorsWithLength(validators, meta.validators) ??
        meta.validators,
    );
  } catch {
    // ignore
  }

  const totalBytes =
    meta.totalBytes ??
    (typeof knownTotalBytes === 'number' && knownTotalBytes > offset
      ? Math.trunc(knownTotalBytes)
      : null);
  const expectedRemaining =
    meta.expectedRemaining ??
    (totalBytes != null ? totalBytes - offset : null);

  onProgress({
    bytesWritten: offset,
    totalBytes: totalBytes ?? null,
  });

  const temp = new File(
    destination.parentDirectory,
    `${destination.name}.rangepart`,
  );
  deleteQuiet(temp);

  let lastProgressAt = 0;
  const emitProgress = (writtenToTemp: number, force = false) => {
    const now = Date.now();
    if (!force && now - lastProgressAt < PROGRESS_MIN_INTERVAL_MS) {
      return;
    }
    lastProgressAt = now;
    const cumulative = offset + Math.max(0, writtenToTemp);
    onProgress({
      bytesWritten: cumulative,
      totalBytes: totalBytes ?? null,
    });
    stallWatchdog?.noteBytes(cumulative);
  };

  let tempWritten = 0;
  try {
    tempWritten = await streamResponseToTemp(
      response,
      temp,
      signal,
      shouldPause,
      (written) => emitProgress(written, false),
      stallWatchdog,
      offset,
    );
  } catch (error) {
    deleteQuiet(temp);
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
    deleteQuiet(temp);
    return null;
  }
  if (signal.aborted) {
    deleteQuiet(temp);
    throw new DownloadEngineError('CANCELLED', 'Download cancelled.');
  }

  // Re-check destination was not touched during the temp download.
  if (readSize(destination) !== offset) {
    deleteQuiet(temp);
    throw new DownloadEngineError(
      'RESUME_FAILED',
      'Unable to resume this download.',
    );
  }

  const tempSize = readSize(temp);
  if (tempSize <= 0 && tempWritten <= 0) {
    deleteQuiet(temp);
    throw new DownloadEngineError(
      'NETWORK_ERROR',
      'Resumed download produced no data.',
    );
  }

  const effectiveTempSize = tempSize > 0 ? tempSize : tempWritten;

  // Defense in depth: refuse an oversized payload that looks like a full-object rewrite.
  if (
    expectedRemaining != null &&
    effectiveTempSize > expectedRemaining + 256 * 1024
  ) {
    deleteQuiet(temp);
    throw new DownloadEngineError(
      'INVALID_RANGE_RESPONSE',
      'The resumed payload exceeded the expected Range size.',
    );
  }

  try {
    appendTempToDestination(destination, temp, signal, shouldPause);
  } catch (error) {
    deleteQuiet(temp);
    if (shouldPause()) {
      return null;
    }
    if (
      error instanceof DownloadEngineError &&
      error.code === 'CANCELLED' &&
      shouldPause()
    ) {
      return null;
    }
    if (error instanceof DownloadEngineError) {
      throw error;
    }
    throw new DownloadEngineError(
      'FILE_APPEND_FAILED',
      error instanceof Error ? error.message : 'Unable to continue saving this file.',
    );
  }

  deleteQuiet(temp);

  const finalSize = readSize(destination);
  emitProgress(Math.max(0, finalSize - offset), true);

  if (finalSize < offset + effectiveTempSize - 1024) {
    throw new DownloadEngineError(
      'FILE_APPEND_FAILED',
      'Unable to continue saving this file.',
    );
  }

  return destination;
}
