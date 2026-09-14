/**
 * Week 8 Day 3 Phase 1 — Durable Playback State Core (mobile).
 * Pure logic / fake clocks / injectable storage. NO network. NO Metro.
 *
 * Usage (from mobile/):
 *   npx tsx scripts/verify-week8-day3-phase1.ts
 */

import {
  computeProgressPercent,
  configurePlaybackStorageAdapter,
  isNearEndComplete,
  isValidProgressNumbers,
  loadPlaybackState,
  PlaybackPersistenceCoordinator,
  resetPlaybackStorageForTests,
  resolveCompletedState,
  savePlaybackState,
  type PlaybackStorageAdapter,
  type PlaybackSyncTransport,
} from '../src/playback';
import {
  emitPlaybackEvent,
  resetPlaybackEventListeners,
  subscribePlaybackEvents,
} from '../src/player/playback-events';

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

function createMemoryAdapter(): PlaybackStorageAdapter & {
  store: Map<string, string>;
} {
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
    set: (ms: number) => {
      now = ms;
    },
  };
}

const USER = 'user-a-1111-1111-1111-111111111111';
const MEDIA = 'media-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

async function main(): Promise<void> {
  console.log('Week 8 Day 3 Phase 1 — mobile playback persistence verifier\n');

  await test('domain: progress 0 duration → 0%', () => {
    assert(computeProgressPercent(10, 0) === 0, 'zero duration');
  });

  await test('domain: progress clamp 0–100', () => {
    assert(computeProgressPercent(50, 100) === 50, 'mid');
    assert(computeProgressPercent(200, 100) === 100, 'over 100');
    assert(computeProgressPercent(-5, 100) === 0, 'negative pos → 0%');
  });

  await test('domain: reject invalid numbers', () => {
    assert(!isValidProgressNumbers(-1, 10), 'neg position');
    assert(!isValidProgressNumbers(10, -1), 'neg duration');
    assert(!isValidProgressNumbers(Number.NaN, 10), 'NaN');
    assert(!isValidProgressNumbers(10, Number.POSITIVE_INFINITY), 'Infinity');
    assert(!isValidProgressNumbers(105, 100), 'far beyond duration');
    assert(isValidProgressNumbers(101.5, 100), 'small tolerance ok');
  });

  await test('domain: completion threshold + short video guard', () => {
    assert(
      isNearEndComplete({ positionSeconds: 95, durationSeconds: 100 }),
      '95%',
    );
    assert(
      isNearEndComplete({ positionSeconds: 1770, durationSeconds: 1800 }),
      'remaining ≤30 on long',
    );
    assert(
      !isNearEndComplete({ positionSeconds: 15, durationSeconds: 20 }),
      'short video remaining must not auto-complete',
    );
    assert(
      isNearEndComplete({ positionSeconds: 19.1, durationSeconds: 20 }),
      'short video still completes at 95%',
    );
  });

  await test('domain: completed never downgraded by stale progress', () => {
    assert(
      resolveCompletedState({
        positionSeconds: 10,
        durationSeconds: 100,
        existingCompleted: true,
      }) === true,
      'keep completed',
    );
    assert(
      resolveCompletedState({
        positionSeconds: 10,
        durationSeconds: 100,
        markCompleted: true,
      }) === true,
      'native complete',
    );
  });

  await test('local persistence: save / reload / flags', () => {
    resetPlaybackStorageForTests();
    const adapter = createMemoryAdapter();
    configurePlaybackStorageAdapter(adapter);

    const saved = savePlaybackState(USER, {
      mediaId: MEDIA,
      positionSeconds: 42,
      durationSeconds: 200,
      progressPercent: 0,
      lastPlayedAt: '2026-08-22T10:00:00.000Z',
      completed: false,
      updatedAt: '2026-08-22T10:01:00.000Z',
      pendingSync: true,
    });

    assert(saved.progressPercent === 21, `percent derived ${saved.progressPercent}`);
    const loaded = loadPlaybackState(USER, MEDIA);
    assert(loaded !== null, 'loaded');
    assert(loaded!.positionSeconds === 42, 'position');
    assert(loaded!.pendingSync === true, 'pendingSync');
    assert(loaded!.completed === false, 'completed false');

    savePlaybackState(USER, { ...loaded!, completed: true, pendingSync: false });
    const again = loadPlaybackState(USER, MEDIA);
    assert(again?.completed === true, 'completed survives');
    assert(again?.pendingSync === false, 'pendingSync false survives');
  });

  await test('coordinator: started → lastPlayedAt + local persist', async () => {
    resetPlaybackStorageForTests();
    const adapter = createMemoryAdapter();
    configurePlaybackStorageAdapter(adapter);
    const clock = createFakeClock();
    const puts: unknown[] = [];

    const sync: PlaybackSyncTransport = {
      updateProgress: async (mediaId, body) => {
        puts.push({ mediaId, body });
        return {};
      },
    };

    const coord = new PlaybackPersistenceCoordinator({
      getUserId: () => USER,
      sync,
      clock,
      localPersistIntervalMs: 5_000,
      backendSyncIntervalMs: 15_000,
    });

    coord.startPlayback(MEDIA, clock.now());
    const local = loadPlaybackState(USER, MEDIA);
    assert(local?.lastPlayedAt != null, 'lastPlayedAt set on start');
    assert(local?.pendingSync === true, 'pending after start');

    coord.dispose();
  });

  await test('coordinator: position throttle local 5s / backend 15s', async () => {
    resetPlaybackStorageForTests();
    configurePlaybackStorageAdapter(createMemoryAdapter());
    const clock = createFakeClock();
    const puts: Array<{ at: number; pos: number }> = [];

    const sync: PlaybackSyncTransport = {
      updateProgress: async (_mediaId, body) => {
        puts.push({ at: clock.now(), pos: body.positionSeconds });
        return {};
      },
    };

    const coord = new PlaybackPersistenceCoordinator({
      getUserId: () => USER,
      sync,
      clock,
      localPersistIntervalMs: 5_000,
      backendSyncIntervalMs: 15_000,
    });

    coord.startPlayback(MEDIA, clock.now());
    // Drain start sync scheduled at 15s — use flush later.

    clock.advance(1_000);
    coord.updatePosition(MEDIA, 10, 100, clock.now());
    clock.advance(1_000);
    coord.updatePosition(MEDIA, 20, 100, clock.now());
    clock.advance(1_000);
    coord.updatePosition(MEDIA, 30, 100, clock.now());

    // Before 5s from last mandatory persist at start: local may still be start state
    // unless timer fired — advance past local interval and flush timers via flush.
    clock.advance(5_000);
    coord.flush();

    // Allow microtask for async sync
    await Promise.resolve();
    await Promise.resolve();

    assert(puts.length >= 1, `expected ≥1 put, got ${puts.length}`);
    const last = puts[puts.length - 1]!;
    assert(last.pos === 30, `coalesced to latest pos ${last.pos}`);

    const local = loadPlaybackState(USER, MEDIA);
    assert(local?.positionSeconds === 30, 'local flushed to 30');

    coord.dispose();
  });

  await test('coordinator: pause / exit / background / complete flush', async () => {
    resetPlaybackStorageForTests();
    configurePlaybackStorageAdapter(createMemoryAdapter());
    const clock = createFakeClock();
    let putCount = 0;
    const sync: PlaybackSyncTransport = {
      updateProgress: async () => {
        putCount += 1;
        return {};
      },
    };

    const coord = new PlaybackPersistenceCoordinator({
      getUserId: () => USER,
      sync,
      clock,
      localPersistIntervalMs: 60_000,
      backendSyncIntervalMs: 60_000,
    });

    coord.startPlayback(MEDIA, clock.now());
    await Promise.resolve();
    putCount = 0;

    coord.updatePosition(MEDIA, 50, 100, clock.now());
    coord.pause(MEDIA, 55, clock.now());
    await Promise.resolve();
    await Promise.resolve();
    assert(loadPlaybackState(USER, MEDIA)?.positionSeconds === 55, 'pause flush');
    assert(putCount >= 1, 'pause remote flush');

    putCount = 0;
    coord.updatePosition(MEDIA, 60, 100, clock.now());
    coord.exit(MEDIA, 62, clock.now());
    await Promise.resolve();
    await Promise.resolve();
    assert(loadPlaybackState(USER, MEDIA)?.positionSeconds === 62, 'exit flush');

    putCount = 0;
    coord.updatePosition(MEDIA, 70, 100, clock.now());
    coord.background();
    await Promise.resolve();
    await Promise.resolve();
    assert(loadPlaybackState(USER, MEDIA)?.positionSeconds === 70, 'bg flush');

    coord.complete(MEDIA, clock.now());
    await Promise.resolve();
    await Promise.resolve();
    assert(loadPlaybackState(USER, MEDIA)?.completed === true, 'completed');

    coord.dispose();
  });

  await test('coordinator: offline → pendingSync, no throw', async () => {
    resetPlaybackStorageForTests();
    configurePlaybackStorageAdapter(createMemoryAdapter());
    const clock = createFakeClock();
    const sync: PlaybackSyncTransport = {
      updateProgress: async () => {
        throw Object.assign(new Error('network'), { status: null, code: 'NETWORK_ERROR' });
      },
    };

    const coord = new PlaybackPersistenceCoordinator({
      getUserId: () => USER,
      sync,
      clock,
      localPersistIntervalMs: 5_000,
      backendSyncIntervalMs: 1,
    });

    coord.startPlayback(MEDIA, clock.now());
    coord.updatePosition(MEDIA, 12, 100, clock.now());
    coord.flush();
    await Promise.resolve();
    await Promise.resolve();

    const local = loadPlaybackState(USER, MEDIA);
    assert(local?.positionSeconds === 12, 'local survives');
    assert(local?.pendingSync === true, 'pendingSync');

    // Further events must not throw
    coord.updatePosition(MEDIA, 20, 100, clock.now());
    coord.pause(MEDIA, 20, clock.now());
    await Promise.resolve();

    coord.dispose();
  });

  await test('coordinator: in-flight coalesce keeps latest', async () => {
    resetPlaybackStorageForTests();
    configurePlaybackStorageAdapter(createMemoryAdapter());
    const clock = createFakeClock();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const puts: number[] = [];
    let inflight = 0;
    let completed = 0;

    const sync: PlaybackSyncTransport = {
      updateProgress: async (_id, body) => {
        puts.push(body.positionSeconds);
        inflight += 1;
        await gate;
        completed += 1;
        return {};
      },
    };

    const coord = new PlaybackPersistenceCoordinator({
      getUserId: () => USER,
      sync,
      clock,
      localPersistIntervalMs: 60_000,
      backendSyncIntervalMs: 60_000,
    });

    coord.startPlayback(MEDIA, clock.now());
    coord.updatePosition(MEDIA, 100, 200, clock.now());
    coord.flush();
    await Promise.resolve();
    assert(inflight === 1, 'first request in flight');

    coord.updatePosition(MEDIA, 115, 200, clock.now());
    coord.flush();
    await Promise.resolve();
    assert(inflight === 1, 'no parallel second request');

    release();
    // Drain deferred follow-up sync.
    for (let i = 0; i < 20; i += 1) {
      await Promise.resolve();
      if (puts.includes(115) && completed >= 2) {
        break;
      }
    }

    assert(puts.includes(100), 'first send');
    assert(puts.includes(115), `latest missing in ${puts.join(',')}`);

    coord.dispose();
  });

  await test('event binding: single subscriber via playback event bus', async () => {
    resetPlaybackStorageForTests();
    resetPlaybackEventListeners();
    configurePlaybackStorageAdapter(createMemoryAdapter());
    const clock = createFakeClock();

    const coord = new PlaybackPersistenceCoordinator({
      getUserId: () => USER,
      sync: {
        updateProgress: async () => ({}),
      },
      clock,
      localPersistIntervalMs: 5_000,
      backendSyncIntervalMs: 60_000,
      subscribeAppState: () => () => undefined,
    });

    const unsub = subscribePlaybackEvents((event) => {
      coord.handleEvent(event);
    });

    emitPlaybackEvent({
      type: 'playbackStarted',
      mediaId: MEDIA,
      at: clock.now(),
    });
    emitPlaybackEvent({
      type: 'positionChanged',
      mediaId: MEDIA,
      positionSeconds: 5,
      durationSeconds: 50,
      at: clock.now(),
    });
    emitPlaybackEvent({
      type: 'paused',
      mediaId: MEDIA,
      positionSeconds: 5,
      at: clock.now(),
    });
    await Promise.resolve();
    await Promise.resolve();

    const local = loadPlaybackState(USER, MEDIA);
    assert(local?.lastPlayedAt != null, 'started via bus');
    assert(local?.positionSeconds === 5, 'paused flush via bus');

    unsub();
    coord.dispose();
    resetPlaybackEventListeners();
  });

  await test('logout reset clears in-memory session (no cross-account send)', async () => {
    resetPlaybackStorageForTests();
    configurePlaybackStorageAdapter(createMemoryAdapter());
    const clock = createFakeClock();
    let currentUser: string | null = USER;
    const puts: string[] = [];

    const coord = new PlaybackPersistenceCoordinator({
      getUserId: () => currentUser,
      sync: {
        updateProgress: async (mediaId) => {
          puts.push(`${currentUser}:${mediaId}`);
          return {};
        },
      },
      clock,
      backendSyncIntervalMs: 60_000,
      localPersistIntervalMs: 60_000,
    });

    coord.startPlayback(MEDIA, clock.now());
    coord.updatePosition(MEDIA, 10, 100, clock.now());
    coord.resetForLogout();
    currentUser = 'user-b';
    coord.flush();
    await Promise.resolve();

    assert(
      !puts.some((p) => p.startsWith('user-b:')),
      'no flush under next account without new session',
    );
    coord.dispose();
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

void main();
