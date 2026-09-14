/**
 * Phase 1D — transfer reliability, watchdog, and bounded probe tests.
 * Run: npx tsx scripts/verify-transfer-reliability.ts
 */

import { readBoundedResponseBody } from '../src/downloads/network/bounded-response-reader';
import {
  computeProgressPercent,
  normalizeTotalBytes,
} from '../src/downloads/engine/progress';
import { StallWatchdog } from '../src/downloads/engine/stall-watchdog';
import { TRANSFER_TIMEOUTS } from '../src/downloads/engine/transfer-timeouts';
import { DOWNLOAD_ENGINE } from '../src/downloads/engine/constants';
import { DownloadEngineError } from '../src/downloads/engine/errors';
import { isAutoRetryableCode } from '../src/downloads/engine/retry-policy';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    failed += 1;
    console.error(`FAIL: ${message}`);
    return;
  }
  passed += 1;
  console.log(`PASS: ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeStreamResponse(chunks: Uint8Array[], contentLength?: number): Response {
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[index]);
      index += 1;
    },
  });
  const headers = new Headers();
  if (contentLength != null) {
    headers.set('Content-Length', String(contentLength));
  }
  return new Response(stream, { status: 200, headers });
}

async function main(): Promise<void> {
  assert(
    TRANSFER_TIMEOUTS.firstByteTimeoutMs === DOWNLOAD_ENGINE.socialFirstByteTimeoutMs,
    'first-byte timeout wired to engine constant',
  );

  const wd1 = new StallWatchdog({ generation: 1, firstByteMs: 5000 });
  wd1.startFirstBytePhase({ generation: 1, baselineBytes: 0 });
  wd1.noteBytes(1024);
  try {
    wd1.assertHealthy(1);
    assert(true, 'first-byte phase transitions after valid bytes');
  } catch {
    assert(false, 'first-byte phase transitions after valid bytes');
  }
  wd1.stop();

  let stallFired = false;
  const wd2 = new StallWatchdog({
    generation: 2,
    firstByteMs: 40,
    onStall: () => {
      stallFired = true;
    },
  });
  wd2.startFirstBytePhase({ generation: 2, baselineBytes: 0 });
  await sleep(80);
  try {
    wd2.assertHealthy(2);
    assert(false, 'first-byte timeout throws FIRST_BYTE_TIMEOUT');
  } catch (error) {
    assert(
      error instanceof DownloadEngineError && error.code === 'FIRST_BYTE_TIMEOUT',
      'first-byte timeout throws FIRST_BYTE_TIMEOUT',
    );
    assert(stallFired, 'first-byte timeout fires onStall');
  }
  wd2.stop();

  const wd3 = new StallWatchdog({ generation: 3, firstByteMs: 30 });
  wd3.startFirstBytePhase({ generation: 3, baselineBytes: 100 });
  wd3.noteBytes(200);
  await sleep(60);
  try {
    wd3.assertHealthy(3);
    assert(true, 'first-byte timer cancelled after first byte');
  } catch {
    assert(false, 'first-byte timer cancelled after first byte');
  }
  wd3.stop();

  const wd4 = new StallWatchdog({ generation: 4, firstByteMs: 20 });
  wd4.startFirstBytePhase({ generation: 4, baselineBytes: 0 });
  await sleep(50);
  try {
    wd4.assertHealthy(99);
    assert(true, 'stale generation timeout ignored');
  } catch {
    assert(false, 'stale generation timeout ignored');
  }
  wd4.stop();

  const wd5 = new StallWatchdog({
    generation: 5,
    inactivityMs: 40,
    onStall: () => {
      stallFired = true;
    },
  });
  stallFired = false;
  wd5.startTransferPhase({ generation: 5 });
  wd5.noteBytes(1000);
  await sleep(80);
  try {
    wd5.assertHealthy(5);
    assert(false, 'transfer stall throws TRANSFER_STALLED');
  } catch (error) {
    assert(
      error instanceof DownloadEngineError && error.code === 'TRANSFER_STALLED',
      'transfer stall throws TRANSFER_STALLED',
    );
  }
  wd5.stop();

  const wd6 = new StallWatchdog({ generation: 6, inactivityMs: 80 });
  wd6.startTransferPhase({ generation: 6 });
  wd6.noteBytes(500);
  await sleep(40);
  wd6.noteBytes(1000);
  await sleep(40);
  try {
    wd6.assertHealthy(6);
    assert(true, 'continued bytes refresh stall timer');
  } catch {
    assert(false, 'continued bytes refresh stall timer');
  }
  wd6.stop();

  const wd7 = new StallWatchdog({ generation: 7, firstByteMs: 5000 });
  wd7.startFirstBytePhase({ generation: 7, baselineBytes: 26_000_000 });
  wd7.noteBytes(26_000_000);
  try {
    wd7.assertHealthy(7);
    assert(true, 'existing partial does not count as first byte');
  } catch {
    assert(false, 'existing partial does not count as first byte');
  }
  wd7.noteBytes(26_000_100);
  try {
    wd7.assertHealthy(7);
    assert(true, 'fresh resume bytes promote transfer phase');
  } catch {
    assert(false, 'fresh resume bytes promote transfer phase');
  }
  wd7.stop();

  const wd9 = new StallWatchdog({ generation: 9 });
  wd9.startHlsManifestPhase({ generation: 9, timeoutMs: 30 });
  await sleep(60);
  try {
    wd9.assertHealthy(9);
    assert(false, 'HLS manifest timeout');
  } catch (error) {
    assert(
      error instanceof DownloadEngineError && error.code === 'HLS_MANIFEST_TIMEOUT',
      'HLS manifest timeout',
    );
  }
  wd9.stop();

  const hugeChunks = [new Uint8Array(64 * 1024), new Uint8Array(64 * 1024)];
  const probeCap = 4096;
  const bounded = await readBoundedResponseBody(
    makeStreamResponse(hugeChunks, 100 * 1024 * 1024),
    probeCap,
  );
  assert(bounded.bytesConsumed <= probeCap, 'server ignores Range → read only cap');
  assert(bounded.abortedAtByteLimit, 'bounded read aborted at byte limit');

  const noLength = await readBoundedResponseBody(
    makeStreamResponse([new Uint8Array(8192)]),
    probeCap,
  );
  assert(noLength.bytesConsumed <= probeCap, 'missing Content-Length → cap enforced');

  const lyingLength = await readBoundedResponseBody(
    makeStreamResponse([new Uint8Array(8192)], 50),
    probeCap,
  );
  assert(lyingLength.bytesConsumed <= probeCap, 'lying Content-Length → cap enforced');

  assert(computeProgressPercent(18_700_000, null) === 0, 'unknown total → no fabricated percent');
  assert(computeProgressPercent(500_000, 1_000_000) === 50, 'known total → correct percentage');
  assert(computeProgressPercent(1_100_000, 1_000_000) === 100, 'percentage clamped at 100');

  assert(isAutoRetryableCode('FIRST_BYTE_TIMEOUT'), 'FIRST_BYTE_TIMEOUT auto-retryable');
  assert(isAutoRetryableCode('TRANSFER_STALLED'), 'TRANSFER_STALLED auto-retryable');
  assert(isAutoRetryableCode('HLS_SEGMENT_TIMEOUT'), 'HLS_SEGMENT_TIMEOUT auto-retryable');

  const wd10 = new StallWatchdog({
    generation: 10,
    inactivityMs: 20,
    shouldPause: () => true,
  });
  wd10.startTransferPhase({ generation: 10 });
  await sleep(50);
  try {
    wd10.assertHealthy(10);
    assert(true, 'PAUSED watchdog does not fail');
  } catch {
    assert(false, 'PAUSED watchdog does not fail');
  }
  wd10.stop();

  const wd11 = new StallWatchdog({ generation: 11, inactivityMs: 20 });
  wd11.startTransferPhase({ generation: 11 });
  wd11.stop();
  await sleep(50);
  try {
    wd11.assertHealthy(11);
    assert(true, 'timer cleanup after stop');
  } catch {
    assert(false, 'timer cleanup after stop');
  }

  assert(
    TRANSFER_TIMEOUTS.boundedProbeMaxBytes === DOWNLOAD_ENGINE.boundedProbeMaxBytes,
    'probe byte limit centralized',
  );
  assert(normalizeTotalBytes(0) === null, 'zero total normalized to null (no fake percent)');

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
