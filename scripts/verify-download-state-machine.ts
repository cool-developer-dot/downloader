/**
 * Phase 1C — canonical download execution state machine verification.
 * Run: npm run verify:download-state-machine
 */

import { deriveDownloadExecutionDisplayState } from '../src/downloads/execution/display-status';
import {
  createExecutionSnapshot,
  freshBytesWritten,
} from '../src/downloads/execution/download-execution-state';
import {
  assertExecutionInvariant,
  catalogStatusForExecutionState,
  executionStateFromWaitingReason,
  isAllowedExecutionTransition,
  markFirstValidByte,
  transitionDownloadExecutionState,
  workerStateForExecutionState,
} from '../src/downloads/execution/download-state-machine';
import {
  assertProgressStatusInvariant,
  computeProgressPercent,
} from '../src/downloads/engine/progress';

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

console.log('Phase 1C — Download State Machine Verification\n');

async function main(): Promise<void> {
await test('create/preparation maps to QUEUED catalog status', () => {
  assert(
    catalogStatusForExecutionState('PREPARING') === 'QUEUED',
    'PREPARING → QUEUED catalog',
  );
});

await test('scheduler admission → STARTING execution state', () => {
  const snap = createExecutionSnapshot('a', 1, 0);
  const result = transitionDownloadExecutionState({
    snapshot: snap,
    to: 'STARTING',
    reason: 'worker_admitted',
    generation: 1,
  });
  assert(result.ok && snap.state === 'STARTING', 'STARTING after admit');
  assert(
    catalogStatusForExecutionState('STARTING') === 'QUEUED',
    'STARTING stays QUEUED in catalog',
  );
});

await test('STARTING with zero fresh bytes remains STARTING', () => {
  const snap = createExecutionSnapshot('b', 2, 0);
  transitionDownloadExecutionState({
    snapshot: snap,
    to: 'STARTING',
    reason: 'worker_admitted',
    generation: 2,
  });
  const result = markFirstValidByte({
    snapshot: snap,
    bytesWritten: 0,
    generation: 2,
  });
  assert(result.ok && snap.state === 'STARTING', 'no byte → STARTING');
  assert(freshBytesWritten(snap) === 0, 'fresh bytes remain 0');
});

await test('first fresh byte → DOWNLOADING', () => {
  const snap = createExecutionSnapshot('c', 3, 0);
  transitionDownloadExecutionState({
    snapshot: snap,
    to: 'STARTING',
    reason: 'worker_admitted',
    generation: 3,
  });
  const result = markFirstValidByte({
    snapshot: snap,
    bytesWritten: 65536,
    generation: 3,
  });
  assert(result.ok && result.changed, 'first byte changed state');
  assert(snap.state === 'DOWNLOADING', 'now DOWNLOADING');
  assert(snap.firstByteObserved, 'first byte flag set');
});

await test('first-byte transition fires once (idempotent)', () => {
  const snap = createExecutionSnapshot('d', 4, 0);
  transitionDownloadExecutionState({
    snapshot: snap,
    to: 'STARTING',
    reason: 'worker_admitted',
    generation: 4,
  });
  markFirstValidByte({ snapshot: snap, bytesWritten: 1024, generation: 4 });
  const second = markFirstValidByte({
    snapshot: snap,
    bytesWritten: 2048,
    generation: 4,
  });
  assert(second.ok && !second.changed, 'second mark is no-op');
  assert(snap.state === 'DOWNLOADING', 'still DOWNLOADING');
});

await test('Content-Length known but no bytes → STARTING', () => {
  const snap = createExecutionSnapshot('e', 5, 0);
  transitionDownloadExecutionState({
    snapshot: snap,
    to: 'STARTING',
    reason: 'worker_admitted',
    generation: 5,
    totalBytes: 1_000_000,
  });
  assert(snap.state === 'STARTING', 'still STARTING with known total');
  assert(
    computeProgressPercent(snap.bytesWritten, snap.totalBytes) === 0,
    '0% progress',
  );
});

await test('response status 200 but no bytes → STARTING (no promotion helper)', () => {
  const snap = createExecutionSnapshot('f', 6, 0);
  transitionDownloadExecutionState({
    snapshot: snap,
    to: 'STARTING',
    reason: 'worker_admitted',
    generation: 6,
  });
  assert(
    !isAllowedExecutionTransition('STARTING', 'DOWNLOADING') ||
      freshBytesWritten(snap) === 0,
    'cannot be DOWNLOADING without fresh bytes',
  );
});

await test('existing partial file on resume does not auto-promote DOWNLOADING', () => {
  const snap = createExecutionSnapshot('g', 7, 18_874_368);
  snap.bytesWritten = 18_874_368;
  transitionDownloadExecutionState({
    snapshot: snap,
    to: 'STARTING',
    reason: 'worker_admitted',
    generation: 7,
    attemptStartBytes: 18_874_368,
  });
  const result = markFirstValidByte({
    snapshot: snap,
    bytesWritten: 18_874_368,
    generation: 7,
  });
  assert(result.ok && snap.state === 'STARTING', 'partial alone stays STARTING');
});

await test('resumed attempt first NEW byte → DOWNLOADING', () => {
  const snap = createExecutionSnapshot('h', 8, 18_874_368);
  snap.bytesWritten = 18_874_368;
  transitionDownloadExecutionState({
    snapshot: snap,
    to: 'STARTING',
    reason: 'worker_admitted',
    generation: 8,
    attemptStartBytes: 18_874_368,
  });
  const result = markFirstValidByte({
    snapshot: snap,
    bytesWritten: 18_938_432,
    generation: 8,
  });
  assert(result.ok && snap.state === 'DOWNLOADING', 'new bytes promote');
});

await test('transfer complete → FINALIZING', () => {
  const snap = createExecutionSnapshot('i', 9, 0);
  transitionDownloadExecutionState({
    snapshot: snap,
    to: 'STARTING',
    reason: 'worker_admitted',
    generation: 9,
  });
  markFirstValidByte({ snapshot: snap, bytesWritten: 1_000_000, generation: 9 });
  const result = transitionDownloadExecutionState({
    snapshot: snap,
    to: 'FINALIZING',
    reason: 'transfer_complete',
    progress: 100,
    bytesWritten: 1_000_000,
    totalBytes: 1_000_000,
  });
  assert(result.ok && snap.state === 'FINALIZING', 'FINALIZING after transfer');
});

await test('FINALIZING success → COMPLETED', () => {
  const snap = createExecutionSnapshot('j', 10, 0);
  transitionDownloadExecutionState({
    snapshot: snap,
    to: 'STARTING',
    reason: 'worker_admitted',
    generation: 10,
  });
  markFirstValidByte({ snapshot: snap, bytesWritten: 100, generation: 10 });
  transitionDownloadExecutionState({
    snapshot: snap,
    to: 'FINALIZING',
    reason: 'transfer_complete',
  });
  const result = transitionDownloadExecutionState({
    snapshot: snap,
    to: 'COMPLETED',
    reason: 'finalization_success',
  });
  assert(result.ok && snap.state === 'COMPLETED', 'COMPLETED');
});

await test('FINALIZING failure → FAILED', () => {
  const snap = createExecutionSnapshot('k', 11, 0);
  transitionDownloadExecutionState({
    snapshot: snap,
    to: 'STARTING',
    reason: 'worker_admitted',
    generation: 11,
  });
  markFirstValidByte({ snapshot: snap, bytesWritten: 100, generation: 11 });
  transitionDownloadExecutionState({
    snapshot: snap,
    to: 'FINALIZING',
    reason: 'transfer_complete',
  });
  const result = transitionDownloadExecutionState({
    snapshot: snap,
    to: 'FAILED',
    reason: 'finalization_failure',
  });
  assert(result.ok && snap.state === 'FAILED', 'FAILED after finalize error');
});

await test('WAITING_FOR_WIFI has no active worker invariant', () => {
  const snap = createExecutionSnapshot('l', 0, 0);
  transitionDownloadExecutionState({
    snapshot: snap,
    to: 'WAITING_FOR_WIFI',
    reason: 'waiting_for_wifi',
  });
  assert(
    assertExecutionInvariant({ snapshot: snap, hasActiveWorker: false }),
    'valid without worker',
  );
  assert(
    !assertExecutionInvariant({ snapshot: snap, hasActiveWorker: true }),
    'invalid with worker',
  );
});

await test('capacity waiting remains QUEUED execution state', () => {
  assert(
    executionStateFromWaitingReason('CAPACITY') === 'QUEUED',
    'CAPACITY → QUEUED',
  );
});

await test('WAITING_FOR_WIFI from scheduler reason', () => {
  assert(
    executionStateFromWaitingReason('WAITING_FOR_WIFI') === 'WAITING_FOR_WIFI',
    'wifi reason maps',
  );
});

await test('CANCELLED cannot transition to STARTING', () => {
  const snap = createExecutionSnapshot('m', 12, 0);
  transitionDownloadExecutionState({
    snapshot: snap,
    to: 'CANCELLED',
    reason: 'user_cancel',
  });
  const result = transitionDownloadExecutionState({
    snapshot: snap,
    to: 'STARTING',
    reason: 'worker_admitted',
  });
  assert(!result.ok, 'rejected transition');
});

await test('COMPLETED cannot transition to DOWNLOADING', () => {
  const snap = createExecutionSnapshot('n', 13, 0);
  transitionDownloadExecutionState({
    snapshot: snap,
    to: 'COMPLETED',
    reason: 'finalization_success',
  });
  const result = transitionDownloadExecutionState({
    snapshot: snap,
    to: 'DOWNLOADING',
    reason: 'first_valid_byte',
  });
  assert(!result.ok, 'rejected transition');
});

await test('stale attempt progress ignored', () => {
  const snap = createExecutionSnapshot('o', 14, 0);
  transitionDownloadExecutionState({
    snapshot: snap,
    to: 'STARTING',
    reason: 'worker_admitted',
    generation: 14,
  });
  const result = markFirstValidByte({
    snapshot: snap,
    bytesWritten: 4096,
    generation: 13,
  });
  assert(!result.ok && result.reason === 'stale_generation', 'stale gen rejected');
});

await test('progress cannot exceed 100', () => {
  const snap = createExecutionSnapshot('p', 15, 0);
  snap.progress = 150;
  assert(
    !assertExecutionInvariant({ snapshot: snap, hasActiveWorker: false, progress: 150 }),
    'progress > 100 invalid',
  );
});

await test('known bytes >= total but still DOWNLOADING is invalid', () => {
  const snap = createExecutionSnapshot('q', 16, 0);
  transitionDownloadExecutionState({
    snapshot: snap,
    to: 'DOWNLOADING',
    reason: 'first_valid_byte',
  });
  snap.firstByteObserved = true;
  snap.bytesWritten = 1_000;
  snap.totalBytes = 1_000;
  assert(
    !assertExecutionInvariant({ snapshot: snap, hasActiveWorker: true }),
    'should be FINALIZING not DOWNLOADING at 100%',
  );
});

await test('UI projection STARTING label', () => {
  assert(
    deriveDownloadExecutionDisplayState({
      executionState: 'STARTING',
      status: 'QUEUED',
      appState: 'active',
      hasActiveExecution: true,
    }) === 'STARTING',
    'STARTING display',
  );
});

await test('UI projection WAITING_FOR_WIFI from canonical state', () => {
  assert(
    deriveDownloadExecutionDisplayState({
      executionState: 'WAITING_FOR_WIFI',
      status: 'QUEUED',
      appState: 'active',
    }) === 'WAITING_FOR_WIFI',
    'wifi display from execution state',
  );
});

await test('special regression: admitted before bytes → STARTING not DOWNLOADING', () => {
  assert(
    deriveDownloadExecutionDisplayState({
      executionState: 'STARTING',
      status: 'QUEUED',
      workerState: 'STARTING',
      appState: 'active',
      hasActiveExecution: true,
    }) === 'STARTING',
    'no DOWNLOADING 0% symptom',
  );
  assert(
    !assertProgressStatusInvariant({
      status: 'DOWNLOADING',
      bytesWritten: 0,
      executionState: 'STARTING',
    }),
    'DOWNLOADING catalog + STARTING execution invalid',
  );
});

await test('after first 64KB → DOWNLOADING catalog mapping', () => {
  const snap = createExecutionSnapshot('r', 17, 0);
  transitionDownloadExecutionState({
    snapshot: snap,
    to: 'STARTING',
    reason: 'worker_admitted',
    generation: 17,
  });
  markFirstValidByte({ snapshot: snap, bytesWritten: 65536, generation: 17 });
  assert(
    catalogStatusForExecutionState(snap.state) === 'DOWNLOADING',
    'catalog DOWNLOADING after bytes',
  );
  assert(
    workerStateForExecutionState(snap.state) === 'TRANSFERRING',
    'worker TRANSFERRING',
  );
});

await test('unknown total does not fabricate percentage', () => {
  assert(computeProgressPercent(500_000, null) === 0, 'unknown total → 0%');
});

await test('QUEUED → DOWNLOADING without STARTING is disallowed', () => {
  assert(
    !isAllowedExecutionTransition('QUEUED', 'DOWNLOADING'),
    'must pass through STARTING',
  );
});

await test('STARTING + first fresh byte must reach DOWNLOADING', () => {
  const snap = createExecutionSnapshot('s', 18, 0);
  transitionDownloadExecutionState({
    snapshot: snap,
    to: 'STARTING',
    reason: 'worker_admitted',
    generation: 18,
  });
  const result = markFirstValidByte({
    snapshot: snap,
    bytesWritten: 1,
    generation: 18,
  });
  assert(result.changed && snap.state === 'DOWNLOADING', 'promoted on byte 1');
});

await test('DOWNLOADING without firstByteObserved fails invariant', () => {
  const snap = createExecutionSnapshot('t', 19, 0);
  snap.state = 'DOWNLOADING';
  snap.firstByteObserved = false;
  assert(
    !assertExecutionInvariant({ snapshot: snap, hasActiveWorker: true }),
    'DOWNLOADING requires first byte',
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
}

void main();
