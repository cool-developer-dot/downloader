/**
 * Week 7 Day 3 Phase 3 — multi-range progressive engine verifier.
 * Deterministic fixtures. NO Metro. NO emulator.
 * Network is stubbed via global fetch for eligibility probes only.
 *
 * Usage (from mobile/):
 *   npx tsx scripts/verify-week7-day3-phase3.ts
 */

import { DOWNLOAD_ENGINE } from '../src/downloads/engine/constants';
import { DownloadEngineError } from '../src/downloads/engine/errors';
import { isAutoRetryableCode } from '../src/downloads/engine/retry-policy';
import { validateRangeResumeResponse } from '../src/downloads/engine/range-validation';
import { assertSourceIdentityCompatible } from '../src/downloads/engine/source-identity';
import { evaluateMultiRangeEligibility } from '../src/downloads/engine/multi-range/eligibility';
import {
  GlobalNetworkBudget,
} from '../src/downloads/engine/multi-range/budget';
import { hasResumableMultiRange } from '../src/downloads/engine/multi-range/resume';
import {
  planByteRanges,
  recommendWorkerCount,
  assertValidRangePlan,
} from '../src/downloads/engine/multi-range/planner';
import { isPlaylistOrStreamUrl } from '../src/downloads/engine/resource-guard';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.log(`FAIL  ${name}\n      ${message}`);
  }
}

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error(`expected ${code}`);
  } catch (error) {
    assert(error instanceof DownloadEngineError, 'engine error');
    assert(error.code === code, `got ${error.code}`);
  }
}

type StubResponse = {
  status: number;
  headers: Record<string, string>;
};

function stubFetch(response: StubResponse): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    ({
      status: response.status,
      headers: {
        get: (name: string) => {
          const key = Object.keys(response.headers).find(
            (k) => k.toLowerCase() === name.toLowerCase(),
          );
          return key ? response.headers[key]! : null;
        },
      },
      body: { cancel: async () => undefined },
    }) as unknown as Response) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

async function main(): Promise<void> {
  console.log('Week 7 Day 3 Phase 3 — multi-range progressive engine\n');

  await test('planner: 2 workers cover evenly', () => {
    const plan = planByteRanges(100, 2);
    assert(plan.workerCount === 2, 'workers');
    assert(plan.ranges[0]!.rangeStart === 0, 'start0');
    assert(plan.ranges[0]!.rangeEnd === 49, 'end0');
    assert(plan.ranges[1]!.rangeStart === 50, 'start1');
    assert(plan.ranges[1]!.rangeEnd === 99, 'end1');
    assertValidRangePlan(plan);
  });

  await test('planner: 3 workers uneven remainder', () => {
    const plan = planByteRanges(100, 3);
    assert(plan.workerCount === 3, 'workers');
    const lengths = plan.ranges.map((r) => r.length);
    assert(lengths.reduce((a, b) => a + b, 0) === 100, 'sum');
    assert(plan.ranges[0]!.rangeStart === 0, 'byte0');
    assert(plan.ranges[2]!.rangeEnd === 99, 'final');
    // First remainder parts get +1
    assert(lengths[0] === 34 && lengths[1] === 33 && lengths[2] === 33, String(lengths));
    assertValidRangePlan(plan);
  });

  await test('planner: 4 workers 100MB example', () => {
    const total = 100 * 1024 * 1024;
    const plan = planByteRanges(total, 4);
    assert(plan.ranges.length === 4, '4 parts');
    assert(plan.ranges[0]!.rangeStart === 0, '0');
    assert(plan.ranges[3]!.rangeEnd === total - 1, 'last');
    for (let i = 1; i < plan.ranges.length; i += 1) {
      assert(
        plan.ranges[i]!.rangeStart === plan.ranges[i - 1]!.rangeEnd + 1,
        `gap at ${i}`,
      );
    }
    assertValidRangePlan(plan);
  });

  await test('planner: no gaps/overlaps for odd sizes', () => {
    for (const size of [7, 11, 99, 1_000_001]) {
      for (const workers of [2, 3, 4]) {
        const plan = planByteRanges(size, workers);
        assertValidRangePlan(plan);
      }
    }
  });

  await test('recommendWorkerCount: small/medium/large policy', () => {
    assert(recommendWorkerCount(1024) === 1, 'tiny');
    assert(
      recommendWorkerCount(DOWNLOAD_ENGINE.minMultiRangeBytes) === 2,
      'min eligible',
    );
    assert(
      recommendWorkerCount(DOWNLOAD_ENGINE.multiRangeMediumBytes) === 3 ||
        recommendWorkerCount(DOWNLOAD_ENGINE.multiRangeMediumBytes) <=
          DOWNLOAD_ENGINE.maxRangesPerFile,
      'medium',
    );
    assert(
      recommendWorkerCount(DOWNLOAD_ENGINE.multiRangeLargeBytes) ===
        DOWNLOAD_ENGINE.maxRangesPerFile,
      'large',
    );
  });

  await test('eligibility: HLS never eligible', async () => {
    const restore = stubFetch({
      status: 206,
      headers: {
        'Content-Range': 'bytes 0-0/50000000',
        ETag: '"x"',
      },
    });
    try {
      const result = await evaluateMultiRangeEligibility({
        sourceUrl: 'https://cdn.example.com/master.m3u8',
        knownFileSize: 50_000_000,
        platformOs: 'android',
      });
      assert(!result.eligible, 'ineligible');
      if (!result.eligible) {
        assert(result.reason === 'HLS', result.reason);
      }
      assert(isPlaylistOrStreamUrl('https://cdn.example.com/master.m3u8'), 'hls guard');
    } finally {
      restore();
    }
  });

  await test('eligibility: known size + Range 206 → eligible', async () => {
    const restore = stubFetch({
      status: 206,
      headers: {
        'Content-Range': `bytes 0-0/${DOWNLOAD_ENGINE.minMultiRangeBytes}`,
        ETag: '"abc"',
      },
    });
    try {
      const result = await evaluateMultiRangeEligibility({
        sourceUrl: 'https://cdn.example.com/video.mp4',
        knownFileSize: DOWNLOAD_ENGINE.minMultiRangeBytes,
        platformOs: 'android',
      });
      assert(result.eligible, 'eligible');
      if (result.eligible) {
        assert(result.rangeSupported === true, 'range');
        assert(result.contentLength === DOWNLOAD_ENGINE.minMultiRangeBytes, 'len');
        assert(result.recommendedWorkers >= 2, 'workers');
      }
    } finally {
      restore();
    }
  });

  await test('eligibility: 200 on probe → fallback', async () => {
    const restore = stubFetch({
      status: 200,
      headers: {
        'Content-Length': String(DOWNLOAD_ENGINE.minMultiRangeBytes),
        'Accept-Ranges': 'bytes',
      },
    });
    try {
      const result = await evaluateMultiRangeEligibility({
        sourceUrl: 'https://cdn.example.com/video.mp4',
        knownFileSize: DOWNLOAD_ENGINE.minMultiRangeBytes,
        platformOs: 'android',
      });
      assert(!result.eligible, 'ineligible');
      if (!result.eligible) {
        assert(result.reason === 'RANGE_UNSUPPORTED', result.reason);
      }
    } finally {
      restore();
    }
  });

  await test('eligibility: unknown size → fallback', async () => {
    const restore = stubFetch({
      status: 206,
      headers: {
        'Content-Range': 'bytes 0-0/*',
      },
    });
    try {
      const result = await evaluateMultiRangeEligibility({
        sourceUrl: 'https://cdn.example.com/video.mp4',
        knownFileSize: null,
        platformOs: 'android',
      });
      assert(!result.eligible, 'ineligible');
      if (!result.eligible) {
        assert(result.reason === 'UNKNOWN_SIZE', result.reason);
      }
    } finally {
      restore();
    }
  });

  await test('eligibility: small file → fallback', async () => {
    const restore = stubFetch({
      status: 206,
      headers: {
        'Content-Range': 'bytes 0-0/1024',
      },
    });
    try {
      const result = await evaluateMultiRangeEligibility({
        sourceUrl: 'https://cdn.example.com/tiny.mp4',
        knownFileSize: 1024,
        platformOs: 'android',
      });
      assert(!result.eligible, 'ineligible');
      if (!result.eligible) {
        assert(result.reason === 'TOO_SMALL', result.reason);
      }
    } finally {
      restore();
    }
  });

  await test('eligibility: non-android → platform fallback', async () => {
    const restore = stubFetch({
      status: 206,
      headers: {
        'Content-Range': `bytes 0-0/${DOWNLOAD_ENGINE.minMultiRangeBytes}`,
      },
    });
    try {
      const result = await evaluateMultiRangeEligibility({
        sourceUrl: 'https://cdn.example.com/video.mp4',
        knownFileSize: DOWNLOAD_ENGINE.minMultiRangeBytes,
        platformOs: 'ios',
      });
      assert(!result.eligible, 'ineligible');
      if (!result.eligible) {
        assert(result.reason === 'PLATFORM_UNSUPPORTED', result.reason);
      }
    } finally {
      restore();
    }
  });

  await test('worker validation: valid 206 part range', () => {
    const result = validateRangeResumeResponse({
      status: 206,
      contentRange: 'bytes 0-24/100',
      etag: '"a"',
      offset: 0,
      sentIfRange: true,
      knownTotalBytes: 100,
      priorValidators: { etag: '"a"', lastModified: null, contentLength: 100 },
    });
    assert(result.totalBytes === 100, 'total');
  });

  await test('worker validation: bad Content-Range / wrong start / wrong total', () => {
    expectCode(
      () =>
        validateRangeResumeResponse({
          status: 206,
          contentRange: 'bytes 10-24/100',
          offset: 0,
          sentIfRange: false,
          knownTotalBytes: 100,
          priorValidators: null,
        }),
      'INVALID_RANGE_RESPONSE',
    );
    expectCode(
      () =>
        validateRangeResumeResponse({
          status: 206,
          contentRange: 'bytes 0-24/999',
          offset: 0,
          sentIfRange: false,
          knownTotalBytes: 100,
          priorValidators: { contentLength: 100 },
        }),
      'SOURCE_CHANGED',
    );
  });

  await test('worker validation: ETag mismatch → SOURCE_CHANGED', () => {
    expectCode(
      () =>
        assertSourceIdentityCompatible(
          { etag: '"old"', lastModified: null, contentLength: 100 },
          { etag: '"new"', lastModified: null, contentLength: 100 },
        ),
      'SOURCE_CHANGED',
    );
  });

  await test('worker validation: HTTP 200 on range → not valid resume', () => {
    expectCode(
      () =>
        validateRangeResumeResponse({
          status: 200,
          contentRange: null,
          offset: 0,
          sentIfRange: false,
          knownTotalBytes: 100,
          priorValidators: null,
        }),
      'RESUME_UNSUPPORTED',
    );
  });

  await test('concurrency: global cap + fairness between two downloads', () => {
    const budget = new GlobalNetworkBudget(6);
    const fairA = budget.recommendFairShare('a', 4, ['a', 'b']);
    const fairB = budget.recommendFairShare('b', 4, ['a', 'b']);
    assert(fairA === 3, `fairA=${fairA}`);
    assert(fairB === 3, `fairB=${fairB}`);

    const g1 = budget.tryAcquire('a', fairA);
    const g2 = budget.tryAcquire('b', fairB);
    assert(g1 === 3 && g2 === 3, 'acquired');
    const full = budget.activeCount;
    assert(full === 6, 'full');
    assert(budget.tryAcquire('c', 1) === 0, 'no leftover');

    budget.release('a', 3);
    assert(budget.getAvailable() === 3, 'released');
    budget.releaseAll('b');
    const cleared = budget.activeCount;
    assert(cleared === 0, 'cleared');
  });

  await test('concurrency: queue 1 × ranges 4 respects global cap', () => {
    const budget = new GlobalNetworkBudget(6);
    const fair = budget.recommendFairShare('solo', 4, ['solo']);
    assert(fair === 4, `fair=${fair}`);
    assert(budget.tryAcquire('solo', 4) === 4, 'grant');
    assert(budget.tryAcquire('solo', 4) === 2, 'remaining 2');
    budget.releaseAll('solo');
    const cleared = budget.activeCount;
    assert(cleared === 0, 'slots released');
  });

  await test('resume helper: multi-range checkpoint detection', () => {
    assert(!hasResumableMultiRange(null), 'null');
    assert(
      !hasResumableMultiRange({
        contentLength: 100,
        workerCount: 1,
        sourceValidators: null,
        parts: [
          {
            index: 0,
            rangeStart: 0,
            rangeEnd: 99,
            downloadedBytes: 10,
            status: 'PAUSED',
            retryCount: 0,
            lastFailureReason: null,
          },
        ],
        failedPart: null,
      }),
      'single part not multi',
    );
    assert(
      hasResumableMultiRange({
        contentLength: 100,
        workerCount: 2,
        sourceValidators: null,
        parts: [
          {
            index: 0,
            rangeStart: 0,
            rangeEnd: 49,
            downloadedBytes: 49,
            status: 'COMPLETED',
            retryCount: 0,
            lastFailureReason: null,
          },
          {
            index: 1,
            rangeStart: 50,
            rangeEnd: 99,
            downloadedBytes: 10,
            status: 'PAUSED',
            retryCount: 1,
            lastFailureReason: 'NETWORK_ERROR',
          },
        ],
        failedPart: null,
      }),
      'two parts',
    );
  });

  await test('retry policy: merge/part codes are not auto-retryable', () => {
    assert(!isAutoRetryableCode('MERGE_FAILED'), 'merge');
    assert(!isAutoRetryableCode('PART_SIZE_MISMATCH'), 'part');
    assert(!isAutoRetryableCode('FINAL_SIZE_MISMATCH'), 'final');
    assert(isAutoRetryableCode('NETWORK_ERROR'), 'network still retryable');
  });

  await test('constants: separate queue vs range concurrency domains', () => {
    assert(DOWNLOAD_ENGINE.maxConcurrentDownloads >= 1, 'queue');
    assert(DOWNLOAD_ENGINE.maxRangesPerFile === 4, 'ranges');
    assert(DOWNLOAD_ENGINE.maxGlobalNetworkWorkers === 6, 'global');
    assert(
      DOWNLOAD_ENGINE.maxRangesPerFile <= DOWNLOAD_ENGINE.maxGlobalNetworkWorkers,
      'cap relationship',
    );
  });

  await test('regression: HLS playlist guard still isolates streams', () => {
    assert(isPlaylistOrStreamUrl('https://x/a.m3u8'), 'm3u8');
    assert(!isPlaylistOrStreamUrl('https://x/a.mp4'), 'mp4');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
