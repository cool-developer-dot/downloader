import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { assembleCanonicalItems } from '@/library/assemble';

import { projectV2Download } from './projection';
import { downloadRecord, libraryItem } from './test-fixtures';

function assemble(entries: ReturnType<typeof projectV2Download>[]) {
  return assembleCanonicalItems({
    downloads: entries.map((entry) => entry.item),
    records: [],
    transfers: Object.fromEntries(entries.map((entry) => [entry.item.id, entry.transfer])),
    remoteById: {},
    favoriteKeys: new Set<string>(),
    // No filesystem reconcile has run yet: the engine's own state is the live truth.
    assessments: {},
  });
}

describe('8/9: Library shows what the v2 engine finished, and only that', () => {
  test('a completed download becomes exactly one available Library item', () => {
    const library = libraryItem();
    const entry = projectV2Download(downloadRecord({ state: 'completed' }), { library });
    const items = assemble([entry]);

    assert.equal(items.length, 1);
    const item = items[0]!;
    assert.equal(item.id, 'dl-1');
    assert.equal(item.fileName, library.fileName);
    assert.equal(item.localAvailability, 'available');
    // The playable file is the engine's verified library file, carried by the row's transfer snapshot.
    assert.equal(entry.transfer.localUri, library.fileUri);
  });

  test('queued, downloading, finalizing, failed and cancelled downloads are not in the Library', () => {
    const entries = [
      projectV2Download(downloadRecord({ id: 'queued', state: 'queued' })),
      projectV2Download(downloadRecord({ id: 'running', state: 'downloading' })),
      projectV2Download(downloadRecord({ id: 'finalizing', state: 'processing' })),
      projectV2Download(downloadRecord({ id: 'failed', state: 'failed', errorCode: 'NETWORK' })),
      projectV2Download(downloadRecord({ id: 'cancelled', state: 'cancelled' })),
    ];
    assert.deepEqual(assemble(entries), []);
  });

  test('the same download never yields two Library items', () => {
    const library = libraryItem();
    const record = downloadRecord({ state: 'completed' });
    const items = assemble([
      projectV2Download(record, { library }),
      projectV2Download({ ...record, updatedAt: record.updatedAt + 1000 }, { library }),
    ]);
    assert.equal(items.length, 1);
  });
});
