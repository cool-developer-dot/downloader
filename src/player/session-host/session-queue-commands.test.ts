import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { sessionQueueCommand } from './session-queue-commands';

const ids = ['device:1', 'device:2', 'device:3'];

describe('⏭ / ⏮ in the mini player (session runner)', () => {
  test('⏭ opens the next video of the queue', () => {
    assert.deepEqual(sessionQueueCommand('next', { ids, mediaId: 'device:2', positionSeconds: 40 }), {
      kind: 'open',
      mediaId: 'device:3',
    });
  });

  test('⏭ on the last video, or outside the queue, does nothing', () => {
    assert.deepEqual(sessionQueueCommand('next', { ids, mediaId: 'device:3', positionSeconds: 0 }), { kind: 'none' });
    assert.deepEqual(sessionQueueCommand('next', { ids, mediaId: 'other', positionSeconds: 0 }), { kind: 'none' });
  });

  test('⏮ within the first 3 s opens the previous video', () => {
    assert.deepEqual(sessionQueueCommand('previous', { ids, mediaId: 'device:2', positionSeconds: 2 }), {
      kind: 'open',
      mediaId: 'device:1',
    });
  });

  test('⏮ later goes back to the start of this video', () => {
    assert.deepEqual(sessionQueueCommand('previous', { ids, mediaId: 'device:2', positionSeconds: 12 }), {
      kind: 'restart',
    });
  });

  test('⏮ on the first video restarts it', () => {
    assert.deepEqual(sessionQueueCommand('previous', { ids, mediaId: 'device:1', positionSeconds: 1 }), {
      kind: 'restart',
    });
  });
});
