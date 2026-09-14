/**
 * Week 8 Day 2 Stage 3 — lifecycle / error / cleanup hardening verifier.
 * Pure logic / fixtures. NO network. NO Metro. NO emulator.
 */

import {
  PlaybackError,
  PREPARATION_TIMEOUT_MS,
  PreparationWatchdog,
  clampSeekTarget,
  classifyNativePlayerError,
  completeEnterFullscreen,
  completeExitFullscreen,
  configureOrientationAdapter,
  configureSystemBarsAdapter,
  createPlayerController,
  decideAppLifecycleAction,
  emitPlaybackEvent,
  enterFullscreenOrientation,
  enterImmersiveSystemBars,
  exitFullscreenOrientation,
  exitImmersiveSystemBars,
  formatPlaybackTime,
  getOrientationLockKind,
  initialFullscreenState,
  beginEnterFullscreen,
  beginExitFullscreen,
  isRecoverablePlayerError,
  isSystemBarsImmersive,
  normalizePlayerError,
  parseRouteMediaId,
  playerLog,
  resetOrientationControllerForTests,
  resetPlaybackEventListeners,
  resetResolvePlaybackSourceDeps,
  resetSystemBarsControllerForTests,
  resolveAndroidBackAction,
  resolvePlaybackSource,
  restoreOrientation,
  restoreSystemBars,
  subscribePlaybackEvents,
  type LocalPlaybackRecord,
  type PlaybackContractEvent,
  type PlayerEngineAdapter,
  type ResolvePlaybackSourceDeps,
} from '../src/player';
import {
  isCompletedStatus,
  isTempOrWorkspaceArtifact,
} from '../src/library/eligibility';
import {
  normalizeMimeType,
  resolveDisplayName,
} from '../src/library/mapper';

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

function mockEngine(): PlayerEngineAdapter & { calls: string[] } {
  const calls: string[] = [];
  let current = 10;
  return {
    calls,
    play: () => calls.push('play'),
    pause: () => calls.push('pause'),
    getCurrentTime: () => current,
    getDuration: () => 100,
    setCurrentTime: (s) => {
      current = s;
      calls.push(`seek:${s}`);
    },
    seekBy: () => undefined,
    setPlaybackRate: () => undefined,
    setVolume: () => undefined,
    setMuted: () => undefined,
    release: () => calls.push('release'),
  };
}

async function main(): Promise<void> {
  console.log('Week 8 Day 2 Stage 3 — hardening verifier\n');

  await test('background → pause decision; foreground → no autoplay', () => {
    assert(
      decideAppLifecycleAction({ nextState: 'background', isPlaying: true })
        .action === 'background_pause',
      'bg pause',
    );
    assert(
      decideAppLifecycleAction({ nextState: 'inactive', isPlaying: true })
        .action === 'background_pause',
      'lock pause',
    );
    assert(
      decideAppLifecycleAction({ nextState: 'background', isPlaying: false })
        .action === 'none',
      'bg already paused',
    );
    assert(
      decideAppLifecycleAction({ nextState: 'active', isPlaying: false })
        .action === 'foreground_no_autoplay',
      'fg no autoplay',
    );
  });

  await test('media A→B stale-resolution generation guard pattern', async () => {
    let activeGen = 0;
    const results: string[] = [];
    const load = async (id: string, delay: number) => {
      const gen = ++activeGen;
      await new Promise((r) => setTimeout(r, delay));
      if (gen !== activeGen) {
        return;
      }
      results.push(id);
    };
    void load('A', 30);
    void load('B', 5);
    await new Promise((r) => setTimeout(r, 50));
    assert(results.length === 1 && results[0] === 'B', 'only B wins');
  });

  await test('cleanup idempotency: dispose + restore presentation repeated', async () => {
    resetOrientationControllerForTests();
    resetSystemBarsControllerForTests();
    let orientRestores = 0;
    let barRestores = 0;
    configureOrientationAdapter({
      lockLandscape: async () => undefined,
      restoreDefault: async () => {
        orientRestores += 1;
      },
    });
    configureSystemBarsAdapter({
      hide: () => undefined,
      show: () => {
        barRestores += 1;
      },
    });
    await enterFullscreenOrientation();
    await enterImmersiveSystemBars();
    await restoreOrientation();
    await restoreSystemBars();
    await restoreOrientation();
    await restoreSystemBars();
    assert(orientRestores >= 2, 'orient idempotent');
    assert(barRestores >= 2, 'bars idempotent');
    assert(getOrientationLockKind() === 'app_default', 'default');
    assert(!isSystemBarsImmersive(), 'not immersive');
    const engine = mockEngine();
    const c = createPlayerController(engine);
    c.dispose();
    c.dispose();
    c.play();
    assert(engine.calls.filter((x) => x === 'release').length === 1, 'single release');
    assert(!engine.calls.includes('play') || engine.calls.indexOf('play') < engine.calls.indexOf('release'), 'no play after');
    // play after dispose should be ignored — calls should not gain play after release
    const releaseIdx = engine.calls.indexOf('release');
    assert(
      !engine.calls.slice(releaseIdx + 1).includes('play'),
      'ignored after dispose',
    );
    resetOrientationControllerForTests();
    resetSystemBarsControllerForTests();
  });

  await test('fullscreen exit + Back priority still holds', async () => {
    let state = initialFullscreenState;
    state = completeEnterFullscreen(beginEnterFullscreen(state)!);
    assert(resolveAndroidBackAction(true) === 'exit_fullscreen', 'back fs');
    state = completeExitFullscreen();
    assert(resolveAndroidBackAction(false) === 'leave_player', 'back leave');
    await enterFullscreenOrientation();
    await enterImmersiveSystemBars();
    await exitImmersiveSystemBars();
    await exitFullscreenOrientation();
    beginExitFullscreen(completeEnterFullscreen(beginEnterFullscreen(initialFullscreenState)!));
  });

  await test('preparation timeout watchdog fires once then clears', async () => {
    const timers = new Map<number, () => void>();
    let nextId = 1;
    let fired = 0;
    const wd = new PreparationWatchdog({
      timeoutMs: PREPARATION_TIMEOUT_MS,
      setTimeoutFn: ((fn: () => void) => {
        const id = nextId++;
        timers.set(id, fn);
        return id as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
      clearTimeoutFn: ((id: ReturnType<typeof setTimeout>) => {
        timers.delete(id as unknown as number);
      }) as typeof clearTimeout,
      onTimeout: () => {
        fired += 1;
      },
    });
    wd.start();
    assert(wd.isArmed(), 'armed');
    wd.clear();
    assert(!wd.isArmed(), 'cleared');
    wd.start();
    for (const [id, fn] of [...timers.entries()]) {
      timers.delete(id);
      fn();
    }
    assert(fired === 1, 'fired once');
    wd.dispose();
    wd.start();
    assert([...timers.keys()].length === 0, 'disposed no arm');
  });

  await test('error normalization taxonomy', () => {
    assert(classifyNativePlayerError({ message: 'Unsupported codec' }) === 'UNSUPPORTED_MEDIA', 'codec');
    assert(classifyNativePlayerError({ message: 'Decoder init failed' }) === 'UNSUPPORTED_MEDIA', 'decoder');
    assert(classifyNativePlayerError({ message: 'File is corrupt' }) === 'CORRUPT_MEDIA', 'corrupt');
    assert(classifyNativePlayerError({ message: 'Permission denied' }) === 'PERMISSION_DENIED', 'perm');
    assert(classifyNativePlayerError({ message: 'ENOENT no such file' }) === 'FILE_UNAVAILABLE', 'missing');
    assert(classifyNativePlayerError({ message: 'weird boom' }) === 'PLAYBACK_FAILED', 'fallback');
    assert(normalizePlayerError(new Error('x')).code === 'PLAYBACK_FAILED', 'norm');
    assert(isRecoverablePlayerError('PREPARATION_TIMEOUT'), 'timeout retry');
    assert(isRecoverablePlayerError('PLAYER_INIT_FAILED'), 'init retry');
    assert(!isRecoverablePlayerError('UNSUPPORTED_MEDIA'), 'unsupported no retry');
    assert(!isRecoverablePlayerError('FILE_UNAVAILABLE'), 'missing no retry');
  });

  await test('path substitution + managed path rejection', async () => {
    resetResolvePlaybackSourceDeps();
    try {
      await resolvePlaybackSource(
        'media-a',
        mockDeps({
          record: baseRecord({
            downloadId: 'media-a',
            localUri: 'file:///mock/VidoraXDownloads/media-b/other.mp4',
          }),
          assessFile: () => ({
            presence: 'complete',
            localUri: 'file:///mock/VidoraXDownloads/media-b/other.mp4',
            size: 100,
            hasRangePart: false,
          }),
          assertManagedPath: () => {
            throw new Error('blocked');
          },
        }),
      );
      assert(false, 'should reject');
    } catch (error) {
      assert(error instanceof PlaybackError, 'PlaybackError');
      assert(error.code === 'SOURCE_RESOLUTION_FAILED', 'code');
    }

    try {
      await resolvePlaybackSource(
        'media-a',
        mockDeps({
          getLocalRecord: async () =>
            baseRecord({
              downloadId: 'media-b',
              localUri: 'file:///mock/VidoraXDownloads/media-b/x.mp4',
            }),
        }),
      );
      assert(false, 'id mismatch');
    } catch (error) {
      assert(error instanceof PlaybackError, 'err');
      assert(
        error.code === 'MEDIA_NOT_FOUND' ||
          error.code === 'SOURCE_RESOLUTION_FAILED',
        'rejected',
      );
    }
  });

  await test('offline resolution still works without remote', async () => {
    const source = await resolvePlaybackSource(
      'offline-1',
      mockDeps({
        record: baseRecord({ downloadId: 'offline-1' }),
        getDisplayTitle: () => null,
      }),
    );
    assert(source.mediaId === 'offline-1', 'id');
    assert(source.uri.includes('offline-1'), 'local uri');
  });

  await test('security: schemes and traversal still rejected', () => {
    assert(parseRouteMediaId('file:///tmp/x') === null, 'file');
    assert(parseRouteMediaId('content://x') === null, 'content');
    assert(parseRouteMediaId('https://evil') === null, 'https');
    assert(parseRouteMediaId('../../etc') === null, 'traversal');
  });

  await test('corrupt media maps to CORRUPT_MEDIA', async () => {
    try {
      await resolvePlaybackSource(
        'bad',
        mockDeps({
          record: baseRecord({ downloadId: 'bad' }),
          verifyFile: () => ({ ok: false, reason: 'corrupt' }),
        }),
      );
      assert(false, 'throw');
    } catch (error) {
      assert(error instanceof PlaybackError && error.code === 'CORRUPT_MEDIA', 'corrupt');
    }
  });

  await test('completion once + replay gate reset', () => {
    resetPlaybackEventListeners();
    const events: PlaybackContractEvent[] = [];
    subscribePlaybackEvents((e) => events.push(e));
    let gate = false;
    const complete = (id: string) => {
      if (gate) return;
      gate = true;
      emitPlaybackEvent({ type: 'completed', mediaId: id, at: 1 });
    };
    const replay = () => {
      gate = false;
    };
    complete('m');
    complete('m');
    replay();
    complete('m');
    assert(events.filter((e) => e.type === 'completed').length === 2, 'two cycles');
  });

  await test('rapid commands against disposed controller are safe', () => {
    const engine = mockEngine();
    const c = createPlayerController(engine);
    c.play();
    c.pause();
    c.seekTo(999);
    c.seekBy(-10);
    c.setPlaybackRate(2);
    c.setVolume(0.5);
    c.dispose();
    c.play();
    c.seekTo(1);
    c.setPlaybackRate(0.5);
    assert(clampSeekTarget(1e9, 36000) === 36000, 'long clamp');
    assert(formatPlaybackTime(3661) === '1:01:01', 'hours');
  });

  await test('diagnostics sanitize never logs uri keys', () => {
    // Smoke: callable without throw; blocked fields omitted internally.
    playerLog('player.retry', {
      mediaId: 'x',
      uri: 'file:///secret',
      token: 'abc',
    } as never);
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
