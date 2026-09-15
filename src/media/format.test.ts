import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  formatBytes,
  formatClock,
  formatDurationMs,
  formatEta,
  formatPercent,
  formatSpeed,
  resolutionLabel,
  transferFraction,
} from './format.ts';

describe('formatBytes', () => {
  test('uses decimal units with one decimal below 100', () => {
    assert.equal(formatBytes(0), '0 B');
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(1_536), '1.5 KB');
    assert.equal(formatBytes(42_300_000), '42.3 MB');
    assert.equal(formatBytes(512_000_000), '512 MB');
    assert.equal(formatBytes(1_250_000_000), '1.3 GB');
  });

  test('drops a trailing .0 and rolls over instead of printing 1000', () => {
    assert.equal(formatBytes(2_000_000), '2 MB');
    assert.equal(formatBytes(999_999), '1 MB');
    assert.equal(formatBytes(999.6), '1 KB');
  });

  test('treats invalid input as zero', () => {
    assert.equal(formatBytes(Number.NaN), '0 B');
    assert.equal(formatBytes(-5), '0 B');
  });
});

test('formatSpeed appends per second', () => {
  assert.equal(formatSpeed(1_200_000), '1.2 MB/s');
  assert.equal(formatSpeed(0), '0 B/s');
});

describe('clock formatting', () => {
  test('formats minutes and hours', () => {
    assert.equal(formatClock(5), '0:05');
    assert.equal(formatClock(125), '2:05');
    assert.equal(formatClock(3_725), '1:02:05');
  });

  test('durations shorter than a second are unknown', () => {
    assert.equal(formatDurationMs(null), null);
    assert.equal(formatDurationMs(400), null);
    assert.equal(formatDurationMs(205_000), '3:25');
  });

  test('eta is null when unknown or finished', () => {
    assert.equal(formatEta(null), null);
    assert.equal(formatEta(0), null);
    assert.equal(formatEta(Number.POSITIVE_INFINITY), null);
    assert.equal(formatEta(72), '1:12');
  });
});

describe('progress', () => {
  test('prefers the reported fraction and clamps', () => {
    assert.equal(transferFraction(10, 100, 0.5), 0.5);
    assert.equal(transferFraction(10, 100, 1.2), 1);
  });

  test('falls back to bytes over total, else unknown', () => {
    assert.equal(transferFraction(25, 100), 0.25);
    assert.equal(transferFraction(25, null), null);
    assert.equal(transferFraction(25, 0), null);
  });

  test('percent floors so 99.9% never shows as done', () => {
    assert.equal(formatPercent(0.999), '99%');
    assert.equal(formatPercent(1), '100%');
  });
});

describe('resolutionLabel', () => {
  test('labels landscape, portrait and wide frames by their quality tier', () => {
    assert.equal(resolutionLabel(1920, 1080), '1080p');
    assert.equal(resolutionLabel(1080, 1920), '1080p');
    assert.equal(resolutionLabel(1920, 800), '1080p');
    assert.equal(resolutionLabel(3840, 2160), '4K');
    assert.equal(resolutionLabel(1280, 720), '720p');
    assert.equal(resolutionLabel(576, 1024), '480p');
    assert.equal(resolutionLabel(640, 360), '360p');
  });

  test('uses height alone when width is unknown', () => {
    assert.equal(resolutionLabel(null, 720), '720p');
  });

  test('returns null when unknown or tiny', () => {
    assert.equal(resolutionLabel(1920, null), null);
    assert.equal(resolutionLabel(null, null), null);
    assert.equal(resolutionLabel(160, 90), null);
  });
});
