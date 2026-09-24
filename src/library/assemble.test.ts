import assert from 'node:assert/strict';
import { test } from 'node:test';

import { projectV2Download } from '../downloads/v2/projection.ts';
import { downloadRecord, libraryItem, PAGE_URL } from '../downloads/v2/test-fixtures.ts';

import { assembleCanonicalItems } from './assemble.ts';

function build(rows: ReturnType<typeof projectV2Download>[], favoriteKeys: Set<string>) {
  const transfers = Object.fromEntries(rows.map((row) => [row.item.id, row.transfer]));
  return assembleCanonicalItems({
    downloads: rows.map((row) => row.item),
    records: [],
    transfers,
    remoteById: {},
    favoriteKeys,
    favoriteMediaIds: new Set(),
    assessments: {},
  });
}

test('a v2 video is a favorite only when the user marked that video, not because its page is', () => {
  const marked = projectV2Download(downloadRecord({ id: 'a', state: 'completed' }), {
    library: libraryItem({ id: 'a', favorite: true }),
  });
  const sibling = projectV2Download(downloadRecord({ id: 'b', state: 'completed' }), {
    library: libraryItem({ id: 'b', favorite: false }),
  });
  // The page URL is a favorite (the Favorites screen lists it): its other videos must not inherit that.
  const items = build([marked, sibling], new Set([PAGE_URL]));
  const byId = Object.fromEntries(items.map((item) => [item.id, item.favorite]));
  assert.deepEqual(byId, { a: true, b: false });
});

test('a row without a favorite of its own keeps the page favorite', () => {
  const v1Like = projectV2Download(downloadRecord({ id: 'c', state: 'completed' }), { library: libraryItem({ id: 'c' }) });
  delete (v1Like.item as { favorite?: boolean }).favorite;
  const items = build([v1Like], new Set([PAGE_URL]));
  assert.equal(items[0]?.favorite, true);
});
