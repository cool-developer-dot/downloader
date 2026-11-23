import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_STREAM_QUALITY,
  STREAM_QUALITIES,
  getStreamQuality,
  normalizeStreamQuality,
  playingQualityLabel,
  setStreamQuality,
  streamQualityLongSide,
} from './stream-quality.ts';

describe('P14 #670 stream quality', () => {
  it('caps by the longest side, so portrait and landscape streams get the same quality', () => {
    assert.equal(streamQualityLongSide('auto'), null);
    assert.equal(streamQualityLongSide('saver'), 854);
    assert.equal(streamQualityLongSide('720'), 1280);
    assert.equal(streamQualityLongSide('1080'), 1920);
  });

  it('reads anything unknown as Auto', () => {
    assert.equal(DEFAULT_STREAM_QUALITY, 'auto');
    for (const value of STREAM_QUALITIES) {
      assert.equal(normalizeStreamQuality(value), value);
    }
    for (const value of [undefined, null, '', '480', 'best', 720, {}]) {
      assert.equal(normalizeStreamQuality(value), 'auto');
    }
  });

  it('names the playing quality by the shorter side', () => {
    assert.equal(playingQualityLabel({ width: 1280, height: 720 }), '720p');
    assert.equal(playingQualityLabel({ width: 720, height: 1280 }), '720p');
    assert.equal(playingQualityLabel({ width: 640, height: 360 }), '360p');
    assert.equal(playingQualityLabel(null), null);
    assert.equal(playingQualityLabel({ width: 0, height: 720 }), null);
  });

  it('remembers the choice for the run even without storage', () => {
    setStreamQuality('saver');
    assert.equal(getStreamQuality(), 'saver');
    setStreamQuality('auto');
    assert.equal(getStreamQuality(), 'auto');
  });
});
