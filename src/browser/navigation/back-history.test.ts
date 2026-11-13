import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildBackHistory } from './back-history.ts';

const page = (path: string, title = path) => ({ url: `https://news.example${path}`, title });

test('earlier pages, newest first, with the steps that reach each', () => {
  const list = buildBackHistory({
    currentIndex: 3,
    entries: [page('/a', 'A'), page('/b', 'B'), page('/c', 'C'), page('/d', 'D')],
  });
  assert.deepEqual(
    list.map((e) => [e.title, e.steps]),
    [
      ['C', -1],
      ['B', -2],
      ['A', -3],
    ],
  );
});

test('the blank page a tab starts on and the start page are not listed, but their steps are counted', () => {
  const list = buildBackHistory({
    currentIndex: 3,
    entries: [{ url: 'about:blank', title: '' }, page('/a'), { url: 'vidorax://home', title: '' }, page('/b')],
  });
  assert.deepEqual(list.map((e) => [e.url, e.steps]), [['https://news.example/a', -2]]);
});

test('pushState entries are listed; the same address twice in a row once', () => {
  // An SPA: /feed → pushState /feed?page=2 → pushState /feed?page=2 again → /post/1.
  const list = buildBackHistory({
    currentIndex: 3,
    entries: [page('/feed'), page('/feed?page=2'), page('/feed?page=2'), page('/post/1')],
  });
  assert.deepEqual(list.map((e) => [e.url, e.steps]), [
    ['https://news.example/feed?page=2', -1],
    ['https://news.example/feed', -3],
  ]);
});

test('a redirect or a reload adds no entry, so nothing is doubled', () => {
  // http → https redirect and a reload of /a: the WebView keeps one entry for each page.
  const list = buildBackHistory({ currentIndex: 1, entries: [page('/a'), page('/b')] });
  assert.deepEqual(list.map((e) => e.steps), [-1]);
});

test('nothing for the first page, a parked tab or a broken list; at most the limit', () => {
  assert.deepEqual(buildBackHistory({ currentIndex: 0, entries: [page('/a')] }), []);
  assert.deepEqual(buildBackHistory(null), []);
  assert.deepEqual(buildBackHistory({ currentIndex: -1, entries: [] }), []);
  const many = Array.from({ length: 30 }, (_, i) => page(`/${i}`));
  assert.equal(buildBackHistory({ currentIndex: 29, entries: many }).length, 20);
  assert.equal(buildBackHistory({ currentIndex: 29, entries: many }, 5).at(-1)!.steps, -5);
});

test('only web pages; titles trimmed', () => {
  const list = buildBackHistory({
    currentIndex: 2,
    entries: [{ url: 'data:text/html,x', title: 'x' }, { url: 'https://a.example/', title: '  A  ' }, page('/b')],
  });
  assert.deepEqual(list, [{ steps: -1, url: 'https://a.example/', title: 'A' }]);
});
