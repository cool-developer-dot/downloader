import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  binTotalBytes,
  DEFAULT_BIN_SETTINGS,
  expiredEntries,
  normalizeBinEntries,
  normalizeBinSettings,
  purgeAtOf,
  sortedBin,
  withoutTrashed,
  type BinEntry,
} from './bin-model';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 26, 12);

function entry(id: string, daysAgo: number, sizeBytes = 100): BinEntry {
  return {
    id,
    title: id,
    fileName: `${id}.mp4`,
    fileType: 'video',
    sizeBytes,
    trashedAt: NOW - daysAgo * DAY,
    folderId: null,
    engineOwned: true,
  };
}

describe('bin settings', () => {
  test('defaults: on, 30 days', () => assert.deepEqual(DEFAULT_BIN_SETTINGS, { enabled: true, keepDays: 30 }));
  test('normalize keeps valid values and fixes bad ones', () => {
    assert.deepEqual(normalizeBinSettings({ enabled: false, keepDays: 7 }), { enabled: false, keepDays: 7 });
    assert.deepEqual(normalizeBinSettings({ enabled: true, keepDays: null }), { enabled: true, keepDays: null });
    assert.deepEqual(normalizeBinSettings({ enabled: 'yes', keepDays: 5 }), DEFAULT_BIN_SETTINGS);
    assert.deepEqual(normalizeBinSettings(undefined), DEFAULT_BIN_SETTINGS);
  });
});

describe('bin entries', () => {
  test('normalize drops broken rows and fills defaults', () => {
    const out = normalizeBinEntries({
      a: { trashedAt: 5, title: 'A', fileType: 'audio', sizeBytes: 10, folderId: 'f', engineOwned: true },
      b: { title: 'no date' },
      c: null,
      d: { trashedAt: 9, sizeBytes: -3 },
    });
    assert.deepEqual(Object.keys(out).sort(), ['a', 'd']);
    assert.equal(out.a!.folderId, 'f');
    assert.equal(out.d!.sizeBytes, 0);
    assert.equal(out.d!.engineOwned, false);
    assert.deepEqual(normalizeBinEntries('junk'), {});
  });

  test('purge time follows keep days; "until I empty it" never purges', () => {
    const e = entry('a', 0);
    assert.equal(purgeAtOf(e, 30), e.trashedAt + 30 * DAY);
    assert.equal(purgeAtOf(e, null), null);
  });

  test('expired entries, oldest first, exactly at the limit counts', () => {
    const entries = { a: entry('a', 31), b: entry('b', 30), c: entry('c', 2), d: entry('d', 45) };
    assert.deepEqual(expiredEntries(entries, 30, NOW).map((x) => x.id), ['d', 'a', 'b']);
    assert.deepEqual(expiredEntries(entries, null, NOW), []);
    assert.deepEqual(expiredEntries(entries, 60, NOW), []);
  });

  test('sorted newest first, with a stable tie order; total bytes', () => {
    const entries = { a: entry('a', 3, 10), b: entry('b', 1, 20), c: entry('c', 1, 30) };
    assert.deepEqual(sortedBin(entries).map((x) => x.id), ['b', 'c', 'a']);
    assert.equal(binTotalBytes(entries), 60);
  });
});

describe('withoutTrashed', () => {
  test('drops trashed ids, keeps order', () => {
    assert.deepEqual(withoutTrashed(['a', 'b', 'c'], { b: 1 }), ['a', 'c']);
  });
  test('returns the same array when nothing is trashed', () => {
    const ids = ['a', 'b'];
    assert.equal(withoutTrashed(ids, { z: 1 }), ids);
  });
});
