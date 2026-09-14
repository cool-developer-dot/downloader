/**
 * Multi-range progressive transfer coordinator.
 * Extends the progressive engine — does not replace single-stream TransferWorker.
 */

import { File } from 'expo-file-system';

import { DOWNLOAD_ENGINE } from '../constants';
import { classifyTransferFailure, DownloadEngineError } from '../errors';
import { assertEnoughDiskSpaceForTransfer } from '../file-paths';
import {
  computeRetryDelayMs,
  isAutoRetryableCode,
} from '../retry-policy';
import { mergeRangeValidatorsWithLength } from '../source-validators';
import type {
  MultiRangePartState,
  MultiRangeTransferState,
  RangeValidators,
} from '../types';
import { getGlobalNetworkBudget } from './budget';
import { MULTI_RANGE } from './constants';
import { evaluateMultiRangeEligibility } from './eligibility';
import { mergeMultiRangeParts } from './merge';
import {
  cleanupMultiRangeWorkspace,
  getMultiRangePartFile,
  readPartFileSize,
} from './paths';
import { planByteRanges, type RangePlan } from './planner';
import { downloadRangePart } from './part-worker';
import type { StallWatchdog } from '../stall-watchdog';

export type MultiRangeProgressEvent = {
  bytesWritten: number;
  totalBytes: number;
  parts: MultiRangePartState[];
};

export type MultiRangeTransferOptions = {
  downloadId: string;
  sourceUrl: string;
  destination: File;
  /** Known size hint from API / prior state. */
  knownFileSize?: number | null;
  platformOs: string;
  priorValidators?: RangeValidators | null;
  priorState?: MultiRangeTransferState | null;
  /** Other active download ids for fair share. */
  activeDownloadIds?: string[];
  signal: AbortSignal;
  shouldPause: () => boolean;
  onProgress: (event: MultiRangeProgressEvent) => void;
  onCheckpoint: (state: MultiRangeTransferState, force: boolean) => void;
  sessionHeaders?: Record<string, string> | null;
  stallWatchdog?: StallWatchdog | null;
};

export type MultiRangeTransferResult =
  | { status: 'completed'; file: File; state: MultiRangeTransferState }
  | { status: 'paused'; state: MultiRangeTransferState }
  | { status: 'fallback' };

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ms <= 0) {
      resolve();
      return;
    }
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

function partsFromPlan(
  plan: RangePlan,
  prior?: MultiRangeTransferState | null,
): MultiRangePartState[] {
  return plan.ranges.map((range) => {
    const prev = prior?.parts.find((p) => p.index === range.index);
    return {
      index: range.index,
      rangeStart: range.rangeStart,
      rangeEnd: range.rangeEnd,
      downloadedBytes: prev?.downloadedBytes ?? 0,
      status: prev?.status === 'COMPLETED' ? 'COMPLETED' : 'PENDING',
      retryCount: prev?.retryCount ?? 0,
      lastFailureReason: prev?.lastFailureReason ?? null,
    };
  });
}

function reconcilePartsWithDisk(
  downloadId: string,
  plan: RangePlan,
  parts: MultiRangePartState[],
): MultiRangePartState[] {
  return parts.map((part) => {
    const range = plan.ranges[part.index]!;
    const size = readPartFileSize(getMultiRangePartFile(downloadId, part.index));
    if (size >= range.length) {
      return {
        ...part,
        downloadedBytes: range.length,
        status: 'COMPLETED',
        lastFailureReason: null,
      };
    }
    if (size > 0) {
      return {
        ...part,
        downloadedBytes: size,
        status: part.status === 'COMPLETED' ? 'PAUSED' : part.status,
      };
    }
    return {
      ...part,
      downloadedBytes: 0,
      status: part.status === 'COMPLETED' ? 'PENDING' : part.status,
    };
  });
}

function sumDownloaded(parts: MultiRangePartState[]): number {
  return parts.reduce((sum, part) => sum + Math.max(0, part.downloadedBytes), 0);
}

function buildState(
  plan: RangePlan,
  parts: MultiRangePartState[],
  validators: RangeValidators | null,
  failedPart: number | null,
): MultiRangeTransferState {
  return {
    contentLength: plan.contentLength,
    workerCount: plan.workerCount,
    sourceValidators: validators,
    parts,
    failedPart,
  };
}

/**
 * Attempt multi-range transfer. Returns `fallback` when ineligible so caller
 * can use the existing single-stream progressive path.
 */
export async function runMultiRangeTransfer(
  options: MultiRangeTransferOptions,
): Promise<MultiRangeTransferResult> {
  const {
    downloadId,
    sourceUrl,
    destination,
    knownFileSize,
    platformOs,
    priorValidators,
    priorState,
    activeDownloadIds = [],
    signal,
    shouldPause,
    onProgress,
    onCheckpoint,
    sessionHeaders,
    stallWatchdog,
  } = options;

  let eligibility = await evaluateMultiRangeEligibility({
    sourceUrl,
    knownFileSize,
    platformOs,
    priorValidators: priorState?.sourceValidators ?? priorValidators,
    signal,
    sessionHeaders,
  });

  // Soft resume: keep a prior multi-range plan when a transient probe fails.
  // Hard ineligible reasons (HLS / unsafe URL / platform) still fall back.
  if (
    !eligibility.eligible &&
    priorState != null &&
    priorState.contentLength > 0 &&
    priorState.parts.length > 1 &&
    eligibility.reason !== 'HLS' &&
    eligibility.reason !== 'UNSAFE_URL' &&
    eligibility.reason !== 'PLATFORM_UNSUPPORTED'
  ) {
    eligibility = {
      eligible: true,
      contentLength: priorState.contentLength,
      rangeSupported: true,
      recommendedWorkers: Math.max(2, priorState.workerCount),
      validators: priorState.sourceValidators,
    };
  }

  if (!eligibility.eligible) {
    return { status: 'fallback' };
  }

  const contentLength = eligibility.contentLength;
  let validators = mergeRangeValidatorsWithLength(
    priorState?.sourceValidators ?? priorValidators,
    eligibility.validators,
  );

  // Resume prior plan when content length matches; else replan cleanly.
  const reusePrior =
    priorState != null &&
    priorState.contentLength === contentLength &&
    priorState.parts.length > 1;

  const wantedWorkers = reusePrior
    ? priorState.workerCount
    : eligibility.recommendedWorkers;

  const budget = getGlobalNetworkBudget();
  const fair = budget.recommendFairShare(
    downloadId,
    wantedWorkers,
    activeDownloadIds.includes(downloadId)
      ? activeDownloadIds
      : [...activeDownloadIds, downloadId],
  );
  const workerCount = Math.max(2, Math.min(wantedWorkers, fair || wantedWorkers));

  const plan = planByteRanges(contentLength, workerCount);

  // Storage: remaining + part overhead + merge temp margin.
  const existingBytes = reusePrior
    ? sumDownloaded(priorState.parts)
    : 0;
  assertEnoughDiskSpaceForTransfer({
    expectedTotalBytes: contentLength + MULTI_RANGE.diskMarginBytes,
    partialBytes: existingBytes,
  });

  let parts = reconcilePartsWithDisk(
    downloadId,
    plan,
    partsFromPlan(plan, reusePrior ? priorState : null),
  );

  let lastPersistAt = 0;
  const publish = (force = false) => {
    const aggregateBytes = sumDownloaded(parts);
    stallWatchdog?.noteBytes(aggregateBytes);
    const state = buildState(plan, parts, validators, null);
    onProgress({
      bytesWritten: aggregateBytes,
      totalBytes: contentLength,
      parts: parts.map((p) => ({ ...p })),
    });
    const now = Date.now();
    if (force || now - lastPersistAt >= MULTI_RANGE.persistIntervalMs) {
      lastPersistAt = now;
      onCheckpoint(state, force);
    }
  };

  publish(true);

  if (shouldPause()) {
    parts = parts.map((p) =>
      p.status === 'RUNNING' || p.status === 'PENDING'
        ? { ...p, status: 'PAUSED' as const }
        : p,
    );
    const state = buildState(plan, parts, validators, null);
    onCheckpoint(state, true);
    return { status: 'paused', state };
  }

  // Sequential admission with bounded parallel slots — no unbounded Promise.all.
  const pendingIndexes = parts
    .filter((p) => p.status !== 'COMPLETED')
    .map((p) => p.index);

  const inFlight = new Map<number, Promise<void>>();
  let fatalError: DownloadEngineError | null = null;

  const runOne = async (partIndex: number): Promise<void> => {
    if (fatalError || shouldPause() || signal.aborted) {
      return;
    }

    const part = parts[partIndex];
    const range = plan.ranges[partIndex];
    if (!part || !range || part.status === 'COMPLETED') {
      return;
    }

    let lease = 0;
    try {
      lease = await budget.acquireAtLeastOne(downloadId, 1, signal);
    } catch {
      if (shouldPause() || signal.aborted) {
        return;
      }
      throw new DownloadEngineError('CANCELLED', 'Download cancelled.');
    }

    try {
      parts[partIndex] = {
        ...part,
        status: 'RUNNING',
        lastFailureReason: null,
      };
      publish(false);

      const partFile = getMultiRangePartFile(downloadId, partIndex);
      const result = await downloadRangePart({
        sourceUrl,
        partFile,
        range,
        existingBytes: part.downloadedBytes,
        contentLength,
        validators,
        signal,
        shouldPause,
        onProgress: (event) => {
          parts[partIndex] = {
            ...parts[partIndex]!,
            downloadedBytes: event.downloadedBytes,
            status: 'RUNNING',
          };
          publish(false);
        },
        onValidators: (next) => {
          validators = mergeRangeValidatorsWithLength(validators, next);
        },
        sessionHeaders,
        stallWatchdog,
      });

      if (result == null || shouldPause()) {
        parts[partIndex] = {
          ...parts[partIndex]!,
          status: 'PAUSED',
          downloadedBytes: readPartFileSize(partFile),
        };
        publish(true);
        return;
      }

      parts[partIndex] = {
        ...parts[partIndex]!,
        downloadedBytes: range.length,
        status: 'COMPLETED',
        lastFailureReason: null,
      };
      publish(true);
    } catch (error) {
      const classified = classifyTransferFailure(error);
      const code = classified.error.code;

      parts[partIndex] = {
        ...parts[partIndex]!,
        status: 'FAILED',
        retryCount: parts[partIndex]!.retryCount,
        lastFailureReason: code,
        downloadedBytes: readPartFileSize(
          getMultiRangePartFile(downloadId, partIndex),
        ),
      };

      if (
        code === 'SOURCE_CHANGED' ||
        code === 'AUTH_ERROR' ||
        code === 'INVALID_RESOURCE' ||
        code === 'CANCELLED'
      ) {
        fatalError = classified.error;
        publish(true);
        return;
      }

      if (
        classified.autoRetryable &&
        isAutoRetryableCode(code) &&
        parts[partIndex]!.retryCount < DOWNLOAD_ENGINE.maxAutoRetryAttempts
      ) {
        const attempt = parts[partIndex]!.retryCount;
        parts[partIndex] = {
          ...parts[partIndex]!,
          retryCount: attempt + 1,
          status: 'PENDING',
        };
        publish(true);
        try {
          await sleep(
            computeRetryDelayMs(attempt, classified.retryAfterMs),
            signal,
          );
        } catch {
          return;
        }
        // Re-queue by pushing index back.
        pendingIndexes.push(partIndex);
        return;
      }

      fatalError = new DownloadEngineError(
        code === 'RETRY_EXHAUSTED' ? code : code,
        classified.error.message,
      );
      if (
        parts[partIndex]!.retryCount >= DOWNLOAD_ENGINE.maxAutoRetryAttempts &&
        classified.autoRetryable
      ) {
        fatalError = new DownloadEngineError(
          'RETRY_EXHAUSTED',
          'A download part failed after several automatic retries.',
        );
      }
      publish(true);
    } finally {
      if (lease > 0) {
        budget.release(downloadId, lease);
      }
    }
  };

  try {
    while (
      (pendingIndexes.length > 0 || inFlight.size > 0) &&
      !fatalError &&
      !shouldPause() &&
      !signal.aborted
    ) {
      while (
        pendingIndexes.length > 0 &&
        inFlight.size < Math.max(1, workerCount) &&
        !fatalError &&
        !shouldPause()
      ) {
        const available = budget.getAvailable();
        if (available <= 0 && inFlight.size > 0) {
          break;
        }
        if (available <= 0 && inFlight.size === 0) {
          // Block until a global slot frees.
          break;
        }
        const nextIndex = pendingIndexes.shift();
        if (nextIndex == null) {
          break;
        }
        if (parts[nextIndex]?.status === 'COMPLETED') {
          continue;
        }
        const promise = runOne(nextIndex).finally(() => {
          inFlight.delete(nextIndex);
        });
        inFlight.set(nextIndex, promise);
      }

      if (inFlight.size === 0 && pendingIndexes.length > 0 && !fatalError) {
        // Wait for a budget slot.
        try {
          const granted = await budget.acquireAtLeastOne(downloadId, 1, signal);
          budget.release(downloadId, granted);
        } catch {
          break;
        }
        continue;
      }

      if (inFlight.size > 0) {
        await Promise.race(inFlight.values());
      }
    }

    // Drain remaining in-flight after pause/cancel/fatal.
    if (inFlight.size > 0) {
      await Promise.allSettled(inFlight.values());
    }
  } finally {
    budget.releaseAll(downloadId);
  }

  if (signal.aborted && !shouldPause()) {
    throw new DownloadEngineError('CANCELLED', 'Download cancelled.');
  }

  if (shouldPause()) {
    parts = parts.map((p) =>
      p.status === 'RUNNING' || p.status === 'PENDING'
        ? { ...p, status: 'PAUSED' as const }
        : p,
    );
    const state = buildState(plan, parts, validators, null);
    onCheckpoint(state, true);
    return { status: 'paused', state };
  }

  if (fatalError) {
    const failedPart =
      parts.find((p) => p.status === 'FAILED')?.index ??
      parts.find((p) => p.lastFailureReason)?.index ??
      null;
    const state = buildState(plan, parts, validators, failedPart);
    onCheckpoint(state, true);
    throw fatalError;
  }

  const incomplete = parts.some((p) => p.status !== 'COMPLETED');
  if (incomplete) {
    parts = parts.map((p) =>
      p.status === 'COMPLETED'
        ? p
        : { ...p, status: 'PAUSED' as const },
    );
    const state = buildState(plan, parts, validators, null);
    onCheckpoint(state, true);
    return { status: 'paused', state };
  }

  // All parts complete → merge + exact finalize.
  const merged = await mergeMultiRangeParts({
    downloadId,
    plan,
    destination,
    signal,
  });

  await cleanupMultiRangeWorkspace(downloadId);

  const finalState = buildState(
    plan,
    parts.map((p) => ({ ...p, status: 'COMPLETED' as const })),
    validators,
    null,
  );
  onCheckpoint(finalState, true);
  onProgress({
    bytesWritten: contentLength,
    totalBytes: contentLength,
    parts: finalState.parts,
  });

  return { status: 'completed', file: merged, state: finalState };
}
