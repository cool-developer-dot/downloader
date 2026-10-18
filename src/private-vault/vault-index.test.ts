import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  findVaultItem,
  isVaultId,
  normalizeVaultItem,
  sortVaultItems,
  vaultIndexFrom,
  vaultTotalBytes,
  withoutVaultItem,
  withVaultItem,
  type VaultItem,
} from './vault-index';

const A = '0b2c4e6a-1111-4a2b-8c3d-000000000001';
const B = '0b2c4e6a-2222-4a2b-8c3d-000000000002';
const C = '0b2c4e6a-3333-4a2b-8c3d-000000000003';

function raw(id: string, addedAt: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    title: `Video ${id.slice(9, 13)}`,
    mimeType: 'video/mp4',
    durationMs: 60_000,
    sizeBytes: 1_000,
    width: 1280,
    height: 720,
    createdAt: 1,
    addedAt,
    hasThumbnail: true,
    ...extra,
  };
}

describe('vault index', () => {
  test('items are checked, de-duplicated and listed newest first', () => {
    const items = vaultIndexFrom([raw(A, 10), raw(B, 30), raw(A, 99), raw(C, 20), 'junk', null, { id: 'nope' }]);
    assert.deepEqual(
      items.map((item) => item.id),
      [B, C, A],
    );
    assert.deepEqual(vaultIndexFrom('not a list'), []);
  });

  test('a malformed entry is dropped: bad id, missing size or dates', () => {
    assert.equal(normalizeVaultItem(raw('../etc/passwd', 1)), null);
    assert.equal(normalizeVaultItem(raw(A, 1, { sizeBytes: -5 })), null);
    assert.equal(normalizeVaultItem(raw(A, 1, { addedAt: 'yesterday' })), null);
    assert.equal(normalizeVaultItem([raw(A, 1)]), null);
  });

  test('optional fields fall back safely', () => {
    const item = normalizeVaultItem(raw(A, 1, { durationMs: null, width: 'x', title: 42, mimeType: undefined }));
    assert.equal(item?.durationMs, null);
    assert.equal(item?.width, null);
    assert.equal(item?.title, '');
    assert.equal(item?.mimeType, 'video/mp4');
  });

  test('adding replaces an item with the same id; removing keeps the same list when absent', () => {
    const items = vaultIndexFrom([raw(A, 10), raw(B, 20)]);
    const added = withVaultItem(items, normalizeVaultItem(raw(C, 30))!);
    assert.deepEqual(
      added.map((item) => item.id),
      [C, B, A],
    );
    const replaced = withVaultItem(added, normalizeVaultItem(raw(A, 40, { title: 'New' }))!);
    assert.equal(replaced.length, 3);
    assert.equal(replaced[0]?.title, 'New');
    assert.equal(withoutVaultItem(items, C), items);
    assert.deepEqual(
      withoutVaultItem(items, A).map((item) => item.id),
      [B],
    );
  });

  test('totals and lookups', () => {
    const items = vaultIndexFrom([raw(A, 10), raw(B, 20, { sizeBytes: 500 })]);
    assert.equal(vaultTotalBytes(items), 1_500);
    assert.equal(findVaultItem(items, B)?.sizeBytes, 500);
    assert.equal(findVaultItem(items, C), null);
  });

  test('ties are ordered by title, so the list is stable', () => {
    const items: VaultItem[] = [
      normalizeVaultItem(raw(A, 5, { title: 'b' }))!,
      normalizeVaultItem(raw(B, 5, { title: 'a' }))!,
    ];
    assert.deepEqual(
      sortVaultItems(items).map((item) => item.title),
      ['a', 'b'],
    );
  });

  test('vault ids are random UUIDs, never library or download ids', () => {
    assert.equal(isVaultId(A), true);
    assert.equal(isVaultId('dl_1729000000000_abcd'), false);
    assert.equal(isVaultId(A.toUpperCase()), false);
  });
});
