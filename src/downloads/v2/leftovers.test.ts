import assert from 'node:assert/strict';
import { test } from 'node:test';

import { activeLegacyIds } from './leftovers-policy';

test('v1 downloads that may still use their temporary parts keep them; finished and cancelled ones do not', () => {
  const items = {
    a: { id: 'a', status: 'DOWNLOADING' },
    b: { id: 'b', status: 'COMPLETED' },
    c: { id: 'c', status: 'PAUSED' },
    d: { id: 'd', status: 'CANCELLED' },
    e: { id: 'e', status: 'QUEUED' },
    f: { id: 'f', status: 'FAILED' },
  } as const;
  assert.deepEqual(activeLegacyIds(items), ['a', 'c', 'e', 'f']);
  assert.deepEqual(activeLegacyIds({}), []);
});
