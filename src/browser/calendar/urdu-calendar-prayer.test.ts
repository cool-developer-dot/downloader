import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { applyBrowserTables } from '@/storage/sqlite/schema';
import { listNotes, insertNote } from '@/storage/repositories/notes.queries';
import { foldedLikePattern, foldedSql, needsUrduFold } from '@/storage/repositories/urdu-fold-sql';
import { titleUrlHostSearchClause } from '@/storage/repositories/title-url-search';
import { splitHighlight } from '@/browser/history/history-highlight';
import { classifyNavigationInput } from '@/browser/utils/url';
import { fieldForcesLtr, firstStrongDirection, inputDirectionStyle, normalizeAddressDigits, toUrduDigits } from '@/utils/text-direction';

import { clampHijriAdjust, intlHijriWorks, makeHijriConverter, monthGrid, tabularHijri } from './hijri.ts';
import {
  formatCountdown,
  formatPrayerTime,
  nextPrayer,
  parseCoordinates,
  prayerTimesFor,
  resolvePlace,
} from '../prayer/prayer-times.ts';

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

describe('B24 #271 Urdu input', () => {
  test('caret and alignment follow the first strong letter; empty follows the app', () => {
    assert.equal(firstStrongDirection('لاہور weather'), 'rtl');
    assert.equal(firstStrongDirection('  2026 weather لاہور'), 'ltr');
    assert.equal(firstStrongDirection('۲۰۲۶ ...'), null, 'digits and punctuation are not strong');
    assert.deepEqual(inputDirectionStyle('https://example.com', true), { textAlign: 'left', writingDirection: 'ltr' });
    assert.deepEqual(inputDirectionStyle('اردو', false), { textAlign: 'right', writingDirection: 'rtl' });
    assert.deepEqual(inputDirectionStyle('', true), { textAlign: 'right', writingDirection: 'rtl' });
    assert.equal(toUrduDigits('12:05'), '۱۲:۰۵');
  });

  test('PIN, password, number, phone, URL and e-mail fields stay left-to-right (B24 fix)', () => {
    for (const props of [
      { secureTextEntry: true },
      { keyboardType: 'number-pad' },
      { keyboardType: 'phone-pad' },
      { keyboardType: 'email-address' },
      { keyboardType: 'url' },
      { keyboardType: 'decimal-pad' },
      { inputMode: 'numeric' },
      { textContentType: 'oneTimeCode' },
      { autoComplete: 'email' },
      { autoComplete: 'password' },
    ]) {
      assert.ok(fieldForcesLtr(props), JSON.stringify(props));
    }
    assert.ok(!fieldForcesLtr({}), 'an ordinary field follows its text');
    assert.ok(!fieldForcesLtr({ keyboardType: 'default', autoComplete: 'off' }));
    assert.ok(!fieldForcesLtr({ keyboardType: 'web-search' }), 'the address bar follows what is typed');
  });

  test('an address typed with Eastern digits opens; Urdu words and mixed text are searches, correctly encoded', () => {
    assert.equal(normalizeAddressDigits('۱۹۲.۱۶۸.۱.۱'), '192.168.1.1');
    assert.equal(normalizeAddressDigits('example.com/٢٠٢٦'), 'example.com/2026');
    assert.equal(normalizeAddressDigits('لاہور ۲۰۲۶'), 'لاہور ۲۰۲۶');
    const ip = classifyNavigationInput('۱۹۲.۱۶۸.۱.۱');
    assert.equal(ip.kind, 'navigate');
    const search = classifyNavigationInput('لاہور weather ۲۰۲۶');
    assert.equal(search.kind, 'search');
    if (search.kind === 'search') {
      assert.ok(search.url.includes(encodeURIComponent('لاہور weather ۲۰۲۶')) || search.url.includes(encodeURIComponent('لاہور').replace(/%20/g, '+')));
      assert.ok(!/[؀-ۿ ]/.test(search.url), 'every Urdu letter and space is percent-encoded');
    }
  });

  test('Urdu matching in SQL searches: letter forms, diacritics and Eastern digits (only for Arabic-script queries)', async () => {
    assert.ok(needsUrduFold('پاکستان'));
    assert.ok(needsUrduFold('۲۰۲۶'));
    assert.ok(!needsUrduFold('pakistan 2026'));
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec('CREATE TABLE t (title TEXT)');
    for (const title of ['پاكستان كى تاريخ', 'مُحَمَّد علی جناح', 'سال ۲۰۲۶ کا بجٹ', 'English only']) sqlite.prepare('INSERT INTO t VALUES (?)').run(title);
    const find = (q: string) =>
      (sqlite.prepare(`SELECT title FROM t WHERE ${foldedSql('title')} LIKE ? ESCAPE '\\'`).all(foldedLikePattern(q)) as { title: string }[]).map((r) => r.title);
    assert.deepEqual(find('پاکستان کی'), ['پاكستان كى تاريخ'], 'Arabic ك / ى typed, Urdu ک / ی searched');
    assert.deepEqual(find('محمد'), ['مُحَمَّد علی جناح'], 'diacritics ignored');
    assert.deepEqual(find('2026'.replace(/\d/g, (d) => String.fromCharCode(0x06f0 + Number(d)))), ['سال ۲۰۲۶ کا بجٹ']);
    assert.deepEqual(find('٪'), [], 'a sign that is no letter matches nothing here');
  });

  test('the History / bookmarks clause runs on SQLite, Urdu folded and English as before', () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec('CREATE TABLE h (title TEXT, url TEXT, hostname TEXT)');
    sqlite.prepare('INSERT INTO h VALUES (?, ?, ?)').run('پاكستان كى خبريں', 'https://ur.example/news', 'ur.example');
    sqlite.prepare('INSERT INTO h VALUES (?, ?, ?)').run('Pakistan News', 'https://en.example/news', 'en.example');
    const run = (q: string) => {
      const { clause, params } = titleUrlHostSearchClause(q);
      return (sqlite.prepare(`SELECT title FROM h ${clause}`).all(...params) as { title: string }[]).map((r) => r.title);
    };
    assert.deepEqual(run('پاکستان کی'), ['پاكستان كى خبريں']);
    assert.deepEqual(run('pakistan'), ['Pakistan News']);
    assert.deepEqual(run('example'), ['پاكستان كى خبريں', 'Pakistan News']);
    assert.deepEqual(titleUrlHostSearchClause('  '), { clause: '', params: [] });
  });

  test('notes search folds Urdu; other searches unchanged', async () => {
    const sqlite = new DatabaseSync(':memory:');
    const db = {
      async execAsync(sql: string) {
        sqlite.exec(sql);
      },
      async runAsync(sql: string, ...p: (string | number | null)[]) {
        return { changes: Number(sqlite.prepare(sql).run(...p).changes) };
      },
      async getAllAsync<T>(sql: string, ...p: (string | number | null)[]) {
        return sqlite.prepare(sql).all(...p) as T[];
      },
      async getFirstAsync<T>(sql: string, ...p: (string | number | null)[]) {
        return (sqlite.prepare(sql).get(...p) ?? null) as T | null;
      },
    };
    await applyBrowserTables(db as never);
    await insertNote(db as never, { id: 'a', text: 'شالامار باغ كى سير', pageUrl: '', pageTitle: '' }, '2026-11-09T10:00:00Z');
    await insertNote(db as never, { id: 'b', text: 'Badshahi Mosque', pageUrl: '', pageTitle: '' }, '2026-11-09T11:00:00Z');
    assert.deepEqual((await listNotes(db as never, 'باغ کی')).map((n) => n.id), ['a']);
    assert.deepEqual((await listNotes(db as never, 'mosque')).map((n) => n.id), ['b']);
  });

  test('the history highlight marks exactly what the folded search matched', () => {
    assert.deepEqual(splitHighlight('پاكستان زندہ باد', 'پاکستان'), [
      { text: 'پاكستان', match: true },
      { text: ' زندہ باد', match: false },
    ]);
    assert.deepEqual(splitHighlight('قائدِ اعظم مُحَمَّد', 'محمد'), [
      { text: 'قائدِ اعظم ', match: false },
      { text: 'مُحَمَّد', match: true },
    ]);
    assert.deepEqual(splitHighlight('VidoraX Browser', 'browser'), [
      { text: 'VidoraX ', match: false },
      { text: 'Browser', match: true },
    ], 'English unchanged');
  });
});

describe('B24 #269 dual calendar', () => {
  // Published Umm al-Qura dates (api.aladhan.com/v1/gToH/<date>?calendarMethod=UAQ, fetched 2026-11-09):
  // 18-02-2026 = 1 Ramadan 1447, 15-03-2026 = 26 Ramadan 1447, 16-06-2026 = 1 Muharram 1448.
  const PUBLISHED: [number, number, number, number, number, number][] = [
    [2026, 2, 18, 1447, 9, 1],
    [2026, 3, 15, 1447, 9, 26],
    [2026, 6, 16, 1448, 1, 1],
  ];

  test('Intl’s Umm al-Qura path (Node has full ICU) gives the published dates', () => {
    const intl = makeHijriConverter(Intl);
    assert.equal(intl.source, 'intl');
    for (const [y, m, d, hy, hm, hd] of PUBLISHED) assert.deepEqual(intl.convert(y, m, d), { year: hy, month: hm, day: hd }, `${y}-${m}-${d}`);
  });

  test('the bundled calculation equals Intl’s islamic-civil every day for 30 years, and is within a day of the published dates', () => {
    const civil = new Intl.DateTimeFormat('en-u-ca-islamic-civil-nu-latn', { timeZone: 'UTC', day: 'numeric', month: 'numeric', year: 'numeric' });
    for (let t = Date.UTC(2000, 0, 1); t < Date.UTC(2030, 0, 1); t += 86_400_000) {
      const date = new Date(t + 12 * 3_600_000);
      const parts = civil.formatToParts(date);
      const num = (type: string) => Number(parts.find((p) => p.type === type)!.value.replace(/[^0-9]/g, ''));
      const got = tabularHijri(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
      if (got.year !== num('year') || got.month !== num('month') || got.day !== num('day')) {
        assert.fail(`${date.toISOString().slice(0, 10)}: ${JSON.stringify(got)} vs ${num('year')}-${num('month')}-${num('day')}`);
      }
    }
    for (const [y, m, d, hy, hm, hd] of PUBLISHED) {
      const got = tabularHijri(y, m, d);
      const diff = got.year === hy && got.month === hm ? got.day - hd : NaN;
      assert.ok(Math.abs(diff) <= 1 || (hd === 1 && got.day >= 29), `${y}-${m}-${d}: ${JSON.stringify(got)}`);
    }
  });

  test('a phone whose Intl lacks the calendar uses the bundled one; the adjustment moves ±2 days; month view', () => {
    const gregorianOnly = {
      DateTimeFormat: function () {
        return { formatToParts: () => [{ type: 'year', value: '2026' }, { type: 'month', value: '2' }, { type: 'day', value: '18' }] };
      } as unknown as typeof Intl.DateTimeFormat,
    };
    assert.equal(intlHijriWorks(gregorianOnly), false);
    assert.equal(intlHijriWorks(undefined), false);
    const throwing = { DateTimeFormat: function () { throw new RangeError('calendar'); } as unknown as typeof Intl.DateTimeFormat };
    const bundled = makeHijriConverter(throwing);
    assert.equal(bundled.source, 'bundled');
    assert.deepEqual(bundled.convert(2026, 3, 15), tabularHijri(2026, 3, 15));
    const intl = makeHijriConverter(Intl);
    assert.deepEqual(intl.convert(2026, 2, 18, -1), { year: 1447, month: 8, day: 29 });
    assert.deepEqual(intl.convert(2026, 2, 17, 1), { year: 1447, month: 9, day: 1 });
    assert.equal(clampHijriAdjust(5), 2);
    assert.equal(clampHijriAdjust(-9), -2);
    const weeks = monthGrid(2026, 2, (y, m, d) => intl.convert(y, m, d));
    assert.equal(weeks[0][6]?.day, 1, 'February 2026 starts on a Sunday (Monday-first weeks)');
    assert.equal(weeks.flat().filter(Boolean).length, 28);
    assert.deepEqual(weeks.flat().find((c) => c?.day === 18)?.hijri, { year: 1447, month: 9, day: 1 });
  });
});

describe('B24 #270 prayer times (Karachi method, Asr Hanafi) against published times', () => {
  // api.aladhan.com/v1/timings/15-03-2026?latitude=…&longitude=…&method=1&school=1&timezonestring=… (fetched 2026-11-09)
  const PUBLISHED = {
    lahore: { lat: 31.5497, lng: 74.3436, tz: 'Asia/Karachi', fajr: '04:52', sunrise: '06:13', dhuhr: '12:12', asr: '16:28', maghrib: '18:11', isha: '19:31' },
    london: { lat: 51.5074, lng: -0.1278, tz: 'Europe/London', fajr: '04:23', sunrise: '06:15', dhuhr: '12:09', asr: '16:08', maghrib: '18:05', isha: '19:57' },
  } as const;

  for (const [name, p] of Object.entries(PUBLISHED)) {
    test(`${name}, 15 March 2026: every time within 2 minutes`, () => {
      const day = prayerTimesFor({ lat: p.lat, lng: p.lng, tz: p.tz }, { year: 2026, month: 3, day: 15 }, 'hanafi');
      for (const prayer of ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'] as const) {
        const got = minutes(formatPrayerTime(day[prayer], p.tz));
        assert.ok(Math.abs(got - minutes(p[prayer])) <= 2, `${prayer}: ${formatPrayerTime(day[prayer], p.tz)} vs ${p[prayer]}`);
      }
    });
  }

  test('Shafi Asr is earlier; places, coordinates by hand, next prayer and countdown', () => {
    const place = resolvePlace('lahore', '');
    const hanafi = prayerTimesFor(place, { year: 2026, month: 3, day: 15 }, 'hanafi');
    const shafi = prayerTimesFor(place, { year: 2026, month: 3, day: 15 }, 'shafi');
    assert.ok(shafi.asr.getTime() < hanafi.asr.getTime() - 30 * 60000);
    assert.deepEqual(parseCoordinates('31.55, 74.34'), { lat: 31.55, lng: 74.34 });
    assert.deepEqual(parseCoordinates('۳۱.۵۵، ۷۴.۳۴'), { lat: 31.55, lng: 74.34 });
    assert.equal(parseCoordinates('95, 10'), null);
    assert.deepEqual(resolvePlace('nowhere', ''), { lat: 31.5497, lng: 74.3436, tz: 'Asia/Karachi' });
    assert.deepEqual(resolvePlace('lahore', '24.86, 67.0'), { lat: 24.86, lng: 67, tz: null });
    const afterAsr = new Date(hanafi.asr.getTime() + 60000);
    const next = nextPrayer(hanafi, new Date(hanafi.fajr.getTime() + 86_400_000), afterAsr);
    assert.equal(next.name, 'maghrib');
    const late = nextPrayer(hanafi, new Date(hanafi.fajr.getTime() + 86_400_000), new Date(hanafi.isha.getTime() + 60000));
    assert.equal(late.name, 'fajr');
    assert.equal(formatCountdown(125), '2:05');
  });
});
