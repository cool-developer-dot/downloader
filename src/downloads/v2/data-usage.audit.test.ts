import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { applyProgressEvent, applyStateEvent, dayKey, EMPTY_DATA_USAGE, monthKey, summarizeDataUsage } from './data-usage';

describe('data usage dates (audit)', () => {
  test('a leap day and the year boundary are their own buckets', () => {
    assert.equal(dayKey(new Date(2028, 1, 29, 12).getTime()), '2028-02-29');
    assert.equal(monthKey(new Date(2026, 11, 31, 23, 59).getTime()), '2026-12');
    assert.equal(monthKey(new Date(2027, 0, 1, 0, 1).getTime()), '2027-01');
  });

  test('the last 30 days span a month and a year change', () => {
    const now = new Date(2027, 0, 10, 12).getTime();
    const summary = summarizeDataUsage(
      { ...EMPTY_DATA_USAGE, days: { '2026-12-12': 7, '2026-12-11': 100, '2027-01-10': 1 }, months: { '2027-01': 1 } },
      now,
    );
    assert.equal(summary.last30DaysBytes, 8);
    assert.equal(summary.monthBytes, 1);
    assert.equal(summary.todayBytes, 1);
  });

  test('a repeated progress event with the same bytes adds nothing', () => {
    let s = applyStateEvent(EMPTY_DATA_USAGE, { id: 'a', state: 'queued', bytesDone: 0 });
    const at = new Date(2026, 9, 1, 12).getTime();
    s = applyProgressEvent(s, { id: 'a', phase: 'download', bytesDone: 500 }, at);
    s = applyProgressEvent(s, { id: 'a', phase: 'download', bytesDone: 500 }, at);
    assert.equal(s.totalBytes, 500);
  });
});
