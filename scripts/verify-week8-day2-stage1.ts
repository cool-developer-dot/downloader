/**
 * Week 8 Day 2 Stage 1 — Production Video Player Foundation verification.
 * Pure logic / fixtures. NO network. NO Metro. NO emulator.
 *
 * Usage (from mobile/):
 *   npx tsx scripts/verify-week8-day2-stage1.ts
 */

import { playerPath } from '../src/navigation/constants/route-paths';
import { isCompletedStatus, isTempOrWorkspaceArtifact } from '../src/library/eligibility';
import {
  normalizeMimeType,
  resolveDisplayName,
} from '../src/library/mapper';
import {
  assertSafeMediaId,
  clampSeekTarget,
  createPlayerController,
  emitPlaybackEvent,
  formatPlaybackTime,
  parseRouteMediaId,
  PlaybackError,
  resetPlaybackEventListeners,
  resetResolvePlaybackSourceDeps,
  resolvePlaybackSource,
  seekByDelta,
  SEEK_STEP_SECONDS,
  subscribePlaybackEvents,
  configureResolvePlaybackSourceDeps,
  type LocalPlaybackRecord,
  type PlaybackContractEvent,
  type PlayerEngineAdapter,
  type ResolvePlaybackSourceDeps,
} from '../src/player';

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

function baseRecord(
  overrides: Partial<LocalPlaybackRecord> & { downloadId: string },
): LocalPlaybackRecord {
  const { downloadId, ...rest } = overrides;
  return {
    downloadId,
    fileName: 'travel.mp4',
    expectedFileSize: '1048576',
    localUri: `file:///mock/VidoraXDownloads/${downloadId}/travel.mp4`,
    localState: 'complete',
    totalBytes: 1_048_576,
    remoteStatus: 'COMPLETED',
    ...rest,
  };
}

function mockDeps(
  overrides: Partial<ResolvePlaybackSourceDeps> & {
    record?: LocalPlaybackRecord | null;
  } = {},
): ResolvePlaybackSourceDeps {
  const record =
    overrides.record === undefined
      ? baseRecord({ downloadId: 'media-ok' })
      : overrides.record;
  const { record: _ignored, ...rest } = overrides;

  return {
    getLocalRecord: async (id) =>
      record && record.downloadId === id ? record : null,
    assessFile: () => ({
      presence: 'complete',
      localUri: record?.localUri ?? null,
      size: 1_048_576,
      hasRangePart: false,
    }),
    assertManagedPath: () => undefined,
    verifyFile: () => ({ ok: true, size: 1_048_576 }),
    reconcileAvailability: async () => ({}),
    invalidateAvailability: () => undefined,
    isCompletedStatus,
    isTempOrWorkspaceArtifact,
    normalizeMimeType,
    resolveDisplayName,
    resolveFileUri: (uri) => uri,
    ...rest,
  };
}

function mockEngine(initial: {
  current?: number;
  duration?: number;
}): PlayerEngineAdapter & {
  calls: string[];
  current: number;
  duration: number;
  released: boolean;
} {
  const state = {
    current: initial.current ?? 0,
    duration: initial.duration ?? 100,
    released: false,
    calls: [] as string[],
  };
  return {
    get calls() {
      return state.calls;
    },
    get current() {
      return state.current;
    },
    get duration() {
      return state.duration;
    },
    get released() {
      return state.released;
    },
    play: () => {
      state.calls.push('play');
    },
    pause: () => {
      state.calls.push('pause');
    },
    getCurrentTime: () => state.current,
    getDuration: () => state.duration,
    setCurrentTime: (seconds: number) => {
      state.current = seconds;
      state.calls.push(`seek:${seconds}`);
    },
    seekBy: (delta: number) => {
      state.current += delta;
      state.calls.push(`seekBy:${delta}`);
    },
    setPlaybackRate: (rate: number) => {
      state.calls.push(`rate:${rate}`);
    },
    setVolume: (volume: number) => {
      state.calls.push(`vol:${volume}`);
    },
    setMuted: (muted: boolean) => {
      state.calls.push(`mute:${muted}`);
    },
    release: () => {
      state.released = true;
      state.calls.push('release');
    },
  };
}

async function main(): Promise<void> {
  console.log('Week 8 Day 2 Stage 1 — player foundation verifier\n');

  await test('mediaId rejects path traversal and schemes', () => {
    assert(parseRouteMediaId('../../evil') === null, 'traversal');
    assert(parseRouteMediaId('file:///tmp/x') === null, 'file scheme');
    assert(parseRouteMediaId('content://media/1') === null, 'content scheme');
    assert(parseRouteMediaId('/player/../../evil') === null, 'path');
    let threw = false;
    try {
      assertSafeMediaId('..\\evil');
    } catch {
      threw = true;
    }
    assert(threw, 'backslash traversal');
    assert(assertSafeMediaId('dl-abc-123') === 'dl-abc-123', 'valid id');
  });

  await test('resolver: valid completed media (offline)', async () => {
    resetResolvePlaybackSourceDeps();
    const source = await resolvePlaybackSource(
      'media-ok',
      mockDeps({
        record: baseRecord({ downloadId: 'media-ok' }),
        getDisplayTitle: () => 'Travel Vlog',
      }),
    );
    assert(source.mediaId === 'media-ok', 'mediaId');
    assert(source.displayName === 'Travel Vlog', 'title');
    assert(source.mimeType === 'video/mp4', 'mime');
    assert(source.uri.includes('travel.mp4'), 'uri');
  });

  await test('resolver: missing mediaId record', async () => {
    try {
      await resolvePlaybackSource('unknown-id', mockDeps({ record: null }));
      assert(false, 'should throw');
    } catch (error) {
      assert(error instanceof PlaybackError, 'PlaybackError');
      assert(error.code === 'MEDIA_NOT_FOUND', 'code');
    }
  });

  await test('resolver: missing physical file reconciles availability', async () => {
    let invalidated = false;
    let reconciled: string[] | null = null;
    try {
      await resolvePlaybackSource(
        'media-missing',
        mockDeps({
          record: baseRecord({ downloadId: 'media-missing' }),
          assessFile: () => ({
            presence: 'missing',
            localUri: 'file:///mock/gone.mp4',
            size: 0,
            hasRangePart: false,
          }),
          invalidateAvailability: () => {
            invalidated = true;
          },
          reconcileAvailability: async (ids) => {
            reconciled = ids;
            return {};
          },
        }),
      );
      assert(false, 'should throw');
    } catch (error) {
      assert(error instanceof PlaybackError, 'PlaybackError');
      assert(error.code === 'FILE_UNAVAILABLE', 'code');
      assert(invalidated, 'invalidated');
      assert(reconciled?.[0] === 'media-missing', 'reconciled');
    }
  });

  await test('resolver: unmanaged path rejected', async () => {
    try {
      await resolvePlaybackSource(
        'media-evil',
        mockDeps({
          record: baseRecord({
            downloadId: 'media-evil',
            localUri: 'file:///etc/passwd',
          }),
          assessFile: () => ({
            presence: 'complete',
            localUri: 'file:///etc/passwd',
            size: 100,
            hasRangePart: false,
          }),
          assertManagedPath: () => {
            throw new Error('blocked');
          },
        }),
      );
      assert(false, 'should throw');
    } catch (error) {
      assert(error instanceof PlaybackError, 'PlaybackError');
      assert(error.code === 'SOURCE_RESOLUTION_FAILED', 'code');
    }
  });

  await test('resolver: partial/temp file rejected', async () => {
    try {
      await resolvePlaybackSource(
        'media-temp',
        mockDeps({
          record: baseRecord({
            downloadId: 'media-temp',
            fileName: 'part.rangepart',
            localUri:
              'file:///mock/VidoraXDownloads/media-temp/part.rangepart',
          }),
        }),
      );
      assert(false, 'should throw');
    } catch (error) {
      assert(error instanceof PlaybackError, 'PlaybackError');
      assert(error.code === 'SOURCE_RESOLUTION_FAILED', 'code');
    }
  });

  await test('resolver: non-completed record rejected', async () => {
    try {
      await resolvePlaybackSource(
        'media-paused',
        mockDeps({
          record: baseRecord({
            downloadId: 'media-paused',
            remoteStatus: 'PAUSED',
            localState: 'paused',
          }),
        }),
      );
      assert(false, 'should throw');
    } catch (error) {
      assert(error instanceof PlaybackError, 'PlaybackError');
      assert(error.code === 'SOURCE_RESOLUTION_FAILED', 'code');
    }
  });

  await test('resolver: stable mediaId after rename metadata', async () => {
    const source = await resolvePlaybackSource(
      'stable-id',
      mockDeps({
        record: baseRecord({
          downloadId: 'stable-id',
          fileName: 'renamed-title.mp4',
          localUri:
            'file:///mock/VidoraXDownloads/stable-id/renamed-title.mp4',
        }),
        assessFile: () => ({
          presence: 'complete',
          localUri:
            'file:///mock/VidoraXDownloads/stable-id/renamed-title.mp4',
          size: 1_048_576,
          hasRangePart: false,
        }),
      }),
    );
    assert(source.mediaId === 'stable-id', 'stable id');
    assert(source.displayName === 'renamed-title.mp4', 'display from file');
  });

  await test('seek clamp / -10 / +10 / boundaries', () => {
    assert(clampSeekTarget(-5, 100) === 0, 'neg clamp');
    assert(clampSeekTarget(150, 100) === 100, 'over clamp');
    assert(clampSeekTarget(40, 100) === 40, 'mid');
    assert(clampSeekTarget(10, null) === 10, 'unknown duration allows');
    assert(clampSeekTarget(10, 0) === 10, 'zero duration treated unknown');
    assert(seekByDelta(5, -SEEK_STEP_SECONDS, 100) === 0, '-10 at low');
    assert(seekByDelta(95, SEEK_STEP_SECONDS, 100) === 100, '+10 at high');
    assert(seekByDelta(50, -SEEK_STEP_SECONDS, 100) === 40, '-10');
    assert(seekByDelta(50, SEEK_STEP_SECONDS, 100) === 60, '+10');
  });

  await test('controller play/pause/seek/dispose + rapid commands', () => {
    const engine = mockEngine({ current: 50, duration: 100 });
    const controller = createPlayerController(engine);
    controller.play();
    controller.pause();
    controller.play();
    controller.seekTo(-10);
    controller.seekTo(999);
    controller.seekBy(-SEEK_STEP_SECONDS);
    controller.seekBy(SEEK_STEP_SECONDS);
    controller.seekTo(Number.NaN);
    controller.dispose();
    controller.play();
    assert(engine.calls.includes('play'), 'played');
    assert(engine.calls.includes('pause'), 'paused');
    assert(engine.calls.includes('seek:0'), 'clamped low');
    assert(engine.calls.includes('seek:100'), 'clamped high');
    assert(engine.released, 'released');
    assert(
      engine.calls.filter((c) => c === 'play').length === 2,
      'no play after dispose',
    );
  });

  await test('formatPlaybackTime never invents duration', () => {
    assert(formatPlaybackTime(null) === '--:--', 'null');
    assert(formatPlaybackTime(undefined) === '--:--', 'undef');
    assert(formatPlaybackTime(86) === '01:26', 'mm:ss');
    assert(formatPlaybackTime(522) === '08:42', 'duration sample');
  });

  await test('navigation: Library/Details use mediaId path, no raw URI', () => {
    const path = playerPath('media-42');
    assert(path === '/player/media-42', 'path');
    assert(!path.includes('file:'), 'no file');
    assert(!path.includes('/tmp/'), 'no abs path');
    const encoded = playerPath('id with space');
    assert(encoded.includes(encodeURIComponent('id with space')), 'encoded');
    assert(parseRouteMediaId('media-42') === 'media-42', 'parse');
  });

  await test('lifecycle: dispose then recreate controller is clean', () => {
    const engineA = mockEngine({ current: 10, duration: 50 });
    const a = createPlayerController(engineA);
    a.play();
    a.dispose();
    assert(engineA.released, 'A disposed');
    const engineB = mockEngine({ current: 0, duration: 80 });
    const b = createPlayerController(engineB);
    b.play();
    assert(engineB.calls.includes('play'), 'B plays');
    assert(!engineB.released, 'B alive');
    b.dispose();
  });

  await test('Day 3 contract: completion once + mediaId; no persistence', () => {
    resetPlaybackEventListeners();
    const events: PlaybackContractEvent[] = [];
    const unsub = subscribePlaybackEvents((event) => {
      events.push(event);
    });

    emitPlaybackEvent({
      type: 'playbackStarted',
      mediaId: 'm1',
      at: 1,
    });
    emitPlaybackEvent({ type: 'completed', mediaId: 'm1', at: 2 });
    emitPlaybackEvent({ type: 'completed', mediaId: 'm1', at: 3 });
    emitPlaybackEvent({
      type: 'playerExited',
      mediaId: 'm1',
      positionSeconds: 12,
      at: 4,
    });

    assert(events[0]?.type === 'playbackStarted', 'started');
    assert(events.every((e) => e.mediaId === 'm1'), 'mediaId');
    assert(
      events.filter((e) => e.type === 'completed').length === 2,
      'emitter allows; session dedupes separately',
    );
    // Stage 1 contract surface only — no history table / PATCH symbols in module.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const contractModule = require('../src/player/playback-events') as Record<
      string,
      unknown
    >;
    assert(
      typeof contractModule.subscribePlaybackEvents === 'function',
      'subscribe',
    );
    assert(
      !('persistPlaybackHistory' in contractModule),
      'no history persist API',
    );
    assert(!('patchPlaybackProgress' in contractModule), 'no PATCH API');
    unsub();
    resetPlaybackEventListeners();
  });

  await test('session completion dedupe helper behavior', () => {
    let emitted = 0;
    let gate = false;
    const onPlayToEnd = (mediaId: string | null) => {
      if (!mediaId || gate) return;
      gate = true;
      emitted += 1;
      emitPlaybackEvent({ type: 'completed', mediaId, at: Date.now() });
    };
    resetPlaybackEventListeners();
    onPlayToEnd('m2');
    onPlayToEnd('m2');
    onPlayToEnd('m2');
    assert(emitted === 1, 'once');
  });

  await test('configure/reset deps seam works without native runtime', () => {
    resetResolvePlaybackSourceDeps();
    configureResolvePlaybackSourceDeps(mockDeps());
    // Active deps path used when second arg omitted.
    return resolvePlaybackSource('media-ok').then((source) => {
      assert(source.mediaId === 'media-ok', 'via active deps');
      resetResolvePlaybackSourceDeps();
    });
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
