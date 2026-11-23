/**
 * P6: the one function that decides what a finished video does, in the order asked for: A-B loop, Repeat one,
 * Repeat all (the queue), Auto Play Next, then the End of Playback Action.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { decideEndOfPlayback, type EndOfPlaybackInput } from './end-of-playback';

const loop = { startSeconds: 5, endSeconds: 9 };
const base: EndOfPlaybackInput = {
  loop: null,
  action: 'stop',
  queue: ['a', 'b', 'c'],
  mediaId: 'b',
  autoPlayNext: false,
  folderNextId: 'f2',
  advanceCancelled: false,
};

describe('what a finished video does (precedence)', () => {
  test('with the defaults, nothing moves on: a queue with a next video and a folder with one both stop', () => {
    assert.deepEqual(decideEndOfPlayback(base), { kind: 'stop' });
    assert.deepEqual(decideEndOfPlayback({ ...base, queue: [], folderNextId: 'f2' }), { kind: 'stop' });
  });

  test('1. an A-B loop wins over everything', () => {
    assert.deepEqual(decideEndOfPlayback({ ...base, loop, action: 'repeatAll', autoPlayNext: true }), {
      kind: 'loop',
      seekSeconds: 5,
    });
  });

  test('2. Repeat one wins over Repeat all’s queue and Auto Play Next', () => {
    assert.deepEqual(decideEndOfPlayback({ ...base, action: 'repeatOne', autoPlayNext: true }), {
      kind: 'replay',
      reason: 'repeatOne',
    });
  });

  test('3. Repeat all goes round the queue, before Auto Play Next', () => {
    assert.deepEqual(decideEndOfPlayback({ ...base, action: 'repeatAll', autoPlayNext: true, mediaId: 'c' }), {
      kind: 'next',
      mediaId: 'a',
      reason: 'repeatAll',
    });
  });

  test('4. Auto Play Next plays the next of the queue, and stops after the last one (no wrap)', () => {
    assert.deepEqual(decideEndOfPlayback({ ...base, autoPlayNext: true }), {
      kind: 'next',
      mediaId: 'c',
      reason: 'autoPlayNext',
    });
    assert.deepEqual(decideEndOfPlayback({ ...base, autoPlayNext: true, mediaId: 'c' }), { kind: 'stop' });
  });

  test('4. with no queue (or a queue of this video alone), Auto Play Next plays the next in its folder', () => {
    for (const queue of [[], ['b']]) {
      assert.deepEqual(decideEndOfPlayback({ ...base, queue, autoPlayNext: true }), {
        kind: 'next',
        mediaId: 'f2',
        reason: 'folder',
      });
    }
    assert.deepEqual(decideEndOfPlayback({ ...base, queue: [], autoPlayNext: true, folderNextId: null }), {
      kind: 'stop',
    });
    assert.deepEqual(decideEndOfPlayback({ ...base, queue: [], autoPlayNext: true, folderNextId: 'b' }), {
      kind: 'stop',
    });
  });

  test('5. otherwise the End of Playback Action: Stop', () => {
    assert.deepEqual(decideEndOfPlayback({ ...base, autoPlayNext: false, action: 'stop' }), { kind: 'stop' });
  });

  test('Cancel on the Next Episode card stops a move to the next video, and nothing else', () => {
    assert.deepEqual(decideEndOfPlayback({ ...base, autoPlayNext: true, advanceCancelled: true }), { kind: 'stop' });
    assert.deepEqual(decideEndOfPlayback({ ...base, action: 'repeatAll', advanceCancelled: true }), { kind: 'stop' });
    assert.deepEqual(decideEndOfPlayback({ ...base, action: 'repeatOne', advanceCancelled: true }), {
      kind: 'replay',
      reason: 'repeatOne',
    });
    assert.deepEqual(decideEndOfPlayback({ ...base, loop, advanceCancelled: true }), { kind: 'loop', seekSeconds: 5 });
  });

  test('P5 callers that pass no P6 fields behave as in P5', () => {
    assert.deepEqual(decideEndOfPlayback({ loop: null, action: 'stop', queue: ['a', 'b'], mediaId: 'a' }), {
      kind: 'stop',
    });
  });
});

describe("Faran's P18: the sleep timer's End of this video", () => {
  test('stops before anything else, even an A-B loop or Repeat one', () => {
    assert.deepEqual(decideEndOfPlayback({ ...base, sleepAtEnd: true }), { kind: 'stop' });
    assert.deepEqual(decideEndOfPlayback({ ...base, loop, action: 'repeatOne', autoPlayNext: true, sleepAtEnd: true }), {
      kind: 'stop',
    });
    assert.deepEqual(decideEndOfPlayback({ ...base, action: 'repeatAll', sleepAtEnd: false }), {
      kind: 'next',
      mediaId: 'c',
      reason: 'repeatAll',
    });
  });
});
