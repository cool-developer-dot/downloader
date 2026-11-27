import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { applyCustomOrder, dropGoneIds, moveByStep, moveInOrder } from './custom-order';

describe('Files F7 #954: custom order', () => {
  test('move up and down', () => {
    assert.deepEqual(moveInOrder(['a', 'b', 'c', 'd'], 'd', 1), ['a', 'd', 'b', 'c']);
    assert.deepEqual(moveInOrder(['a', 'b', 'c', 'd'], 'a', 2), ['b', 'c', 'a', 'd']);
    assert.deepEqual(moveInOrder(['a', 'b'], 'a', 99), ['b', 'a']);
    assert.deepEqual(moveInOrder(['a', 'b'], 'zz', 0), ['a', 'b']);
    assert.deepEqual(moveByStep(['a', 'b', 'c'], 'b', -1), ['b', 'a', 'c']);
    assert.deepEqual(moveByStep(['a', 'b', 'c'], 'b', 1), ['a', 'c', 'b']);
    assert.deepEqual(moveByStep(['a', 'b', 'c'], 'a', -1), ['a', 'b', 'c']);
  });

  test('new ids go to the end (a new download lands last)', () => {
    assert.deepEqual(applyCustomOrder(['c', 'a'], ['a', 'b', 'c', 'd']), ['c', 'a', 'b', 'd']);
  });

  test('removed ids are dropped', () => {
    assert.deepEqual(applyCustomOrder(['c', 'gone', 'a'], ['a', 'c']), ['c', 'a']);
    assert.deepEqual(dropGoneIds(['x', 'a', 'y'], ['a']), ['a']);
  });
});
