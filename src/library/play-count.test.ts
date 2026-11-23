import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { PlaybackContractEvent } from '@/player/playback-events';

import {
  createPlayCountTracker,
  PLAY_COUNT_THRESHOLD_SECONDS,
  playCountReached,
} from './play-count.ts';

/**
 * P9 #708: a play counts once per session, after 30 s actually watched (seeks add nothing), or to the end of a video
 * shorter than 30 s; nothing while Disable History (#687) is on. The events are the Player's own, at its real pace:
 * `positionChanged` about every 1.05 s (1 s throttle, 0.35 s time updates), the first one at 0.35 s.
 */

function harness(options: { paused?: () => boolean; countable?: (id: string) => boolean } = {}) {
  const counted: [string, number][] = [];
  const tracker = createPlayCountTracker({
    isHistoryPaused: options.paused ?? (() => false),
    isCountable: options.countable ?? (() => true),
    onCount: (id, at) => counted.push([id, at]),
  });
  let clock = 0;
  const send = (event: PlaybackContractEvent) => tracker.handle(event);
  const start = (mediaId: string) => send({ type: 'playbackStarted', mediaId, at: clock });
  /** Plays from `from` to `to` (video seconds) at `rate`, one event per ~1.05 s of wall time. */
  const play = (mediaId: string, from: number, to: number, durationSeconds: number | null = 600, rate = 1) => {
    const step = 1.05 * rate;
    for (let position = from; position <= to + 1e-9; position += step) {
      clock += 1050;
      send({ type: 'positionChanged', mediaId, positionSeconds: Math.min(position, to), durationSeconds, at: clock });
    }
  };
  const at = (mediaId: string, positionSeconds: number, durationSeconds: number | null = 600) => {
    clock += 1050;
    send({ type: 'positionChanged', mediaId, positionSeconds, durationSeconds, at: clock });
  };
  return { tracker, counted, send, start, play, at, now: () => clock };
}

describe('P9 #708 play counting', () => {
  test('the threshold is 30 s', () => {
    assert.equal(PLAY_COUNT_THRESHOLD_SECONDS, 30);
    assert.equal(playCountReached({ watchedSeconds: 29.99, durationSeconds: 600 }), false);
    assert.equal(playCountReached({ watchedSeconds: 30, durationSeconds: 600 }), true);
    assert.equal(playCountReached({ watchedSeconds: 30, durationSeconds: null }), true);
  });

  test('30 s rule: counted once, at the event where 30 s of the video has played', () => {
    const h = harness();
    h.start('v1');
    h.play('v1', 0.35, 29);
    assert.deepEqual(h.counted, [], 'not at 29 s');
    h.play('v1', 30.05, 31.5);
    assert.equal(h.counted.length, 1);
    assert.equal(h.counted[0]![0], 'v1');
    const session = h.tracker.session();
    assert.ok(session && session.watchedSeconds >= 30 && session.watchedSeconds < 32);
  });

  test('watching 25 s and leaving counts nothing', () => {
    const h = harness();
    h.start('v1');
    h.play('v1', 0.35, 25);
    h.send({ type: 'playerExited', mediaId: 'v1', positionSeconds: 25.2, at: h.now() + 200 });
    assert.deepEqual(h.counted, []);
    assert.equal(h.tracker.session(), null);
  });

  test('2× speed counts the video’s time (30 s of it in about 15 s)', () => {
    const h = harness();
    h.start('v1');
    h.play('v1', 0.7, 31, 600, 2);
    assert.equal(h.counted.length, 1);
    assert.ok(h.now() <= 16_000, `counted after ${h.now()} ms`);
  });

  test('seeking adds nothing: forward or back, while playing or while paused', () => {
    const h = harness();
    h.start('v1');
    h.play('v1', 0.35, 10); // ~10 s watched
    h.at('v1', 100); // a seek forward while playing: a jump
    h.play('v1', 101.05, 110); // ~10 s more
    h.at('v1', 40); // a seek back
    h.send({ type: 'paused', mediaId: 'v1', positionSeconds: 41, at: h.now() + 1000 }); // 1 s more
    // Paused, then a seek to 200 and play on: the first event after it is a jump from the pause.
    h.at('v1', 200);
    h.play('v1', 201.05, 205); // ~5 s more → about 26 s in all
    assert.deepEqual(h.counted, []);
    const watched = h.tracker.session()!.watchedSeconds;
    assert.ok(watched > 24 && watched < 28, `watched ${watched}`);
    h.play('v1', 206.1, 211);
    assert.equal(h.counted.length, 1, 'counted once 30 s are reached');
  });

  test('a seek straight to the end of a long video counts nothing', () => {
    const h = harness();
    h.start('v1');
    h.play('v1', 0.35, 3);
    h.at('v1', 598);
    h.send({ type: 'completed', mediaId: 'v1', at: h.now() + 2000 });
    assert.deepEqual(h.counted, []);
  });

  test('shorter than 30 s: counted when watched to the end; a seek to the end is not', () => {
    const watched = harness();
    watched.start('short');
    watched.play('short', 0.35, 18.2, 20);
    assert.deepEqual(watched.counted, [], 'not before its end (minus 1 s)');
    watched.send({ type: 'completed', mediaId: 'short', at: watched.now() + 1800 });
    assert.equal(watched.counted.length, 1);
    // Leaving within the last second also counts (the events are a second apart).
    const almost = harness();
    almost.start('short');
    almost.play('short', 0.35, 19.25, 20);
    assert.equal(almost.counted.length, 1);

    const skipped = harness();
    skipped.start('short');
    skipped.play('short', 0.35, 2.45, 20);
    skipped.at('short', 19.8, 20);
    skipped.send({ type: 'completed', mediaId: 'short', at: skipped.now() + 300 });
    assert.deepEqual(skipped.counted, []);

    // A 5 s clip played through.
    const clip = harness();
    clip.start('clip');
    clip.play('clip', 0.35, 4.55, 5);
    clip.send({ type: 'completed', mediaId: 'clip', at: clip.now() + 500 });
    assert.equal(clip.counted.length, 1);
  });

  test('unknown length: the 30 s rule; when it ends early, where it ended is its length', () => {
    const h = harness();
    h.start('live');
    h.play('live', 0.35, 12, null);
    h.send({ type: 'completed', mediaId: 'live', at: h.now() + 1000 });
    assert.equal(h.counted.length, 1, 'a 12 s video with no reported length, played through');

    const long = harness();
    long.start('x');
    long.play('x', 0.35, 31, null);
    assert.equal(long.counted.length, 1);
  });

  test('once per session: replay and Repeat one don’t count again; a new session does', () => {
    const h = harness();
    h.start('v1');
    h.play('v1', 0.35, 40);
    h.send({ type: 'completed', mediaId: 'v1', at: h.now() + 1000 });
    // Repeat one / Replay: back to 0 and on, in the same session (no new playbackStarted).
    h.play('v1', 0.35, 40);
    h.send({ type: 'completed', mediaId: 'v1', at: h.now() + 1000 });
    h.start('v1'); // a retry inside the same session
    h.play('v1', 0.35, 40);
    assert.equal(h.counted.length, 1);

    h.send({ type: 'playerExited', mediaId: 'v1', positionSeconds: 40, at: h.now() + 100 });
    h.start('v1');
    h.play('v1', 0.35, 31);
    assert.equal(h.counted.length, 2, 'opened again: a new session');
  });

  test('the mini player is the same session: no exit, so watching on counts once', () => {
    const h = harness();
    h.start('v1');
    h.play('v1', 0.35, 20);
    // The Player closes into the mini player: no event, playback goes on.
    h.play('v1', 21.05, 45);
    assert.equal(h.counted.length, 1);
  });

  test('another video’s events start its own session; a late exit of the one before changes nothing', () => {
    const h = harness();
    h.start('a');
    h.play('a', 0.35, 20);
    // Next video: its start comes before the old session's exit.
    h.start('b');
    h.send({ type: 'playerExited', mediaId: 'a', positionSeconds: 20, at: h.now() });
    h.send({ type: 'paused', mediaId: 'a', positionSeconds: 20, at: h.now() });
    h.play('b', 0.35, 31);
    assert.deepEqual(h.counted.map(([id]) => id), ['b']);
    assert.equal(h.tracker.session()?.mediaId, 'b');
  });

  test('Disable History on: nothing counts, and time watched meanwhile is not kept', () => {
    let paused = true;
    const h = harness({ paused: () => paused });
    h.start('v1');
    h.play('v1', 0.35, 120);
    h.send({ type: 'completed', mediaId: 'v1', at: h.now() + 1000 });
    assert.deepEqual(h.counted, []);
    assert.equal(h.tracker.session()?.watchedSeconds, 0);

    // Turned off in the middle of a video: only what plays after it counts.
    const g = harness({ paused: () => paused });
    g.start('v2');
    g.play('v2', 0.35, 25);
    paused = false;
    g.play('v2', 26.05, 50);
    assert.deepEqual(g.counted, []);
    g.play('v2', 51.1, 57);
    assert.equal(g.counted.length, 1);
  });

  test('streams and files another app opened are never counted', () => {
    const h = harness({ countable: (id) => !id.startsWith('stream:') && !id.startsWith('external:') });
    for (const id of ['stream:abc', 'external:tok']) {
      h.start(id);
      h.play(id, 0.35, 45);
      h.send({ type: 'playerExited', mediaId: id, positionSeconds: 45, at: h.now() });
    }
    assert.equal(h.counted.length, 0);
    h.start('device:42');
    h.play('device:42', 0.35, 31);
    assert.deepEqual(h.counted.map(([id]) => id), ['device:42'], 'a phone video counts under its own id');
  });

  test('a resumed video: the jump to the resume point adds nothing; 30 s from there counts', () => {
    const h = harness();
    h.start('v1');
    h.at('v1', 300);
    h.play('v1', 301.05, 320);
    assert.deepEqual(h.counted, []);
    h.play('v1', 321.05, 332);
    assert.equal(h.counted.length, 1);
  });
});
