import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  findVaultItem,
  normalizeVaultItem,
  vaultIndexFrom,
  vaultItemActions,
  withoutVaultItem,
} from './vault-index';

const READABLE = '0b2c4e6a-1111-4a2b-8c3d-000000000001';
const LOST = '0b2c4e6a-2222-4a2b-8c3d-000000000002';

function readable(addedAt: number) {
  return {
    id: READABLE,
    title: 'Clip',
    mimeType: 'video/mp4',
    durationMs: 1000,
    sizeBytes: 10,
    width: null,
    height: null,
    createdAt: 1,
    addedAt,
    hasThumbnail: true,
  };
}

/** What the native side lists for an item whose key or file cannot be read. */
function unreadable(addedAt: number, extra: Record<string, unknown> = {}) {
  return { id: LOST, unreadable: true, title: '', sizeBytes: 5_000, addedAt, hasThumbnail: false, ...extra };
}

describe('items that cannot be opened', () => {
  test('are never hidden: they stay in the list, in date order', () => {
    const items = vaultIndexFrom([readable(10), unreadable(20)]);
    assert.deepEqual(
      items.map((item) => item.id),
      [LOST, READABLE],
    );
    assert.equal(items[0]?.unreadable, true);
    assert.equal(items[1]?.unreadable, false);
  });

  test('only their id, size and date are kept; nothing else is trusted', () => {
    const item = normalizeVaultItem(unreadable(20, { title: 'Leaked?', durationMs: 99, hasThumbnail: true, mimeType: 'video/mp4' }));
    assert.deepEqual(item, {
      id: LOST,
      title: '',
      mimeType: 'application/octet-stream',
      durationMs: null,
      sizeBytes: 5_000,
      width: null,
      height: null,
      createdAt: 0,
      addedAt: 20,
      hasThumbnail: false,
      unreadable: true,
    });
  });

  test('a missing size or date falls back to zero instead of dropping the item', () => {
    const item = normalizeVaultItem({ id: LOST, unreadable: true, sizeBytes: 'x', addedAt: null });
    assert.equal(item?.sizeBytes, 0);
    assert.equal(item?.addedAt, 0);
  });

  test('offer only Delete; a readable item offers everything', () => {
    assert.deepEqual(vaultItemActions({ unreadable: true }), ['delete']);
    assert.deepEqual(vaultItemActions({ unreadable: false }), ['play', 'export-gallery', 'export-folder', 'delete']);
  });

  test('deleting removes their entry from the list', () => {
    const items = vaultIndexFrom([readable(10), unreadable(20)]);
    const after = withoutVaultItem(items, LOST);
    assert.equal(findVaultItem(after, LOST), null);
    assert.equal(after.length, 1);
  });

  test('a bad id is still refused, unreadable or not', () => {
    assert.equal(normalizeVaultItem({ id: '../x', unreadable: true, sizeBytes: 1, addedAt: 1 }), null);
  });
});
