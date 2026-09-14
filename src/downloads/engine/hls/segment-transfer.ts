/**
 * Sequential HLS segment download + ordered file assembly.
 * Segments are file-backed via expo-file-system — not held in JS memory.
 */

import { File, FileMode } from 'expo-file-system';

import { DownloadEngineError, classifyTransferError } from '../errors';
import { isSafeHttpUrl } from '../resource-guard';
import type { HlsTransferState } from '../types';
import { HLS_TRANSFER } from './constants';
import {
  getHlsInitFile,
  getHlsSegmentFile,
  getHlsTempOutputFile,
  isReusableHlsFile,
  readHlsFileSize,
} from './paths';
import { planHlsSegments, type HlsPlanEntry, type HlsSegmentPlan } from './planner';
import type { HlsMediaPlaylist } from './playlist';
import { isSegmentRetryable, segmentRetryDelayMs } from './segment-retry';
import {
  assertHlsPlanComplete,
  assertHlsTempSegmentsExist,
  verifyAssembledHlsFile,
} from './verifier';
import {
  createTimeoutAbortSignal,
  TRANSFER_TIMEOUTS,
} from '../transfer-timeouts';
import type { StallWatchdog } from '../stall-watchdog';

export type SegmentProgressEvent = {
  completedSegments: number;
  totalSegments: number;
  currentSegment: number | null;
  bytesWritten: number;
  /** Known only when every segment reports Content-Length; else null. */
  totalBytes: number | null;
  failedSegment: number | null;
  lastFailureReason: string | null;
  retryCount: number;
};

function toHlsState(event: SegmentProgressEvent): HlsTransferState {
  return {
    totalSegments: event.totalSegments,
    completedSegments: event.completedSegments,
    currentSegment: event.currentSegment,
    downloadedBytes: event.bytesWritten,
    failedSegment: event.failedSegment,
    retryCount: event.retryCount,
    lastFailureReason: event.lastFailureReason,
  };
}

function planEntryFile(downloadId: string, entry: HlsPlanEntry): File {
  return entry.isInitSegment
    ? getHlsInitFile(downloadId)
    : getHlsSegmentFile(downloadId, entry.index);
}

async function downloadToFile(
  url: string,
  destination: File,
  signal: AbortSignal,
  headers?: Record<string, string>,
  onBytes?: (written: number, total: number | null) => void,
  stallWatchdog?: StallWatchdog | null,
  generation?: number,
): Promise<number> {
  if (!isSafeHttpUrl(url)) {
    throw new DownloadEngineError(
      'INVALID_RESOURCE',
      'Segment URL failed security checks.',
    );
  }

  let lastWritten = 0;
  if (stallWatchdog) {
    stallWatchdog.startHlsSegmentPhase({
      generation,
      timeoutMs: TRANSFER_TIMEOUTS.hlsSegmentTimeoutMs,
    });
  }
  const segmentTimeout = createTimeoutAbortSignal(
    TRANSFER_TIMEOUTS.hlsSegmentTimeoutMs,
    signal,
  );
  try {
    if (destination.exists) {
      try {
        destination.delete();
      } catch {
        // overwrite via idempotent download
      }
    }

    const file = await File.downloadFileAsync(url, destination, {
      idempotent: true,
      signal: segmentTimeout.signal,
      headers: headers && Object.keys(headers).length > 0 ? headers : undefined,
      onProgress: (data) => {
        lastWritten = Math.max(0, data.bytesWritten);
        const total =
          typeof data.totalBytes === 'number' && data.totalBytes > 0
            ? data.totalBytes
            : null;
        stallWatchdog?.assertHealthy(generation);
        onBytes?.(lastWritten, total);
      },
    });

    const size =
      typeof file.size === 'number' && Number.isFinite(file.size) ? file.size : 0;
    if (size <= 0) {
      try {
        file.delete();
      } catch {
        // ignore
      }
      throw new DownloadEngineError(
        'NETWORK_ERROR',
        'Downloaded HLS segment is empty.',
      );
    }
    if (size > HLS_TRANSFER.maxSegmentBytes) {
      try {
        file.delete();
      } catch {
        // ignore
      }
      throw new DownloadEngineError(
        'HLS_UNSUPPORTED',
        'An HLS segment exceeds the supported size.',
      );
    }
    return size;
  } catch (error) {
    if (signal.aborted) {
      throw new DownloadEngineError('CANCELLED', 'Download cancelled.');
    }
    if (segmentTimeout.signal.aborted && !signal.aborted) {
      throw new DownloadEngineError(
        'HLS_SEGMENT_TIMEOUT',
        'HLS segment download timed out.',
      );
    }
    throw classifyTransferError(error);
  } finally {
    segmentTimeout.cleanup();
  }
}

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(new DownloadEngineError('CANCELLED', 'Download cancelled.'));
    };
    if (signal.aborted) {
      clearTimeout(timer);
      reject(new DownloadEngineError('CANCELLED', 'Download cancelled.'));
      return;
    }
    signal.addEventListener('abort', onAbort);
  });
}

async function downloadWithRetry(
  url: string,
  destination: File,
  signal: AbortSignal,
  headers?: Record<string, string>,
  onBytes?: (written: number, total: number | null) => void,
  stallWatchdog?: StallWatchdog | null,
  generation?: number,
  onAuthDenied?: () => Promise<Record<string, string>>,
): Promise<{ size: number; retryCount: number }> {
  let lastError: unknown;
  let retryCount = 0;
  let currentHeaders = headers;
  let authRetried = false;
  for (let attempt = 0; attempt <= HLS_TRANSFER.segmentRetryCount; attempt += 1) {
    if (signal.aborted) {
      throw new DownloadEngineError('CANCELLED', 'Download cancelled.');
    }
    try {
      const size = await downloadToFile(
        url,
        destination,
        signal,
        currentHeaders,
        onBytes,
        stallWatchdog,
        generation,
      );
      return { size, retryCount };
    } catch (error) {
      lastError = error;
      const classified = classifyTransferError(error);
      if (
        !authRetried &&
        onAuthDenied &&
        (classified.code === 'AUTH_ERROR' ||
          classified.httpStatus === 401 ||
          classified.httpStatus === 403)
      ) {
        authRetried = true;
        currentHeaders = await onAuthDenied();
        retryCount += 1;
        continue;
      }
      if (!isSegmentRetryable(error) || attempt >= HLS_TRANSFER.segmentRetryCount) {
        throw classifyTransferError(error);
      }
      retryCount += 1;
      await sleep(segmentRetryDelayMs(attempt), signal);
    }
  }
  throw classifyTransferError(lastError);
}

/**
 * Download init (optional) + media segments in playlist order (sequential).
 * Valid on-disk segments from a prior attempt are reused.
 */
export async function downloadHlsSegments(options: {
  downloadId: string;
  media: HlsMediaPlaylist;
  signal: AbortSignal;
  /** @deprecated Prefer resolveHeaders for per-target session cookies. */
  headers?: Record<string, string>;
  resolveHeaders?: (
    targetUrl: string,
    parentUrl: string | null,
  ) => Promise<Record<string, string>>;
  onAuthDenied?: (
    targetUrl: string,
    parentUrl: string | null,
  ) => Promise<Record<string, string>>;
  onProgress: (event: SegmentProgressEvent) => void;
  onCheckpoint?: (state: HlsTransferState, force: boolean) => void;
  stallWatchdog?: StallWatchdog | null;
  generation?: number;
  attemptStartBytes?: number;
}): Promise<{ bytesWritten: number; totalBytes: number | null; plan: HlsSegmentPlan }> {
  const {
    downloadId,
    media,
    signal,
    headers,
    resolveHeaders,
    onAuthDenied,
    onProgress,
    onCheckpoint,
    stallWatchdog,
    generation,
    attemptStartBytes = 0,
  } = options;
  const plan = planHlsSegments(media);
  assertHlsPlanComplete(plan);
  const parentUrl = media.playlistUrl ?? null;

  let bytesWritten = 0;
  let completed = 0;
  let currentSegment: number | null = null;
  let failedSegment: number | null = null;
  let lastFailureReason: string | null = null;
  let retryCount = 0;

  const publish = (currentSegmentWritten = 0, forceCheckpoint = false) => {
    const aggregateBytes = bytesWritten + currentSegmentWritten;
    stallWatchdog?.noteBytes(aggregateBytes);
    const event: SegmentProgressEvent = {
      completedSegments: completed,
      totalSegments: plan.totalSegments,
      currentSegment,
      bytesWritten: aggregateBytes,
      totalBytes: null,
      failedSegment,
      lastFailureReason,
      retryCount,
    };
    onProgress(event);
    if (currentSegmentWritten === 0 || forceCheckpoint) {
      onCheckpoint?.(toHlsState(event), forceCheckpoint);
    }
  };

  for (const entry of plan.entries) {
    if (signal.aborted) {
      throw new DownloadEngineError('CANCELLED', 'Download cancelled.');
    }
    currentSegment = entry.index;
    const dest = planEntryFile(downloadId, entry);

    if (isReusableHlsFile(dest)) {
      bytesWritten += readHlsFileSize(dest);
      completed += 1;
      failedSegment = null;
      lastFailureReason = null;
      publish(0, false);
      continue;
    }

    try {
      const segmentHeaders = resolveHeaders
        ? await resolveHeaders(entry.url, parentUrl)
        : headers;
      const result = await downloadWithRetry(
        entry.url,
        dest,
        signal,
        segmentHeaders,
        (written) => {
          publish(written);
        },
        stallWatchdog,
        generation,
        onAuthDenied
          ? () => onAuthDenied(entry.url, parentUrl)
          : undefined,
      );
      bytesWritten += result.size;
      completed += 1;
      retryCount += result.retryCount;
      failedSegment = null;
      lastFailureReason = null;
      publish(0, false);
    } catch (error) {
      const classified = classifyTransferError(error);
      failedSegment = entry.index;
      lastFailureReason = classified.code;
      publish(0, true);
      throw classified;
    }
  }

  publish(0, true);

  return {
    bytesWritten,
    totalBytes: bytesWritten > 0 ? bytesWritten : null,
    plan,
  };
}

function appendFileChunked(
  source: File,
  destination: File,
  mode: FileMode,
  signal: AbortSignal,
): void {
  if (signal.aborted) {
    throw new DownloadEngineError('CANCELLED', 'Download cancelled.');
  }
  if (!source.exists) {
    throw new DownloadEngineError(
      'FILE_SYSTEM_ERROR',
      'Missing HLS segment during assembly.',
    );
  }
  const size =
    typeof source.size === 'number' && Number.isFinite(source.size)
      ? source.size
      : 0;
  if (size <= 0) {
    throw new DownloadEngineError(
      'FILE_SYSTEM_ERROR',
      'Empty HLS segment during assembly.',
    );
  }

  const reader = source.open(FileMode.ReadOnly);
  const writer = destination.open(mode);
  try {
    while (true) {
      if (signal.aborted) {
        throw new DownloadEngineError('CANCELLED', 'Download cancelled.');
      }
      const chunk = reader.readBytes(HLS_TRANSFER.assemblyChunkBytes);
      if (!chunk || chunk.byteLength === 0) {
        break;
      }
      writer.writeBytes(chunk);
    }
  } finally {
    try {
      reader.close();
    } catch {
      // ignore
    }
    try {
      writer.close();
    } catch {
      // ignore
    }
  }
}

/**
 * Ordered assembly into a temporary file (init once, then segments).
 * Reads one chunk at a time — never loads the full stream into memory.
 */
export async function assembleHlsOutput(options: {
  downloadId: string;
  media: HlsMediaPlaylist;
  plan?: HlsSegmentPlan;
  signal: AbortSignal;
}): Promise<File> {
  const { downloadId, media, signal } = options;
  const plan = options.plan ?? planHlsSegments(media);
  assertHlsPlanComplete(plan);
  assertHlsTempSegmentsExist(downloadId, plan);

  const output = getHlsTempOutputFile(downloadId);

  try {
    if (output.exists) {
      output.delete();
    }
  } catch {
    // continue
  }

  let firstWrite = true;
  for (const entry of plan.entries) {
    const source = planEntryFile(downloadId, entry);
    appendFileChunked(
      source,
      output,
      firstWrite ? FileMode.WriteOnly : FileMode.Append,
      signal,
    );
    firstWrite = false;
  }

  verifyAssembledHlsFile(output, downloadId);
  return output;
}

const COPY_CHUNK = HLS_TRANSFER.assemblyChunkBytes;

/**
 * Copy assembled HLS output to the final destination in fixed-size chunks.
 * Never loads the full VOD into JS memory.
 */
export function copyHlsAssembledFile(
  source: File,
  destination: File,
  signal: AbortSignal,
): void {
  if (signal.aborted) {
    throw new DownloadEngineError('CANCELLED', 'Download cancelled.');
  }
  if (!source.exists) {
    throw new DownloadEngineError(
      'FILE_SYSTEM_ERROR',
      'HLS assembly produced no output file.',
    );
  }

  try {
    if (destination.exists) {
      destination.delete();
    }
  } catch {
    // continue — WriteOnly may overwrite
  }

  const reader = source.open(FileMode.ReadOnly);
  const writer = destination.open(FileMode.WriteOnly);
  try {
    while (true) {
      if (signal.aborted) {
        throw new DownloadEngineError('CANCELLED', 'Download cancelled.');
      }
      const chunk = reader.readBytes(COPY_CHUNK);
      if (!chunk || chunk.byteLength === 0) {
        break;
      }
      writer.writeBytes(chunk);
    }
  } finally {
    try {
      reader.close();
    } catch {
      // ignore
    }
    try {
      writer.close();
    } catch {
      // ignore
    }
  }

  const finalSize =
    typeof destination.size === 'number' && Number.isFinite(destination.size)
      ? destination.size
      : 0;
  if (finalSize <= 0) {
    throw new DownloadEngineError(
      'FILE_FINALIZE_FAILED',
      'HLS assembly copy produced an empty file.',
    );
  }
}
