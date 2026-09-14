/**
 * Ordered multi-range merge + exact size verification.
 * Never loads whole files into JS memory.
 */

import { File, FileMode } from 'expo-file-system';

import { DownloadEngineError } from '../errors';
import { verifyCompletedFile } from '../file-paths';
import { MULTI_RANGE } from './constants';
import {
  getMultiRangeMergeTempFile,
  getMultiRangePartFile,
  readPartFileSize,
} from './paths';
import type { RangePlan } from './planner';

function deleteQuiet(file: File): void {
  try {
    if (file.exists) {
      file.delete();
    }
  } catch {
    // ignore
  }
}

export function assertPartsReadyForMerge(
  downloadId: string,
  plan: RangePlan,
): void {
  for (const range of plan.ranges) {
    const file = getMultiRangePartFile(downloadId, range.index);
    const size = readPartFileSize(file);
    if (!file.exists || size <= 0) {
      throw new DownloadEngineError(
        'PART_SIZE_MISMATCH',
        `Missing multi-range part ${range.index}.`,
      );
    }
    if (size !== range.length) {
      throw new DownloadEngineError(
        'PART_SIZE_MISMATCH',
        `Multi-range part ${range.index} size mismatch.`,
      );
    }
  }
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
    throw new DownloadEngineError('MERGE_FAILED', 'Missing part during merge.');
  }

  const reader = source.open(FileMode.ReadOnly);
  const writer = destination.open(mode);
  try {
    while (true) {
      if (signal.aborted) {
        throw new DownloadEngineError('CANCELLED', 'Download cancelled.');
      }
      const chunk = reader.readBytes(MULTI_RANGE.ioChunkBytes);
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
 * Merge parts in order into a workspace merge temp, then copy to destination.
 * Uses exact contentLength verification for authoritative progressive sizes.
 */
export async function mergeMultiRangeParts(options: {
  downloadId: string;
  plan: RangePlan;
  destination: File;
  signal: AbortSignal;
}): Promise<File> {
  const { downloadId, plan, destination, signal } = options;
  assertPartsReadyForMerge(downloadId, plan);

  const mergeTemp = getMultiRangeMergeTempFile(downloadId);
  deleteQuiet(mergeTemp);

  let first = true;
  try {
    for (const range of plan.ranges) {
      if (signal.aborted) {
        throw new DownloadEngineError('CANCELLED', 'Download cancelled.');
      }
      const part = getMultiRangePartFile(downloadId, range.index);
      appendFileChunked(
        part,
        mergeTemp,
        first ? FileMode.WriteOnly : FileMode.Append,
        signal,
      );
      first = false;
    }
  } catch (error) {
    deleteQuiet(mergeTemp);
    if (error instanceof DownloadEngineError) {
      throw error;
    }
    throw new DownloadEngineError(
      'MERGE_FAILED',
      error instanceof Error ? error.message : 'Unable to assemble the downloaded file.',
    );
  }

  const mergedSize = readPartFileSize(mergeTemp);
  if (mergedSize !== plan.contentLength) {
    deleteQuiet(mergeTemp);
    throw new DownloadEngineError(
      'FINAL_SIZE_MISMATCH',
      'The merged file size does not match the source content length.',
    );
  }

  // Copy merge temp → final destination (never mutate destination incrementally).
  try {
    if (destination.exists) {
      destination.delete();
    }
  } catch {
    // continue
  }

  try {
    appendFileChunked(mergeTemp, destination, FileMode.WriteOnly, signal);
  } catch (error) {
    deleteQuiet(destination);
    deleteQuiet(mergeTemp);
    throw new DownloadEngineError(
      'FILE_FINALIZE_FAILED',
      error instanceof Error ? error.message : 'Unable to finalize the downloaded file.',
    );
  }

  deleteQuiet(mergeTemp);

  const finalSize = readPartFileSize(destination);
  if (finalSize !== plan.contentLength) {
    deleteQuiet(destination);
    throw new DownloadEngineError(
      'FINAL_SIZE_MISMATCH',
      'The downloaded file size does not match the source content length.',
    );
  }

  // Exact verification for authoritative progressive Content-Length.
  const verification = verifyCompletedFile(destination, plan.contentLength, {
    downloadId,
  });
  if (!verification.ok || verification.size !== plan.contentLength) {
    deleteQuiet(destination);
    throw new DownloadEngineError(
      'FINAL_FILE_INVALID',
      'The downloaded file failed integrity checks.',
    );
  }

  return destination;
}
