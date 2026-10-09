import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { queueNeighbours } from './play-queue';

describe('queueNeighbours', () => {
  const ids = ['a', 'b', 'c'];

  test('steps both ways inside the list', () => {
    assert.deepEqual(queueNeighbours(ids, 'b'), { previousId: 'a', nextId: 'c' });
  });

  test('has no previous at the start and no next at the end', () => {
    assert.deepEqual(queueNeighbours(ids, 'a'), { previousId: null, nextId: 'b' });
    assert.deepEqual(queueNeighbours(ids, 'c'), { previousId: 'b', nextId: null });
  });

  test('has neither for media outside the list', () => {
    assert.deepEqual(queueNeighbours(ids, 'z'), { previousId: null, nextId: null });
    assert.deepEqual(queueNeighbours([], 'a'), { previousId: null, nextId: null });
    assert.deepEqual(queueNeighbours(ids, null), { previousId: null, nextId: null });
  });
});
