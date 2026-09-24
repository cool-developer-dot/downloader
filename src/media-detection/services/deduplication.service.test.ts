import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { clearStableResourcePathCache } from '../social-source/resource-identity';
import type { DetectedMedia } from '../types';

import { dedupeUpsert } from './deduplication.service';

function media(overrides: Partial<DetectedMedia> & { id: string; url: string }): DetectedMedia {
  const { url } = overrides;
  return {
    sourceUrl: url,
    finalUrl: url,
    pageUrl: 'https://example.org/watch',
    title: null,
    thumbnailUrl: null,
    duration: null,
    width: null,
    height: null,
    resolution: null,
    aspectRatio: null,
    fps: null,
    estimatedFileSize: null,
    codec: null,
    audioCodec: null,
    bitrate: null,
    mimeType: null,
    extension: 'mp4',
    container: 'mp4',
    category: 'video',
    streamType: 'progressive',
    isLive: false,
    isDrm: false,
    playlistType: null,
    streamProtocol: null,
    websiteSource: null,
    detectionSource: 'dom_video',
    sourceDetector: 'dom_video',
    detectedAt: 1,
    confidence: 0.6,
    downloadable: true,
    requiresCookies: false,
    requiredHeaders: null,
    redirectCount: 0,
    platformHint: null,
    hasSeparateAudio: false,
    videoOnly: false,
    ...overrides,
  } as DetectedMedia;
}

describe('dedupe collapses the same resource across detectors', () => {
  test('a rotated signature on the same object is one item, not two', () => {
    clearStableResourcePathCache();
    const first = media({
      id: 'a',
      url: 'https://cdn.example.com/v/clip.mp4?token=AAA&expires=1&bitrate=800',
    });
    const rotated = media({
      id: 'b',
      url: 'https://cdn.example.com/v/clip.mp4?token=BBB&expires=2&bitrate=800',
    });

    const inserted = dedupeUpsert([], first, 80);
    assert.equal(inserted.inserted, true);

    const second = dedupeUpsert(inserted.items, rotated, 80);
    assert.equal(second.inserted, false, 'signature rotation must not create a second row');
    assert.equal(second.items.length, 1);
  });

  test('a different object path stays a separate item', () => {
    clearStableResourcePathCache();
    const a = media({ id: 'a', url: 'https://cdn.example.com/v/one.mp4?token=AAA' });
    const b = media({ id: 'b', url: 'https://cdn.example.com/v/two.mp4?token=AAA' });

    const items = dedupeUpsert(dedupeUpsert([], a, 80).items, b, 80);
    assert.equal(items.inserted, true);
    assert.equal(items.items.length, 2);
  });

  test('memoized identity survives a cache clear between pages', () => {
    const url = 'https://cdn.example.com/v/clip.mp4?sig=X';
    const a = media({ id: 'a', url });
    const first = dedupeUpsert([], a, 80);
    clearStableResourcePathCache();
    const again = dedupeUpsert(first.items, media({ id: 'c', url }), 80);
    assert.equal(again.inserted, false, 'the same URL still dedupes after the cache is cleared');
  });

  test('the retained list never exceeds the page cap', () => {
    clearStableResourcePathCache();
    let items: DetectedMedia[] = [];
    for (let i = 0; i < 40; i += 1) {
      items = dedupeUpsert(
        items,
        media({ id: `id-${i}`, url: `https://cdn.example.com/v/clip-${i}.mp4` }),
        10,
      ).items;
    }
    assert.equal(items.length, 10);
  });

  test('matching by id updates in place', () => {
    clearStableResourcePathCache();
    const base = dedupeUpsert(
      [],
      media({ id: 'a', url: 'https://cdn.example.com/v/clip.mp4', width: null }),
      80,
    );
    const updated = dedupeUpsert(
      base.items,
      media({ id: 'a', url: 'https://cdn.example.com/v/clip.mp4', width: 1920, height: 1080 }),
      80,
    );
    assert.equal(updated.updated, true);
    assert.equal(updated.items.length, 1);
    assert.equal(updated.items[0]!.width, 1920);
  });
});
