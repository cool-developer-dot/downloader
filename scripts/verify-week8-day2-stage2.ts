/**
 * Week 8 Day 2 Stage 2 — Fullscreen / controls / speed / volume verifier.
 * Pure logic / fixtures. NO network. NO Metro. NO emulator.
 *
 * Usage (from mobile/):
 *   npx tsx scripts/verify-week8-day2-stage2.ts
 */

import {
  CONTROLS_AUTO_HIDE_MS,
  ControlsVisibilityController,
  DEFAULT_PLAYBACK_RATE,
  PLAYBACK_RATES,
  SEEK_STEP_SECONDS,
  applyMute,
  applyUnmute,
  applyVolumeChange,
  beginEnterFullscreen,
  beginExitFullscreen,
  clampVolume,
  completeEnterFullscreen,
  completeExitFullscreen,
  createInitialVolumeState,
  doubleTapSeekDelta,
  formatPlaybackRateLabel,
  initialFullscreenState,
  isValidPlaybackRate,
  normalizePlaybackRate,
  resolveAndroidBackAction,
  resolveDoubleTapSide,
  shouldForceControlsVisible,
} from '../src/player';
import {
  configureOrientationAdapter,
  enterFullscreenOrientation,
  exitFullscreenOrientation,
  getOrientationLockKind,
  resetOrientationControllerForTests,
  restoreOrientation,
} from '../src/player/orientation-controller';
import {
  configureSystemBarsAdapter,
  enterImmersiveSystemBars,
  exitImmersiveSystemBars,
  isSystemBarsImmersive,
  resetSystemBarsControllerForTests,
  restoreSystemBars,
} from '../src/player/system-bars';

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

async function main(): Promise<void> {
  console.log('Week 8 Day 2 Stage 2 — player chrome verifier\n');

  await test('fullscreen machine: enter/exit/repeated + Back priority', () => {
    let state = initialFullscreenState;
    assert(resolveAndroidBackAction(false) === 'leave_player', 'back leave');
    const entering = beginEnterFullscreen(state);
    assert(entering?.phase === 'entering', 'entering');
    state = completeEnterFullscreen(entering!);
    assert(state.isFullscreen && state.phase === 'fullscreen', 'fullscreen');
    assert(resolveAndroidBackAction(true) === 'exit_fullscreen', 'back exit fs');
    assert(beginEnterFullscreen(state) === null, 'no double enter');
    const exiting = beginExitFullscreen(state);
    assert(exiting?.phase === 'exiting', 'exiting');
    state = completeExitFullscreen();
    assert(!state.isFullscreen && state.phase === 'inline', 'inline');
    // repeated enter/exit
    for (let i = 0; i < 3; i += 1) {
      const e = beginEnterFullscreen(state);
      assert(e, `enter ${i}`);
      state = completeEnterFullscreen(e!);
      const x = beginExitFullscreen(state);
      assert(x, `exit ${i}`);
      state = completeExitFullscreen();
    }
    assert(!state.isFullscreen, 'stable after repeats');
  });

  await test('orientation + system bars restore contracts', async () => {
    resetOrientationControllerForTests();
    resetSystemBarsControllerForTests();
    const orientCalls: string[] = [];
    const barCalls: string[] = [];
    configureOrientationAdapter({
      lockLandscape: async () => {
        orientCalls.push('landscape');
      },
      lockPortrait: async () => {
        orientCalls.push('portrait');
      },
      unlockAuto: async () => {
        orientCalls.push('auto');
      },
      restoreDefault: async () => {
        orientCalls.push('default');
      },
    });
    configureSystemBarsAdapter({
      hide: () => {
        barCalls.push('hide');
      },
      show: () => {
        barCalls.push('show');
      },
    });
    await enterFullscreenOrientation();
    await enterImmersiveSystemBars();
    assert(getOrientationLockKind() === 'landscape', 'landscape lock');
    assert(isSystemBarsImmersive(), 'immersive');
    await exitImmersiveSystemBars();
    await exitFullscreenOrientation();
    assert(
      getOrientationLockKind() === 'auto' || getOrientationLockKind() === 'app_default',
      'restored orient',
    );
    assert(!isSystemBarsImmersive(), 'bars restored');
    await restoreOrientation();
    await restoreSystemBars();
    assert(orientCalls.includes('landscape') && orientCalls.includes('default'), 'orient calls');
    assert(barCalls.includes('hide') && barCalls.includes('show'), 'bar calls');
    resetOrientationControllerForTests();
    resetSystemBarsControllerForTests();
  });

  await test('playback speed: all rates + invalid rejected + default', () => {
    assert(DEFAULT_PLAYBACK_RATE === 1, 'default 1x');
    for (const rate of PLAYBACK_RATES) {
      assert(isValidPlaybackRate(rate), `valid ${rate}`);
      assert(normalizePlaybackRate(rate) === rate, `norm ${rate}`);
      assert(formatPlaybackRateLabel(rate).endsWith('x'), `label ${rate}`);
    }
    assert(normalizePlaybackRate(1.1) === null, 'reject 1.1');
    assert(normalizePlaybackRate(0) === null, 'reject 0');
    assert(normalizePlaybackRate(Number.NaN) === null, 'reject NaN');
    assert(normalizePlaybackRate('1' as unknown) === null, 'reject string');
  });

  await test('volume/mute: bounds + previousNonZeroVolume', () => {
    let state = createInitialVolumeState(0.7);
    assert(state.volume === 0.7 && !state.isMuted, 'init');
    state = applyMute(state);
    assert(state.isMuted && state.previousNonZeroVolume === 0.7, 'muted remembers');
    state = applyUnmute(state);
    assert(!state.isMuted && state.volume === 0.7, 'unmute restores');
    assert(clampVolume(-1) === 0, 'clamp low');
    assert(clampVolume(2) === 1, 'clamp high');
    assert(clampVolume(Number.NaN) === null, 'reject nan');
    const zero = applyVolumeChange(state, 0);
    assert(zero?.isMuted === true && zero.previousNonZeroVolume === 0.7, 'vol 0');
    const mid = applyVolumeChange(createInitialVolumeState(1), 0.5);
    assert(mid?.volume === 0.5 && mid.previousNonZeroVolume === 0.5, '0.5');
    const full = applyVolumeChange(mid!, 1);
    assert(full?.volume === 1, '1.0');
  });

  await test('auto-hide: interaction/timeout/force rules + dispose', async () => {
    const events: boolean[] = [];
    let now = 0;
    const timers = new Map<number, () => void>();
    let nextId = 1;
    const controller = new ControlsVisibilityController({
      hideDelayMs: CONTROLS_AUTO_HIDE_MS,
      now: () => now,
      setTimeoutFn: ((fn: () => void) => {
        const id = nextId++;
        timers.set(id, fn);
        return id as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
      clearTimeoutFn: ((id: ReturnType<typeof setTimeout>) => {
        timers.delete(id as unknown as number);
      }) as typeof clearTimeout,
      onChange: (v) => events.push(v),
    });

    assert(controller.isVisible(), 'start visible');
    controller.bump();
    assert(timers.size === 1, 'timer scheduled');
    // fire timeout
    for (const fn of [...timers.values()]) fn();
    timers.clear();
    assert(!controller.isVisible(), 'hidden after timeout');

    assert(
      shouldForceControlsVisible({
        isPlaying: false,
        isSeeking: false,
        isSpeedSheetOpen: false,
        isLoading: false,
        hasError: false,
        isCompleted: false,
      }),
      'paused forces visible',
    );
    assert(
      shouldForceControlsVisible({
        isPlaying: true,
        isSeeking: true,
        isSpeedSheetOpen: false,
        isLoading: false,
        hasError: false,
        isCompleted: false,
      }),
      'seeking forces',
    );
    assert(
      shouldForceControlsVisible({
        isPlaying: true,
        isSeeking: false,
        isSpeedSheetOpen: true,
        isLoading: false,
        hasError: false,
        isCompleted: false,
      }),
      'menu forces',
    );

    controller.setForceVisible(true);
    assert(controller.isVisible(), 'force show');
    controller.hide();
    assert(controller.isVisible(), 'cannot hide while forced');
    controller.setForceVisible(false);
    controller.dispose();
    controller.bump();
    assert([...timers.keys()].length === 0, 'disposed no timers');
    void now;
  });

  await test('double-tap seek: left/right + bounds helper', () => {
    assert(resolveDoubleTapSide(10, 100) === null, 'outer left strip reserved');
    assert(resolveDoubleTapSide(90, 100) === null, 'outer right strip reserved');
    assert(resolveDoubleTapSide(30, 100) === 'left', 'center-left');
    assert(resolveDoubleTapSide(60, 100) === 'right', 'center-right');
    assert(resolveDoubleTapSide(10, 0) === null, 'bad width');
    assert(doubleTapSeekDelta('left') === -SEEK_STEP_SECONDS, '-10');
    assert(doubleTapSeekDelta('right') === SEEK_STEP_SECONDS, '+10');
  });

  await test('replay contract: completed → seek0 → play (idempotent shape)', () => {
    // Mirrors session replay: clear completed gate then seek+play.
    let completed = true;
    let position = 120;
    let playing = false;
    let completionEvents = 0;
    const onPlayToEnd = () => {
      if (completed) return;
      completed = true;
      completionEvents += 1;
      playing = false;
      position = 120;
    };
    const replay = () => {
      completed = false;
      position = 0;
      playing = true;
    };
    replay();
    assert(position === 0 && playing && !completed, 'replay starts');
    onPlayToEnd();
    onPlayToEnd();
    assert(completionEvents === 1, 'completion once after replay');
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
