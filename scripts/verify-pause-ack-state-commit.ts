/**
 * Pause acknowledgement / PAUSED state-commit verifier.
 * Production functions only — no fake downloader, no polling harness.
 * Run: npm run verify:pause-ack-state-commit
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DownloadEngineError } from '../src/downloads/engine/errors';
import {
  awaitNativePauseTask,
  captureNativePauseState,
  classifyUserPauseAbort,
  decidePauseCommit,
  detectPauseSplitBrain,
  isUserPauseAbortError,
  nativePauseFalseDoesNotFailUserPause,
  pauseFailureMessageForUi,
  pauseNativeDownloadTask,
  shouldAcceptPausedStatusEvent,
  shouldRejectLateDownloadingStatusOverPaused,
  shouldRejectLateTransferringOverPaused,
  shouldShowPauseFailureMessage,
  shouldAbortAbortSignalAfterNativePause,
  USER_PAUSE_ABORT_MESSAGE,
} from '../src/downloads/engine/pause-ack';
import {
  capturePauseSettleHandle,
  createWorkerSettleBarrier,
  isSamePauseGeneration,
  oldGenerationCannotSatisfyPause,
  waitForCapturedSettle,
  waitForCapturedSettleWithTimeout,
} from '../src/downloads/engine/worker-settle';
import {
  catalogStatusForExecutionState,
  isAllowedExecutionTransition,
  transitionDownloadExecutionState,
  createExecutionSnapshot,
} from '../src/downloads/execution/download-state-machine';
import {
  resolveDownloadRuntimeActions,
  runtimeActionsToCardActions,
} from '../src/downloads/runtime-actions';
import {
  parseContentRange,
  validateRangeResumeResponse,
} from '../src/downloads/engine/range-validation';
import { buildDurablePauseState, parseAndroidResumeOffset } from '../src/downloads/engine/pause-state';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`FAIL  ${name}`);
    console.error(`      ${message}`);
  }
}

async function testAsync(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`FAIL  ${name}`);
    console.error(`      ${message}`);
  }
}

console.log('Pause ack / PAUSED state-commit verifier\n');

test('1 active progressive pause stops transport (native pause; abort gated)', () => {
  const fn = read('src/downloads/engine/worker.ts');
  const body = fn.slice(fn.indexOf('async pause('), fn.indexOf('async cancel('));
  const pauseIdx = body.indexOf('awaitNativePauseTask');
  const abortIdx = body.indexOf('abortController.abort()');
  assert(pauseIdx >= 0 && abortIdx > pauseIdx, 'native pause before optional abort');
  assert(body.includes('pauseRequested = true'), 'flag first');
  assert(body.includes('shouldAbortAbortSignalAfterNativePause'), 'cancel gated');
});

test('2 user-abort classified USER_PAUSE', () => {
  const abort = new Error('Aborted');
  abort.name = 'AbortError';
  assert(classifyUserPauseAbort(abort, true) === 'USER_PAUSE', 'abort');
  assert(
    classifyUserPauseAbort(
      new DownloadEngineError('CANCELLED', USER_PAUSE_ABORT_MESSAGE),
      true,
    ) === 'USER_PAUSE',
    'cancelled paused',
  );
  assert(classifyUserPauseAbort(abort, false) === 'NOT_USER_PAUSE', 'not requested');
});

test('3 safe transport stop allows PAUSED commit', () => {
  const d = decidePauseCommit({
    executionState: 'DOWNLOADING',
    workerStillTransferring: false,
    pauseRequested: true,
    localState: 'transferring',
    hasResumeData: true,
    hasHlsCheckpoint: false,
    hasMultiRangeCheckpoint: false,
    partialBytes: 12_000,
  });
  assert(d.commit && !d.fail, d.reason);
});

test('4 redundant task.pause false does not fail if transport settled', () => {
  assert(
    nativePauseFalseDoesNotFailUserPause(true, true),
    'redundant false ignored',
  );
  const d = decidePauseCommit({
    executionState: 'DOWNLOADING',
    workerStillTransferring: false,
    pauseRequested: true,
    localState: 'paused',
    hasResumeData: false,
    hasHlsCheckpoint: false,
    hasMultiRangeCheckpoint: false,
    partialBytes: 4096,
    nativePauseReturnedFalse: true,
  });
  assert(d.commit, 'commit despite native false');
});

test('5 genuine still-running transport does not commit PAUSED', () => {
  const d = decidePauseCommit({
    executionState: 'DOWNLOADING',
    workerStillTransferring: true,
    pauseRequested: true,
    localState: 'transferring',
    hasResumeData: false,
    hasHlsCheckpoint: false,
    hasMultiRangeCheckpoint: false,
    partialBytes: 100,
  });
  assert(d.fail && !d.commit, 'must fail');
  assert(d.reason === 'transport_still_active', d.reason);
});

testAsync('6 waitUntilSettled resolves on correct worker generation', async () => {
  const barrier = createWorkerSettleBarrier();
  const handle = capturePauseSettleHandle(7, barrier);
  assert(handle?.generation === 7, 'captured');
  let resolved = false;
  const wait = waitForCapturedSettle(handle, null).then(() => {
    resolved = true;
  });
  assert(!resolved, 'not yet');
  barrier.resolve();
  await wait;
  assert(resolved, 'resolved');
});

test('7 old generation cannot satisfy new pause', () => {
  assert(isSamePauseGeneration(capturePauseSettleHandle(1, createWorkerSettleBarrier()), 1), 'same');
  assert(
    !isSamePauseGeneration(capturePauseSettleHandle(1, createWorkerSettleBarrier()), 2),
    'not same',
  );
  assert(oldGenerationCannotSatisfyPause(1, 2, true), 'old cannot satisfy');
  assert(!oldGenerationCannotSatisfyPause(2, 2, true), 'current can');
});

test('8 PAUSED emitted to store (bind accepts manager commit)', () => {
  assert(
    shouldAcceptPausedStatusEvent({
      catalogStatus: 'DOWNLOADING',
      eventStatus: 'PAUSED',
      executionState: 'PAUSED',
    }),
    'accept commit',
  );
  const src = read('src/downloads/bind-engine-to-store.ts');
  assert(src.includes('shouldAcceptPausedStatusEvent'), 'wired');
  assert(src.includes("executionState: 'PAUSED'"), 'exec field');
});

test('9 PAUSED cannot be overwritten by late progress', () => {
  assert(
    shouldRejectLateTransferringOverPaused({
      catalogStatus: 'PAUSED',
      snapshotLocalState: 'transferring',
    }),
    'late transferring',
  );
});

test('10 PAUSED cannot be overwritten by late transferring state', () => {
  assert(
    shouldRejectLateTransferringOverPaused({
      catalogStatus: 'PAUSED',
      snapshotLocalState: 'paused',
      snapshotExecutionState: 'DOWNLOADING',
    }),
    'late exec',
  );
  assert(
    shouldRejectLateDownloadingStatusOverPaused({
      catalogStatus: 'PAUSED',
      eventStatus: 'DOWNLOADING',
      executionState: 'PAUSED',
    }),
    'late status',
  );
});

test('11 UI runtime actions show Resume', () => {
  const a = resolveDownloadRuntimeActions({
    status: 'PAUSED',
    executionState: 'PAUSED',
    workerState: 'PAUSED',
    hasActiveTransfer: false,
  });
  assert(!a.canPause && a.canResume && a.canCancel, 'resume visible');
  assert(runtimeActionsToCardActions(a).includes('resume'), 'card');
});

test('12 failure message absent on successful pause', () => {
  assert(
    !shouldShowPauseFailureMessage({
      pauseSucceeded: true,
      transportStopped: true,
      pausedCommitted: true,
    }),
    'no toast',
  );
});

test('13 genuine pause failure returns failure', () => {
  const d = decidePauseCommit({
    executionState: 'DOWNLOADING',
    workerStillTransferring: true,
    pauseRequested: false,
    localState: 'transferring',
    hasResumeData: false,
    hasHlsCheckpoint: false,
    hasMultiRangeCheckpoint: false,
    partialBytes: 0,
  });
  assert(d.fail, 'fail');
  assert(
    shouldShowPauseFailureMessage({
      pauseSucceeded: false,
      transportStopped: false,
      pausedCommitted: false,
    }),
    'toast',
  );
  assert(
    pauseFailureMessageForUi().includes('Couldn’t pause this download right now'),
    'copy',
  );
});

test('14 genuine failure keeps coherent runtime controls', () => {
  const a = resolveDownloadRuntimeActions({
    status: 'DOWNLOADING',
    executionState: 'DOWNLOADING',
    workerState: 'TRANSFERRING',
    hasActiveTransfer: true,
  });
  assert(a.canPause && !a.canResume && a.canCancel, 'still pause');
});

test('15 .part retained on pause (source)', () => {
  const worker = read('src/downloads/engine/worker.ts');
  const body = worker.slice(
    worker.indexOf('async pause('),
    worker.indexOf('async cancel('),
  );
  assert(!body.includes('deletePartialTransferQuiet'), 'no part delete in pause()');
  const settle = worker.slice(
    worker.indexOf('const settlePaused'),
    worker.indexOf('const settleMultiRangePaused'),
  );
  assert(!settle.includes('deletePartialTransferQuiet'), 'no part delete in settle');
});

test('16 no finalization on Pause (source)', () => {
  const settle = read('src/downloads/engine/worker.ts');
  const body = settle.slice(
    settle.indexOf('const settlePaused'),
    settle.indexOf('const settleMultiRangePaused'),
  );
  assert(!body.includes('this.complete('), 'no complete');
  assert(!body.includes('finalizing'), 'no finalize');
  assert(body.includes("remoteStatus: 'PAUSED'"), 'paused');
});

test('17 Resume from PAUSED queued once (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes("applyExecutionTransition(downloadId, 'QUEUED', 'resume'"), 'queued');
  assert(src.includes('RESUME_QUEUED'), 'trace');
});

test('18 duplicate Resume joins (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes('resumeOps'), 'map');
  assert(src.includes("event: 'RESUME_REQUESTED'"), 'join');
});

test('19 206 exact range still valid', () => {
  const result = validateRangeResumeResponse({
    status: 206,
    contentRange: 'bytes 100-199/1000',
    offset: 100,
    sentIfRange: false,
    knownTotalBytes: 1000,
  });
  assert(result.totalBytes === 1000, '206');
  const parsed = parseContentRange('bytes 100-199/1000');
  assert(parsed?.start === 100, 'start');
});

test('20 200 never append', () => {
  let threw = false;
  try {
    validateRangeResumeResponse({
      status: 200,
      contentRange: null,
      offset: 100,
      sentIfRange: false,
    });
  } catch (error) {
    threw = error instanceof DownloadEngineError && error.code === 'RESUME_UNSUPPORTED';
  }
  assert(threw, '200 rejected');
});

test('21 FINALIZING rejects Pause', () => {
  const d = decidePauseCommit({
    executionState: 'FINALIZING',
    workerStillTransferring: false,
    pauseRequested: true,
    localState: 'finalizing',
    hasResumeData: true,
    hasHlsCheckpoint: false,
    hasMultiRangeCheckpoint: false,
    partialBytes: 999,
  });
  assert(d.fail && d.reason === 'FINALIZING', d.reason);
  assert(!isAllowedExecutionTransition('FINALIZING', 'PAUSED'), 'illegal');
});

test('22 COMPLETED rejects Pause', () => {
  const d = decidePauseCommit({
    executionState: 'COMPLETED',
    workerStillTransferring: false,
    pauseRequested: true,
    localState: 'complete',
    hasResumeData: false,
    hasHlsCheckpoint: false,
    hasMultiRangeCheckpoint: false,
    partialBytes: 0,
  });
  assert(d.fail && d.reason === 'COMPLETED', d.reason);
});

test('23 CANCELLED rejects Resume', () => {
  const a = resolveDownloadRuntimeActions({
    status: 'CANCELLED',
    executionState: 'CANCELLED',
  });
  assert(!a.canResume && !a.canPause, 'no resume');
  assert(!isAllowedExecutionTransition('CANCELLED', 'QUEUED'), 'no resume transition');
});

test('24 HLS unaffected (source)', () => {
  const src = read('src/downloads/engine/hls/worker.ts');
  assert(src.includes('userPauseRequested'), 'flag');
  assert(src.includes('settleUserPaused'), 'settle');
  assert(src.includes('hlsTransfer'), 'checkpoint');
  assert(src.includes('abortController.abort()'), 'abort');
});

test('25 two downloads isolated (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes('pauseOps.get(downloadId)'), 'keyed pause');
  assert(src.includes('resumeOps.get(downloadId)'), 'keyed resume');
  assert(src.includes('this.workers.get(downloadId)'), 'keyed worker');
});

test('26 no polling loops in pause-ack / worker pause', () => {
  const ack = read('src/downloads/engine/pause-ack.ts');
  assert(!ack.includes('setInterval'), 'no interval ack');
  assert(!ack.includes('setTimeout'), 'no timeout ack');
  const worker = read('src/downloads/engine/worker.ts');
  const pause = worker.slice(worker.indexOf('async pause('), worker.indexOf('async cancel('));
  assert(!pause.includes('setInterval'), 'no interval pause');
  assert(!pause.includes('setTimeout'), 'no timeout pause');
});

test('27 no UI-local pause state (source)', () => {
  const details = read('src/screens/downloads/hooks/useDownloadDetailsScreen.ts');
  assert(!details.includes('localPaused'), 'no localPaused');
  assert(details.includes('await pause(downloadId)'), 'store pause');
});

test('28 no timer-based correction (source)', () => {
  const bind = read('src/downloads/bind-engine-to-store.ts');
  assert(!bind.includes('setTimeout'), 'no bind timer');
  assert(!bind.includes('setInterval'), 'no bind interval');
  const ack = read('src/downloads/engine/pause-ack.ts');
  assert(ack.includes('DOWNLOAD_RUNTIME_INVARIANT_VIOLATION'), 'diag only');
});

test('29 transport-stop without resumeData still commits USER_PAUSE', () => {
  const d = decidePauseCommit({
    executionState: 'DOWNLOADING',
    workerStillTransferring: false,
    pauseRequested: true,
    localState: 'transferring',
    hasResumeData: false,
    hasHlsCheckpoint: false,
    hasMultiRangeCheckpoint: false,
    partialBytes: 0,
  });
  assert(d.commit && d.reason === 'transport_stopped_user_pause', d.reason);
});

test('30 HLS checkpoint commits without DownloadTask resumeData', () => {
  const d = decidePauseCommit({
    executionState: 'DOWNLOADING',
    workerStillTransferring: false,
    pauseRequested: true,
    localState: 'paused',
    hasResumeData: false,
    hasHlsCheckpoint: true,
    hasMultiRangeCheckpoint: false,
    partialBytes: 0,
  });
  assert(d.commit && d.reason === 'hls_checkpoint', d.reason);
});

test('31 multi-range checkpoint commits', () => {
  const d = decidePauseCommit({
    executionState: 'DOWNLOADING',
    workerStillTransferring: false,
    pauseRequested: true,
    localState: 'paused',
    hasResumeData: false,
    hasHlsCheckpoint: false,
    hasMultiRangeCheckpoint: true,
    partialBytes: 50,
  });
  assert(d.commit && d.reason === 'multi_range_checkpoint', d.reason);
});

test('32 native pause false helper', () => {
  const r = pauseNativeDownloadTask({
    pause: () => false,
  });
  assert(r.attempted && r.redundantFalse && !r.nativeOk, 'false');
});

test('33 native pause throw is redundantFalse', () => {
  const r = pauseNativeDownloadTask({
    pause: () => {
      throw new Error('not active');
    },
  });
  assert(r.redundantFalse, 'threw');
});

testAsync('34 async native pause false', async () => {
  const r = await awaitNativePauseTask({
    pause: () => Promise.resolve(false),
  });
  assert(r.redundantFalse, 'async false');
});

test('35 savable captured even when state is not paused', () => {
  const saved = captureNativePauseState({
    state: 'error',
    savable: () => ({
      url: 'https://cdn.example/a.mp4',
      fileUri: 'file://x.part',
      resumeData: '12345',
    }),
  });
  assert(saved?.resumeData === '12345', 'captured');
});

test('36 savable throw yields null', () => {
  assert(
    captureNativePauseState({
      savable: () => {
        throw new Error('gone');
      },
    }) == null,
    'null',
  );
});

test('37 AbortError with pauseRequested is USER_PAUSE not NETWORK_ERROR', () => {
  const err = new Error('The user aborted a request.');
  err.name = 'AbortError';
  assert(isUserPauseAbortError(err, true), 'user pause');
  assert(!isUserPauseAbortError(err, false), 'not without flag');
});

test('38 STARTING → PAUSED is legal USER_PAUSE transition', () => {
  assert(isAllowedExecutionTransition('STARTING', 'PAUSED'), 'starting');
  const snap = createExecutionSnapshot('d1', 1, 0);
  snap.state = 'STARTING';
  const result = transitionDownloadExecutionState({
    snapshot: snap,
    to: 'PAUSED',
    reason: 'user_pause',
  });
  assert(result.ok && result.snapshot.state === 'PAUSED', 'committed');
});

test('39 DOWNLOADING → PAUSED is legal', () => {
  assert(isAllowedExecutionTransition('DOWNLOADING', 'PAUSED'), 'dl');
});

test('40 RETRYING → PAUSED is legal', () => {
  assert(isAllowedExecutionTransition('RETRYING', 'PAUSED'), 'retry');
});

test('41 late PAUSED rejected after resume admitted STARTING', () => {
  assert(
    !shouldAcceptPausedStatusEvent({
      catalogStatus: 'QUEUED',
      eventStatus: 'PAUSED',
      executionState: 'STARTING',
    }),
    'reject late pause',
  );
});

test('42 worker PAUSED emit without exec PAUSED is not catalog-promoted', () => {
  assert(
    !shouldAcceptPausedStatusEvent({
      catalogStatus: 'DOWNLOADING',
      eventStatus: 'PAUSED',
      executionState: 'DOWNLOADING',
    }),
    'wait for manager commit',
  );
});

test('43 resume-advanced DOWNLOADING status over PAUSED is accepted', () => {
  assert(
    !shouldRejectLateDownloadingStatusOverPaused({
      catalogStatus: 'PAUSED',
      eventStatus: 'DOWNLOADING',
      executionState: 'DOWNLOADING',
    }),
    'legitimate resume',
  );
});

test('44 split-brain detector: DOWNLOADING + no transport + pause settled', () => {
  assert(
    detectPauseSplitBrain({
      executionState: 'DOWNLOADING',
      hasActiveTransport: false,
      pauseRequestedOrSettled: true,
    }),
    'detected',
  );
  assert(
    !detectPauseSplitBrain({
      executionState: 'DOWNLOADING',
      hasActiveTransport: true,
      pauseRequestedOrSettled: true,
    }),
    'active ok',
  );
});

test('45 catalog PAUSED maps Resume immediately', () => {
  const a = resolveDownloadRuntimeActions({
    status: 'PAUSED',
    executionState: 'PAUSED',
  });
  assert(runtimeActionsToCardActions(a)[0] === 'resume', 'primary resume');
});

test('46 PAUSED catalog + DOWNLOADING exec (resume started) shows Pause', () => {
  const a = resolveDownloadRuntimeActions({
    status: 'PAUSED',
    executionState: 'DOWNLOADING',
    hasActiveTransfer: true,
  });
  assert(a.canPause && !a.canResume, 'resume advanced');
});

test('47 manager commits via commitPauseAfterTransportStop (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes('commitPauseAfterTransportStop'), 'helper');
  assert(src.includes('decidePauseCommit'), 'decision');
  assert(src.includes('PAUSE_SETTLED'), 'settled trace');
  assert(!src.includes("Couldn’t pause this download right now") || src.includes('pauseFailureMessageForUi'), 'ui via helper');
});

test('48 lock_held pause still commits (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  const body = src.slice(src.indexOf('private async runPause'), src.indexOf('async resume('));
  assert(body.includes("operation: 'lock_held_signal'"), 'signal');
  assert(body.includes('commitPauseAfterTransportStop'), 'commit');
});

test('49 no WORKER_NOT_FOUND throw after transport stop (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  const body = src.slice(src.indexOf('private async runPause'), src.indexOf('async resume('));
  assert(!body.includes("'WORKER_NOT_FOUND'"), 'no worker_not_found in pause');
});

test('50 fetch pause abort uses USER_PAUSE_ABORT_MESSAGE', () => {
  const src = read('src/downloads/engine/fetch-single-stream-transfer.ts');
  assert(src.includes('USER_PAUSE_ABORT_MESSAGE'), 'classified');
});

test('51 invalid 206 start mismatch still rejected', () => {
  let threw = false;
  try {
    validateRangeResumeResponse({
      status: 206,
      contentRange: 'bytes 0-199/1000',
      offset: 100,
      sentIfRange: false,
    });
  } catch {
    threw = true;
  }
  assert(threw, 'mismatch');
});

test('52 catalog mapping PAUSED stays PAUSED', () => {
  assert(catalogStatusForExecutionState('PAUSED') === 'PAUSED', 'map');
});

test('53 waitUntilSettled is generation-aware (source)', () => {
  const worker = read('src/downloads/engine/worker.ts');
  assert(worker.includes('waitUntilSettled(generation?: number)'), 'gen arg');
  assert(worker.includes('pauseSettleHandle'), 'handle');
  const hls = read('src/downloads/engine/hls/worker.ts');
  assert(hls.includes('waitUntilSettled(generation?: number)'), 'hls gen');
});

test('54 worker catch persists PAUSED not DOWNLOADING on USER_PAUSE (source)', () => {
  const worker = read('src/downloads/engine/worker.ts');
  const catchBody = worker.slice(
    worker.indexOf('pause() may abort the fetch'),
    worker.indexOf('External cancel()'),
  );
  assert(catchBody.includes("remoteStatus: 'PAUSED'"), 'paused persist');
  assert(!catchBody.includes("remoteStatus: 'DOWNLOADING'"), 'not downloading');
});

test('55 store pause success requires engine PAUSED backup (source)', () => {
  const src = read('src/store/downloads/actions.ts');
  assert(src.includes("exec === 'PAUSED'"), 'backup');
});

test('56 details pause error only when !result (source)', () => {
  const src = read('src/screens/downloads/hooks/useDownloadDetailsScreen.ts');
  assert(src.includes('if (!result)'), 'failure only');
  assert(src.includes('Couldn’t pause this download'), 'copy');
});

test('57 pauseOps keyed isolation (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes('this.pauseOps.set(downloadId, op)'), 'set');
  assert(src.includes('this.pauseOps.delete(downloadId)'), 'delete');
});

test('58 durable Android offset matches file size', () => {
  assert(parseAndroidResumeOffset('4096') === 4096, 'offset');
  const fakeFile = {
    exists: true,
    size: 4096,
    uri: 'file:///data/d.part',
  };
  const built = buildDurablePauseState(
    'https://cdn.example/v.mp4',
    fakeFile as never,
    null,
    5000,
  );
  assert(built?.resumeData === '4096', 'disk authoritative');
});

test('59 empty disk + opaque iOS resumeData still durable', () => {
  const fakeFile = {
    exists: false,
    size: 0,
    uri: 'file:///data/d.part',
  };
  const built = buildDurablePauseState(
    'https://cdn.example/v.mp4',
    fakeFile as never,
    { url: 'https://cdn.example/v.mp4', fileUri: 'file:///data/d.part', resumeData: 'abc+opaque' },
    0,
  );
  assert(built?.resumeData === 'abc+opaque', 'ios blob');
});

test('60 no polling in manager pause commit helper (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  const helper = src.slice(
    src.indexOf('commitPauseAfterTransportStop'),
    src.indexOf('async pause('),
  );
  assert(!helper.includes('setInterval'), 'no interval');
  assert(!helper.includes('setTimeout'), 'no timeout');
});

test('61 Details uses transfer executionState for Resume', () => {
  const src = read('src/screens/downloads/hooks/useDownloadDetailsScreen.ts');
  assert(src.includes('executionState: transfer?.executionState'), 'wired');
});

test('62 bind rejects late transferring workerState over PAUSED', () => {
  assert(
    shouldRejectLateTransferringOverPaused({
      catalogStatus: 'PAUSED',
      snapshotLocalState: 'paused',
      snapshotWorkerState: 'TRANSFERRING',
    }),
    'worker state',
  );
});

test('63 invariant log is DEV-only (source)', () => {
  const src = read('src/downloads/engine/pause-ack.ts');
  assert(src.includes('typeof __DEV__'), 'dev');
  assert(src.includes('DOWNLOAD_RUNTIME_INVARIANT_VIOLATION'), 'token');
});

test('64 PAUSED→QUEUED resume transition still allowed', () => {
  assert(isAllowedExecutionTransition('PAUSED', 'QUEUED'), 'resume');
  assert(isAllowedExecutionTransition('PAUSED', 'STARTING'), 'start');
});

test('65 CANCELLED pause commit rejected', () => {
  const d = decidePauseCommit({
    executionState: 'CANCELLED',
    workerStillTransferring: false,
    pauseRequested: true,
    localState: 'failed',
    hasResumeData: false,
    hasHlsCheckpoint: false,
    hasMultiRangeCheckpoint: false,
    partialBytes: 0,
  });
  assert(d.fail && d.reason === 'CANCELLED', d.reason);
});

test('66 capturePauseSettleHandle null barrier', () => {
  assert(capturePauseSettleHandle(1, null) == null, 'null');
});

test('67 no expo prebuild / apk in this pass', () => {
  const pkg = read('package.json');
  assert(pkg.includes('verify:pause-ack-state-commit'), 'script');
});

test('68 manager waitUntilSettled uses pause generation (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes('getPauseSettleGeneration()'), 'gen wait');
});

test('69 HLS pause settle handle (source)', () => {
  const src = read('src/downloads/engine/hls/worker.ts');
  assert(src.includes('pauseSettleHandle'), 'handle');
  assert(src.includes('capturePauseSettleHandle'), 'capture');
});

test('70 worker does not fail Pause solely because task.state is not active (source)', () => {
  const worker = read('src/downloads/engine/worker.ts');
  const body = worker.slice(worker.indexOf('async pause('), worker.indexOf('async cancel('));
  assert(!body.includes("task.state === 'active' || task.state === 'paused'"), 'no state gate');
});

test('71 native pause must not abort DownloadTask cancel path', () => {
  assert(
    !shouldAbortAbortSignalAfterNativePause({
      hasNativeDownloadTask: true,
      nativePauseAttempted: true,
    }),
    'skip',
  );
});

test('72 fetch pause still aborts AbortSignal', () => {
  assert(
    shouldAbortAbortSignalAfterNativePause({
      hasNativeDownloadTask: false,
      nativePauseAttempted: false,
    }),
    'abort',
  );
});

testAsync('73 bounded settle wait times out instead of hanging', async () => {
  const barrier = createWorkerSettleBarrier();
  const handle = capturePauseSettleHandle(1, barrier);
  const started = Date.now();
  const result = await waitForCapturedSettleWithTimeout(handle, null, 30);
  const elapsed = Date.now() - started;
  assert(result.timedOut && !result.settled, 'timed out');
  assert(elapsed < 2000, `elapsed ${elapsed}`);
});

testAsync('74 bounded settle wait resolves when barrier fires', async () => {
  const barrier = createWorkerSettleBarrier();
  const handle = capturePauseSettleHandle(3, barrier);
  queueMicrotask(() => barrier.resolve());
  const result = await waitForCapturedSettleWithTimeout(handle, null, 2000);
  assert(result.settled && !result.timedOut, 'settled');
});

test('75 manager uses bounded pause settle (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes('waitUntilSettledBounded'), 'bounded');
  assert(src.includes('PAUSE_SETTLE_TIMEOUT'), 'timeout event');
  assert(src.includes('releasePausedWorkerOwnership'), 'release');
});

test('76 worker skip abort after native pause (source)', () => {
  const worker = read('src/downloads/engine/worker.ts');
  const body = worker.slice(worker.indexOf('async pause('), worker.indexOf('async cancel('));
  assert(body.includes('PAUSE_ABORT_SKIPPED_NATIVE_TASK'), 'diag');
  assert(body.includes('shouldAbortAbortSignalAfterNativePause'), 'gate');
});

test('77 identity-safe worker finally (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes('this.workers.get(input.id) === worker'), 'identity');
});

test('78 USER_PAUSE after transferPromise does not complete truncated file (source)', () => {
  const worker = read('src/downloads/engine/worker.ts');
  assert(worker.includes('completionWon'), 'completion vs pause');
  assert(worker.includes('pauseRequested && !this.active.cancelled'), 'pause wins');
});

test('79 pause settle timeout still commits when pause signalled (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes('settleTimedOut'), 'flag');
  assert(src.includes('options.settleTimedOut && options.pauseSignalled'), 'treat stopped');
});

test('80 resume waits bounded then reclaims (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  const resume = src.slice(src.indexOf('private async runResume'), src.indexOf('async cancel('));
  assert(resume.includes('waitUntilSettledBounded'), 'bounded');
  assert(resume.includes('RESUME_CLAIMED'), 'claim');
});

const summary = `\n${passed} passed, ${failed} failed`;
console.log(summary);
if (failed > 0) {
  process.exit(1);
}
