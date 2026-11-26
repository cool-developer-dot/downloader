import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { filterVaultItems, privateKindOf } from './private-filters';

const item = (id: string, mimeType: string, unreadable = false) => ({ id, mimeType, unreadable });

const VAULT = [
  item('v1', 'video/mp4'),
  item('p1', 'image/jpeg'),
  item('a1', 'audio/mpeg'),
  item('v2', 'video/webm'),
  item('x', 'application/octet-stream', true),
];

describe('Files F10 · design 29: the vault’s chips', () => {
  test('All shows everything, an item that can’t be opened included', () => {
    assert.deepEqual(
      filterVaultItems(VAULT, 'all').map((entry) => entry.id),
      ['v1', 'p1', 'a1', 'v2', 'x'],
    );
  });

  test('Videos', () => {
    assert.deepEqual(
      filterVaultItems(VAULT, 'videos').map((entry) => entry.id),
      ['v1', 'v2'],
    );
  });

  test('Photos', () => {
    assert.deepEqual(
      filterVaultItems(VAULT, 'photos').map((entry) => entry.id),
      ['p1'],
    );
  });

  test('Audio', () => {
    assert.deepEqual(
      filterVaultItems(VAULT, 'audio').map((entry) => entry.id),
      ['a1'],
    );
    assert.equal(privateKindOf({ mimeType: 'AUDIO/MP4', unreadable: false }), 'audio');
    assert.equal(privateKindOf({ mimeType: 'video/mp4', unreadable: true }), 'other');
  });
});
