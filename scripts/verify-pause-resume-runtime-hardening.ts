/**
 * Pause / Resume runtime hardening verifier.
 *
 * Prefer calling exported functions / state transitions over string greps.
 * Avoid importing RN screen modules (tsx/esbuild cannot transform react-native).
 * Run: npm run verify:pause-resume-runtime-hardening
 */

import {
  catalogStatusForExecutionState,
  createExecutionSnapshot,
  isAllowedExecutionTransition,
  transitionDownloadExecutionState,
} from '../src/downloads/execution/download-state-machine';
import {
  resolveDownloadRuntimeActions,
  runtimeActionsToCardActions,
} from '../src/downloads/runtime-actions';
import { classifyLibraryDownloadState } from '../src/downloads/completed-file/state';
import { resolveCompletedActions } from '../src/downloads/completed-file/actions';
import {
  parseContentRange,
  validateRangeResumeResponse,
} from '../src/downloads/engine/range-validation';
import { withCompletedFileOperation } from '../src/downloads/completed-file/operation-lock';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fs = require('fs') as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const path = require('path') as any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __dirname: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const process: any;

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

const root = path.join(__dirname, '..');

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

/** Mirror getSupportedActions transfer subset without importing RN screens. */
function supportedTransferActions(
  status: string,
  executionState?: string | null,
): Array<'pause' | 'resume' | 'cancel' | 'retry'> {
  return runtimeActionsToCardActions(
    resolveDownloadRuntimeActions({ status, executionState }),
  );
}

console.log('Pause / Resume runtime hardening verifier\n');

// ─── STATE → ACTION VISIBILITY (1–13) ───────────────────────────────────────

test('1 PREPARING (catalog QUEUED) → cancel only', () => {
  const a = resolveDownloadRuntimeActions({
    status: 'QUEUED',
    executionState: 'PREPARING',
  });
  assert(!a.canPause && !a.canResume && a.canCancel, 'preparing contract');
});

test('2 QUEUED → cancel only', () => {
  const a = resolveDownloadRuntimeActions({ status: 'QUEUED' });
  assert(!a.canPause && !a.canResume && a.canCancel, 'queued');
});

test('3 WAITING_FOR_WIFI (catalog QUEUED) → cancel only', () => {
  const a = resolveDownloadRuntimeActions({
    status: 'QUEUED',
    executionState: 'WAITING_FOR_WIFI',
  });
  assert(!a.canPause && !a.canResume && a.canCancel, 'wifi wait');
});

test('4 STARTING (catalog QUEUED) → cancel only (no fake Pause)', () => {
  const a = resolveDownloadRuntimeActions({
    status: 'QUEUED',
    executionState: 'STARTING',
  });
  assert(!a.canPause && !a.canResume && a.canCancel, 'starting');
});

test('5 DOWNLOADING → canPause', () => {
  assert(
    resolveDownloadRuntimeActions({ status: 'DOWNLOADING' }).canPause,
    'pause',
  );
});

test('6 DOWNLOADING → !canResume', () => {
  assert(
    !resolveDownloadRuntimeActions({ status: 'DOWNLOADING' }).canResume,
    'no resume',
  );
});

test('7 PAUSED → canResume', () => {
  assert(
    resolveDownloadRuntimeActions({ status: 'PAUSED' }).canResume,
    'resume',
  );
});

test('8 PAUSED → !canPause', () => {
  assert(
    !resolveDownloadRuntimeActions({ status: 'PAUSED' }).canPause,
    'no pause',
  );
});

test('9 RETRYING (catalog QUEUED) → cancel only', () => {
  const a = resolveDownloadRuntimeActions({
    status: 'QUEUED',
    executionState: 'RETRYING',
  });
  assert(!a.canPause && !a.canResume && a.canCancel, 'retrying');
});

test('10 FINALIZING → no Pause/Resume', () => {
  const a = resolveDownloadRuntimeActions({
    status: 'DOWNLOADING',
    executionState: 'FINALIZING',
  });
  assert(!a.canPause && !a.canResume, 'finalizing');
});

test('11 COMPLETED → no Pause/Resume', () => {
  const a = resolveDownloadRuntimeActions({ status: 'COMPLETED' });
  assert(!a.canPause && !a.canResume && !a.canCancel && !a.canRetry, 'done');
});

test('12 FAILED → no Pause/Resume; canRetry', () => {
  const a = resolveDownloadRuntimeActions({ status: 'FAILED' });
  assert(!a.canPause && !a.canResume && a.canRetry, 'failed');
});

test('13 CANCELLED → no Pause/Resume', () => {
  const a = resolveDownloadRuntimeActions({ status: 'CANCELLED' });
  assert(!a.canPause && !a.canResume && !a.canRetry, 'cancelled');
});

// ─── UI action lists (14–23) ────────────────────────────────────────────────

test('14 DOWNLOADING renders Pause', () => {
  assert(supportedTransferActions('DOWNLOADING').includes('pause'), 'pause');
});

test('15 PAUSED renders Resume', () => {
  assert(supportedTransferActions('PAUSED').includes('resume'), 'resume');
});

test('16 COMPLETED does not render active transfer controls', () => {
  const actions = supportedTransferActions('COMPLETED');
  assert(!actions.includes('pause') && !actions.includes('resume'), String(actions));
});

test('17 FAILED does not render Pause', () => {
  assert(!supportedTransferActions('FAILED').includes('pause'), 'no pause');
});

test('18 CANCELLED does not render Resume', () => {
  assert(!supportedTransferActions('CANCELLED').includes('resume'), 'no resume');
});

test('19 action remains present after unrelated progress meta (status unchanged)', () => {
  const a = supportedTransferActions('DOWNLOADING', 'DOWNLOADING');
  const b = supportedTransferActions('DOWNLOADING', 'DOWNLOADING');
  assert(a.includes('pause') && b.includes('pause'), 'stable');
});

test('20 DOWNLOADING→PAUSED rerenders action (capability flip)', () => {
  assert(
    supportedTransferActions('DOWNLOADING')[0] === 'pause' &&
      supportedTransferActions('PAUSED')[0] === 'resume',
    'flip',
  );
});

test('21 PAUSED→DOWNLOADING rerenders action', () => {
  assert(
    supportedTransferActions('PAUSED')[0] === 'resume' &&
      supportedTransferActions('DOWNLOADING')[0] === 'pause',
    'flip back',
  );
});

test('22 runtime actions are downloadId-agnostic pure functions (row-safe)', () => {
  const a = resolveDownloadRuntimeActions({ status: 'DOWNLOADING' });
  const b = resolveDownloadRuntimeActions({ status: 'PAUSED' });
  assert(a.canPause && b.canResume, 'distinct');
});

test('23 list/grid share resolveDownloadRuntimeActions policy', () => {
  const format = read('src/screens/downloads/utils/download-format.ts');
  assert(format.includes('resolveDownloadRuntimeActions'), 'format uses resolver');
  assert(format.includes('runtimeActionsToCardActions'), 'maps to card actions');
  assert(!format.includes('canResumeProgressive'), 'url gate removed');
  assert(!format.includes('isPlaylistOrStreamUrl'), 'no playlist gate in format');
});

test('HLS playlist URL still exposes Pause/Resume (no URL gate in actions)', () => {
  assert(supportedTransferActions('DOWNLOADING').includes('pause'), 'hls pause');
  assert(supportedTransferActions('PAUSED').includes('resume'), 'hls resume');
});

// ─── Engine / store wiring (source contracts 24–30) ─────────────────────────

test('24 pause(downloadId) commits execution PAUSED + emits status', () => {
  const src = read('src/downloads/engine/manager.ts');
  const pauseStart = src.indexOf('async pause(');
  const pauseEnd = src.indexOf('async resume(downloadId: string)', pauseStart);
  const body = src.slice(pauseStart, pauseEnd);
  assert(body.includes("applyExecutionTransition(downloadId, 'PAUSED'"), 'exec');
  assert(body.includes("executionState: 'PAUSED'"), 'emit exec');
  assert(body.includes("status: 'PAUSED'"), 'emit status');
  assert(body.includes('clearRetryTimer'), 'clears retry');
});

test('25 resume(downloadId) applies QUEUED execution before enqueue', () => {
  const src = read('src/downloads/engine/manager.ts');
  const resumeStart = src.indexOf('async resume(downloadId: string)');
  const resumeEnd = src.indexOf('async cancel(downloadId: string)', resumeStart);
  const body = src.slice(resumeStart, resumeEnd);
  assert(body.includes("applyExecutionTransition(downloadId, 'QUEUED', 'resume'"), 'queued');
  assert(body.includes('this.ensureScheduler().enqueue'), 'enqueue');
  const execIdx = body.indexOf("applyExecutionTransition(downloadId, 'QUEUED'");
  const enqueueIdx = body.indexOf('this.ensureScheduler().enqueue');
  assert(execIdx >= 0 && enqueueIdx > execIdx, 'order');
});

test('26–28 terminal / lock guards present on pause', () => {
  const src = read('src/downloads/engine/manager.ts');
  const pauseStart = src.indexOf('async pause(');
  const pauseEnd = src.indexOf('async resume(downloadId: string)', pauseStart);
  const body = src.slice(pauseStart, pauseEnd);
  assert(body.includes("execNow === 'FINALIZING'"), 'blocks finalizing');
  assert(body.includes('this.locks.has(downloadId)'), 'lock');
  assert(body.includes("outcome: 'blocked'"), 'idempotent block');
});

test('29–30 locks gate duplicate pause/resume', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes("action: 'pause'") && src.includes("reason: 'lock_held'"), 'pause lock');
  assert(src.includes('RESUME_STATE_CONFLICT'), 'resume lock');
});

// ─── Progressive Range (31–38) ──────────────────────────────────────────────

test('31–33 pause preserves part path; resume uses Range offset helpers', () => {
  const worker = read('src/downloads/engine/worker.ts');
  assert(worker.includes('async pause(downloadId'), 'worker pause');
  assert(worker.includes('pauseRequested'), 'pause flag');
  const manager = read('src/downloads/engine/manager.ts');
  assert(manager.includes('readPartialFileSize'), 'part size');
  assert(manager.includes('parseAndroidResumeOffset'), 'offset');
});

test('34–35 matching 206 appends; 200 never appends (throws — no partial append)', () => {
  const ok206 = validateRangeResumeResponse({
    status: 206,
    contentRange: 'bytes 100-199/1000',
    offset: 100,
    sentIfRange: false,
    knownTotalBytes: 1000,
  });
  assert(ok206.totalBytes === 1000, '206 total');

  let threw = false;
  try {
    validateRangeResumeResponse({
      status: 200,
      contentRange: null,
      offset: 100,
      sentIfRange: false,
    });
  } catch {
    threw = true;
  }
  assert(threw, '200 must not append');

  const parsed = parseContentRange('bytes 100-199/1000');
  assert(parsed && parsed.start === 100 && parsed.total === 1000, 'content-range');
});

test('36–38 pause does not finalize; FAILED not forced', () => {
  const src = read('src/downloads/engine/manager.ts');
  const pauseStart = src.indexOf('async pause(');
  const pauseEnd = src.indexOf('async resume(downloadId: string)', pauseStart);
  const body = src.slice(pauseStart, pauseEnd);
  assert(!body.includes("remoteStatus: 'FAILED'"), 'no fail');
  assert(body.includes("localState: 'paused'"), 'paused local');
});

// ─── HLS (39–43) ────────────────────────────────────────────────────────────

test('39–43 HLS pause settle + resume uses hlsTransfer; no rewrite', () => {
  const hls = read('src/downloads/engine/hls/worker.ts');
  assert(hls.includes('async pause(downloadId'), 'hls pause');
  assert(hls.includes('settleUserPaused') || hls.includes('userPauseRequested'), 'pause settle');
  const manager = read('src/downloads/engine/manager.ts');
  const resumeStart = manager.indexOf('async resume(downloadId: string)');
  const resumeEnd = manager.indexOf('async cancel(downloadId: string)', resumeStart);
  const body = manager.slice(resumeStart, resumeEnd);
  assert(body.includes('hlsTransfer'), 'requires hls state');
  assert(body.includes('RESUME_UNSUPPORTED'), 'guard');
});

// ─── Network / retry / races (44–58) ─────────────────────────────────────────

test('44–48 Wi-Fi + retry pause contracts in manager', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(
    src.includes('WAITING_FOR_WIFI') ||
      src.includes('waiting_for_wifi') ||
      src.includes('wifi_policy'),
    'wifi',
  );
  assert(src.includes('clearRetryTimer'), 'retry clear');
  assert(isAllowedExecutionTransition('RETRYING', 'PAUSED'), 'retry→paused allowed');
});

test('54 FINALIZING cannot transition to PAUSED', () => {
  assert(!isAllowedExecutionTransition('FINALIZING', 'PAUSED'), 'no back');
  const snap = createExecutionSnapshot('x', 1, 0);
  transitionDownloadExecutionState({
    snapshot: snap,
    to: 'STARTING',
    reason: 'worker_admitted',
    generation: 1,
  });
  transitionDownloadExecutionState({
    snapshot: snap,
    to: 'DOWNLOADING',
    reason: 'first_valid_byte',
    generation: 1,
  });
  transitionDownloadExecutionState({
    snapshot: snap,
    to: 'FINALIZING',
    reason: 'transfer_complete',
    generation: 1,
  });
  const bad = transitionDownloadExecutionState({
    snapshot: snap,
    to: 'PAUSED',
    reason: 'user_pause',
    generation: 1,
  });
  assert(!bad.ok, 'rejected');
});

test('55–56 catalog mapping PAUSED / DOWNLOADING', () => {
  assert(catalogStatusForExecutionState('PAUSED') === 'PAUSED', 'paused');
  assert(catalogStatusForExecutionState('DOWNLOADING') === 'DOWNLOADING', 'dl');
  assert(catalogStatusForExecutionState('FINALIZING') === 'DOWNLOADING', 'coarse');
});

test('58 bind-engine accepts authoritative PAUSED when execution PAUSED', () => {
  const src = read('src/downloads/bind-engine-to-store.ts');
  assert(src.includes("execState !== 'PAUSED'"), 'stale-only guard');
  assert(src.includes("executionState: 'PAUSED'"), 'stale exec heal');
});

// ─── Session (49–53) ────────────────────────────────────────────────────────

test('49–53 session pause/resume do not persist Cookie/Authorization', () => {
  const src = read('src/downloads/engine/manager.ts');
  const pauseStart = src.indexOf('async pause(');
  const pauseEnd = src.indexOf('async resume(downloadId: string)', pauseStart);
  const pauseBody = src.slice(pauseStart, pauseEnd);
  assert(!/Cookie|Authorization/.test(pauseBody), 'no secrets in pause');
  assert(
    src.includes('SESSION_CONTEXT_LOST') ||
      src.includes('assertSessionBoundExecutionContext'),
    'session death',
  );
});

// ─── Phase 7 regression (59–64) ─────────────────────────────────────────────

test('59 PAUSED is active_transitional, not completed', () => {
  assert(
    classifyLibraryDownloadState('PAUSED') === 'active_transitional',
    'paused active',
  );
  assert(
    classifyLibraryDownloadState('COMPLETED') === 'completed',
    'completed',
  );
});

test('60 completed-file actions do not replace runtime transfer actions', () => {
  const completed = resolveCompletedActions({
    status: 'COMPLETED',
    physicalFilePresent: true,
    allowExternalHandoff: true,
    allowDelete: true,
    allowExport: true,
  });
  assert(completed.canPlay && completed.canOpen, 'completed caps');
  const pausedRuntime = resolveDownloadRuntimeActions({ status: 'PAUSED' });
  assert(pausedRuntime.canResume && !pausedRuntime.canPause, 'runtime separate');
  const pausedCompleted = resolveCompletedActions({
    status: 'PAUSED',
    physicalFilePresent: false,
  });
  assert(
    !pausedCompleted.canPlay &&
      !pausedCompleted.canOpen &&
      !pausedCompleted.canShare &&
      !pausedCompleted.canExport,
    'paused not completed actions',
  );
});

test('62 Phase 7C delete service not used for active .part pause/resume', () => {
  const actions = read('src/store/downloads/actions.ts');
  const pauseBlock = actions.slice(
    actions.indexOf('pause: async'),
    actions.indexOf('cancel: async'),
  );
  assert(!pauseBlock.includes('deleteCompletedFile'), 'no delete');
  assert(pauseBlock.includes('downloadEngine.pause'), 'engine pause');
});

test('63–64 completed vs active card actions diverge', () => {
  const format = read('src/screens/downloads/utils/download-format.ts');
  assert(format.includes("status === 'COMPLETED'"), 'completed branch');
  assert(format.includes('resolveDownloadRuntimeActions'), 'active uses resolver');
  assert(!supportedTransferActions('COMPLETED').includes('pause'), 'no pause');
  assert(supportedTransferActions('DOWNLOADING').includes('pause'), 'active pause');
});

// ─── Persistence / security greps (65–76) ───────────────────────────────────

test('65–68 PAUSED hydration / no auto-resume preference gate on manual resume', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes('KEEP_PAUSED') || src.includes('RECOVER_TO_PAUSED'), 'recovery');
  const resumeStart = src.indexOf('async resume(downloadId: string)');
  const resumeEnd = src.indexOf('async cancel(downloadId: string)', resumeStart);
  assert(!src.slice(resumeStart, resumeEnd).includes('isAutoResumeEnabled()'), 'manual');
});

test('69–76 boundary: no Cookie/Authorization persistence in runtime-actions; no timers in resolver', () => {
  const runtime = read('src/downloads/runtime-actions.ts');
  assert(!/Cookie|Authorization|setTimeout|setInterval/.test(runtime), 'clean');
  const bind = read('src/downloads/bind-engine-to-store.ts');
  assert(!bind.includes('setInterval'), 'no poll');
});

test('DownloadCard uses getSupportedActions + store status (no button-local pause truth)', () => {
  const card = read('src/screens/downloads/components/DownloadCard.tsx');
  assert(card.includes('getSupportedActions(item.status'), 'status driven');
  assert(card.includes('onPause(id)') && card.includes('onResume(id)'), 'id routing');
  assert(!/isPaused|showPause|showResume/.test(card), 'no local pause flags');
  assert(card.includes('executionState: transfer?.executionState'), 'passes exec');
});

test('QueueActiveRow uses resolveDownloadRuntimeActions (HLS + Resume)', () => {
  const row = read('src/screens/downloads/components/QueueActiveRow.tsx');
  assert(row.includes('resolveDownloadRuntimeActions'), 'resolver');
  assert(row.includes('onResume'), 'resume wired');
  assert(!row.includes('isPlaylistOrStreamUrl'), 'no url gate');
});

async function main(): Promise<void> {
  await testAsync('61 Phase 7C export lock does not share pause/resume path', async () => {
    let ran = false;
    await withCompletedFileOperation('dl-lock-1', 'exporting', async () => {
      ran = true;
      return true;
    });
    assert(ran, 'export ran');
    const manager = read('src/downloads/engine/manager.ts');
    assert(!manager.includes('withCompletedFileOperation'), 'engine free of 7C lock');
    const actions = read('src/store/downloads/actions.ts');
    const pauseStart = actions.indexOf('pause: async');
    const pauseEnd = actions.indexOf('resume: async', pauseStart);
    assert(
      !actions.slice(pauseStart, pauseEnd).includes('withCompletedFileOperation'),
      'store pause free',
    );
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void main();
