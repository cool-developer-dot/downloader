import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  AUTO_SCROLL_LEVELS,
  AUTO_SCROLL_OFF,
  autoScrollPixelsPerSecond,
  nextAutoScroll,
  type AutoScrollEvent,
  type AutoScrollState,
} from './auto-scroll.ts';
import {
  fastScrollExpired,
  INITIAL_FAST_SCROLL,
  onFastScrollReport,
  SCROLL_JUMP_VISIBLE_MS,
  type FastScrollState,
} from './fast-scroll.ts';
import { normalizeScrollSpeed, scrollStepFraction } from './scroll-speed.ts';
import { shouldCaptureVolumeKeys, volumeKeyDirection, type VolumeKeyContext } from './volume-keys.ts';

describe('scroll speed (#53)', () => {
  test('values and the step it gives', () => {
    assert.equal(normalizeScrollSpeed('fast'), 'fast');
    assert.equal(normalizeScrollSpeed('turbo'), 'normal');
    assert.equal(scrollStepFraction('slow'), 0.5);
    assert.ok(scrollStepFraction('normal') < 1, 'a screen with overlap');
    assert.ok(scrollStepFraction('fast') > scrollStepFraction('normal'));
  });
});

describe('scroll to top / bottom button (#46, #47)', () => {
  const page = { height: 10_000, viewHeight: 800 };
  const feed = (ys: [number, number][], start: FastScrollState = INITIAL_FAST_SCROLL) =>
    ys.reduce((state, [y, at]) => onFastScrollReport(state, { ...page, y, at }), start);

  test('a fast fling down offers the bottom; up offers the top', () => {
    assert.equal(feed([[1000, 0], [1600, 200]]).target, 'bottom');
    assert.equal(feed([[6000, 0], [5400, 200]]).target, 'top');
  });

  test('ordinary scrolling, a short page or the page already at that end: no button', () => {
    assert.equal(feed([[1000, 0], [1200, 200]]).target, null);
    const short = [[0, 0], [700, 200]].reduce(
      (state, [y, at]) => onFastScrollReport(state, { y: y!, at: at!, height: 2000, viewHeight: 800 }),
      INITIAL_FAST_SCROLL,
    );
    assert.equal(short.target, null);
    assert.equal(feed([[1000, 0], [300, 200]]).target, null, 'flung up to the top already');
    assert.equal(feed([[8000, 0], [9200, 200]]).target, null, 'flung down to the bottom already');
  });

  test('fades a few seconds after the fast scrolling stops', () => {
    const shown = feed([[1000, 0], [1600, 200]]);
    assert.equal(fastScrollExpired(shown, 200 + SCROLL_JUMP_VISIBLE_MS - 1), false);
    assert.equal(fastScrollExpired(shown, 200 + SCROLL_JUMP_VISIBLE_MS), true);
    // Slow scrolling afterwards keeps the button but does not re-arm it.
    const later = feed([[1700, 1200]], shown);
    assert.equal(later.target, 'bottom');
    assert.equal(later.shownAt, 200);
  });

  test('garbage reports are ignored', () => {
    const shown = feed([[1000, 0], [1600, 200]]);
    assert.equal(onFastScrollReport(shown, { y: Number.NaN, height: 1, viewHeight: 0, at: 300 }), shown);
  });
});

describe('auto scroll (#54)', () => {
  const run = (events: AutoScrollEvent[], start: AutoScrollState = AUTO_SCROLL_OFF) =>
    events.reduce(nextAutoScroll, start);

  test('starts at the Scroll speed level and runs', () => {
    assert.deepEqual(run([{ type: 'start', speed: 'normal' }]), { status: 'running', level: 2 });
    assert.equal(run([{ type: 'start', speed: 'slow' }]).level, 1);
    assert.equal(run([{ type: 'start', speed: 'fast' }]).level, 4);
    assert.equal(autoScrollPixelsPerSecond(2), AUTO_SCROLL_LEVELS[2]);
  });

  test('pause / resume, slower / faster within the levels', () => {
    const started = run([{ type: 'start', speed: 'normal' }]);
    assert.equal(run([{ type: 'toggle' }], started).status, 'paused');
    assert.equal(run([{ type: 'toggle' }, { type: 'toggle' }], started).status, 'running');
    const top = AUTO_SCROLL_LEVELS.length - 1;
    assert.equal(run(Array(20).fill({ type: 'faster' }), started).level, top);
    assert.equal(run(Array(20).fill({ type: 'slower' }), started).level, 0);
    assert.equal(autoScrollPixelsPerSecond(99), AUTO_SCROLL_LEVELS[top]);
  });

  test('a touch pauses; the bottom, navigation, the background and Stop end it', () => {
    const started = run([{ type: 'start', speed: 'normal' }]);
    assert.equal(run([{ type: 'touched' }], started).status, 'paused');
    for (const type of ['reachedBottom', 'navigated', 'background', 'stop'] as const) {
      assert.equal(run([{ type }], started).status, 'off', type);
    }
  });

  test('nothing to toggle or speed up while off', () => {
    assert.equal(run([{ type: 'toggle' }]).status, 'off');
    assert.equal(run([{ type: 'faster' }]), AUTO_SCROLL_OFF);
  });
});

describe('volume keys (#240)', () => {
  const on: VolumeKeyContext = {
    enabled: true,
    browserInFront: true,
    pageShown: true,
    keyboardUp: false,
    pageMediaPlaying: false,
    playerPlaying: false,
  };

  test('taken only while every condition holds', () => {
    assert.equal(shouldCaptureVolumeKeys(on), true);
    const releasedBy: Partial<VolumeKeyContext>[] = [
      { enabled: false },
      { browserInFront: false },
      { pageShown: false },
      { keyboardUp: true },
      { pageMediaPlaying: true },
      { playerPlaying: true },
    ];
    for (const change of releasedBy) {
      assert.equal(shouldCaptureVolumeKeys({ ...on, ...change }), false, JSON.stringify(change));
    }
  });

  test('down scrolls down, up scrolls up', () => {
    assert.equal(volumeKeyDirection('volumeDown'), 1);
    assert.equal(volumeKeyDirection('volumeUp'), -1);
    assert.equal(volumeKeyDirection('ctrl+t'), 0);
  });
});
