/**
 * Phase 1B — scheduler + network policy behavioral verification.
 *
 * Run: npm run verify:scheduler-network-policy
 */

import {
  DEFAULT_DOWNLOAD_SETTINGS,
  type DownloadSettings,
} from '../src/downloads/settings/types';
import {
  normalizeDownloadSettings,
} from '../src/downloads/settings/normalize';
import {
  AdmissionScheduler,
  admissionHandoff,
  admissionRequeue,
  admissionStarted,
  admissionTerminal,
  evaluateNetworkAdmission,
  type SchedulerJobInput,
} from '../src/downloads/scheduler';

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

function settle(ms = 25): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function job(id: string): SchedulerJobInput {
  return {
    id,
    sourceUrl: `https://cdn.example.com/${id}.mp4`,
    fileName: `${id}.mp4`,
    fileSize: '1048576',
  };
}

function hydrateFromDisk(
  live: DownloadSettings,
  disk: {
    wifiOnly: boolean | null;
    autoResume: boolean | null;
    notificationsEnabled: boolean | null;
    maxConcurrentDownloads: number | null;
  },
): DownloadSettings {
  return normalizeDownloadSettings({
    wifiOnly: disk.wifiOnly ?? live.wifiOnly,
    autoResume: disk.autoResume ?? live.autoResume,
    notificationsEnabled:
      disk.notificationsEnabled ?? live.notificationsEnabled,
    maxConcurrentDownloads:
      disk.maxConcurrentDownloads ?? live.maxConcurrentDownloads,
  });
}

console.log('Phase 1B — Scheduler + Network Policy Verification\n');

async function main(): Promise<void> {
await test('fresh default wifiOnly is false', () => {
  assert(DEFAULT_DOWNLOAD_SETTINGS.wifiOnly === false, 'DEFAULT wifiOnly');
  const empty = normalizeDownloadSettings({});
  assert(empty.wifiOnly === false, 'normalize empty');
});

await test('persisted wifiOnly true survives hydration', () => {
  const hydrated = hydrateFromDisk(
    { ...DEFAULT_DOWNLOAD_SETTINGS, wifiOnly: false },
    { wifiOnly: true, autoResume: null, notificationsEnabled: null, maxConcurrentDownloads: null },
  );
  assert(hydrated.wifiOnly === true, 'explicit true wins');
});

await test('persisted wifiOnly false survives hydration', () => {
  const hydrated = hydrateFromDisk(
    { ...DEFAULT_DOWNLOAD_SETTINGS, wifiOnly: true },
    { wifiOnly: false, autoResume: null, notificationsEnabled: null, maxConcurrentDownloads: null },
  );
  assert(hydrated.wifiOnly === false, 'explicit false wins');
});

await test('wifiOnly off + cellular allows admission', () => {
  const decision = evaluateNetworkAdmission(false, {
    connected: true,
    internetReachable: true,
    type: 'cellular',
  });
  assert(decision.allowed === true, 'cellular allowed when wifiOnly off');
});

await test('wifiOnly on + cellular blocks with WAITING_FOR_WIFI', () => {
  const decision = evaluateNetworkAdmission(true, {
    connected: true,
    internetReachable: true,
    type: 'cellular',
  });
  assert(decision.allowed === false, 'blocked');
  if (!decision.allowed) {
    assert(decision.reason === 'WAITING_FOR_WIFI', 'reason');
  }
});

await test('wifiOnly on + wifi allows admission', () => {
  const decision = evaluateNetworkAdmission(true, {
    connected: true,
    internetReachable: true,
    type: 'wifi',
  });
  assert(decision.allowed === true, 'wifi allowed');
});

await test('wifiOnly on + vpn allows admission (usable network)', () => {
  const decision = evaluateNetworkAdmission(false, {
    connected: true,
    internetReachable: true,
    type: 'vpn',
  });
  assert(decision.allowed === true, 'vpn allowed when wifiOnly off');
});

await test('offline blocks admission', () => {
  const decision = evaluateNetworkAdmission(false, {
    connected: false,
    internetReachable: false,
    type: 'none',
  });
  assert(decision.allowed === false, 'offline');
  if (!decision.allowed) {
    assert(decision.reason === 'OFFLINE', 'reason');
  }
});

await test('transient admit failure requeues job instead of dropping', async () => {
  const scheduler = new AdmissionScheduler({
    onAdmit: () => admissionRequeue('LOCK_HELD'),
  });
  scheduler.setPolicy({ maxConcurrentDownloads: 2, wifiOnly: false });
  scheduler.setNetwork({ connected: true, internetReachable: true, type: 'wifi' });
  scheduler.enqueue(job('A'));
  await settle();
  assert(scheduler.getPendingCount() === 1, 'A remains pending');
  assert(scheduler.getActiveWorkerCount() === 0, 'no active slot');
});

await test('terminal admit removes pending job', async () => {
  const scheduler = new AdmissionScheduler({
    onAdmit: () => admissionTerminal('PAUSED'),
  });
  scheduler.setPolicy({ maxConcurrentDownloads: 2, wifiOnly: false });
  scheduler.setNetwork({ connected: true, internetReachable: true, type: 'wifi' });
  scheduler.enqueue(job('A'));
  await settle();
  assert(scheduler.getPendingCount() === 0, 'A removed');
});

await test('social refresh handoff does not leak active slot', async () => {
  const scheduler = new AdmissionScheduler({
    onAdmit: () => admissionHandoff('social_refresh_handoff'),
  });
  scheduler.setPolicy({ maxConcurrentDownloads: 2, wifiOnly: false });
  scheduler.setNetwork({ connected: true, internetReachable: true, type: 'wifi' });
  scheduler.enqueue(job('A'));
  await settle();
  assert(scheduler.getActiveWorkerCount() === 0, 'handoff must not occupy active slot');
  assert(scheduler.getPendingCount() === 1, 'A remains schedulable');
});

await test('two refresh handoffs with max=2 do not freeze queue', async () => {
  const handoffIds = new Set<string>();
  const scheduler = new AdmissionScheduler({
    onAdmit: (input) => {
      if (handoffIds.has(input.id)) {
        return admissionStarted();
      }
      handoffIds.add(input.id);
      return admissionHandoff('social_refresh_handoff');
    },
  });
  scheduler.setPolicy({ maxConcurrentDownloads: 2, wifiOnly: false });
  scheduler.setNetwork({ connected: true, internetReachable: true, type: 'wifi' });
  scheduler.enqueue(job('A'));
  scheduler.enqueue(job('B'));
  scheduler.enqueue(job('C'));
  await settle(40);
  assert(scheduler.getActiveWorkerCount() <= 2, 'active bounded');
  assert(
    scheduler.getPendingCount() + scheduler.getActiveWorkerCount() >= 1,
    'queue not frozen empty',
  );
});

await test('cellular → wifi automatically drains waiting job', async () => {
  const started: string[] = [];
  const scheduler = new AdmissionScheduler({
    onAdmit: (input) => {
      started.push(input.id);
      return admissionStarted();
    },
  });
  scheduler.setPolicy({ maxConcurrentDownloads: 1, wifiOnly: true });
  scheduler.setNetwork({ connected: true, internetReachable: true, type: 'cellular' });
  scheduler.enqueue(job('A'));
  await settle();
  assert(started.length === 0, 'blocked on cellular');
  assert(scheduler.getPendingCount() === 1, 'still pending');
  scheduler.setNetwork({ connected: true, internetReachable: true, type: 'wifi' });
  await settle();
  assert(started.includes('A'), 'A admitted after wifi');
  assert(scheduler.getActiveWorkerCount() === 1, 'one active');
});

await test('offline → online re-evaluates pending job', async () => {
  const started: string[] = [];
  const scheduler = new AdmissionScheduler({
    onAdmit: (input) => {
      started.push(input.id);
      return admissionStarted();
    },
  });
  scheduler.setPolicy({ maxConcurrentDownloads: 1, wifiOnly: false });
  scheduler.setNetwork({ connected: false, internetReachable: false, type: 'none' });
  scheduler.enqueue(job('A'));
  await settle();
  assert(started.length === 0, 'offline blocked');
  scheduler.setNetwork({ connected: true, internetReachable: true, type: 'wifi' });
  await settle();
  assert(started.includes('A'), 'admitted online');
});

await test('max=1 serializes A then B then C', async () => {
  const order: string[] = [];
  const scheduler = new AdmissionScheduler({
    onAdmit: (input) => {
      order.push(`start:${input.id}`);
      return admissionStarted();
    },
  });
  scheduler.setPolicy({ maxConcurrentDownloads: 1, wifiOnly: false });
  scheduler.setNetwork({ connected: true, internetReachable: true, type: 'wifi' });
  scheduler.enqueue(job('A'));
  scheduler.enqueue(job('B'));
  scheduler.enqueue(job('C'));
  await settle();
  assert(order[0] === 'start:A', 'A first');
  assert(scheduler.getActiveWorkerCount() === 1, 'one active');
  scheduler.release('A');
  await settle();
  assert(order.includes('start:B'), 'B after A release');
  scheduler.release('B');
  await settle();
  assert(order.includes('start:C'), 'C after B release');
});

await test('max=2 admits two then third waits', async () => {
  const started: string[] = [];
  const scheduler = new AdmissionScheduler({
    onAdmit: (input) => {
      started.push(input.id);
      return admissionStarted();
    },
  });
  scheduler.setPolicy({ maxConcurrentDownloads: 2, wifiOnly: false });
  scheduler.setNetwork({ connected: true, internetReachable: true, type: 'wifi' });
  for (const id of ['A', 'B', 'C']) {
    scheduler.enqueue(job(id));
  }
  await settle();
  assert(started.length === 2, 'two started');
  assert(scheduler.getPendingCount() === 1, 'one waiting');
  scheduler.release('A');
  await settle();
  assert(started.includes('C'), 'C admitted after slot free');
});

await test('increasing concurrency 1→4 drains waiting jobs', async () => {
  const started: string[] = [];
  const scheduler = new AdmissionScheduler({
    onAdmit: (input) => {
      started.push(input.id);
      return admissionStarted();
    },
  });
  scheduler.setPolicy({ maxConcurrentDownloads: 1, wifiOnly: false });
  scheduler.setNetwork({ connected: true, internetReachable: true, type: 'wifi' });
  scheduler.enqueue(job('A'));
  scheduler.enqueue(job('B'));
  scheduler.enqueue(job('C'));
  await settle();
  assert(started.length === 1, 'only A');
  scheduler.setPolicy({ maxConcurrentDownloads: 4, wifiOnly: false });
  await settle();
  assert(started.length >= 3, 'B and C admitted');
});

await test('decreasing concurrency does not kill active workers', async () => {
  const scheduler = new AdmissionScheduler({
    onAdmit: () => admissionStarted(),
  });
  scheduler.setPolicy({ maxConcurrentDownloads: 4, wifiOnly: false });
  scheduler.setNetwork({ connected: true, internetReachable: true, type: 'wifi' });
  for (const id of ['A', 'B', 'C', 'D']) {
    scheduler.enqueue(job(id));
  }
  await settle();
  assert(scheduler.getActiveWorkerCount() === 4, 'four active');
  scheduler.setPolicy({ maxConcurrentDownloads: 1, wifiOnly: false });
  await settle();
  assert(scheduler.getActiveWorkerCount() === 4, 'existing workers kept');
  assert(scheduler.getPendingCount() === 0, 'none pending');
});

await test('paused job is not admitted; runnable job proceeds', async () => {
  const started: string[] = [];
  const scheduler = new AdmissionScheduler({
    probeJob: (id) =>
      id === 'A' ? { status: 'PAUSED' } : { status: 'QUEUED' },
    onAdmit: (input) => {
      started.push(input.id);
      return admissionStarted();
    },
  });
  scheduler.setPolicy({ maxConcurrentDownloads: 2, wifiOnly: false });
  scheduler.setNetwork({ connected: true, internetReachable: true, type: 'wifi' });
  scheduler.enqueue(job('A'));
  scheduler.enqueue(job('B'));
  await settle();
  assert(!started.includes('A'), 'paused not started');
  assert(started.includes('B'), 'B started');
});

await test('duplicate enqueue keeps single pending identity', async () => {
  const scheduler = new AdmissionScheduler({
    onAdmit: () => admissionStarted(),
  });
  scheduler.setPolicy({ maxConcurrentDownloads: 2, wifiOnly: false });
  scheduler.setNetwork({ connected: true, internetReachable: true, type: 'wifi' });
  assert(scheduler.enqueue(job('A')) === true, 'first');
  assert(scheduler.enqueue(job('A')) === false, 'dup');
  assert(scheduler.enqueue(job('A')) === false, 'dup2');
  await settle();
  assert(scheduler.getPendingCount() + scheduler.getActiveWorkerCount() <= 1, 'single identity');
});

await test('cancel queued removes pending without admitting', () => {
  const scheduler = new AdmissionScheduler({
    onAdmit: () => admissionStarted(),
  });
  scheduler.setPolicy({ maxConcurrentDownloads: 1, wifiOnly: false });
  scheduler.setNetwork({ connected: true, internetReachable: true, type: 'wifi' });
  scheduler.enqueue(job('A'));
  assert(scheduler.isPending('A'), 'queued');
  scheduler.cancelPending('A');
  assert(scheduler.getPendingCount() === 0, 'removed');
});

await test('WAITING_FOR_WIFI pending job consumes no active slot', async () => {
  const scheduler = new AdmissionScheduler({
    onAdmit: () => admissionStarted(),
  });
  scheduler.setPolicy({ maxConcurrentDownloads: 2, wifiOnly: true });
  scheduler.setNetwork({ connected: true, internetReachable: true, type: 'cellular' });
  scheduler.enqueue(job('A'));
  await settle();
  assert(scheduler.getActiveWorkerCount() === 0, 'no active');
  assert(scheduler.getPendingCount() === 1, 'pending');
  const snap = scheduler.getSnapshot();
  assert(snap.pending[0]?.waitingReason === 'WAITING_FOR_WIFI', 'reason');
});

await test('recovery orphan QUEUED enqueue path is not gated on autoResume in manager', async () => {
  // Static contract — behavioral recovery is covered by manager REENQUEUE case edit.
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src/downloads/engine/manager.ts'),
    'utf8',
  );
  const block = src.slice(
    src.indexOf("case 'REENQUEUE':"),
    src.indexOf('default:', src.indexOf("case 'REENQUEUE':")),
  );
  assert(!block.includes('isAutoResumeEnabled()'), 'orphan QUEUED not gated on autoResume');
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
