/**
 * P8 #586 Gesture Sensitivity and #587 Disable Gestures: the settings, the sensitivity maths (Normal is today's mapping
 * bit for bit), and which recogniser on the video is on (with every switch on, exactly what it was before P8).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { brightnessFromSwipe } from './brightness-state.ts';
import {
  DEFAULT_GESTURE_SETTINGS,
  GESTURE_SENSITIVITY_FACTORS,
  SWITCHABLE_GESTURES,
  gestureOn,
  gestureSensitivityFactor,
  gesturesOnCount,
  normalizeGestureSettings,
  scaleSwipeDistance,
  surfaceGestureFlags,
  type GestureSettings,
  type SurfaceGestureFlags,
  type SurfaceGestureState,
} from './gesture-settings.ts';
import { levelFromSwipeDelta } from './level-gesture.ts';
import { clampVolume } from './volume-state.ts';

const volumeClamp = (value: number) => clampVolume(value) ?? 0;

/** Every switch on, the two new gestures included (they are off by default). */
const ALL_ON: GestureSettings = { ...DEFAULT_GESTURE_SETTINGS, swipeSeek: true, twoFingerTap: true };

describe('gesture settings', () => {
  it('starts with the gestures from before P8 on, swipe seek and the two-finger tap off, and Normal sensitivity', () => {
    assert.equal(DEFAULT_GESTURE_SETTINGS.enabled, true);
    assert.equal(DEFAULT_GESTURE_SETTINGS.sensitivity, 'normal');
    for (const gesture of SWITCHABLE_GESTURES) {
      const expected = gesture !== 'swipeSeek' && gesture !== 'twoFingerTap';
      assert.equal(DEFAULT_GESTURE_SETTINGS[gesture], expected, gesture);
    }
    assert.deepEqual(
      [...SWITCHABLE_GESTURES],
      ['swipeSeek', 'brightness', 'volume', 'doubleTap', 'longPress', 'twoFingerTap', 'pinchZoom'],
    );
  });

  it('reads back a damaged store field by field', () => {
    assert.deepEqual(normalizeGestureSettings(null), DEFAULT_GESTURE_SETTINGS);
    assert.deepEqual(normalizeGestureSettings('on'), DEFAULT_GESTURE_SETTINGS);
    assert.deepEqual(normalizeGestureSettings([false]), DEFAULT_GESTURE_SETTINGS);
    assert.deepEqual(
      normalizeGestureSettings({ enabled: false, sensitivity: 'turbo', volume: 'no', pinchZoom: false, extra: 1 }),
      { ...DEFAULT_GESTURE_SETTINGS, enabled: false, pinchZoom: false },
    );
    assert.equal(normalizeGestureSettings({ sensitivity: 'high' }).sensitivity, 'high');
  });

  it('needs the master switch and the gesture\'s own switch', () => {
    const off: GestureSettings = { ...ALL_ON, enabled: false };
    assert.equal(gestureOn(DEFAULT_GESTURE_SETTINGS, 'swipeSeek'), false, 'off by default');
    assert.equal(gestureOn(ALL_ON, 'swipeSeek'), true);
    assert.equal(gestureOn(off, 'swipeSeek'), false);
    assert.equal(gestureOn({ ...DEFAULT_GESTURE_SETTINGS, volume: false }, 'volume'), false);
    assert.equal(gesturesOnCount(DEFAULT_GESTURE_SETTINGS), 5);
    assert.equal(gesturesOnCount(ALL_ON), 7);
    assert.equal(gesturesOnCount({ ...ALL_ON, doubleTap: false, longPress: false }), 5);
    // The master switch keeps each gesture's own choice underneath.
    assert.equal(gesturesOnCount(off), 0);
    assert.equal(off.doubleTap, true);
  });
});

describe('gesture sensitivity', () => {
  it('is ×0.5 for Low, ×1 for Normal, ×2 for High (×1 for anything unknown)', () => {
    assert.deepEqual(GESTURE_SENSITIVITY_FACTORS, { low: 0.5, normal: 1, high: 2 });
    assert.equal(gestureSensitivityFactor(undefined), 1);
    assert.equal(gestureSensitivityFactor('turbo' as never), 1);
  });

  const starts = [0, 0.25, 0.5, 0.731, 1, -0.2, 1.4, Number.NaN];
  const moves = [0, -0, 1, -1, 10, -10, 37.5, -123.25, 480, -480, 1e6, -1e6, Number.NaN, Number.POSITIVE_INFINITY];
  const heights = [480, 183, 360.5, 1, 0, -20, Number.NaN];

  it('Normal gives today\'s brightness and volume levels exactly, for every start, swipe and height', () => {
    let checked = 0;
    for (const start of starts) {
      for (const move of moves) {
        for (const height of heights) {
          const scaled = scaleSwipeDistance(move, 'normal');
          assert.ok(Object.is(scaled, move), `distance ${move}`);
          const brightnessToday = brightnessFromSwipe(start, move, height);
          assert.ok(Object.is(brightnessFromSwipe(start, scaled, height), brightnessToday), `${start} ${move} ${height}`);
          const volumeToday = levelFromSwipeDelta(start, move, height, volumeClamp);
          assert.ok(Object.is(levelFromSwipeDelta(start, scaled, height, volumeClamp), volumeToday), `${start} ${move} ${height}`);
          // No setting at all (a caller that predates P8) is Normal too.
          assert.ok(Object.is(scaleSwipeDistance(move, undefined), move));
          checked += 1;
        }
      }
    }
    assert.equal(checked, starts.length * moves.length * heights.length);
  });

  it('today: a swipe the height of the picture moves the level from one end to the other', () => {
    assert.equal(brightnessFromSwipe(0, -480, 480), 1);
    assert.equal(levelFromSwipeDelta(1, 480, 480, volumeClamp), 0);
    assert.equal(brightnessFromSwipe(0.5, -120, 480), 0.75);
  });

  it('Low moves half as far and High twice as far, still clamped to 0–1', () => {
    const at = (sensitivity: 'low' | 'high', move: number) =>
      brightnessFromSwipe(0.5, scaleSwipeDistance(move, sensitivity), 480);
    assert.equal(at('low', -120), 0.625);
    assert.equal(at('high', -120), 1);
    assert.equal(at('low', 480), 0);
    assert.equal(levelFromSwipeDelta(0.5, scaleSwipeDistance(96, 'high'), 480, volumeClamp), 0.09999999999999998);
    assert.equal(levelFromSwipeDelta(0.5, scaleSwipeDistance(96, 'low'), 480, volumeClamp), 0.4);
  });
});

describe('which recognisers are on', () => {
  const STATE_KEYS = [
    'gesturesEnabled',
    'brightnessAvailable',
    'zoomed',
    'hasLayout',
    'hasLongPress',
    'canSwipeSeek',
    'hasTwoFingerTap',
  ] as const satisfies readonly (keyof SurfaceGestureState)[];

  const everyState = (): SurfaceGestureState[] => {
    const states: SurfaceGestureState[] = [];
    for (let bits = 0; bits < 1 << STATE_KEYS.length; bits += 1) {
      const state = {} as Record<(typeof STATE_KEYS)[number], boolean>;
      STATE_KEYS.forEach((key, index) => {
        state[key] = (bits & (1 << index)) !== 0;
      });
      states.push(state);
    }
    return states;
  };

  it('with the defaults, and with every switch on, gives the recognisers from before P8 exactly their old values', () => {
    for (const state of everyState()) {
      const defaults = surfaceGestureFlags(DEFAULT_GESTURE_SETTINGS, state);
      // The defaults: nothing new runs, so nothing changes for existing users.
      assert.equal(defaults.swipeSeek, false);
      assert.equal(defaults.twoFingerTap, false);
      for (const settings of [DEFAULT_GESTURE_SETTINGS, ALL_ON]) {
      const flags = surfaceGestureFlags(settings, state);
      const { gesturesEnabled, brightnessAvailable, zoomed, hasLayout, hasLongPress } = state;
      // The expressions PlayerVideoSurface used before P8 (zoneWidth > 0 is hasLayout).
      const before = {
        pinch: gesturesEnabled,
        zoomPan: gesturesEnabled && zoomed,
        brightnessPan: gesturesEnabled && brightnessAvailable && !zoomed && hasLayout,
        volumePan: gesturesEnabled && !zoomed && hasLayout,
        doubleTap: gesturesEnabled,
        singleTap: gesturesEnabled,
        longPress: gesturesEnabled && hasLongPress,
      };
      for (const [key, value] of Object.entries(before)) {
        assert.equal(flags[key as keyof SurfaceGestureFlags], value, `${key} ${JSON.stringify(state)}`);
      }
      assert.equal(flags.doubleTapActions, true);
      }
    }
  });

  it('turns the new ones on only with their listener, a ready video, and outside lock, sheets and zoom', () => {
    const base: SurfaceGestureState = {
      gesturesEnabled: true,
      brightnessAvailable: true,
      zoomed: false,
      hasLayout: true,
      hasLongPress: true,
      canSwipeSeek: true,
      hasTwoFingerTap: true,
    };
    const byDefault = surfaceGestureFlags(DEFAULT_GESTURE_SETTINGS, base);
    assert.equal(byDefault.swipeSeek, false, 'off by default');
    assert.equal(byDefault.twoFingerTap, false, 'off by default');
    const on = surfaceGestureFlags(ALL_ON, base);
    assert.equal(on.swipeSeek, true);
    assert.equal(on.twoFingerTap, true);
    assert.equal(surfaceGestureFlags(ALL_ON, { ...base, canSwipeSeek: false }).swipeSeek, false);
    assert.equal(surfaceGestureFlags(ALL_ON, { ...base, zoomed: true }).swipeSeek, false);
    assert.equal(surfaceGestureFlags(ALL_ON, { ...base, hasLayout: false }).swipeSeek, false);
    assert.equal(surfaceGestureFlags(ALL_ON, { ...base, hasTwoFingerTap: false }).twoFingerTap, false);
    const locked = surfaceGestureFlags(ALL_ON, { ...base, gesturesEnabled: false });
    assert.equal(Object.values(locked).filter((value) => value === true).length, 1); // doubleTapActions alone (inert)
    assert.equal(locked.doubleTapActions, true);
  });

  const unzoomed: SurfaceGestureState = {
    gesturesEnabled: true,
    brightnessAvailable: true,
    zoomed: false,
    hasLayout: true,
    hasLongPress: true,
    canSwipeSeek: true,
    hasTwoFingerTap: true,
  };

  it('master switch off: only the single tap is left (it shows the controls)', () => {
    const flags = surfaceGestureFlags({ ...ALL_ON, enabled: false }, unzoomed);
    assert.deepEqual(flags, {
      pinch: false,
      zoomPan: false,
      brightnessPan: false,
      volumePan: false,
      swipeSeek: false,
      doubleTap: false,
      doubleTapActions: false,
      singleTap: true,
      longPress: false,
      twoFingerTap: false,
    });
  });

  it('each switch turns off its own recogniser and nothing else', () => {
    const all = surfaceGestureFlags(ALL_ON, unzoomed);
    const expected: Record<(typeof SWITCHABLE_GESTURES)[number], (keyof SurfaceGestureFlags)[]> = {
      swipeSeek: ['swipeSeek'],
      brightness: ['brightnessPan'],
      volume: ['volumePan'],
      doubleTap: ['doubleTap', 'doubleTapActions'],
      longPress: ['longPress'],
      twoFingerTap: ['twoFingerTap'],
      pinchZoom: ['pinch'],
    };
    for (const gesture of SWITCHABLE_GESTURES) {
      const flags = surfaceGestureFlags({ ...ALL_ON, [gesture]: false }, unzoomed);
      const changed = (Object.keys(all) as (keyof SurfaceGestureFlags)[]).filter((key) => flags[key] !== all[key]);
      assert.deepEqual(changed, expected[gesture], gesture);
      for (const key of changed) {
        assert.equal(flags[key], false, `${gesture}: ${key}`);
      }
    }
  });

  it('double tap switched off still resets a zoomed picture, but never seeks or pauses', () => {
    const flags = surfaceGestureFlags({ ...DEFAULT_GESTURE_SETTINGS, doubleTap: false }, { ...unzoomed, zoomed: true });
    assert.equal(flags.doubleTap, true);
    assert.equal(flags.doubleTapActions, false);
    assert.equal(flags.zoomPan, true);
  });
});
