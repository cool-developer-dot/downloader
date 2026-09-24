import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import type { NetworkMediaObservation } from '@modules/vidorax-web/src/VidoraWeb.types';

import {
  nativeCandidateEventFromObservation,
  processNativeMediaCandidateEvent,
  resetNativeNetworkContractForTests,
} from './native-network.contract';
import { registerNativeObservationScope } from './native-observation-scope';

const PAGE = 'https://news.example.org/story/42';
const TAB = 'tab-1';

function observation(overrides: Partial<NetworkMediaObservation> = {}): NetworkMediaObservation {
  return {
    viewTag: 31,
    url: 'https://edge7.cdnhost.net/o/9f3a1c?token=abc&expires=1999999999',
    method: 'GET',
    isMainFrame: false,
    hasRange: true,
    rangeStart: 0,
    accept: '*/*',
    // Cross-origin iframe media requests carry an origin-only Referer by default policy.
    referer: 'https://player.embedhost.io/',
    hint: 'range-media',
    observedAt: Date.now(),
    ...overrides,
  };
}

let unregister: (() => void) | null = null;

afterEach(() => {
  unregister?.();
  unregister = null;
  resetNativeNetworkContractForTests();
});

function bindActiveScope(viewTag = 31, boundAt = Date.now() - 1_000): void {
  const realNow = Date.now;
  Date.now = () => boundAt;
  try {
    unregister = registerNativeObservationScope(viewTag, {
      tabId: TAB,
      navigationEpoch: 0,
      pageUrl: PAGE,
      active: true,
    });
  } finally {
    Date.now = realNow;
  }
}

describe('VidoraWeb observation → active detector event', () => {
  test('maps view tag, referer and range evidence without inventing a response MIME', () => {
    const event = nativeCandidateEventFromObservation(observation());
    assert.equal(event.parentViewId, 31);
    assert.equal(event.webViewId, 31);
    assert.equal(event.requestReferer, 'https://player.embedhost.io/');
    assert.equal(event.hasRange, true);
    assert.equal(event.isForMainFrame, false);
    assert.equal(event.mimeHint, null);
    assert.equal(event.observationSource, 'webview');
  });

  test('suffix ranges (no rangeStart) still count as Range requests', () => {
    const event = nativeCandidateEventFromObservation(observation({ hasRange: true, rangeStart: null }));
    assert.equal(event.hasRange, true);
  });

  test('media Accept token is kept as request metadata', () => {
    const event = nativeCandidateEventFromObservation(
      observation({ accept: 'application/vnd.apple.mpegurl, */*;q=0.8', hint: 'manifest-hls' }),
    );
    assert.equal(event.mimeHint, 'application/vnd.apple.mpegurl');
  });

  test('service worker requests (viewTag -1) are marked as such', () => {
    const event = nativeCandidateEventFromObservation(observation({ viewTag: -1 }));
    assert.equal(event.observationSource, 'service-worker');
  });
});

describe('native observation → candidate (scope + classification)', () => {
  test('B/C/D: extensionless signed CDN media from a cross-origin iframe becomes a tab-owned candidate', () => {
    bindActiveScope();
    const candidate = processNativeMediaCandidateEvent(nativeCandidateEventFromObservation(observation()));
    assert.ok(candidate, 'candidate expected');
    assert.equal(candidate.tabId, TAB);
    assert.equal(candidate.navigationEpoch, 0);
    assert.equal(candidate.pageUrl, PAGE);
    assert.equal(candidate.hasRange, true);
    assert.equal(candidate.frameUrl, 'https://player.embedhost.io/');
    assert.match(candidate.url, /^https:\/\/edge7\.cdnhost\.net\/o\/9f3a1c\?/);
  });

  test('A: direct .mp4 request is a candidate', () => {
    bindActiveScope();
    const candidate = processNativeMediaCandidateEvent(
      nativeCandidateEventFromObservation(
        observation({ url: 'https://media.example.org/clips/intro.mp4', hint: 'progressive', hasRange: true }),
      ),
    );
    assert.ok(candidate);
    assert.equal(candidate.tabId, TAB);
  });

  test('requests from an unregistered WebView are not attributed to any tab', () => {
    bindActiveScope(31);
    const candidate = processNativeMediaCandidateEvent(nativeCandidateEventFromObservation(observation({ viewTag: 99 })));
    assert.ok(candidate);
    assert.equal(candidate.tabId, undefined);
  });

  test('observations older than the scope binding are not attributed (previous document)', () => {
    bindActiveScope(31, Date.now());
    const candidate = processNativeMediaCandidateEvent(
      nativeCandidateEventFromObservation(observation({ observedAt: Date.now() - 60_000 })),
    );
    assert.ok(candidate);
    assert.equal(candidate.tabId, undefined);
  });

  test('O: isolated media segments never become candidates', () => {
    bindActiveScope();
    for (const url of [
      'https://edge7.cdnhost.net/hls/720/seg-00012.ts',
      'https://edge7.cdnhost.net/dash/v1/chunk-3.m4s',
      'https://edge7.cdnhost.net/dash/v1/init.mp4',
    ]) {
      const candidate = processNativeMediaCandidateEvent(
        nativeCandidateEventFromObservation(observation({ url, hint: 'segment' })),
      );
      assert.equal(candidate, null, url);
    }
  });

  test('S: repeated Range requests for the same resource are deduplicated', () => {
    bindActiveScope();
    const first = processNativeMediaCandidateEvent(nativeCandidateEventFromObservation(observation({ rangeStart: 0 })));
    const second = processNativeMediaCandidateEvent(
      nativeCandidateEventFromObservation(observation({ rangeStart: 1_048_576 })),
    );
    assert.ok(first);
    assert.equal(second, null);
  });

  test('loopback / private hosts stay rejected (SSRF guard)', () => {
    bindActiveScope();
    const candidate = processNativeMediaCandidateEvent(
      nativeCandidateEventFromObservation(observation({ url: 'http://127.0.0.1:8080/v/1.mp4' })),
    );
    assert.equal(candidate, null);
  });
});
