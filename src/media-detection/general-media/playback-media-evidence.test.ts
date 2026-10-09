import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { canonicalizeObservedMediaUrl } from './playback-media-evidence';

describe('A ranged read of a media file is the whole file', () => {
  test('bytestart/byteend and range params are dropped, the signature kept', () => {
    assert.equal(
      canonicalizeObservedMediaUrl('https://cdn.example.com/media/clip-v.mp4?oh=sig&bytestart=0&byteend=65535'),
      'https://cdn.example.com/media/clip-v.mp4?oh=sig',
    );
    assert.equal(
      canonicalizeObservedMediaUrl('https://cdn.example.com/v/t42.1790-2/123_n.mp4?_nc_ht=x&oe=ABC&bytestart=1000&byteend=2000'),
      'https://cdn.example.com/v/t42.1790-2/123_n.mp4?_nc_ht=x&oe=ABC',
    );
    assert.equal(
      canonicalizeObservedMediaUrl('https://cdn.example.com/audio/track.m4a?range=0-4095'),
      'https://cdn.example.com/audio/track.m4a',
    );
  });

  test('other URLs and other params are left alone', () => {
    const page = 'https://example.com/watch?bytestart=0&byteend=10';
    assert.equal(canonicalizeObservedMediaUrl(page), page);
    const segment = 'https://cdn.example.com/hls/seg-1.ts?range=0-100';
    assert.equal(canonicalizeObservedMediaUrl(segment), segment);
    const plain = 'https://cdn.example.com/media/clip.mp4?token=abc';
    assert.equal(canonicalizeObservedMediaUrl(plain), plain);
  });
});
