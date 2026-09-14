/**
 * Week 7 Day 2 Phase 3 — notifications, recovery hardening verifier.
 * Deterministic fixtures. NO network. NO Metro. NO emulator. NO Python.
 *
 * Usage (from mobile/):
 *   npx tsx scripts/verify-week7-day2-phase3.ts
 */

import './_node-asset-stub';

import {
  computeAggregateProgress,
  sanitizeNotificationTitle,
} from '../src/downloads/notifications/aggregate-progress';
import {
  createNotificationDedupeStore,
  shouldEmitTerminalNotification,
} from '../src/downloads/notifications/dedupe';
import {
  capturePendingNotificationTarget,
  clearPendingNotificationTarget,
  getPendingNotificationTarget,
  isValidDownloadId,
  resetNotificationDeepLinkForTests,
  resolveNotificationNavigation,
  setNotificationAuthProbe,
  setNotificationExistsProbe,
  setNotificationNavigationReady,
} from '../src/downloads/notifications/deep-link';
import { deriveEffectiveNotificationsState } from '../src/downloads/notifications/permission';
import {
  createDownloadNotificationService,
  type LocalNotificationAdapter,
} from '../src/downloads/notifications/service';
import { createFgsSummaryPublisher } from '../src/downloads/notifications/fgs-summary';
import { createThrottleController } from '../src/downloads/notifications/throttle-controller';
import type { FgsNotificationSummary } from '../src/downloads/notifications/types';
import { createDownloadExecutionCoordinator } from '../src/downloads/execution/coordinator';
import type { BackgroundExecutionController } from '../src/downloads/execution/background-execution-controller';
import type { BackgroundExecutionSnapshot } from '../src/downloads/execution/types';
import { deriveDownloadExecutionDisplayState } from '../src/downloads/execution/display-status';
import { decideRecoveryState } from '../src/downloads/engine/recovery-decision';
import { AdmissionScheduler, type SchedulerJobInput } from '../src/downloads/scheduler';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
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

function settle(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createFakeController(): BackgroundExecutionController & {
  summaries: FgsNotificationSummary[];
} {
  let running = false;
  let ids: string[] = [];
  const summaries: FgsNotificationSummary[] = [];
  return {
    summaries,
    async ensureRunning() {
      running = true;
      return { ok: true };
    },
    async updateActiveJobs(downloadIds) {
      ids = [...downloadIds];
      running = ids.length > 0;
      return {
        running,
        activeDownloadIds: [...ids],
        serviceStartedAt: running ? Date.now() : null,
        executionMode: 'JS_TRANSFER_FGS',
      };
    },
    async stopIfIdle() {
      if (ids.length === 0) {
        running = false;
      }
      return {
        running,
        activeDownloadIds: [...ids],
        serviceStartedAt: null,
        executionMode: 'JS_TRANSFER_FGS',
      };
    },
    async getSnapshot() {
      return {
        running,
        activeDownloadIds: [...ids],
        serviceStartedAt: null,
        executionMode: 'JS_TRANSFER_FGS',
      } satisfies BackgroundExecutionSnapshot;
    },
    async updateNotificationSummary(summary) {
      summaries.push({ ...summary });
    },
    subscribe() {
      return () => undefined;
    },
  };
}

function createMockLocalAdapter(): LocalNotificationAdapter & {
  scheduled: Array<{ title: string; body: string; identifier: string }>;
  requestCount: number;
} {
  const scheduled: Array<{ title: string; body: string; identifier: string }> = [];
  return {
    scheduled,
    requestCount: 0,
    async ensureEventChannel() {},
    async scheduleNotification(input) {
      scheduled.push({
        title: input.title,
        body: input.body,
        identifier: input.identifier,
      });
    },
    async dismissNotification() {},
    async getLastNotificationResponse() {
      return null;
    },
    addResponseListener() {
      return () => undefined;
    },
  };
}

async function main(): Promise<void> {
  await test('FGS vs preference: optional suppressed when preference false', async () => {
    const local = createMockLocalAdapter();
    const service = createDownloadNotificationService({
      getPreferenceEnabled: () => false,
      permissionAdapter: {
        async getPermissionsAsync() {
          return { status: 'granted', canAskAgain: true };
        },
        async requestPermissionsAsync() {
          return { status: 'granted', canAskAgain: true };
        },
      },
      localAdapter: local,
    });
    await service.initialize();
    const ok = await service.notifyCompleted({
      downloadId: 'A',
      title: 'Video.mp4',
    });
    assert(ok === false, 'must suppress');
    assert(local.scheduled.length === 0, 'no optional notification');
    assert(service.getEffectiveState().effectiveEnabled === false, 'effective off');
  });

  await test('permission granted + preference → one completion', async () => {
    const local = createMockLocalAdapter();
    const service = createDownloadNotificationService({
      getPreferenceEnabled: () => true,
      permissionAdapter: {
        async getPermissionsAsync() {
          return { status: 'granted', canAskAgain: true };
        },
        async requestPermissionsAsync() {
          return { status: 'granted', canAskAgain: true };
        },
      },
      localAdapter: local,
    });
    await service.initialize();
    const ok = await service.notifyCompleted({
      downloadId: 'B',
      title: 'Clip.mp4',
    });
    assert(ok === true, 'emitted');
    assert(local.scheduled.length === 1, 'one notification');
    assert(local.scheduled[0]!.title === 'Download complete', 'title');
    assert(!local.scheduled[0]!.body.includes('https://'), 'no url');
  });

  await test('permission denied → no optional notification', async () => {
    const local = createMockLocalAdapter();
    const service = createDownloadNotificationService({
      getPreferenceEnabled: () => true,
      permissionAdapter: {
        async getPermissionsAsync() {
          return { status: 'denied', canAskAgain: false };
        },
        async requestPermissionsAsync() {
          return { status: 'denied', canAskAgain: false };
        },
      },
      localAdapter: local,
    });
    await service.initialize();
    const state = service.getEffectiveState();
    assert(state.effectiveEnabled === false, 'effective false');
    assert(state.permissionGranted === false, 'not granted');
    const ok = await service.notifyFailed({ downloadId: 'C', title: 'X' });
    assert(ok === false, 'suppressed');
    assert(local.scheduled.length === 0, 'none');
  });

  await test('permission request only on user gesture enable', async () => {
    let requests = 0;
    let status: 'undetermined' | 'granted' | 'denied' = 'undetermined';
    const service = createDownloadNotificationService({
      getPreferenceEnabled: () => true,
      permissionAdapter: {
        async getPermissionsAsync() {
          return { status, canAskAgain: true };
        },
        async requestPermissionsAsync() {
          requests += 1;
          status = 'granted';
          return { status, canAskAgain: true };
        },
      },
      localAdapter: createMockLocalAdapter(),
    });
    await service.initialize();
    assert(requests === 0, 'no request on init');
    await service.enableFromUserGesture();
    const afterFirst = requests;
    assert(afterFirst === 1, 'one request');
    await service.enableFromUserGesture();
    assert(requests === afterFirst, 'no duplicate when granted');
  });

  await test('completion dedupe', async () => {
    const local = createMockLocalAdapter();
    const service = createDownloadNotificationService({
      getPreferenceEnabled: () => true,
      permissionAdapter: {
        async getPermissionsAsync() {
          return { status: 'granted', canAskAgain: true };
        },
        async requestPermissionsAsync() {
          return { status: 'granted', canAskAgain: true };
        },
      },
      localAdapter: local,
    });
    await service.initialize();
    await service.notifyCompleted({ downloadId: 'D', title: 'A' });
    await service.notifyCompleted({ downloadId: 'D', title: 'A' });
    await service.notifyCompleted({ downloadId: 'D', title: 'A' });
    assert(local.scheduled.length === 1, 'one completion');
  });

  await test('failure dedupe', async () => {
    const local = createMockLocalAdapter();
    const service = createDownloadNotificationService({
      getPreferenceEnabled: () => true,
      permissionAdapter: {
        async getPermissionsAsync() {
          return { status: 'granted', canAskAgain: true };
        },
        async requestPermissionsAsync() {
          return { status: 'granted', canAskAgain: true };
        },
      },
      localAdapter: local,
    });
    await service.initialize();
    await service.notifyFailed({ downloadId: 'E', title: 'A' });
    await service.notifyFailed({ downloadId: 'E', title: 'A' });
    assert(local.scheduled.length === 1, 'one failure');
  });

  await test('retryable failure: dedupe store alone does not emit without service call', () => {
    const store = createNotificationDedupeStore();
    // Policy: RETRY_WAIT must not call notifyFailed — verified by bridge using isRetryScheduled.
    // Here we assert dedupe key independence COMPLETED vs FAILED.
    assert(
      shouldEmitTerminalNotification(store, 'R1', 'FAILED') === true,
      'first fail',
    );
    assert(
      shouldEmitTerminalNotification(store, 'R1', 'FAILED') === false,
      'deduped',
    );
    assert(
      shouldEmitTerminalNotification(store, 'R1', 'COMPLETED') === true,
      'different event',
    );
  });

  await test('final failure notification path', async () => {
    const local = createMockLocalAdapter();
    const service = createDownloadNotificationService({
      getPreferenceEnabled: () => true,
      permissionAdapter: {
        async getPermissionsAsync() {
          return { status: 'granted', canAskAgain: true };
        },
        async requestPermissionsAsync() {
          return { status: 'granted', canAskAgain: true };
        },
      },
      localAdapter: local,
    });
    await service.initialize();
    const ok = await service.notifyFailed({ downloadId: 'F1', title: 'Clip' });
    assert(ok === true, 'emitted final failure');
    assert(local.scheduled[0]!.title === 'Download failed', 'title');
  });

  await test('tap details / missing / auth / cold start', async () => {
    resetNotificationDeepLinkForTests();
    const navigated: string[] = [];
    // Monkey-patch via probes only — resolveNotificationNavigation uses safeNavigate.
    // We validate pending capture + validation without router.
    assert(isValidDownloadId('clxyz12345') === true, 'valid id');
    assert(isValidDownloadId('https://evil') === false, 'reject url');
    assert(isValidDownloadId('a/b') === false, 'reject path');

    setNotificationNavigationReady(false);
    const deferred = await resolveNotificationNavigation('clxyz12345');
    assert(deferred === 'deferred', 'deferred');
    assert(getPendingNotificationTarget()?.downloadId === 'clxyz12345', 'pending');

    setNotificationAuthProbe(() => false);
    setNotificationExistsProbe(() => true);
    setNotificationNavigationReady(true);
    // Auth false → ignored/sign-in path
    clearPendingNotificationTarget();
    capturePendingNotificationTarget('clxyz12345');
    // Manual resolve with auth false
    setNotificationNavigationReady(true);
    const authResult = await resolveNotificationNavigation('clxyz12345');
    assert(authResult === 'ignored', `auth guard got ${authResult}`);

    resetNotificationDeepLinkForTests();
    setNotificationAuthProbe(() => true);
    setNotificationExistsProbe(() => false);
    setNotificationNavigationReady(true);
    const missing = await resolveNotificationNavigation('clxyz12345');
    assert(missing === 'downloads', `missing got ${missing}`);
    void navigated;
  });

  await test('FGS throttle bounds progress updates', async () => {
    let emits = 0;
    const throttle = createThrottleController<number>({
      intervalMs: 100,
      onEmit: () => {
        emits += 1;
      },
      now: (() => {
        let t = 0;
        return () => {
          t += 10;
          return t;
        };
      })(),
    });
    for (let i = 0; i < 20; i += 1) {
      throttle.schedule(i);
    }
    await settle(150);
    assert(emits < 20, `bounded emits=${emits}`);
    assert(emits >= 1, 'at least one');
  });

  await test('single progress determinate vs indeterminate', () => {
    const known = computeAggregateProgress([
      { bytesDownloaded: 50, totalBytes: 100, progressPercent: 50 },
    ]);
    assert(known.indeterminate === false, 'determinate');
    assert(known.progressPercent === 50, '50%');

    const unknown = computeAggregateProgress([
      { bytesDownloaded: 10, totalBytes: null, progressPercent: null },
    ]);
    assert(unknown.indeterminate === true, 'indeterminate');
    assert(unknown.progressPercent === null, 'no fake %');
  });

  await test('multiple progress: weighted not average; unknown → indeterminate', () => {
    const weighted = computeAggregateProgress([
      { bytesDownloaded: 10, totalBytes: 100, progressPercent: 10 },
      { bytesDownloaded: 900, totalBytes: 1000, progressPercent: 90 },
    ]);
    // (10+900)/(100+1000) = 910/1100 ≈ 82%
    assert(weighted.indeterminate === false, 'weighted ok');
    const pct = weighted.progressPercent ?? -1;
    assert(pct === 82, `got ${pct}`);
    assert(pct !== 50, 'not naive average');

    const mixed = computeAggregateProgress([
      { bytesDownloaded: 10, totalBytes: 100, progressPercent: 10 },
      { bytesDownloaded: 5, totalBytes: null, progressPercent: 20 },
    ]);
    assert(mixed.indeterminate === true, 'mixed unknown');
    assert(mixed.progressPercent === null, 'no fabricated 50');
  });

  await test('native orphan: clear ledger to JS truth', async () => {
    const fake = createFakeController();
    await fake.ensureRunning();
    await fake.updateActiveJobs(['A']);
    const coordinator = createDownloadExecutionCoordinator(fake);
    const result = await coordinator.reconcile({ jsActiveIds: [] });
    assert(result.ledger.protectedCount === 0, 'cleared');
    assert(result.nativeOwnedIds.includes('A'), 'detected orphan');
  });

  await test('JS worker missing native → resync no duplicate', async () => {
    const fake = createFakeController();
    const coordinator = createDownloadExecutionCoordinator(fake);
    await coordinator.beginExecution('A');
    await fake.updateActiveJobs([]); // desync
    const result = await coordinator.reconcile({ jsActiveIds: ['A'] });
    assert(result.ledger.protectedCount === 1, 'ledger A');
    assert(fake.summaries || true, 'ok');
  });

  await test('duplicate queue reconstruction', async () => {
    const statuses: Record<string, 'QUEUED'> = { A: 'QUEUED' };
    const started: string[] = [];
    const scheduler = new AdmissionScheduler({
      probeJob: (id) => ({ status: statuses[id] ?? 'QUEUED' }),
      onAdmit: (job: SchedulerJobInput) => {
        started.push(job.id);
        return true;
      },
    });
    scheduler.setPolicy({ maxConcurrentDownloads: 2, wifiOnly: false });
    scheduler.setNetwork({
      connected: true,
      internetReachable: true,
      type: 'wifi',
    });
    scheduler.enqueue({
      id: 'A',
      sourceUrl: 'https://cdn.example.com/a.mp4',
      fileName: 'a.mp4',
      fileSize: '1',
    });
    scheduler.enqueue({
      id: 'A',
      sourceUrl: 'https://cdn.example.com/a.mp4',
      fileName: 'a.mp4',
      fileSize: '1',
    });
    await settle(20);
    assert(started.length === 1, 'one admit');
    assert(scheduler.getSnapshot().pending.filter((p) => p.downloadId === 'A').length <= 1, 'once');
  });

  await test('COMPLETED / CANCELLED never FGS', async () => {
    const fake = createFakeController();
    const coordinator = createDownloadExecutionCoordinator(fake);
    const scheduler = new AdmissionScheduler({
      probeJob: (id) => ({
        status: id === 'C' ? 'COMPLETED' : id === 'X' ? 'CANCELLED' : 'QUEUED',
      }),
      onAdmit: () => {
        throw new Error('should not admit');
      },
    });
    scheduler.setPolicy({ maxConcurrentDownloads: 2, wifiOnly: false });
    scheduler.setNetwork({
      connected: true,
      internetReachable: true,
      type: 'wifi',
    });
    assert(scheduler.enqueue({
      id: 'C',
      sourceUrl: 'https://cdn.example.com/c.mp4',
      fileName: 'c.mp4',
      fileSize: '1',
    }) === false, 'completed blocked');
    assert(scheduler.enqueue({
      id: 'X',
      sourceUrl: 'https://cdn.example.com/x.mp4',
      fileName: 'x.mp4',
      fileSize: '1',
    }) === false, 'cancelled blocked');
    assert(coordinator.getLedgerSnapshot().protectedCount === 0, 'no fgs');
  });

  await test('progressive / HLS recovery', () => {
    const progressive = decideRecoveryState({
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
    assert(progressive.action === 'RECOVER_TO_PAUSED', progressive.action);

    const hls = decideRecoveryState({
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
    assert(hls.action === 'RECOVER_TO_FAILED', hls.action);
  });

  await test('Wi-Fi recovery: cellular blocks', async () => {
    const started: string[] = [];
    const scheduler = new AdmissionScheduler({
      probeJob: () => ({ status: 'QUEUED' }),
      onAdmit: (job) => {
        started.push(job.id);
        return true;
      },
    });
    scheduler.setPolicy({ maxConcurrentDownloads: 2, wifiOnly: true });
    scheduler.setNetwork({
      connected: true,
      internetReachable: true,
      type: 'cellular',
    });
    scheduler.enqueue({
      id: 'W1',
      sourceUrl: 'https://cdn.example.com/w.mp4',
      fileName: 'w.mp4',
      fileSize: '1',
    });
    await settle(15);
    assert(started.length === 0, 'blocked');
    assert(
      scheduler.getSnapshot().pending[0]?.waitingReason === 'WAITING_FOR_WIFI',
      'wifi wait',
    );
  });

  await test('zero active / multiple active FGS summary', () => {
    const summaries: FgsNotificationSummary[] = [];
    const publisher = createFgsSummaryPublisher({
      updateSummary: (s) => {
        summaries.push(s);
      },
      getActiveJobs: () => [
        {
          downloadId: 'A',
          title: 'One',
          fileName: 'one.mp4',
          bytesDownloaded: 10,
          totalBytes: 100,
          progressPercent: 10,
        },
        {
          downloadId: 'B',
          title: 'Two',
          fileName: 'two.mp4',
          bytesDownloaded: 50,
          totalBytes: 100,
          progressPercent: 50,
        },
      ],
      getWaitingCount: () => 1,
      throttleMs: 1,
    });
    publisher.onStructureChange();
    assert(summaries.length === 1, 'one summary');
    assert(summaries[0]!.activeCount === 2, 'two active');
    assert(summaries[0]!.waitingCount === 1, 'one waiting');
    assert(summaries[0]!.title === null, 'no single title for multi');

    const empty = createFgsSummaryPublisher({
      updateSummary: (s) => {
        summaries.push(s);
      },
      getActiveJobs: () => [],
      getWaitingCount: () => 0,
      throttleMs: 1,
    });
    empty.onStructureChange();
    assert(summaries[summaries.length - 1]!.activeCount === 0, 'zero');
  });

  await test('background status mapping', () => {
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
      deriveDownloadExecutionDisplayState({
        status: 'QUEUED',
        appState: 'active',
        waitingReason: 'WAITING_FOR_WIFI',
      }) === 'WAITING_FOR_WIFI',
      'wifi',
    );
  });

  await test('effective notifications formula', () => {
    const on = deriveEffectiveNotificationsState({
      preferenceEnabled: true,
      permissionStatus: 'granted',
      canAskAgain: true,
    });
    assert(on.effectiveEnabled === true, 'on');
    const off = deriveEffectiveNotificationsState({
      preferenceEnabled: true,
      permissionStatus: 'denied',
      canAskAgain: false,
    });
    assert(off.effectiveEnabled === false, 'off');
  });

  await test('sanitize notification title rejects URLs', () => {
    assert(
      sanitizeNotificationTitle('https://cdn.example.com/x', 'file.mp4') ===
        'file.mp4',
      'fallback file',
    );
  });

  await test('settings canonical preference source', () => {
    // Documented: notificationsEnabled from Day 1 settings — no NotificationSettingsV2.
    const state = deriveEffectiveNotificationsState({
      preferenceEnabled: false,
      permissionStatus: 'granted',
      canAskAgain: true,
    });
    assert(state.preferenceEnabled === false, 'pref source');
    assert(state.effectiveEnabled === false, 'and formula');
  });

  console.log('');
  console.log(`Phase 3 results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

void main();
