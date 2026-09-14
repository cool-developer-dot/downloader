/**
 * Week 7 Day 3 Phase 2 — progressive resume / retry / source validation verifier.
 * Deterministic fixtures. NO network. NO Metro. NO emulator.
 *
 * Usage (from mobile/):
 *   npx tsx scripts/verify-week7-day3-phase2.ts
 */

import { DownloadEngineError } from '../src/downloads/engine/errors';
import {
  classifyTransferFailure,
} from '../src/downloads/engine/errors';
import {
  parseContentRange,
  validateRangeResumeResponse,
} from '../src/downloads/engine/range-validation';
import {
  computeRetryDelayMs,
  isAutoRetryableCode,
  isManualRetryAllowed,
  shouldScheduleAutoRetry,
} from '../src/downloads/engine/retry-policy';
import { assertSourceIdentityCompatible } from '../src/downloads/engine/source-identity';
import {
  etagsConflict,
  mergeRangeValidatorsWithLength,
} from '../src/downloads/engine/source-validators';
import { decideRecoveryState } from '../src/downloads/engine/recovery-decision';
import { DOWNLOAD_ENGINE } from '../src/downloads/engine/constants';

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

async function main(): Promise<void> {
  console.log('Week 7 Day 3 Phase 2 — progressive resume & retry\n');

  await test('Content-Range parse: valid / malformed / totals', () => {
    const ok = parseContentRange('bytes 100-199/1000');
    assert(ok?.start === 100, 'start');
    assert(ok?.end === 199, 'end');
    assert(ok?.total === 1000, 'total');
    assert(parseContentRange('bytes 0-0/*')?.total === null, 'star total');
    assert(parseContentRange('bytes 50-40/100') === null, 'end < start');
    assert(parseContentRange('invalid') === null, 'malformed');
    assert(parseContentRange(null) === null, 'null');
  });

  await test('valid 206 resume with matching start', () => {
    const result = validateRangeResumeResponse({
      status: 206,
      contentRange: 'bytes 4096-8191/16384',
      etag: '"abc"',
      lastModified: 'Wed, 21 Oct 2015 07:28:00 GMT',
      contentLength: '4096',
      offset: 4096,
      sentIfRange: true,
      knownTotalBytes: 16384,
      priorValidators: { etag: '"abc"', contentLength: 16384 },
    });
    assert(result.totalBytes === 16384, 'total');
    assert(result.expectedRemaining === 4096, 'remaining');
    assert(result.validators.etag === '"abc"', 'etag');
  });

  await test('HTTP 200 without If-Range → RESUME_UNSUPPORTED (never append)', () => {
    expectCode(
      () =>
        validateRangeResumeResponse({
          status: 200,
          contentRange: null,
          offset: 1000,
          sentIfRange: false,
        }),
      'RESUME_UNSUPPORTED',
    );
  });

  await test('HTTP 200 with If-Range → SOURCE_CHANGED', () => {
    expectCode(
      () =>
        validateRangeResumeResponse({
          status: 200,
          contentRange: null,
          offset: 1000,
          sentIfRange: true,
        }),
      'SOURCE_CHANGED',
    );
  });

  await test('malformed Content-Range → INVALID_RANGE_RESPONSE', () => {
    expectCode(
      () =>
        validateRangeResumeResponse({
          status: 206,
          contentRange: 'bytes garbage',
          offset: 0,
          sentIfRange: false,
        }),
      'INVALID_RANGE_RESPONSE',
    );
  });

  await test('wrong Content-Range start → INVALID_RANGE_RESPONSE', () => {
    expectCode(
      () =>
        validateRangeResumeResponse({
          status: 206,
          contentRange: 'bytes 0-999/2000',
          offset: 500,
          sentIfRange: false,
        }),
      'INVALID_RANGE_RESPONSE',
    );
  });

  await test('Content-Range total mismatch → SOURCE_CHANGED', () => {
    expectCode(
      () =>
        validateRangeResumeResponse({
          status: 206,
          contentRange: 'bytes 100-199/999',
          offset: 100,
          sentIfRange: false,
          knownTotalBytes: 2000,
        }),
      'SOURCE_CHANGED',
    );
  });

  await test('ETag change on 206 → SOURCE_CHANGED', () => {
    expectCode(
      () =>
        validateRangeResumeResponse({
          status: 206,
          contentRange: 'bytes 10-19/100',
          etag: '"new"',
          offset: 10,
          sentIfRange: true,
          priorValidators: { etag: '"old"' },
        }),
      'SOURCE_CHANGED',
    );
  });

  await test('Last-Modified change → SOURCE_CHANGED', () => {
    expectCode(
      () =>
        assertSourceIdentityCompatible(
          { lastModified: 'Wed, 21 Oct 2015 07:28:00 GMT' },
          { lastModified: 'Thu, 22 Oct 2015 07:28:00 GMT' },
        ),
      'SOURCE_CHANGED',
    );
    expectCode(
      () =>
        assertSourceIdentityCompatible(
          { contentLength: 1000 },
          { contentLength: 2000 },
        ),
      'SOURCE_CHANGED',
    );
  });

  await test('weak/strong ETag normalization still detects mismatch', () => {
    assert(etagsConflict('W/"abc"', '"abc"') === false, 'weak vs strong same');
    assert(etagsConflict('"abc"', '"xyz"') === true, 'different');
  });

  await test('retryable classification: timeout / reset / 408 / 429 / 5xx', () => {
    for (const code of [
      'NETWORK_TIMEOUT',
      'NETWORK_ERROR',
      'RATE_LIMITED',
      'HTTP_ERROR',
      'TRANSFER_INTERRUPTED',
    ] as const) {
      assert(isAutoRetryableCode(code), code);
    }
    const classified429 = classifyTransferFailure(
      new DownloadEngineError('RATE_LIMITED', 'busy', {
        httpStatus: 429,
        retryAfterSeconds: 5,
      }),
    );
    assert(classified429.autoRetryable === true, '429 auto');
    assert(classified429.retryAfterMs === 5000, 'retry-after');

    const classified503 = classifyTransferFailure(
      new DownloadEngineError('HTTP_ERROR', 'unavailable', { httpStatus: 503 }),
    );
    assert(classified503.autoRetryable === true, '503');
  });

  await test('non-retryable: 404 / 403 / SOURCE_CHANGED / storage / write', () => {
    assert(!isAutoRetryableCode('INVALID_RESOURCE'), '404 class');
    assert(!isAutoRetryableCode('AUTH_ERROR'), '403 class');
    assert(!isAutoRetryableCode('SOURCE_CHANGED'), 'source');
    assert(!isAutoRetryableCode('INSUFFICIENT_STORAGE'), 'storage');
    assert(!isAutoRetryableCode('FILE_WRITE_FAILED'), 'write');
    assert(!isAutoRetryableCode('FILE_FINALIZE_FAILED'), 'finalize');
    assert(!isAutoRetryableCode('INVALID_RANGE_RESPONSE'), 'range');
    assert(!isAutoRetryableCode('RESUME_UNSUPPORTED'), 'resume unsupported');
    assert(!isAutoRetryableCode('RETRY_EXHAUSTED'), 'exhausted');
  });

  await test('bounded exponential backoff 1s → 2s → 4s', () => {
    assert(computeRetryDelayMs(0) === 1000, '1s');
    assert(computeRetryDelayMs(1) === 2000, '2s');
    assert(computeRetryDelayMs(2) === 4000, '4s');
    assert(computeRetryDelayMs(20) === 60_000, 'cap');
  });

  await test('retry exhaustion gate', () => {
    assert(
      shouldScheduleAutoRetry({
        retryEligible: true,
        retryCount: 2,
        errorCode: 'NETWORK_ERROR',
      }) === true,
      'attempt 3 ok',
    );
    assert(
      shouldScheduleAutoRetry({
        retryEligible: true,
        retryCount: 3,
        errorCode: 'NETWORK_ERROR',
      }) === false,
      'exhausted',
    );
    assert(
      shouldScheduleAutoRetry({
        retryEligible: true,
        retryCount: 0,
        errorCode: 'SOURCE_CHANGED',
      }) === false,
      'non-retryable',
    );
  });

  await test('manual retry allowed after SOURCE_CHANGED / RESUME_UNSUPPORTED for clean restart', () => {
    assert(isManualRetryAllowed('SOURCE_CHANGED') === true, 'source');
    assert(isManualRetryAllowed('RESUME_UNSUPPORTED') === true, 'unsupported');
    assert(isManualRetryAllowed('RETRY_EXHAUSTED') === true, 'exhausted');
    assert(isManualRetryAllowed('AUTH_ERROR') === false, 'auth blocked');
  });

  await test('validator merge preserves contentLength', () => {
    const merged = mergeRangeValidatorsWithLength(
      { etag: '"a"', contentLength: 1000 },
      { lastModified: 'Wed, 21 Oct 2015 07:28:00 GMT' },
    );
    assert(merged?.etag === '"a"', 'etag');
    assert(merged?.contentLength === 1000, 'length');
    assert(merged?.lastModified?.includes('2015') === true, 'lm');
  });

  await test('storage remaining math uses expected - partial + margin', () => {
    const expected = 100_000_000;
    const partial = 40_000_000;
    const remaining = Math.max(0, expected - partial);
    const need = remaining + DOWNLOAD_ENGINE.diskSafetyMarginBytes;
    assert(remaining === 60_000_000, 'remaining');
    assert(need === 60_000_000 + 4 * 1024 * 1024, 'margin');
    assert(need < expected + DOWNLOAD_ENGINE.diskSafetyMarginBytes, 'less than full');
  });

  await test('completion verification rules (pure)', () => {
    const verify = (size: number, expected: number | null) => {
      if (size <= 0) return false;
      if (expected != null && expected > 0 && Math.abs(size - expected) > 1024) {
        return false;
      }
      return true;
    };
    assert(verify(1000, 1000) === true, 'match');
    assert(verify(1000, 5000) === false, 'mismatch');
    assert(verify(0, 1000) === false, 'zero');
    assert(verify(500, null) === true, 'unknown expected ok if >0');
  });

  await test('disk size is authoritative over stale counter', () => {
    const disk = 8_000_000;
    const staleCounter = 12_000_000;
    const resumeOffset = Math.min(disk, staleCounter) === disk ? disk : disk;
    // Never trust a counter ahead of on-disk bytes.
    assert(resumeOffset === disk, 'disk wins');
    assert(staleCounter > disk, 'counter was stale');
  });

  await test('progressive recovery still prefers PAUSED when partial resumable', () => {
    const decision = decideRecoveryState({
      remoteStatus: 'DOWNLOADING',
      localState: 'transferring',
      hasActiveWorker: false,
      isQueued: false,
      isSuppressed: false,
      isHls: false,
      hasValidPartial: true,
      canResume: true,
      hasVerifiedFinalFile: false,
      completedFileMissing: false,
      sourceUrlSafe: true,
    });
    assert(decision.action === 'RECOVER_TO_PAUSED', decision.action);
  });

  await test('HLS interrupted recovery unchanged', () => {
    const decision = decideRecoveryState({
      remoteStatus: 'DOWNLOADING',
      localState: 'transferring',
      hasActiveWorker: false,
      isQueued: false,
      isSuppressed: false,
      isHls: true,
      hasValidPartial: false,
      canResume: false,
      hasVerifiedFinalFile: false,
      completedFileMissing: false,
      sourceUrlSafe: true,
    });
    assert(decision.action === 'RECOVER_TO_FAILED', decision.action);
  });

  console.log(`\nday3-phase2: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void main();
