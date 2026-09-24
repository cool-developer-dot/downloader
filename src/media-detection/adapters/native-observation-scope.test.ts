import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import { registerNativeObservationScope, resolveNativeObservationScope } from './native-observation-scope';

const PAGE = 'https://news.example.org/story/42';
const cleanups: Array<() => void> = [];

function bind(viewTag: number, scope: { tabId: string; pageUrl: string; active: boolean }): void {
  const realNow = Date.now;
  Date.now = () => realNow() - 10_000;
  try {
    cleanups.push(registerNativeObservationScope(viewTag, { navigationEpoch: 0, ...scope }));
  } finally {
    Date.now = realNow;
  }
}

function worker(requestReferer: string | null) {
  return resolveNativeObservationScope({
    webViewId: -1,
    parentViewId: -1,
    observedAt: Date.now(),
    observationSource: 'service-worker',
    requestReferer,
  });
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

describe('service worker requests (no WebView) — J/K', () => {
  test('J: same-document Referer from the only active page is owned by that tab', () => {
    bind(11, { tabId: 'tab-a', pageUrl: PAGE, active: true });
    assert.equal(worker(`${PAGE}#comments`)?.tabId, 'tab-a');
  });

  test('J: worker passthrough to a CDN carries only the page origin; a unique page of that origin owns it', () => {
    bind(11, { tabId: 'tab-a', pageUrl: PAGE, active: true });
    assert.equal(worker('https://news.example.org/')?.tabId, 'tab-a');
  });

  test('K: two mounted pages of the same origin make an origin-only Referer ambiguous — unowned', () => {
    bind(11, { tabId: 'tab-a', pageUrl: PAGE, active: true });
    bind(12, { tabId: 'tab-b', pageUrl: 'https://news.example.org/story/43', active: false });
    assert.equal(worker('https://news.example.org/'), null);
  });

  test('K: an exact document match still resolves when another tab shares the origin', () => {
    bind(11, { tabId: 'tab-a', pageUrl: PAGE, active: true });
    bind(12, { tabId: 'tab-b', pageUrl: 'https://news.example.org/story/43', active: false });
    assert.equal(worker(PAGE)?.tabId, 'tab-a');
  });

  test('K: a worker request for a parked (inactive) tab is never attributed to the active tab', () => {
    bind(12, { tabId: 'tab-b', pageUrl: 'https://news.example.org/story/43', active: false });
    assert.equal(worker('https://news.example.org/story/43'), null);
  });

  test('K: no Referer or a foreign origin stays unowned', () => {
    bind(11, { tabId: 'tab-a', pageUrl: PAGE, active: true });
    assert.equal(worker(null), null);
    assert.equal(worker('https://ads.adnetwork.example/'), null);
  });
});
