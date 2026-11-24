import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  isRealPlayToEnd,
  readPlayerDuration,
  DEFAULT_END_OF_PLAYBACK_ACTION,
  decideEndOfPlayback,
  normalizeEndOfPlaybackAction,
  repeatAllNext,
  type EndOfPlaybackInput,
} from './end-of-playback';

const base: EndOfPlaybackInput = { loop: null, action: 'stop', queue: ['a', 'b', 'c'], mediaId: 'b' };

describe('End of Playback Action (#535, #539, #540)', () => {
  test('the default is Stop, as before P5: a queue with a next video still stops', () => {
    assert.equal(DEFAULT_END_OF_PLAYBACK_ACTION, 'stop');
    assert.deepEqual(decideEndOfPlayback({ ...base, action: DEFAULT_END_OF_PLAYBACK_ACTION }), { kind: 'stop' });
    assert.deepEqual(decideEndOfPlayback({ ...base, queue: [], mediaId: 'x' }), { kind: 'stop' });
  });

  test('Repeat one plays the same video again', () => {
    assert.deepEqual(decideEndOfPlayback({ ...base, action: 'repeatOne' }), { kind: 'replay', reason: 'repeatOne' });
    assert.deepEqual(decideEndOfPlayback({ ...base, action: 'repeatOne', queue: [] }), {
      kind: 'replay',
      reason: 'repeatOne',
    });
  });

  test('Repeat all plays the next video, and the first after the last', () => {
    assert.deepEqual(decideEndOfPlayback({ ...base, action: 'repeatAll' }), {
      kind: 'next',
      mediaId: 'c',
      reason: 'repeatAll',
    });
    assert.deepEqual(decideEndOfPlayback({ ...base, action: 'repeatAll', mediaId: 'c' }), {
      kind: 'next',
      mediaId: 'a',
      reason: 'repeatAll',
    });
  });

  test('Repeat all with a list of one, or no list, repeats the video', () => {
    assert.deepEqual(decideEndOfPlayback({ ...base, action: 'repeatAll', queue: ['b'] }), {
      kind: 'replay',
      reason: 'repeatAll',
    });
    assert.deepEqual(decideEndOfPlayback({ ...base, action: 'repeatAll', queue: [] }), {
      kind: 'replay',
      reason: 'repeatAll',
    });
    assert.deepEqual(decideEndOfPlayback({ ...base, action: 'repeatAll', mediaId: 'z' }), {
      kind: 'replay',
      reason: 'repeatAll',
    });
  });

  test('an A-B loop comes before every choice', () => {
    const loop = { startSeconds: 12, endSeconds: 30 };
    for (const action of ['stop', 'repeatOne', 'repeatAll'] as const) {
      assert.deepEqual(decideEndOfPlayback({ ...base, action, loop }), { kind: 'loop', seekSeconds: 12 });
    }
  });

  test('a stored choice is read tolerantly', () => {
    assert.equal(normalizeEndOfPlaybackAction('repeatAll'), 'repeatAll');
    assert.equal(normalizeEndOfPlaybackAction('shuffle'), 'stop');
    assert.equal(normalizeEndOfPlaybackAction(undefined), 'stop');
    assert.equal(normalizeEndOfPlaybackAction(3), 'stop');
  });

  test('repeatAllNext wraps and knows when the video is not in the queue', () => {
    assert.equal(repeatAllNext(['a', 'b'], 'a'), 'b');
    assert.equal(repeatAllNext(['a', 'b'], 'b'), 'a');
    assert.equal(repeatAllNext(['a', 'b'], null), null);
    assert.equal(repeatAllNext([], 'a'), null);
  });
});

describe('P6 fix: only the end of a loaded video counts (isRealPlayToEnd)', () => {
  test("the empty player's end before the video loads is ignored", () => {
    assert.equal(isRealPlayToEnd({ isReady: false, hasError: false, playerDurationSeconds: 0 }), false);
    assert.equal(isRealPlayToEnd({ isReady: true, hasError: false, playerDurationSeconds: 0 }), false);
    assert.equal(isRealPlayToEnd({ isReady: false, hasError: false, playerDurationSeconds: 60 }), false);
  });

  test('an error is not an end', () => {
    assert.equal(isRealPlayToEnd({ isReady: true, hasError: true, playerDurationSeconds: 60 }), false);
  });

  test('a loaded video that plays to its end counts', () => {
    assert.equal(isRealPlayToEnd({ isReady: true, hasError: false, playerDurationSeconds: 60 }), true);
  });

  test("the player's length: 0 when unknown, not finite or released", () => {
    assert.equal(readPlayerDuration({ duration: 90.5 }), 90.5);
    assert.equal(readPlayerDuration({ duration: 0 }), 0);
    assert.equal(readPlayerDuration({ duration: Number.NaN }), 0);
    assert.equal(readPlayerDuration({ duration: -9.2e15 }), 0);
    const released = {
      get duration(): number {
        throw new Error('released');
      },
    };
    assert.equal(readPlayerDuration(released), 0);
  });
});
