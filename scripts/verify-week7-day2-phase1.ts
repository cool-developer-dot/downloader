/**
 * Week 7 Day 2 Phase 1 — dynamic queue scheduler verifier.
 * Deterministic fixtures + fake workers. NO network. NO Metro. NO emulator.
 *
 * Usage (from mobile/):
 *   npx tsx scripts/verify-week7-day2-phase1.ts
 */

import {
  AdmissionScheduler,
  evaluateNetworkAdmission,
  formatQueueWaitingReason,
  type SchedulerJobInput,
} from '../src/downloads/scheduler';
import type { DownloadNetworkState } from '../src/downloads/network';
import { resolvePendingWaitingReason } from '../src/downloads/scheduler/network-policy';

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

function createHarness(options?: {
  max?: number;
  wifiOnly?: boolean;
  network?: DownloadNetworkState;
  statuses?: Record<string, 'QUEUED' | 'DOWNLOADING' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'CANCELLED'>;
}) {
  const active = new Set<string>();
  const startedOrder: string[] = [];
  const statuses = { ...(options?.statuses ?? {}) };

  const scheduler = new AdmissionScheduler({
    probeJob: (id) => ({ status: statuses[id] ?? 'QUEUED' }),
    onAdmit: (input) => {
      if (active.has(input.id)) {
        return false;
      }
      active.add(input.id);
      startedOrder.push(input.id);
      statuses[input.id] = 'DOWNLOADING';
      return true;
    },
  });

  scheduler.setPolicy({
    maxConcurrentDownloads: options?.max ?? 2,
    wifiOnly: options?.wifiOnly ?? false,
  });
  scheduler.setNetwork(
    options?.network ?? {
      connected: true,
      internetReachable: true,
      type: 'wifi',
    },
  );

  return {
    scheduler,
    active,
    startedOrder,
    statuses,
    release(id: string) {
      active.delete(id);
      statuses[id] = 'COMPLETED';
      scheduler.release(id);
    },
    cancelPending(id: string) {
      statuses[id] = 'CANCELLED';
      scheduler.cancelPending(id);
    },
  };
}

async function main(): Promise<void> {
  console.log('Week 7 Day 2 Phase 1 — scheduler / network policy verifier\n');

  await test('max1: A active, B/C pending; settle A → B', async () => {
    const h = createHarness({ max: 1 });
    h.scheduler.enqueue(job('A'));
    h.scheduler.enqueue(job('B'));
    h.scheduler.enqueue(job('C'));
    await settle(10);
    const snap = h.scheduler.getSnapshot();
    assert(snap.active.map((a) => a.downloadId).join() === 'A', 'active A');
    assert(
      snap.pending.map((p) => p.downloadId).join() === 'B,C',
      'pending B,C',
    );
    h.release('A');
    await settle(10);
    const next = h.scheduler.getSnapshot();
    assert(next.active.map((a) => a.downloadId).join() === 'B', 'active B');
    assert(next.pending.map((p) => p.downloadId).join() === 'C', 'pending C');
  });

  await test('max2: A,B active; A settles → B,C', async () => {
    const h = createHarness({ max: 2 });
    for (const id of ['A', 'B', 'C', 'D']) {
      h.scheduler.enqueue(job(id));
    }
    await settle(10);
    let snap = h.scheduler.getSnapshot();
    assert(snap.active.length === 2, '2 active');
    assert(snap.active.map((a) => a.downloadId).join() === 'A,B', 'A,B');
    assert(snap.pending.map((p) => p.downloadId).join() === 'C,D', 'C,D');
    h.release('A');
    await settle(10);
    snap = h.scheduler.getSnapshot();
    assert(snap.active.map((a) => a.downloadId).sort().join() === 'B,C', 'B,C');
    assert(snap.pending.map((p) => p.downloadId).join() === 'D', 'D');
  });

  await test('max4: 5 jobs → 4 active 1 pending', async () => {
    const h = createHarness({ max: 4 });
    for (const id of ['A', 'B', 'C', 'D', 'E']) {
      h.scheduler.enqueue(job(id));
    }
    await settle(10);
    const snap = h.scheduler.getSnapshot();
    assert(snap.active.length === 4, '4 active');
    assert(snap.pending.length === 1, '1 pending');
    assert(!snap.active.some((a) => a.downloadId === 'E'), 'E not active');
  });

  await test('dynamic increase 2→3 promotes C', async () => {
    const h = createHarness({ max: 2 });
    h.scheduler.enqueue(job('A'));
    h.scheduler.enqueue(job('B'));
    h.scheduler.enqueue(job('C'));
    await settle(10);
    h.scheduler.setPolicy({ maxConcurrentDownloads: 3, wifiOnly: false });
    await settle(10);
    const snap = h.scheduler.getSnapshot();
    assert(snap.active.length === 3, '3 active');
    assert(snap.active.some((a) => a.downloadId === 'C'), 'C promoted');
  });

  await test('dynamic decrease 3→1 does not kill active', async () => {
    const h = createHarness({ max: 3 });
    for (const id of ['A', 'B', 'C', 'D']) {
      h.scheduler.enqueue(job(id));
    }
    await settle(10);
    h.scheduler.setPolicy({ maxConcurrentDownloads: 1, wifiOnly: false });
    await settle(10);
    let snap = h.scheduler.getSnapshot();
    assert(snap.active.length === 3, 'still 3 active');
    assert(snap.pending.map((p) => p.downloadId).join() === 'D', 'D pending');
    h.release('A');
    await settle(10);
    snap = h.scheduler.getSnapshot();
    assert(snap.active.length === 2, '2 remain');
    assert(snap.pending.map((p) => p.downloadId).join() === 'D', 'D still pending');
    h.release('B');
    await settle(10);
    snap = h.scheduler.getSnapshot();
    assert(snap.active.length === 1, '1 remain');
    assert(snap.pending.map((p) => p.downloadId).join() === 'D', 'D waiting');
    h.release('C');
    await settle(10);
    snap = h.scheduler.getSnapshot();
    assert(snap.active.map((a) => a.downloadId).join() === 'D', 'D starts');
  });

  await test('FIFO promotion order', async () => {
    const h = createHarness({ max: 1 });
    for (const id of ['A', 'B', 'C', 'D']) {
      h.scheduler.enqueue(job(id));
    }
    await settle(5);
    h.release('A');
    await settle(5);
    h.release('B');
    await settle(5);
    h.release('C');
    await settle(5);
    assert(h.startedOrder.join() === 'A,B,C,D', 'FIFO order');
  });

  await test('duplicate enqueue no-op', async () => {
    const h = createHarness({ max: 1 });
    assert(h.scheduler.enqueue(job('A')) === true, 'first');
    assert(h.scheduler.enqueue(job('A')) === false, 'second');
    assert(h.scheduler.enqueue(job('A')) === false, 'third');
    await settle(5);
    assert(h.scheduler.getSnapshot().pending.length === 0, 'no dup pending');
    assert(h.scheduler.getSnapshot().active.length === 1, 'one active');
  });

  await test('Wi-Fi block on cellular', async () => {
    const h = createHarness({
      max: 2,
      wifiOnly: true,
      network: { connected: true, internetReachable: true, type: 'cellular' },
    });
    h.scheduler.enqueue(job('A'));
    h.scheduler.enqueue(job('B'));
    await settle(10);
    const snap = h.scheduler.getSnapshot();
    assert(snap.active.length === 0, 'none active');
    assert(snap.pending.length === 2, 'both pending');
    assert(
      snap.pending.every((p) => p.waitingReason === 'WAITING_FOR_WIFI'),
      'wifi wait',
    );
  });

  await test('Wi-Fi restore promotes', async () => {
    const h = createHarness({
      max: 2,
      wifiOnly: true,
      network: { connected: true, internetReachable: true, type: 'cellular' },
    });
    h.scheduler.enqueue(job('A'));
    h.scheduler.enqueue(job('B'));
    await settle(5);
    h.scheduler.setNetwork({
      connected: true,
      internetReachable: true,
      type: 'wifi',
    });
    await settle(10);
    const snap = h.scheduler.getSnapshot();
    assert(snap.active.length === 2, 'both active');
  });

  await test('offline blocks then cellular starts when wifiOnly false', async () => {
    const h = createHarness({
      max: 1,
      wifiOnly: false,
      network: { connected: false, internetReachable: false, type: 'none' },
    });
    h.scheduler.enqueue(job('A'));
    await settle(5);
    assert(h.scheduler.getSnapshot().active.length === 0, 'blocked');
    assert(
      h.scheduler.getSnapshot().pending[0]?.waitingReason === 'OFFLINE',
      'offline reason',
    );
    h.scheduler.setNetwork({
      connected: true,
      internetReachable: true,
      type: 'cellular',
    });
    await settle(10);
    assert(h.scheduler.getSnapshot().active[0]?.downloadId === 'A', 'started');
  });

  await test('wifiOnly true→false promotes on cellular', async () => {
    const h = createHarness({
      max: 1,
      wifiOnly: true,
      network: { connected: true, internetReachable: true, type: 'cellular' },
    });
    h.scheduler.enqueue(job('A'));
    await settle(5);
    h.scheduler.setPolicy({ maxConcurrentDownloads: 1, wifiOnly: false });
    await settle(10);
    assert(h.scheduler.getSnapshot().active[0]?.downloadId === 'A', 'promoted');
  });

  await test('wifiOnly false→true keeps pending blocked on cellular', async () => {
    const h = createHarness({
      max: 1,
      wifiOnly: false,
      network: { connected: true, internetReachable: true, type: 'cellular' },
    });
    h.scheduler.enqueue(job('A'));
    h.scheduler.enqueue(job('B'));
    await settle(5);
    assert(h.scheduler.getSnapshot().active[0]?.downloadId === 'A', 'A active');
    h.scheduler.setPolicy({ maxConcurrentDownloads: 1, wifiOnly: true });
    await settle(5);
    assert(
      h.scheduler.getSnapshot().pending[0]?.waitingReason === 'WAITING_FOR_WIFI',
      'B wifi wait',
    );
    h.release('A');
    await settle(10);
    assert(h.scheduler.getSnapshot().active.length === 0, 'B not started');
  });

  await test('terminal protection', async () => {
    const h = createHarness({
      max: 2,
      statuses: { A: 'COMPLETED', B: 'CANCELLED' },
    });
    assert(h.scheduler.enqueue(job('A')) === false, 'completed rejected');
    assert(h.scheduler.enqueue(job('B')) === false, 'cancelled rejected');
    await settle(5);
    assert(h.scheduler.getSnapshot().active.length === 0, 'none');
    assert(h.scheduler.getSnapshot().pending.length === 0, 'none pending');
  });

  await test('FAILED requires legal retry (QUEUED hint)', async () => {
    const h = createHarness({
      max: 1,
      statuses: { A: 'FAILED' },
    });
    assert(h.scheduler.enqueue(job('A')) === false, 'failed rejected');
    h.statuses.A = 'QUEUED';
    assert(h.scheduler.enqueue(job('A')) === true, 'after queued');
    await settle(5);
    assert(h.scheduler.getSnapshot().active[0]?.downloadId === 'A', 'admitted');
  });

  await test('queued cancel recalculates positions', async () => {
    const h = createHarness({ max: 1 });
    h.scheduler.enqueue(job('A'));
    h.scheduler.enqueue(job('B'));
    h.scheduler.enqueue(job('C'));
    await settle(5);
    h.cancelPending('B');
    await settle(5);
    const snap = h.scheduler.getSnapshot();
    assert(snap.active[0]?.downloadId === 'A', 'A active');
    assert(snap.pending.map((p) => p.downloadId).join() === 'C', 'C only');
    assert(snap.pending[0]?.position === 1, 'position 1');
  });

  await test('active cancel releases slot for next', async () => {
    const h = createHarness({ max: 1 });
    h.scheduler.enqueue(job('A'));
    h.scheduler.enqueue(job('B'));
    await settle(5);
    h.statuses.A = 'CANCELLED';
    h.active.delete('A');
    h.scheduler.release('A');
    await settle(10);
    assert(h.scheduler.getSnapshot().active[0]?.downloadId === 'B', 'B promoted');
  });

  await test('start race: single free slot admits once', async () => {
    const h = createHarness({ max: 1 });
    h.scheduler.enqueue(job('A'));
    h.scheduler.requestDrain();
    h.scheduler.requestDrain();
    h.scheduler.requestDrain();
    await settle(20);
    assert(h.startedOrder.filter((id) => id === 'A').length === 1, 'once');
  });

  await test('recovery duplicate enqueue', async () => {
    const h = createHarness({ max: 1 });
    h.scheduler.enqueue(job('A'));
    h.scheduler.enqueue(job('A'));
    await settle(5);
    assert(h.startedOrder.length === 1, 'one start');
  });

  await test('snapshot positions + waiting reasons', async () => {
    const h = createHarness({
      max: 1,
      wifiOnly: true,
      network: { connected: true, internetReachable: true, type: 'cellular' },
    });
    h.scheduler.enqueue(job('A'));
    h.scheduler.enqueue(job('B'));
    await settle(5);
    const snap = h.scheduler.getSnapshot();
    assert(snap.pending[0]?.position === 1, 'pos1');
    assert(snap.pending[1]?.position === 2, 'pos2');
    assert(
      formatQueueWaitingReason(snap.pending[0]!.waitingReason) ===
        'Waiting for Wi-Fi',
      'copy',
    );
  });

  await test('network policy helpers', () => {
    assert(
      evaluateNetworkAdmission(true, {
        connected: true,
        internetReachable: true,
        type: 'wifi',
      }).allowed === true,
      'wifi ok',
    );
    assert(
      evaluateNetworkAdmission(true, {
        connected: true,
        internetReachable: true,
        type: 'unknown',
      }).allowed === false,
      'unknown blocked when wifiOnly',
    );
    assert(
      resolvePendingWaitingReason({
        wifiOnly: true,
        network: { connected: false, internetReachable: false, type: 'none' },
        activeCount: 2,
        maxConcurrent: 2,
      }) === 'OFFLINE',
      'offline precedence over capacity',
    );
  });

  await test('listener cleanup', () => {
    const h = createHarness({ max: 1 });
    let calls = 0;
    const unsub = h.scheduler.subscribe(() => {
      calls += 1;
    });
    h.scheduler.enqueue(job('A'));
    unsub();
    const before = calls;
    h.scheduler.setPolicy({ maxConcurrentDownloads: 2, wifiOnly: false });
    assert(calls === before, 'no calls after unsub');
    h.scheduler.dispose();
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
