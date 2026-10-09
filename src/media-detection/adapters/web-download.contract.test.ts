import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import { nativeCandidateFromWebDownload, resetNativeNetworkContractForTests } from './native-network.contract';
import { registerNativeObservationScope } from './native-observation-scope';

let unregister: (() => void) | null = null;

afterEach(() => {
  unregister?.();
  unregister = null;
  resetNativeNetworkContractForTests();
});

test('a claimed WebView download becomes a user-requested candidate of the tab that owns the WebView', () => {
  unregister = registerNativeObservationScope(41, {
    tabId: 'tab-7',
    navigationEpoch: 3,
    pageUrl: 'https://cdn.example.com/v/manifest.mpd',
    active: true,
  });
  const candidate = nativeCandidateFromWebDownload({
    viewTag: 41,
    url: 'https://cdn.example.com/v/manifest.mpd',
    mimeType: 'application/dash+xml',
    observedAt: Date.now(),
  });
  assert.ok(candidate);
  assert.equal(candidate.tabId, 'tab-7');
  assert.equal(candidate.navigationEpoch, 3);
  assert.equal(candidate.userRequested, true);
  assert.equal(candidate.mimeType, 'application/dash+xml');
  assert.equal(candidate.observationSource, 'webview-download');

  // Not deduplicated against the request the WebView itself just made for the same URL.
  assert.ok(
    nativeCandidateFromWebDownload({ viewTag: 41, url: 'https://cdn.example.com/v/manifest.mpd', mimeType: null, observedAt: Date.now() }),
  );
});

test('no owning tab, or an unsafe URL → null (the caller hands the download back to the system)', () => {
  assert.equal(
    nativeCandidateFromWebDownload({ viewTag: 99, url: 'https://cdn.example.com/a.mp4', mimeType: 'video/mp4', observedAt: Date.now() }),
    null,
  );
  unregister = registerNativeObservationScope(42, {
    tabId: 'tab-1',
    navigationEpoch: 1,
    pageUrl: 'https://example.com/',
    active: true,
  });
  assert.equal(
    nativeCandidateFromWebDownload({ viewTag: 42, url: 'http://192.168.1.4/a.mp4', mimeType: 'video/mp4', observedAt: Date.now() }),
    null,
  );
});
