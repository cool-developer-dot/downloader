import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  applyProgressEvent,
  applyStateEvent,
  checkDataLimits,
  dayKey,
  EMPTY_DATA_USAGE,
  mbToBytes,
  monthKey,
  normalizeLimitMb,
  parseDataUsage,
  resetCounters,
  summarizeDataUsage,
  type DataUsageState,
} from './data-usage';

const T = new Date(2026, 9, 15, 12, 0).getTime(); // 2026-10-15 12:00 local
const MB = 1024 * 1024;

function progress(state: DataUsageState, id: string, bytesDone: number, at = T, phase: 'download' | 'processing' = 'download') {
  return applyProgressEvent(state, { id, phase, bytesDone }, at);
}

describe('counting', () => {
  test('a new download counts every byte through its deltas', () => {
    let s = applyStateEvent(EMPTY_DATA_USAGE, { id: 'a', state: 'queued', bytesDone: 0 });
    s = progress(s, 'a', 100);
    s = progress(s, 'a', 250);
    s = progress(s, 'a', 1000);
    assert.equal(s.totalBytes, 1000);
    assert.equal(s.days[dayKey(T)], 1000);
    assert.equal(s.months[monthKey(T)], 1000);
  });

  test('pause and resume never double-count', () => {
    let s = applyStateEvent(EMPTY_DATA_USAGE, { id: 'a', state: 'queued', bytesDone: 0 });
    s = progress(s, 'a', 500);
    s = applyStateEvent(s, { id: 'a', state: 'paused', bytesDone: 500 });
    s = applyStateEvent(s, { id: 'a', state: 'downloading', bytesDone: 500 });
    s = progress(s, 'a', 500);
    s = progress(s, 'a', 800);
    assert.equal(s.totalBytes, 800);
  });

  test('a resume after the app restarted continues from the persisted baseline', () => {
    let s = applyStateEvent(EMPTY_DATA_USAGE, { id: 'a', state: 'queued', bytesDone: 0 });
    s = progress(s, 'a', 400);
    const restored = parseDataUsage(JSON.stringify(s));
    const after = progress(restored, 'a', 700);
    assert.equal(after.totalBytes, 700);
  });

  test('a download first seen mid-way counts only what it fetches from then on', () => {
    let s = applyStateEvent(EMPTY_DATA_USAGE, { id: 'old', state: 'downloading', bytesDone: 5000 });
    s = progress(s, 'old', 5200);
    assert.equal(s.totalBytes, 200);

    let p = progress(EMPTY_DATA_USAGE, 'p', 9000); // progress before any state event: baseline only
    assert.equal(p.totalBytes, 0);
    p = progress(p, 'p', 9100);
    assert.equal(p.totalBytes, 100);
  });

  test('a restart from zero counts only the new bytes from that point', () => {
    let s = applyStateEvent(EMPTY_DATA_USAGE, { id: 'a', state: 'queued', bytesDone: 0 });
    s = progress(s, 'a', 1000);
    s = progress(s, 'a', 300); // server answered 200: restarted from 0
    s = progress(s, 'a', 600);
    assert.equal(s.totalBytes, 1000 + 300 + 300);
  });

  test('processing progress and garbage are ignored', () => {
    let s = applyStateEvent(EMPTY_DATA_USAGE, { id: 'a', state: 'queued', bytesDone: 0 });
    s = progress(s, 'a', 100);
    s = progress(s, 'a', 99999, T, 'processing');
    s = progress(s, 'a', Number.NaN);
    s = progress(s, 'a', -5);
    s = progress(s, '', 100);
    assert.equal(s.totalBytes, 100);
  });

  test('completion counts once and drops the baseline', () => {
    let s = applyStateEvent(EMPTY_DATA_USAGE, { id: 'a', state: 'queued', bytesDone: 0 });
    s = applyStateEvent(s, { id: 'a', state: 'completed', bytesDone: 10 });
    s = applyStateEvent(s, { id: 'a', state: 'completed', bytesDone: 10 });
    assert.equal(s.completedCount, 1);
    assert.equal(s.baselines.a, undefined);
    const f = applyStateEvent(applyStateEvent(EMPTY_DATA_USAGE, { id: 'b', state: 'queued', bytesDone: 0 }), {
      id: 'b',
      state: 'failed',
      bytesDone: 0,
    });
    assert.equal(f.baselines.b, undefined);
    assert.equal(f.completedCount, 0);
  });
});

describe('buckets and rollover', () => {
  test('bytes land in the local day and month of the event', () => {
    const lateOct31 = new Date(2026, 9, 31, 23, 59, 30).getTime();
    const earlyNov1 = new Date(2026, 10, 1, 0, 0, 30).getTime();
    let s = applyStateEvent(EMPTY_DATA_USAGE, { id: 'a', state: 'queued', bytesDone: 0 });
    s = progress(s, 'a', 100, lateOct31);
    s = progress(s, 'a', 350, earlyNov1);
    assert.equal(s.days['2026-10-31'], 100);
    assert.equal(s.days['2026-11-01'], 250);
    assert.equal(s.months['2026-10'], 100);
    assert.equal(s.months['2026-11'], 250);
    const summary = summarizeDataUsage(s, earlyNov1);
    assert.equal(summary.todayBytes, 250);
    assert.equal(summary.monthBytes, 250);
    assert.equal(summary.last30DaysBytes, 350);
    assert.equal(summary.totalBytes, 350);
  });

  test('the last 30 days exclude day 31', () => {
    const now = new Date(2026, 9, 31, 12).getTime();
    const s: DataUsageState = {
      ...EMPTY_DATA_USAGE,
      days: { '2026-10-02': 5, '2026-10-01': 7, '2026-10-31': 1 },
      totalBytes: 13,
    };
    assert.equal(summarizeDataUsage(s, now).last30DaysBytes, 6);
  });

  test('old buckets are pruned', () => {
    let s = applyStateEvent(EMPTY_DATA_USAGE, { id: 'a', state: 'queued', bytesDone: 0 });
    for (let d = 0; d < 100; d += 1) {
      s = progress(s, 'a', (d + 1) * 10, new Date(2026, 0, 1 + d, 12).getTime());
    }
    assert.ok(Object.keys(s.days).length <= 62);
    assert.equal(s.totalBytes, 1000);
  });
});

describe('limits', () => {
  test('alerts once per day and once per month', () => {
    let s: DataUsageState = { ...EMPTY_DATA_USAGE, days: { [dayKey(T)]: 600 * MB }, months: { [monthKey(T)]: 600 * MB } };
    const first = checkDataLimits(s, { dailyMb: 500, monthlyMb: 1000 }, T);
    assert.deepEqual(first.alerts.map((a) => a.period), ['day']);
    s = first.state;
    assert.equal(checkDataLimits(s, { dailyMb: 500, monthlyMb: 1000 }, T).alerts.length, 0);
    s = { ...s, days: { ...s.days, [dayKey(T)]: 1200 * MB }, months: { [monthKey(T)]: 1200 * MB } };
    assert.deepEqual(checkDataLimits(s, { dailyMb: 500, monthlyMb: 1000 }, T).alerts.map((a) => a.period), ['month']);
    const tomorrow = T + 24 * 3600 * 1000;
    s = { ...s, days: { ...s.days, [dayKey(tomorrow)]: 501 * MB } };
    assert.deepEqual(checkDataLimits(s, { dailyMb: 500, monthlyMb: 0 }, tomorrow).alerts.map((a) => a.period), ['day']);
  });

  test('off by default and below the limit', () => {
    const s: DataUsageState = { ...EMPTY_DATA_USAGE, days: { [dayKey(T)]: 9e12 } };
    assert.equal(checkDataLimits(s, { dailyMb: 0, monthlyMb: 0 }, T).alerts.length, 0);
    assert.equal(checkDataLimits({ ...EMPTY_DATA_USAGE }, { dailyMb: 1, monthlyMb: 1 }, T).alerts.length, 0);
  });

  test('limit helpers', () => {
    assert.equal(mbToBytes(2), 2 * MB);
    assert.equal(mbToBytes(-1), 0);
    assert.equal(normalizeLimitMb('500'), 500);
    assert.equal(normalizeLimitMb(-3), 0);
    assert.equal(normalizeLimitMb(Number.NaN), 0);
    assert.equal(normalizeLimitMb(1e12), 10 * 1024 * 1024);
  });
});

describe('storage and reset', () => {
  test('reset zeroes the counters but keeps baselines, so nothing is recounted', () => {
    let s = applyStateEvent(EMPTY_DATA_USAGE, { id: 'a', state: 'queued', bytesDone: 0 });
    s = progress(s, 'a', 500);
    s = resetCounters(s);
    assert.equal(s.totalBytes, 0);
    s = progress(s, 'a', 600);
    assert.equal(s.totalBytes, 100);
  });

  test('parse survives garbage and other versions', () => {
    assert.deepEqual(parseDataUsage(null), EMPTY_DATA_USAGE);
    assert.deepEqual(parseDataUsage('{nope'), EMPTY_DATA_USAGE);
    assert.deepEqual(parseDataUsage(JSON.stringify({ version: 99 })), EMPTY_DATA_USAGE);
    const parsed = parseDataUsage(JSON.stringify({ version: 1, days: { a: 5, b: 'x', c: -1 }, totalBytes: 'no', completedIds: [1, 'k'] }));
    assert.deepEqual(parsed.days, { a: 5 });
    assert.equal(parsed.totalBytes, 0);
    assert.deepEqual(parsed.completedIds, ['k']);
  });
});
