import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { VideoPlayer } from 'expo-video';

import { redrawPausedFrame } from './use-redraw-on-attach';

function fakePlayer(state: { playing: boolean; status: string; currentTime: number; duration: number }) {
  const calls: string[] = [];
  const player = {
    get playing() {
      return state.playing;
    },
    get status() {
      return state.status;
    },
    get duration() {
      return state.duration;
    },
    get currentTime() {
      return state.currentTime;
    },
    set currentTime(value: number) {
      calls.push(`seek:${value}`);
      state.currentTime = value;
    },
    pause() {
      calls.push('pause');
    },
  };
  return { player: player as unknown as VideoPlayer, calls };
}

describe('a view taking over the picture of a paused player', () => {
  test('re-seeks in place so the paused frame is drawn into the new surface', () => {
    const { player, calls } = fakePlayer({ playing: false, status: 'readyToPlay', currentTime: 12.5, duration: 60 });
    redrawPausedFrame(player);
    assert.deepEqual(calls, ['seek:12.5']);
  });

  test('a finished video is stopped first and shows its last frame (no replay of the last moment)', () => {
    const { player, calls } = fakePlayer({ playing: false, status: 'idle', currentTime: 60, duration: 60 });
    redrawPausedFrame(player);
    assert.deepEqual(calls, ['pause', 'seek:59.9']);
  });

  test('nothing to do while playing, loading, failed, or before the media is known', () => {
    for (const state of [
      { playing: true, status: 'readyToPlay', currentTime: 5, duration: 60 },
      { playing: false, status: 'loading', currentTime: 5, duration: 60 },
      { playing: false, status: 'error', currentTime: 5, duration: 60 },
      { playing: false, status: 'idle', currentTime: 0, duration: 0 },
    ]) {
      const { player, calls } = fakePlayer(state);
      redrawPausedFrame(player);
      assert.deepEqual(calls, [], JSON.stringify(state));
    }
  });

  test('a released player (closed session) is ignored', () => {
    const player = {
      get playing(): boolean {
        throw new Error('released');
      },
    } as unknown as VideoPlayer;
    assert.doesNotThrow(() => redrawPausedFrame(player));
  });
});
