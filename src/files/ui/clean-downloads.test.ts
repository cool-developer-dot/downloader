import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { cleanCandidates, CLEAN_LARGER_THAN_BYTES } from './clean-downloads';
import { toFileEntry } from './files-index';
import { libraryItem } from './test-fixtures';

const NOW = Date.UTC(2026, 10, 26);
const monthsAgo = (months: number, extraDays = 0) => {
  const date = new Date(NOW);
  date.setUTCMonth(date.getUTCMonth() - months);
  return new Date(date.getTime() - extraDays * 86_400_000).toISOString();
};

/** The library as the F12 contract lists it; `completed` is what watch history recorded. */
const LIBRARY = [
  libraryItem({ id: 'watched-new', completed: true, downloadedAt: monthsAgo(0, 2), fileSize: '1000' }),
  libraryItem({ id: 'watched-old', completed: true, downloadedAt: monthsAgo(7), fileSize: String(CLEAN_LARGER_THAN_BYTES + 1) }),
  libraryItem({ id: 'half-old', completed: false, progressPercent: 40, downloadedAt: monthsAgo(13), fileSize: '1000' }),
  libraryItem({ id: 'big-new', downloadedAt: monthsAgo(1), fileSize: String(CLEAN_LARGER_THAN_BYTES + 1) }),
  libraryItem({ id: 'exactly-500', downloadedAt: monthsAgo(1), fileSize: String(CLEAN_LARGER_THAN_BYTES) }),
  libraryItem({ id: 'missing', completed: true, downloadedAt: monthsAgo(13), fileSize: String(CLEAN_LARGER_THAN_BYTES * 2), localAvailability: 'missing' }),
  libraryItem({ id: 'private', completed: true, downloadedAt: monthsAgo(13), fileSize: String(CLEAN_LARGER_THAN_BYTES * 2) }),
  libraryItem({ id: 'no-date', completed: true, downloadedAt: null }),
].map(toFileEntry);

const ids = (rules: Parameters<typeof cleanCandidates>[1]) =>
  cleanCandidates(LIBRARY, rules, { now: NOW, privateIds: new Set(['private']) }).map((file) => file.id);

describe('Files F9 · #856 Clean downloads', () => {
  test('each rule alone', () => {
    // "Watched to the end" is read from watch history (`completed`), not from how far the last play got.
    assert.deepEqual(ids({ watched: true }), ['watched-new', 'watched-old', 'no-date']);
    assert.deepEqual(ids({ olderThanMonths: 6 }), ['watched-old', 'half-old']);
    assert.deepEqual(ids({ olderThanMonths: 12 }), ['half-old']);
    assert.deepEqual(ids({ olderThanMonths: 3 }), ['watched-old', 'half-old']);
    assert.deepEqual(ids({ larger: true }), ['watched-old', 'big-new']);
  });

  test('rules combine: a file must match every rule that is on', () => {
    assert.deepEqual(ids({ watched: true, olderThanMonths: 6 }), ['watched-old']);
    assert.deepEqual(ids({ watched: true, olderThanMonths: 6, larger: true }), ['watched-old']);
    assert.deepEqual(ids({ olderThanMonths: 12, larger: true }), []);
    assert.deepEqual(ids({}), []);
  });

  test('Private and missing files are left out, even when every rule matches', () => {
    const all = ids({ watched: true, olderThanMonths: 12, larger: true });
    assert.ok(!all.includes('private'));
    assert.ok(!all.includes('missing'));
    assert.deepEqual(ids({ olderThanMonths: 12 }).includes('missing'), false);
  });
});
