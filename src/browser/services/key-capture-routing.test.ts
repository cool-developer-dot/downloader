import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { routeCapturedKey, type KeyOwnerRequest } from './key-capture-routing.ts';

const requests = (entries: [string, Partial<KeyOwnerRequest>][]) =>
  new Map(entries.map(([owner, request]) => [owner, { volumeKeys: false, combos: [], since: 0, ...request }]));

describe('key capture routing (B6 / B21 / Faran P15)', () => {
  it('gives the volume keys to the owner that asked most recently', () => {
    const both = requests([
      ['browser.volumeKeyScroll', { volumeKeys: true, since: 1 }],
      ['player.p15', { volumeKeys: true, since: 2 }],
    ]);
    assert.deepEqual([...routeCapturedKey('volumeUp', both)], ['player.p15']);
    const browserOnly = requests([['browser.volumeKeyScroll', { volumeKeys: true, since: 1 }]]);
    assert.deepEqual([...routeCapturedKey('volumeDown', browserOnly)], ['browser.volumeKeyScroll']);
    assert.deepEqual([...routeCapturedKey('volumeDown', requests([]))], []);
  });

  it('gives a combo to every owner that asked for it, and no one else', () => {
    const map = requests([
      ['b21-shortcuts', { combos: ['ctrl+t', 'ctrl+l'] }],
      ['player.p15', { combos: ['space', 'left'] }],
    ]);
    assert.deepEqual([...routeCapturedKey('ctrl+t', map)], ['b21-shortcuts']);
    assert.deepEqual([...routeCapturedKey('SPACE', map)], ['player.p15']);
    assert.deepEqual([...routeCapturedKey('f', map)], []);
  });
});
