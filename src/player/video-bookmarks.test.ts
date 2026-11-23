import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  bookmarkLabel,
  bookmarkMarkerFractions,
  bookmarkTimeLabel,
  clampBookmarkPositionMs,
  MAX_BOOKMARK_NAME_LENGTH,
  normalizeBookmarkName,
  secondsToBookmarkMs,
  sortBookmarks,
  type VideoBookmark,
} from './video-bookmarks.ts';

/** P9 #705: the bookmark rules the sheet, the timeline dots and the SQL share. */

const mark = (id: string, positionMs: number, name: string | null = null, createdAt = '2026-11-23T10:00:00.000Z'): VideoBookmark => ({
  id,
  mediaId: 'v1',
  positionMs,
  name,
  createdAt,
});

describe('P9 #705 video bookmark rules', () => {
  test('a name is optional: trimmed, spaces folded, at most 80 characters, Urdu kept', () => {
    assert.equal(normalizeBookmarkName('  Big\n  moment  '), 'Big moment');
    assert.equal(normalizeBookmarkName('   '), null);
    assert.equal(normalizeBookmarkName(''), null);
    assert.equal(normalizeBookmarkName(null), null);
    assert.equal(normalizeBookmarkName(undefined), null);
    assert.equal(normalizeBookmarkName('گول کا لمحہ'), 'گول کا لمحہ');
    assert.equal(normalizeBookmarkName('x'.repeat(200))?.length, MAX_BOOKMARK_NAME_LENGTH);
    // Cut by characters, never in the middle of one.
    const emoji = normalizeBookmarkName('🎬'.repeat(100))!;
    assert.equal(Array.from(emoji).length, MAX_BOOKMARK_NAME_LENGTH);
  });

  test('positions are whole milliseconds inside 0 … the length', () => {
    assert.equal(clampBookmarkPositionMs(1234.5, 60_000), 1235);
    assert.equal(clampBookmarkPositionMs(-10, 60_000), 0);
    assert.equal(clampBookmarkPositionMs(70_000, 60_000), 60_000);
    assert.equal(clampBookmarkPositionMs(70_000, null), 70_000);
    assert.equal(clampBookmarkPositionMs(70_000, 0), 70_000, 'a length of 0 is unknown');
    assert.equal(clampBookmarkPositionMs(Number.NaN, 60_000), 0);
    assert.equal(secondsToBookmarkMs(83.4567), 83_457);
    assert.equal(secondsToBookmarkMs(-1), 0);
  });

  test('listed by time, then the order they were added in', () => {
    const sorted = sortBookmarks([
      mark('c', 90_000, null, '2026-11-23T11:00:00.000Z'),
      mark('a', 5_000),
      mark('b', 90_000, 'Goal', '2026-11-23T10:30:00.000Z'),
    ]);
    assert.deepEqual(sorted.map((b) => b.id), ['a', 'b', 'c']);
  });

  test('shown by name, or by its time when it has none', () => {
    assert.equal(bookmarkTimeLabel(mark('a', 83_900)), '01:23');
    assert.equal(bookmarkTimeLabel(mark('a', 3_723_000)), '1:02:03');
    assert.equal(bookmarkLabel(mark('a', 83_900)), '01:23');
    assert.equal(bookmarkLabel(mark('a', 83_900, 'Goal')), 'Goal');
  });

  test('timeline dots: fractions of the length, in order, one per place; none while the length is unknown', () => {
    const marks = [mark('a', 30_000), mark('b', 15_000), mark('c', 15_000), mark('d', 90_000)];
    assert.deepEqual(bookmarkMarkerFractions(marks, 60), [0.25, 0.5, 1]);
    assert.deepEqual(bookmarkMarkerFractions(marks, null), []);
    assert.deepEqual(bookmarkMarkerFractions(marks, 0), []);
    assert.deepEqual(bookmarkMarkerFractions([], 60), []);
  });
});
