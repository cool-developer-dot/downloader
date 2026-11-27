import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { MIN_PART_PERCENT, storageBarParts } from './storage-bar';

const GB = 1024 ** 3;
const sum = (parts: { percent: number }[]) => Math.round(parts.reduce((total, part) => total + part.percent, 0) * 100) / 100;
const percentOf = (parts: { part: string; percent: number }[], name: string) => parts.find((part) => part.part === name)!.percent;

/** A mock of the F12 contract's `storageSpace()`. */
const space = (totalGb: number, freeGb: number, vidoraxGb: number) => ({ totalBytes: totalGb * GB, freeBytes: freeGb * GB, vidoraxBytes: vidoraxGb * GB });

describe('Files F9 · design 59: the storage bar', () => {
  test('VidoraX, other apps and free add up to 100%', () => {
    const parts = storageBarParts(space(128, 64, 32));
    assert.deepEqual(
      parts.map((part) => [part.part, part.percent]),
      [
        ['vidorax', 25],
        ['other', 25],
        ['free', 50],
      ],
    );
    assert.equal(sum(parts), 100);
    for (const odd of [space(100, 33, 33), space(7, 1, 3), space(1, 0.333, 0.333)]) {
      assert.equal(sum(storageBarParts(odd)), 100);
    }
  });

  test('a tiny part still gets its minimum width; an empty part stays empty', () => {
    const parts = storageBarParts(space(1000, 400, 0.05));
    assert.equal(percentOf(parts, 'vidorax'), MIN_PART_PERCENT);
    assert.equal(sum(parts), 100);
    const none = storageBarParts(space(100, 40, 0));
    assert.equal(percentOf(none, 'vidorax'), 0);
    assert.equal(sum(none), 100);
  });

  test('zero free space, and an unknown total', () => {
    const full = storageBarParts(space(64, 0, 16));
    assert.equal(percentOf(full, 'free'), 0);
    assert.equal(percentOf(full, 'vidorax'), 25);
    assert.equal(sum(full), 100);
    const unknown = storageBarParts({ totalBytes: 0, freeBytes: 0, vidoraxBytes: 0 });
    assert.deepEqual(
      unknown.map((part) => part.percent),
      [0, 0, 100],
    );
    // VidoraX can't be bigger than what is used.
    const clamped = storageBarParts(space(10, 8, 5));
    assert.equal(clamped.find((part) => part.part === 'vidorax')!.bytes, 2 * GB);
  });
});
