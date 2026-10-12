import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createVideoSurfaceAttachment } from './video-surface-attachment';

test('with background play the views let go of the player while stopped and take it back when active', () => {
  const surface = createVideoSurfaceAttachment();
  let changes = 0;
  surface.subscribe(() => {
    changes += 1;
  });
  surface.onActivityStopped(true);
  assert.deepEqual(surface.get(), { attached: false, generation: 0 });
  surface.onActivityStopped(true);
  surface.onAppActive();
  assert.deepEqual(surface.get(), { attached: true, generation: 1 });
  assert.equal(changes, 2);
});

test('without background play nothing changes (the player is paused anyway)', () => {
  const surface = createVideoSurfaceAttachment();
  surface.onActivityStopped(false);
  surface.onAppActive();
  assert.deepEqual(surface.get(), { attached: true, generation: 0 });
});
