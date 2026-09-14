/**
 * Deterministic byte-range planner for progressive multi-range downloads.
 * Guarantees full coverage: byte 0 .. contentLength-1, no gaps, no overlaps.
 */

import { DownloadEngineError } from '../errors';
import { MULTI_RANGE } from './constants';

export type PlannedRange = {
  index: number;
  rangeStart: number;
  rangeEnd: number;
  /** Inclusive length: rangeEnd - rangeStart + 1. */
  length: number;
};

export type RangePlan = {
  contentLength: number;
  workerCount: number;
  ranges: PlannedRange[];
};

/**
 * Recommend worker count from file size — conservative mobile defaults.
 */
export function recommendWorkerCount(contentLength: number): number {
  const size = Math.trunc(contentLength);
  if (!Number.isFinite(size) || size < MULTI_RANGE.minBytes) {
    return 1;
  }
  if (size < MULTI_RANGE.mediumBytes) {
    return 2;
  }
  if (size < MULTI_RANGE.largeBytes) {
    return Math.min(3, MULTI_RANGE.maxRangesPerFile);
  }
  return MULTI_RANGE.maxRangesPerFile;
}

/**
 * Plan inclusive byte ranges for `workerCount` workers.
 */
export function planByteRanges(
  contentLength: number,
  workerCount: number,
): RangePlan {
  const total = Math.trunc(contentLength);
  if (!Number.isFinite(total) || total <= 0) {
    throw new DownloadEngineError(
      'INVALID_RESOURCE',
      'Multi-range requires a known content length.',
    );
  }

  const requested = Math.max(1, Math.min(MULTI_RANGE.maxRangesPerFile, Math.trunc(workerCount)));
  // Never allocate more workers than bytes (edge: tiny eligible misconfig).
  const count = Math.min(requested, total);

  const base = Math.floor(total / count);
  const remainder = total % count;
  const ranges: PlannedRange[] = [];
  let cursor = 0;

  for (let i = 0; i < count; i += 1) {
    const length = base + (i < remainder ? 1 : 0);
    if (length <= 0) {
      continue;
    }
    const rangeStart = cursor;
    const rangeEnd = cursor + length - 1;
    ranges.push({
      index: ranges.length,
      rangeStart,
      rangeEnd,
      length,
    });
    cursor = rangeEnd + 1;
  }

  assertValidRangePlan({ contentLength: total, workerCount: ranges.length, ranges });

  return {
    contentLength: total,
    workerCount: ranges.length,
    ranges,
  };
}

export function assertValidRangePlan(plan: RangePlan): void {
  if (plan.ranges.length === 0) {
    throw new DownloadEngineError(
      'INVALID_RESOURCE',
      'Multi-range plan has no parts.',
    );
  }
  if (plan.ranges[0]?.rangeStart !== 0) {
    throw new DownloadEngineError(
      'INVALID_RESOURCE',
      'Multi-range plan must start at byte 0.',
    );
  }

  let expectedStart = 0;
  let covered = 0;
  for (let i = 0; i < plan.ranges.length; i += 1) {
    const part = plan.ranges[i]!;
    if (part.index !== i) {
      throw new DownloadEngineError(
        'INVALID_RESOURCE',
        'Multi-range plan indexes must be contiguous.',
      );
    }
    if (part.rangeStart !== expectedStart) {
      throw new DownloadEngineError(
        'INVALID_RESOURCE',
        'Multi-range plan has a gap or overlap.',
      );
    }
    if (part.rangeEnd < part.rangeStart) {
      throw new DownloadEngineError(
        'INVALID_RESOURCE',
        'Multi-range plan has an inverted range.',
      );
    }
    if (part.length !== part.rangeEnd - part.rangeStart + 1) {
      throw new DownloadEngineError(
        'INVALID_RESOURCE',
        'Multi-range plan length mismatch.',
      );
    }
    covered += part.length;
    expectedStart = part.rangeEnd + 1;
  }

  if (expectedStart !== plan.contentLength || covered !== plan.contentLength) {
    throw new DownloadEngineError(
      'INVALID_RESOURCE',
      'Multi-range plan does not cover the full content length.',
    );
  }
  if (plan.ranges[plan.ranges.length - 1]!.rangeEnd !== plan.contentLength - 1) {
    throw new DownloadEngineError(
      'INVALID_RESOURCE',
      'Multi-range plan must end at contentLength - 1.',
    );
  }
}
