import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import type { DetectedMedia } from '../types';
import { buildVerifiedSocialMediaOffer } from './social-source-reliability.service';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

const media = {
  id: 'm1',
  url: 'https://edge7.cdnhost.net/o/9f3a1c.mp4?token=abc',
  finalUrl: 'https://edge7.cdnhost.net/o/9f3a1c.mp4?token=abc',
  sourceUrl: 'https://edge7.cdnhost.net/o/9f3a1c.mp4?token=abc',
  pageUrl: 'https://social.example.org/reel/abc123/',
  category: 'video',
  streamType: 'DIRECT',
  container: 'mp4',
} as unknown as DetectedMedia;

describe('social offer publication requires current-content ownership', () => {
  for (const ownershipConfidence of ['WEAK', 'REJECTED', null] as const) {
    test(`${ownershipConfidence ?? 'no'} ownership never publishes and never probes the network`, async () => {
      let fetched = 0;
      globalThis.fetch = (async () => {
        fetched += 1;
        throw new Error('must not probe');
      }) as typeof fetch;
      const result = await buildVerifiedSocialMediaOffer({
        scope: {
          tabId: 'tab-1',
          navigationEpoch: 0,
          socialContextGeneration: 1,
          contentIdentity: 'social:reel:abc123',
          ownershipConfidence,
        },
        candidates: [media],
        pageUrl: media.pageUrl,
      });
      assert.equal(result.ok, false);
      assert.equal(!result.ok && result.reason, 'WEAK_OWNERSHIP');
      assert.equal(fetched, 0);
    });
  }
});
