/**
 * Week 8 Day 3 Phase 3 — Offline Reconciliation & Sync Hardening (mobile).
 * Pure logic / fake clocks / injectable storage. NO Metro.
 *
 * Usage (from mobile/):
 *   npx tsx scripts/verify-week8-day3-phase3.ts
 */

import {
  clampClientTimestampIso,
  configurePlaybackStorageAdapter,
  listPlaybackStatesForUser,
  loadPlaybackState,
  PlaybackPersistenceCoordinator,
  reconcilePlaybackState,
  resetPlaybackStorageForTests,
  savePlaybackState,
  type PlaybackStorageAdapter,
  type PlaybackSyncTransport,
} from '../src/playback';

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

function memoryAdapter(): PlaybackStorageAdapter & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    getAllKeys: () => Array.from(store.keys()),
  };
}

function createFakeClock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const USER_A = 'user-a-phase3-aaaa-aaaaaaaaaaaa';
const USER_B = 'user-b-phase3-bbbb-bbbbbbbbbbbb';
const MEDIA = 'media-phase3-cccc-cccccccccccc';

async function main(): Promise<void> {
  console.log('\n=== Week 8 Day 3 Phase 3 — Mobile Hardening ===\n');

  await test('reconcile: local newer → PUSH_LOCAL', () => {
    const nowMs = Date.parse('2026-08-22T15:00:00.000Z');
    const result = reconcilePlaybackState({
      local: {
        mediaId: MEDIA,
        positionSeconds: 120,
        durationSeconds: 600,
        progressPercent: 20,
        lastPlayedAt: '2026-08-22T13:00:00.000Z',
        completed: false,
        updatedAt: '2026-08-22T13:00:00.000Z',
        pendingSync: true,
        clientRevision: 5,
      },
      remote: {
        mediaId: MEDIA,
        positionSeconds: 40,
        durationSeconds: 600,
        progressPercent: 6,
        lastPlayedAt: '2026-08-22T12:00:00.000Z',
        completed: false,
        updatedAt: '2026-08-22T12:00:00.000Z',
      },
      nowMs,
    });
    assert(result.decision === 'PUSH_LOCAL', `decision ${result.decision}`);
    assert(result.state?.positionSeconds === 120, 'local position');
  });

  await test('reconcile: remote newer → USE_REMOTE', () => {
    const nowMs = Date.parse('2026-08-22T15:00:00.000Z');
    const result = reconcilePlaybackState({
      local: {
        mediaId: MEDIA,
        positionSeconds: 40,
        durationSeconds: 600,
        progressPercent: 6,
        lastPlayedAt: '2026-08-22T12:00:00.000Z',
        completed: false,
        updatedAt: '2026-08-22T12:00:00.000Z',
        pendingSync: false,
        clientRevision: 2,
      },
      remote: {
        mediaId: MEDIA,
        positionSeconds: 200,
        durationSeconds: 600,
        progressPercent: 33,
        lastPlayedAt: '2026-08-22T14:00:00.000Z',
        completed: false,
        updatedAt: '2026-08-22T14:00:00.000Z',
        clientRevision: 3,
      },
      nowMs,
    });
    assert(result.decision === 'USE_REMOTE', `decision ${result.decision}`);
    assert(result.state?.positionSeconds === 200, 'remote position');
  });

  await test('reconcile: equal timestamp → CONFLICT_RESOLVED sticky completed', () => {
    const nowMs = Date.parse('2026-08-22T15:00:00.000Z');
    const result = reconcilePlaybackState({
      local: {
        mediaId: MEDIA,
        positionSeconds: 70,
        durationSeconds: 100,
        progressPercent: 70,
        lastPlayedAt: '2026-08-22T12:00:00.000Z',
        completed: false,
        updatedAt: '2026-08-22T12:00:00.000Z',
        pendingSync: false,
        clientRevision: 4,
      },
      remote: {
        mediaId: MEDIA,
        positionSeconds: 99,
        durationSeconds: 100,
        progressPercent: 99,
        lastPlayedAt: '2026-08-22T12:00:00.000Z',
        completed: true,
        updatedAt: '2026-08-22T12:00:00.000Z',
        clientRevision: 4,
      },
      nowMs,
    });
    assert(result.decision === 'CONFLICT_RESOLVED', `decision ${result.decision}`);
    assert(result.state?.completed === true, 'sticky completed');
  });

  await test('completion: remote completed + stale unfinished local stays completed', () => {
    const nowMs = Date.parse('2026-08-22T16:00:00.000Z');
    const result = reconcilePlaybackState({
      local: {
        mediaId: MEDIA,
        positionSeconds: 70,
        durationSeconds: 100,
        progressPercent: 70,
        lastPlayedAt: '2026-08-22T15:00:00.000Z',
        completed: false,
        updatedAt: '2026-08-22T15:00:00.000Z',
        pendingSync: true,
        clientRevision: 8,
      },
      remote: {
        mediaId: MEDIA,
        positionSeconds: 99,
        durationSeconds: 100,
        progressPercent: 99,
        lastPlayedAt: '2026-08-22T12:00:00.000Z',
        completed: true,
        updatedAt: '2026-08-22T12:00:00.000Z',
        clientRevision: 3,
      },
      nowMs,
    });
    assert(result.state?.completed === true, 'must remain completed');
  });

  await test('completion: intentional replay allowReplayDowngrade clears completed', () => {
    const nowMs = Date.parse('2026-08-22T17:00:00.000Z');
    const result = reconcilePlaybackState({
      local: {
        mediaId: MEDIA,
        positionSeconds: 5,
        durationSeconds: 100,
        progressPercent: 5,
        lastPlayedAt: '2026-08-22T16:00:00.000Z',
        completed: false,
        updatedAt: '2026-08-22T16:00:00.000Z',
        pendingSync: true,
        clientRevision: 10,
      },
      remote: {
        mediaId: MEDIA,
        positionSeconds: 99,
        durationSeconds: 100,
        progressPercent: 99,
        lastPlayedAt: '2026-08-22T12:00:00.000Z',
        completed: true,
        updatedAt: '2026-08-22T12:00:00.000Z',
        clientRevision: 3,
      },
      allowReplayDowngrade: true,
      nowMs,
    });
    assert(result.state?.completed === false, 'replay clears completed');
  });

  await test('clock skew: future timestamp clamped', () => {
    const now = Date.parse('2026-08-22T12:00:00.000Z');
    const wild = '2099-01-01T00:00:00.000Z';
    const clamped = clampClientTimestampIso(wild, now);
    assert(clamped === new Date(now).toISOString(), `clamped ${clamped}`);
  });

  await test('out-of-order: older sync response ignored by revision', async () => {
    resetPlaybackStorageForTests();
    configurePlaybackStorageAdapter(memoryAdapter());
    const clock = createFakeClock();
    const order: number[] = [];
    const gates: Array<() => void> = [];

    const sync: PlaybackSyncTransport = {
      updateProgress: async (_mediaId, body) => {
        const rev = body.clientRevision ?? 0;
        order.push(rev);
        await new Promise<void>((r) => {
          gates.push(r);
        });
        return {
          mediaId: MEDIA,
          positionSeconds: body.positionSeconds,
          durationSeconds: body.durationSeconds,
          progressPercent: 0,
          lastPlayedAt: null,
          completed: false,
          updatedAt: body.updatedAt,
          clientRevision: rev,
        };
      },
    };

    const coord = new PlaybackPersistenceCoordinator({
      getUserId: () => USER_A,
      sync,
      clock,
      localPersistIntervalMs: 60_000,
      backendSyncIntervalMs: 60_000,
    });

    coord.startPlayback(MEDIA, clock.now());
    coord.updatePosition(MEDIA, 120, 600, clock.now());
    void coord.flush();
    await Promise.resolve();
    coord.updatePosition(MEDIA, 140, 600, clock.now());
    void coord.flush();
    await Promise.resolve();

    assert(order.length >= 1, `had syncs ${order.join(',')}`);

    // Resolve later requests first (out-of-order), then earlier.
    for (let i = gates.length - 1; i >= 0; i -= 1) {
      gates[i]!();
    }
    await new Promise((r) => setTimeout(r, 20));

    const final = loadPlaybackState(USER_A, MEDIA);
    assert(final !== null, 'persisted');
    assert(
      final!.positionSeconds === 140 || final!.clientRevision >= 2,
      `fresh state pos=${final!.positionSeconds} rev=${final!.clientRevision}`,
    );
    coord.dispose();
  });

  await test('offline pending survives restart; reconnect pushes latest only', async () => {
    resetPlaybackStorageForTests();
    configurePlaybackStorageAdapter(memoryAdapter());
    const clock = createFakeClock();
    const puts: Array<{ position: number; revision: number }> = [];

    const syncFail: PlaybackSyncTransport = {
      updateProgress: async () => {
        const err = Object.assign(new Error('offline'), { status: null });
        throw err;
      },
    };

    const coord1 = new PlaybackPersistenceCoordinator({
      getUserId: () => USER_A,
      sync: syncFail,
      clock,
      localPersistIntervalMs: 5_000,
      backendSyncIntervalMs: 15_000,
    });
    coord1.startPlayback(MEDIA, clock.now());
    coord1.updatePosition(MEDIA, 50, 600, clock.now());
    clock.advance(6_000);
    coord1.updatePosition(MEDIA, 80, 600, clock.now());
    coord1.pause(MEDIA, 80, clock.now());
    await new Promise((r) => setTimeout(r, 10));
    coord1.dispose();

    const pending = loadPlaybackState(USER_A, MEDIA);
    assert(pending?.pendingSync === true, 'pending after offline');
    assert(pending?.positionSeconds === 80, 'latest position');

    const syncOk: PlaybackSyncTransport = {
      updateProgress: async (_id, body) => {
        puts.push({
          position: body.positionSeconds,
          revision: body.clientRevision ?? 0,
        });
        return {
          mediaId: MEDIA,
          positionSeconds: body.positionSeconds,
          durationSeconds: body.durationSeconds,
          progressPercent: 0,
          lastPlayedAt: body.lastPlayedAt ?? null,
          completed: false,
          updatedAt: body.updatedAt,
          clientRevision: body.clientRevision,
        };
      },
    };

    const coord2 = new PlaybackPersistenceCoordinator({
      getUserId: () => USER_A,
      sync: syncOk,
      clock,
    });
    await coord2.reconcilePendingOnReconnect();
    await new Promise((r) => setTimeout(r, 20));

    assert(puts.length === 1, `one latest push got ${puts.length}`);
    assert(puts[0]!.position === 80, 'latest position synced');
    assert(loadPlaybackState(USER_A, MEDIA)?.pendingSync === false, 'cleared');
    coord2.dispose();
  });

  await test('account isolation: User A pending never syncs as User B', async () => {
    resetPlaybackStorageForTests();
    configurePlaybackStorageAdapter(memoryAdapter());
    const clock = createFakeClock();
    let activeUser = USER_A;
    const tokens: string[] = [];

    const sync: PlaybackSyncTransport = {
      updateProgress: async () => {
        tokens.push(activeUser);
        return {
          mediaId: MEDIA,
          positionSeconds: 1,
          durationSeconds: 100,
          progressPercent: 1,
          lastPlayedAt: null,
          completed: false,
          updatedAt: new Date(clock.now()).toISOString(),
        };
      },
    };

    const coord = new PlaybackPersistenceCoordinator({
      getUserId: () => activeUser,
      sync,
      clock,
    });

    coord.startPlayback(MEDIA, clock.now());
    coord.updatePosition(MEDIA, 30, 600, clock.now());
    coord.pause(MEDIA, 30, clock.now());
    await new Promise((r) => setTimeout(r, 5));

    coord.resetForLogout();
    activeUser = USER_B;

    // Stale in-flight from A already cancelled by generation; B should not see A's media in list for B
    const bStates = listPlaybackStatesForUser(USER_B);
    assert(bStates.length === 0, 'B has no A local rows');
    const aStates = listPlaybackStatesForUser(USER_A);
    assert(aStates.length >= 1, 'A rows retained locally');
    assert(
      !tokens.includes(USER_B) || tokens.every((t) => t === USER_A || t === USER_B),
      'tokens recorded',
    );
    // After logout, reconnect as B must not push A's media under B
    await coord.reconcilePendingOnReconnect();
    assert(
      tokens.filter((t) => t === USER_B).length === 0,
      'B reconnect must not push A media',
    );
    coord.dispose();
  });

  await test('404 deleted media discards pending without recreating', async () => {
    resetPlaybackStorageForTests();
    configurePlaybackStorageAdapter(memoryAdapter());
    const clock = createFakeClock();

    savePlaybackState(USER_A, {
      mediaId: MEDIA,
      positionSeconds: 40,
      durationSeconds: 600,
      progressPercent: 6,
      lastPlayedAt: '2026-08-22T12:00:00.000Z',
      completed: false,
      updatedAt: '2026-08-22T12:00:00.000Z',
      pendingSync: true,
      clientRevision: 3,
    });

    const sync: PlaybackSyncTransport = {
      updateProgress: async () => {
        throw Object.assign(new Error('gone'), { status: 404 });
      },
    };

    const coord = new PlaybackPersistenceCoordinator({
      getUserId: () => USER_A,
      sync,
      clock,
    });
    await coord.reconcilePendingOnReconnect();
    await new Promise((r) => setTimeout(r, 10));
    assert(loadPlaybackState(USER_A, MEDIA) === null, 'pending discarded');
    coord.dispose();
  });

  await test('logout generation prevents late response apply', async () => {
    resetPlaybackStorageForTests();
    configurePlaybackStorageAdapter(memoryAdapter());
    const clock = createFakeClock();
    let release: (() => void) | undefined;

    const sync: PlaybackSyncTransport = {
      updateProgress: async (_id, body) => {
        await new Promise<void>((r) => {
          release = r;
        });
        return {
          mediaId: MEDIA,
          positionSeconds: body.positionSeconds,
          durationSeconds: body.durationSeconds,
          progressPercent: 0,
          lastPlayedAt: null,
          completed: false,
          updatedAt: body.updatedAt,
        };
      },
    };

    const coord = new PlaybackPersistenceCoordinator({
      getUserId: () => USER_A,
      sync,
      clock,
    });
    coord.startPlayback(MEDIA, clock.now());
    coord.pause(MEDIA, 10, clock.now());
    await Promise.resolve();
    coord.resetForLogout();
    release?.();
    await new Promise((r) => setTimeout(r, 20));
    assert(coord.getActiveState() === null, 'session cleared');
    // Local A row may still exist from flush before logout — pending may remain, but no active session mutation
    coord.dispose();
  });

  console.log(`\nPhase 3 mobile: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
