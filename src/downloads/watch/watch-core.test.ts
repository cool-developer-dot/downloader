import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeWatchInterval, normalizeWatchUrl, parseWatchAdd, parseWatchedLinks } from './watch-core';

const link = (extra: Record<string, unknown> = {}) => ({
  id: 'a',
  url: 'https://site.test/feed.xml',
  kind: 'feed',
  title: 'Clips',
  intervalHours: 6,
  autoDownload: true,
  lastCheckedAt: 10,
  lastStatus: 'ok',
  createdAt: 5,
  items: [
    { id: '1', title: 'One', mediaUrl: 'https://cdn.test/1.mp4', publishedAt: 3 },
    { id: '2', mediaUrl: 'javascript:alert(1)' },
  ],
  ...extra,
});

test('watched links from native: malformed entries and unsafe item links are dropped, newest first', () => {
  const list = parseWatchedLinks(
    JSON.stringify([link(), link({ id: 'b', createdAt: 9, kind: 'page', items: undefined }), { id: 'c', url: 'x', kind: 'other' }, null]),
  );
  assert.deepEqual(list.map((l) => l.id), ['b', 'a']);
  assert.equal(list[1]?.items.length, 1, 'only the http(s) item is kept');
  assert.equal(list[1]?.lastStatus, 'ok');
  assert.equal(list[0]?.lastCheckedAt, 10);
  assert.deepEqual(parseWatchedLinks('not json'), []);
  assert.deepEqual(parseWatchedLinks(null), []);
});

test('the add answer: a link, a full list, or an unreachable one', () => {
  assert.deepEqual(parseWatchAdd('full'), { ok: false, reason: 'full' });
  assert.deepEqual(parseWatchAdd('unreachable'), { ok: false, reason: 'unreachable' });
  const added = parseWatchAdd(JSON.stringify(link()));
  assert.equal(added.ok && added.link.id, 'a');
  assert.deepEqual(parseWatchAdd('{bad'), { ok: false, reason: 'unreachable' });
});

test('only http(s) links are watched, and intervals snap to the offered ones', () => {
  assert.equal(normalizeWatchUrl('  https://site.test/a.mp4 '), 'https://site.test/a.mp4');
  assert.equal(normalizeWatchUrl('ftp://site.test/a'), null);
  assert.equal(normalizeWatchUrl('https://site.test/a b'), null);
  assert.equal(normalizeWatchUrl('https://'), null);
  assert.equal(normalizeWatchInterval(5), 6);
  assert.equal(normalizeWatchInterval(100), 168);
  assert.equal(normalizeWatchInterval(Number.NaN), 24);
  assert.equal(normalizeWatchInterval('x'), 24);
});
