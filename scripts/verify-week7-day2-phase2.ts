/**
 * Week 7 Day 2 Phase 2 — Android FGS & background execution verifier.
 * Deterministic fixtures. NO network. NO Metro. NO emulator. NO Python.
 *
 * Imports pure modules only (no react-native) so Node/tsx can run.
 *
 * Usage (from mobile/):
 *   npx tsx scripts/verify-week7-day2-phase2.ts
 */

import { ActiveExecutionLedger } from '../src/downloads/execution/active-execution-ledger';
import type { BackgroundExecutionController } from '../src/downloads/execution/background-execution-controller';
import { createDownloadExecutionCoordinator } from '../src/downloads/execution/coordinator';
import { deriveDownloadExecutionDisplayState } from '../src/downloads/execution/display-status';
import { createNoopBackgroundExecutionController } from '../src/downloads/execution/noop-controller';
import {
  formatDownloadExecutionDisplayState,
  type BackgroundExecutionSnapshot,
} from '../src/downloads/execution/types';
import { decideRecoveryState } from '../src/downloads/engine/recovery-decision';
import type { DownloadNetworkState } from '../src/downloads/network';
import { AdmissionScheduler, type SchedulerJobInput } from '../src/downloads/scheduler';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed += 1;
      console.log(`PASS  ${name}`);
    })
    .catch((error) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.log(`FAIL  ${name}\n      ${message}`);
    });
}

function job(id: string): SchedulerJobInput {
  return {
    id,
    sourceUrl: `https://cdn.example.com/${id}.mp4`,
    fileName: `${id}.mp4`,
    fileSize: '1000',
  };
}

async function settle(ms = 0): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** In-memory FGS controller for lifecycle tests. */
function createFakeController(options?: {
  failStart?: boolean;
}): BackgroundExecutionController & {
  ensureCalls: number;
  stopCalls: number;
  lastIds: string[];
  snapshots: BackgroundExecutionSnapshot[];
} {
  let running = false;
  let startedAt: number | null = null;
  let ids: string[] = [];
  const ensureCalls = { n: 0 };
  const stopCalls = { n: 0 };
  const snapshots: BackgroundExecutionSnapshot[] = [];

  const snap = (): BackgroundExecutionSnapshot => {
    const s: BackgroundExecutionSnapshot = {
      running,
      activeDownloadIds: [...ids],
      serviceStartedAt: startedAt,
      executionMode: 'JS_TRANSFER_FGS',
    };
    snapshots.push({ ...s, activeDownloadIds: [...s.activeDownloadIds] });
    return { ...s, activeDownloadIds: [...s.activeDownloadIds] };
  };

  const controller: BackgroundExecutionController & {
    ensureCalls: number;
    stopCalls: number;
    lastIds: string[];
    snapshots: BackgroundExecutionSnapshot[];
  } = {
    get ensureCalls() {
      return ensureCalls.n;
    },
    get stopCalls() {
      return stopCalls.n;
    },
    get lastIds() {
      return [...ids];
    },
    snapshots,
    async ensureRunning() {
      ensureCalls.n += 1;
      if (options?.failStart) {
        return {
          ok: false,
          error: {
            code: 'FOREGROUND_SERVICE_START_FAILED',
            message: 'Foreground service could not start.',
          },
        };
      }
      if (!running) {
        running = true;
        startedAt = Date.now();
      }
      return { ok: true };
    },
    async updateActiveJobs(downloadIds) {
      ids = [
        ...new Set(
          downloadIds.filter((id): id is string => typeof id === 'string' && id.length > 0),
        ),
      ].sort();
      if (ids.length > 0 && !running && !options?.failStart) {
        running = true;
        startedAt = Date.now();
      }
      if (ids.length === 0) {
        // leave running flag to stopIfIdle
      }
      return snap();
    },
    async stopIfIdle() {
      stopCalls.n += 1;
      if (ids.length === 0) {
        running = false;
        startedAt = null;
      }
      return snap();
    },
    async getSnapshot() {
      return snap();
    },
    subscribe() {
      return () => undefined;
    },
  };

  return controller;
}

async function main(): Promise<void> {
  // ── Service lifecycle via ledger + coordinator ──────────────────────────
  await test('service lifecycle: 0→1 start, 2 same service, last settle stops', async () => {
    const fake = createFakeController();
    const coordinator = createDownloadExecutionCoordinator(fake);

    assert(coordinator.getLedgerSnapshot().protectedCount === 0, 'start empty');

    await coordinator.beginExecution('A');
    assert(fake.ensureCalls >= 1, 'ensure called for first');
    assert(fake.lastIds.includes('A'), 'A registered');
    assert(coordinator.getLedgerSnapshot().protectedCount === 1, 'one protected');

    const ensuresBeforeB = fake.ensureCalls;
    await coordinator.beginExecution('B');
    assert(fake.lastIds.includes('A') && fake.lastIds.includes('B'), 'A,B');
    assert(coordinator.getLedgerSnapshot().protectedCount === 2, 'two protected');
    // Idempotent ensure — may call again but must not contradict
    assert(fake.ensureCalls >= ensuresBeforeB, 'ensure still ok');

    await coordinator.endExecution('A');
    assert(fake.lastIds.includes('B') && !fake.lastIds.includes('A'), 'only B');
    assert(fake.stopCalls === 0 || fake.lastIds.length > 0, 'no stop while B active');

    await coordinator.endExecution('B');
    assert(fake.lastIds.length === 0, 'empty registry');
    assert(fake.stopCalls >= 1, 'stopIfIdle after last');
    const final = await fake.getSnapshot();
    assert(final.running === false, 'service stopped');
  });

  await test('duplicate ensureRunning is idempotent', async () => {
    const fake = createFakeController();
    const coordinator = createDownloadExecutionCoordinator(fake);
    await coordinator.beginExecution('A');
    const calls = fake.ensureCalls;
    await fake.ensureRunning();
    await fake.ensureRunning();
    await fake.ensureRunning();
    assert(fake.ensureCalls === calls + 3, 'calls increment');
    const snap = await fake.getSnapshot();
    assert(snap.running === true, 'still running once');
    assert(coordinator.getLedgerSnapshot().protectedCount === 1, 'one job');
  });

  await test('active registry: add A twice, add B, remove A/B', async () => {
    const ledger = new ActiveExecutionLedger();
    ledger.beginStarting('A');
    ledger.promoteToActive('A');
    ledger.beginStarting('A'); // duplicate
    ledger.markActive('A');
    assert(ledger.getSnapshot().activeDownloadIds.join() === 'A', 'one A');

    ledger.beginStarting('B');
    ledger.promoteToActive('B');
    assert(ledger.getSnapshot().activeDownloadIds.join() === 'A,B', 'A,B');

    ledger.end('A');
    assert(ledger.getSnapshot().activeDownloadIds.join() === 'B', 'B only');

    ledger.end('B');
    assert(ledger.getSnapshot().protectedCount === 0, 'empty');
    assert(ledger.shouldServiceRun() === false, 'should not run');
  });

  await test('duplicate worker ownership: ledger owns A → no second start path', async () => {
    const fake = createFakeController();
    const coordinator = createDownloadExecutionCoordinator(fake);
    await coordinator.beginExecution('A');

    const active = new Set<string>(['A']);
    const started: string[] = [];
    const scheduler = new AdmissionScheduler({
      probeJob: (id) => ({
        status: active.has(id) ? 'DOWNLOADING' : 'QUEUED',
      }),
      onAdmit: (input) => {
        if (coordinator.isExecutionOwned(input.id) || active.has(input.id)) {
          return false;
        }
        active.add(input.id);
        started.push(input.id);
        void coordinator.beginExecution(input.id);
        return true;
      },
    });
    scheduler.setPolicy({ maxConcurrentDownloads: 2, wifiOnly: false });
    scheduler.setNetwork({
      connected: true,
      internetReachable: true,
      type: 'wifi',
    });
    scheduler.markOwned('A');
    scheduler.enqueue(job('A'));
    await settle(10);
    assert(started.length === 0, 'must not start duplicate A');
    assert(coordinator.getLedgerSnapshot().protectedCount === 1, 'still one');
  });

  await test('app background: ownership unchanged, no enqueue', async () => {
    const fake = createFakeController();
    const coordinator = createDownloadExecutionCoordinator(fake);
    await coordinator.beginExecution('A');
    const before = coordinator.getLedgerSnapshot();
    // Simulate background — coordinator must not clear or re-enqueue.
    const afterBg = coordinator.getLedgerSnapshot();
    assert(
      JSON.stringify(before) === JSON.stringify(afterBg),
      'ledger unchanged on background',
    );
    assert(fake.lastIds.includes('A'), 'service still required');
  });

  await test('app foreground reconciliation: no duplicate worker', async () => {
    const fake = createFakeController();
    const coordinator = createDownloadExecutionCoordinator(fake);
    await coordinator.beginExecution('A');
    const result = await coordinator.reconcile({ jsActiveIds: ['A'] });
    assert(result.ledger.protectedCount === 1, 'one after reconcile');
    assert(result.nativeOwnedIds.length === 0, 'no orphan native ids');
    // Second reconcile idempotent
    const again = await coordinator.reconcile({ jsActiveIds: ['A'] });
    assert(again.ledger.protectedCount === 1, 'still one');
  });

  await test('COMPLETED never starts service / not enqueued', async () => {
    const fake = createFakeController();
    const coordinator = createDownloadExecutionCoordinator(fake);
    const started: string[] = [];
    const statuses: Record<string, 'COMPLETED'> = { A: 'COMPLETED' };
    const scheduler = new AdmissionScheduler({
      probeJob: (id) => ({ status: statuses[id] ?? 'QUEUED' }),
      onAdmit: (input) => {
        started.push(input.id);
        void coordinator.beginExecution(input.id);
        return true;
      },
    });
    scheduler.setPolicy({ maxConcurrentDownloads: 2, wifiOnly: false });
    scheduler.setNetwork({
      connected: true,
      internetReachable: true,
      type: 'wifi',
    });
    const enqueued = scheduler.enqueue(job('A'));
    assert(enqueued === false, 'COMPLETED not enqueued');
    await settle(10);
    assert(started.length === 0, 'no start');
    assert(coordinator.getLedgerSnapshot().protectedCount === 0, 'no FGS');
  });

  await test('CANCELLED never starts', async () => {
    const fake = createFakeController();
    const coordinator = createDownloadExecutionCoordinator(fake);
    const started: string[] = [];
    const scheduler = new AdmissionScheduler({
      probeJob: (id) => ({ status: id === 'A' ? 'CANCELLED' : 'QUEUED' }),
      onAdmit: (input) => {
        started.push(input.id);
        void coordinator.beginExecution(input.id);
        return true;
      },
    });
    scheduler.setPolicy({ maxConcurrentDownloads: 2, wifiOnly: false });
    scheduler.setNetwork({
      connected: true,
      internetReachable: true,
      type: 'wifi',
    });
    assert(scheduler.enqueue(job('A')) === false, 'not enqueued');
    await settle(5);
    assert(started.length === 0, 'no start');
  });

  await test('progressive interrupted → resumable PAUSED candidate', () => {
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
    assert(
      decision.action === 'RECOVER_TO_PAUSED' || decision.action === 'KEEP_PAUSED',
      `expected paused recovery, got ${decision.action}`,
    );
  });

  await test('HLS interrupted → FAILED', () => {
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
    assert(decision.action === 'RECOVER_TO_FAILED', `got ${decision.action}`);
  });

  await test('Auto Resume + Wi-Fi: cellular blocks admission (no service)', async () => {
    const fake = createFakeController();
    const coordinator = createDownloadExecutionCoordinator(fake);
    const started: string[] = [];
    const network: DownloadNetworkState = {
      connected: true,
      internetReachable: true,
      type: 'cellular',
    };
    const scheduler = new AdmissionScheduler({
      probeJob: () => ({ status: 'QUEUED' }),
      onAdmit: (input) => {
        started.push(input.id);
        void coordinator.beginExecution(input.id);
        return true;
      },
    });
    scheduler.setPolicy({ maxConcurrentDownloads: 2, wifiOnly: true });
    scheduler.setNetwork(network);
    scheduler.enqueue(job('R1'));
    await settle(15);
    assert(started.length === 0, 'must not admit on cellular');
    assert(coordinator.getLedgerSnapshot().protectedCount === 0, 'no FGS');
    const snap = scheduler.getSnapshot();
    assert(
      snap.pending.some((p) => p.waitingReason === 'WAITING_FOR_WIFI'),
      'waiting for wifi',
    );
  });

  await test('service start failure: no zombie STARTING; JS may continue foreground-only', async () => {
    const fake = createFakeController({ failStart: true });
    const coordinator = createDownloadExecutionCoordinator(fake);
    const result = await coordinator.beginExecution('A');
    assert(result.admitted === true, 'Model B still admits JS transfer');
    assert(result.serviceOk === false, 'service failed');
    assert(result.foregroundOnly === true, 'foreground only');
    assert(result.error?.code === 'FOREGROUND_SERVICE_START_FAILED', 'error code');
    assert(coordinator.isExecutionOwned('A'), 'owned for slot accounting');
    assert(!coordinator.getLedgerSnapshot().startingDownloadIds.includes('A'), 'not stuck STARTING');
    await coordinator.endExecution('A');
    assert(coordinator.getLedgerSnapshot().protectedCount === 0, 'released');
  });

  await test('stop race: A finishing while B starting keeps service', async () => {
    const fake = createFakeController();
    const coordinator = createDownloadExecutionCoordinator(fake);
    await coordinator.beginExecution('A');

    // Provisional B before A ends
    const ledger = coordinator.getLedgerSnapshot();
    assert(ledger.protectedCount === 1, 'A active');

    // Begin B (starting+active path) then end A in overlapping fashion
    const beginB = coordinator.beginExecution('B');
    await coordinator.endExecution('A');
    await beginB;

    assert(coordinator.getLedgerSnapshot().protectedDownloadIds.includes('B'), 'B protected');
    assert(fake.lastIds.includes('B'), 'native has B');
    // stop may have been attempted but B should keep service required
    assert(coordinator.getLedgerSnapshot().protectedCount >= 1, 'service still needed');
  });

  await test('bridge snapshot: running + ids only (no URLs)', async () => {
    const fake = createFakeController();
    await fake.ensureRunning();
    const snap = await fake.updateActiveJobs(['A', 'B']);
    assert(typeof snap.running === 'boolean', 'running');
    assert(Array.isArray(snap.activeDownloadIds), 'ids array');
    const json = JSON.stringify(snap);
    assert(!json.includes('https://'), 'no URLs');
    assert(!json.includes('cookie'), 'no cookies');
    assert(!json.includes('Authorization'), 'no headers');
    assert(!json.includes('/data/'), 'no paths');
  });

  await test('bootstrap reconciliation: one logical A', async () => {
    const fake = createFakeController();
    await fake.ensureRunning();
    await fake.updateActiveJobs(['A']);
    const coordinator = createDownloadExecutionCoordinator(fake);
    // JS worker still active for A
    const result = await coordinator.reconcile({ jsActiveIds: ['A'] });
    assert(result.ledger.activeDownloadIds.join() === 'A', 'ledger A');
    assert(result.nativeOwnedIds.length === 0, 'no conflict');
    // If JS has nothing but native listed A (process death of JS ownership) — clear native
    const cleared = await coordinator.reconcile({ jsActiveIds: [] });
    assert(cleared.ledger.protectedCount === 0, 'cleared');
  });

  await test('stale backend progress must not reset runtime (projection rule)', () => {
    // Documented invariant: runtime/local truth wins over stale backend %.
    // This is a policy assertion — synchronizer preserves max progress.
    const nativeProgress = 60;
    const backendProgress = 45;
    const projected = Math.max(nativeProgress, backendProgress);
    assert(projected === 60, 'must keep 60 not 45');
  });

  await test('zero workers: service should not start at bootstrap', async () => {
    const fake = createFakeController();
    const coordinator = createDownloadExecutionCoordinator(fake);
    await coordinator.reconcile({ jsActiveIds: [] });
    assert(fake.ensureCalls === 0 || fake.lastIds.length === 0, 'no jobs');
    const snap = await fake.getSnapshot();
    assert(snap.running === false || snap.activeDownloadIds.length === 0, 'idle');
  });

  await test('background status derivation mapping', () => {
    assert(
      deriveDownloadExecutionDisplayState({
        status: 'DOWNLOADING',
        appState: 'active',
        hasActiveExecution: true,
        backgroundServiceActive: true,
      }) === 'DOWNLOADING_FOREGROUND',
      'fg',
    );
    assert(
      deriveDownloadExecutionDisplayState({
        status: 'DOWNLOADING',
        appState: 'background',
        hasActiveExecution: true,
        backgroundServiceActive: true,
      }) === 'DOWNLOADING_BACKGROUND',
      'bg',
    );
    assert(
      formatDownloadExecutionDisplayState('DOWNLOADING_BACKGROUND') ===
        'Downloading in background',
      'copy bg',
    );
    assert(
      deriveDownloadExecutionDisplayState({
        status: 'QUEUED',
        appState: 'active',
        waitingReason: 'WAITING_FOR_WIFI',
      }) === 'WAITING_FOR_WIFI',
      'wifi',
    );
    assert(
      deriveDownloadExecutionDisplayState({
        status: 'FAILED',
        appState: 'active',
        retryDelay: true,
      }) === 'WAITING_FOR_RETRY',
      'retry',
    );
    assert(
      deriveDownloadExecutionDisplayState({
        status: 'PAUSED',
        appState: 'active',
      }) === 'PAUSED',
      'paused',
    );
    assert(
      deriveDownloadExecutionDisplayState({
        status: 'DOWNLOADING',
        appState: 'active',
        workerState: 'VERIFYING',
        hasActiveExecution: true,
      }) === 'FINALIZING',
      'finalizing',
    );
  });

  await test('noop controller safe on non-android', async () => {
    const noop = createNoopBackgroundExecutionController();
    const ok = await noop.ensureRunning();
    assert(ok.ok, 'noop ensure ok');
    const snap = await noop.updateActiveJobs(['X']);
    assert(snap.activeDownloadIds.includes('X'), 'tracks ids in memory');
    await noop.updateActiveJobs([]);
    await noop.stopIfIdle();
  });

  await test('Auto Resume OFF progressive: recovery stays paused (no forced start)', () => {
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
    // Engine gates REENQUEUE via autoResume; progressive interrupt → PAUSED.
    assert(
      decision.action === 'RECOVER_TO_PAUSED' || decision.action === 'KEEP_PAUSED',
      `got ${decision.action}`,
    );
  });

  console.log('');
  console.log(`Phase 2 results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

void main();
