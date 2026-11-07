import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { BROWSING_DATA_RANGES, normalizeBrowsingDataRange, rangeStartMs } from './browsing-data-range.ts';
import { planHistorySeed } from './debug/history-seed.ts';
import { formatExportTime, historyExportCsv, historyExportFileName } from './history-export.ts';
import { historySubtitle, matchesQuery, splitHighlight } from './history-highlight.ts';
import { shouldSaveVisit } from './history-policy.ts';

const NOW = Date.parse('2026-11-08T12:00:00.000Z');
const HOUR = 3_600_000;

describe('B10 #98 time ranges', () => {
  test('each range starts where its name says; All time has no start', () => {
    assert.deepEqual(BROWSING_DATA_RANGES, ['hour', 'day', 'week', 'fourWeeks', 'all']);
    assert.equal(rangeStartMs('hour', NOW), NOW - HOUR);
    assert.equal(rangeStartMs('day', NOW), NOW - 24 * HOUR);
    assert.equal(rangeStartMs('week', NOW), NOW - 7 * 24 * HOUR);
    assert.equal(rangeStartMs('fourWeeks', NOW), NOW - 28 * 24 * HOUR);
    assert.equal(rangeStartMs('all', NOW), null);
  });

  test('an unknown range falls back to the smallest', () => {
    assert.equal(normalizeBrowsingDataRange('forever'), 'hour');
    assert.equal(normalizeBrowsingDataRange('week'), 'week');
  });
});

describe('B10 #95 highlight', () => {
  test('marks every match, ignoring case for A–Z like SQLite LIKE', () => {
    assert.deepEqual(splitHighlight('Lahore Fort and lahore museum', 'LAHORE'), [
      { text: 'Lahore', match: true },
      { text: ' Fort and ', match: false },
      { text: 'lahore', match: true },
      { text: ' museum', match: false },
    ]);
  });

  test('Urdu matches as typed; no query or no match is plain text', () => {
    assert.deepEqual(splitHighlight('بادشاہی مسجد — لاہور', 'لاہور'), [
      { text: 'بادشاہی مسجد — ', match: false },
      { text: 'لاہور', match: true },
    ]);
    assert.deepEqual(splitHighlight('Example', '  '), [{ text: 'Example', match: false }]);
    assert.deepEqual(splitHighlight('Example', 'zzz'), [{ text: 'Example', match: false }]);
    assert.deepEqual(splitHighlight('', 'x'), []);
  });

  test('folding keeps positions: non-ASCII letters are compared as they are (as LIKE does)', () => {
    assert.equal(matchesQuery('İstanbul', 'i̇stanbul'), false);
    assert.deepEqual(
      splitHighlight('ÄBC abc', 'abc').map((p) => p.match),
      [false, true],
    );
  });

  test('the second line shows the URL only when the match is in its path', () => {
    const entry = { url: 'https://example.com/docs/needle', hostname: 'example.com' };
    assert.equal(historySubtitle(entry, ''), 'example.com');
    assert.equal(historySubtitle(entry, 'example'), 'example.com');
    assert.equal(historySubtitle(entry, 'needle'), 'https://example.com/docs/needle');
    assert.equal(historySubtitle(entry, 'missing'), 'example.com');
  });

  test('highlighting 5,000 rows stays well under a frame budget per row', () => {
    const titles = Array.from({ length: 5000 }, (_, i) => `Page ${i} about Lahore and Karachi — لاہور ${i}`);
    const started = performance.now();
    let matches = 0;
    for (const title of titles) matches += splitHighlight(title, 'lahore').filter((p) => p.match).length;
    const elapsed = performance.now() - started;
    assert.equal(matches, 5000);
    assert.ok(elapsed < 200, `5,000 titles took ${elapsed.toFixed(1)} ms`);
  });
});

describe('B10 #103 CSV', () => {
  const headers = { title: 'Title', url: 'URL', lastVisit: 'Last visit', visitCount: 'Visits' };

  test('UTF-8 BOM, CRLF, one row per page with its visit count; Urdu kept', () => {
    const csv = historyExportCsv(
      [
        { title: 'لاہور', url: 'https://ur.wikipedia.org/wiki/لاہور', lastVisitedAt: 'X', visitCount: 3 },
        { title: 'Example, "quoted"', url: 'https://example.com/', lastVisitedAt: 'Y', visitCount: 1 },
      ],
      headers,
      (iso) => `t:${iso}`,
    );
    assert.equal(csv.charCodeAt(0), 0xfeff);
    assert.equal(
      csv.slice(1),
      'Title,URL,Last visit,Visits\r\n' +
        'لاہور,https://ur.wikipedia.org/wiki/لاہور,t:X,3\r\n' +
        '"Example, ""quoted""",https://example.com/,t:Y,1\r\n',
    );
  });

  test('a cell a spreadsheet would run as a formula starts with an apostrophe', () => {
    const csv = historyExportCsv(
      [{ title: '=HYPERLINK("x")', url: 'https://e.test/', lastVisitedAt: 'Z', visitCount: 2 }],
      headers,
      (iso) => iso,
    );
    assert.match(csv, /\r\n"'=HYPERLINK\(""x""\)",https:\/\/e\.test\/,Z,2\r\n$/);
  });

  test('times in local time, file name with the date', () => {
    const local = new Date(2026, 10, 8, 9, 5);
    assert.equal(formatExportTime(local.toISOString()), '2026-11-08 09:05');
    assert.equal(formatExportTime('not a time'), 'not a time');
    assert.equal(historyExportFileName(local), 'vidorax-history-2026-11-08.csv');
  });
});

describe('B10 #101 what may be saved', () => {
  test('History off saves nothing; on saves for ordinary tabs and for visits without a tab', () => {
    assert.equal(shouldSaveVisit(false, { id: 't1' }), false);
    assert.equal(shouldSaveVisit(false, undefined), false);
    assert.equal(shouldSaveVisit(true, { id: 't1' }), true);
    assert.equal(shouldSaveVisit(undefined, null), true); // old settings without the key: today's behaviour
  });
});

describe('B10 debug seed (debug builds only)', () => {
  test('5,000 entries over 8 weeks, with some in every range', () => {
    const seed = planHistorySeed(5000, NOW);
    assert.equal(seed.length, 5000);
    const ages = seed.map((v) => NOW - Date.parse(v.visitedAt));
    for (const range of ['hour', 'day', 'week', 'fourWeeks'] as const) {
      const start = rangeStartMs(range, NOW)!;
      assert.ok(ages.some((age) => NOW - age >= start), `${range} has entries`);
      assert.ok(ages.some((age) => NOW - age < start), `${range} leaves older entries`);
    }
    assert.ok(Math.max(...ages) <= 56 * 24 * HOUR);
    assert.equal(new Set(seed.map((v) => v.url)).size, 5000);
    assert.ok(seed.some((v) => /لاہور/.test(v.title)));
    assert.equal(planHistorySeed(-3, NOW).length, 0);
  });
});
