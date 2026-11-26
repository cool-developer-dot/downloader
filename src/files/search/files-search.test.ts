import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { FileType } from '@/files/ui/file-types';

import {
  DEFAULT_OLD_MONTHS,
  extensionsPresent,
  GB,
  hasFilters,
  inDateRange,
  inSizeBucket,
  isOld,
  isRecent,
  MB,
  searchFiles,
  type SearchInput,
  type SearchItem,
} from './files-search';

const DAY = 24 * 60 * 60 * 1000;
/** A fixed "now": 25 Nov 2026, 12:00 UTC. */
const NOW = Date.UTC(2026, 10, 25, 12, 0, 0);
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

const item = (id: string, name: string, extra: Partial<SearchItem> = {}): SearchItem => ({
  id,
  name,
  type: 'video' as FileType,
  sizeBytes: 5 * MB,
  date: ago(1),
  folderId: null,
  ...extra,
});

const run = (items: SearchItem[], input: Partial<SearchInput>) =>
  searchFiles(items, { query: '', filters: {}, sort: 'best', now: NOW, ...input }).map((hit) => hit.item.id);

describe('Files F6: search', () => {
  test('name matching ignores case and accents; the bold part is the match in the name', () => {
    const items = [item('1', 'Café Trip.mp4'), item('2', 'cafe night.MP4'), item('3', 'Other.mp4')];
    assert.deepEqual(run(items, { query: 'CAFE' }), ['1', '2']);
    assert.deepEqual(run(items, { query: 'café' }), ['1', '2']);
    const [hit] = searchFiles(items, { query: 'trip', filters: {}, sort: 'best', now: NOW });
    assert.deepEqual(hit!.nameMatch, { start: 5, end: 9 });
  });

  test('an Urdu query matches with or without vowel marks', () => {
    const items = [item('u1', 'سفرِ پاکستان.mp4'), item('u2', 'شادی.mp4')];
    assert.deepEqual(run(items, { query: 'سفر پاکستان' }), ['u1']);
    assert.deepEqual(run(items, { query: 'شادی' }), ['u2']);
    const [hit] = searchFiles(items, { query: 'پاکستان', filters: {}, sort: 'best', now: NOW });
    // The bold part covers the word in the original name (after the vowel mark).
    assert.equal(items[0]!.name.slice(hit!.nameMatch!.start, hit!.nameMatch!.end), 'پاکستان');
  });

  test('folder names, tags and notes match too', () => {
    const items = [
      item('f', 'a.mp4', { folderName: 'Holidays' }),
      item('t', 'b.mp4', { tags: ['work'] }),
      item('n', 'c.mp4', { note: 'birthday of Ali' }),
    ];
    assert.deepEqual(run(items, { query: 'holiday' }), ['f']);
    assert.deepEqual(run(items, { query: 'WORK' }), ['t']);
    assert.deepEqual(run(items, { query: 'ali' }), ['n']);
  });

  test('an extension query: "mp4" and ".mp4" find every .mp4 file; the Extension chip lists what is there', () => {
    const items = [item('1', 'a.mp4'), item('2', 'B.MP4'), item('3', 'c.mkv'), item('4', 'mp4 notes.txt', { type: 'doc' })];
    // ".mp4" is the extension; "mp4" is the extension, and a name with "mp4" in it too.
    assert.deepEqual(run(items, { query: '.mp4' }).sort(), ['1', '2']);
    assert.deepEqual(run(items, { query: 'mp4' }).sort(), ['1', '2', '4']);
    assert.deepEqual(run(items, { filters: { extension: '.MP4' } }), ['1', '2']);
    assert.deepEqual(extensionsPresent(items), ['mp4', 'mkv', 'txt']);
  });

  test('every size boundary: 100 MB is in 10–100 MB, 10 MB is too, 1 GB is in 100 MB–1 GB', () => {
    assert.equal(inSizeBucket(10 * MB - 1, 'under-10mb'), true);
    assert.equal(inSizeBucket(10 * MB, 'under-10mb'), false);
    assert.equal(inSizeBucket(10 * MB, '10-100mb'), true);
    assert.equal(inSizeBucket(100 * MB, '10-100mb'), true);
    assert.equal(inSizeBucket(100 * MB, '100mb-1gb'), false);
    assert.equal(inSizeBucket(100 * MB + 1, '100mb-1gb'), true);
    assert.equal(inSizeBucket(GB, '100mb-1gb'), true);
    assert.equal(inSizeBucket(GB, 'over-1gb'), false);
    assert.equal(inSizeBucket(GB + 1, 'over-1gb'), true);
  });

  test('every date boundary: exactly 7 days ago is in "7 days", a moment more is not', () => {
    assert.equal(inDateRange(ago(7), '7-days', NOW), true);
    assert.equal(inDateRange(new Date(NOW - 7 * DAY - 1).toISOString(), '7-days', NOW), false);
    assert.equal(inDateRange(ago(30), '30-days', NOW), true);
    assert.equal(inDateRange(new Date(NOW - 30 * DAY - 1).toISOString(), '30-days', NOW), false);
    assert.equal(inDateRange(new Date(NOW).toISOString(), 'today', NOW), true);
    assert.equal(inDateRange(ago(2), 'today', NOW), false);
    assert.equal(inDateRange(ago(2), 'this-year', NOW), true);
    assert.equal(inDateRange(new Date(Date.UTC(2025, 5, 1)).toISOString(), 'this-year', NOW), false);
    // A custom range holds whole days, both ends included.
    assert.equal(inDateRange(ago(3), { from: ago(3), to: ago(3) }, NOW), true);
    assert.equal(inDateRange(ago(5), { from: ago(4), to: ago(1) }, NOW), false);
    assert.equal(inDateRange(null, '30-days', NOW), false);
  });

  test('old (3, 6, 12 months; default 6) and recent (downloaded, renamed or edited in 7 days)', () => {
    assert.equal(DEFAULT_OLD_MONTHS, 6);
    assert.equal(isOld(ago(200), 6, NOW), true);
    assert.equal(isOld(ago(150), 6, NOW), false);
    assert.equal(isOld(ago(100), 3, NOW), true);
    assert.equal(isOld(ago(300), 12, NOW), false);
    assert.equal(isRecent({ date: ago(3) }, NOW), true);
    assert.equal(isRecent({ date: ago(30) }, NOW), false);
    assert.equal(isRecent({ date: ago(30), changedAt: ago(2) }, NOW), true);
  });

  test('chips combine with AND', () => {
    const items = [
      item('match', 'a.mp4', { sizeBytes: 50 * MB, date: ago(2) }),
      item('too-big', 'b.mp4', { sizeBytes: 500 * MB, date: ago(2) }),
      item('too-old', 'c.mp4', { sizeBytes: 50 * MB, date: ago(40) }),
      item('audio', 'd.mp3', { type: 'audio', sizeBytes: 50 * MB, date: ago(2) }),
    ];
    const filters = { types: ['video' as FileType], size: '10-100mb' as const, date: '7-days' as const };
    assert.deepEqual(run(items, { filters }), ['match']);
    assert.equal(hasFilters(filters), true);
    assert.equal(hasFilters({}), false);
  });

  test('each sort, and ties keep their order', () => {
    const items = [
      item('b', 'b.mp4', { sizeBytes: 3, date: ago(3) }),
      item('a', 'a.mp4', { sizeBytes: 9, date: ago(1) }),
      item('c', 'c.mp4', { sizeBytes: 9, date: ago(2) }),
    ];
    assert.deepEqual(run(items, { sort: 'name' }), ['a', 'b', 'c']);
    assert.deepEqual(run(items, { sort: 'date' }), ['a', 'c', 'b']);
    assert.deepEqual(run(items, { sort: 'size' }), ['a', 'c', 'b']);
    // Best match with nothing typed: every file ties, so the list order stays.
    assert.deepEqual(run(items, { sort: 'best' }), ['b', 'a', 'c']);
    // A name that starts with the query beats one that has it inside.
    assert.deepEqual(run([item('in', 'my trip.mp4'), item('start', 'trip.mp4')], { query: 'trip', sort: 'best' }), ['start', 'in']);
  });

  test('Private files and locked-folder files never match', () => {
    const items = [item('open', 'trip.mp4'), item('locked', 'trip 2.mp4', { folderId: 'L' })];
    assert.deepEqual(run(items, { query: 'trip', hiddenFolderIds: new Set(['L']) }), ['open']);
    // Private files are not in Files' list at all; nothing else can bring them back.
    assert.deepEqual(run([], { query: 'trip' }), []);
  });

  test('5,000 items filter in under 50 ms', () => {
    const many: SearchItem[] = Array.from({ length: 5000 }, (_, index) =>
      item(String(index), `Clip ${index} holiday.${index % 3 === 0 ? 'mp4' : 'mkv'}`, {
        sizeBytes: (index % 200) * MB,
        date: ago(index % 400),
        tags: index % 7 === 0 ? ['work'] : [],
        note: index % 11 === 0 ? 'family trip' : null,
      }),
    );
    // Warm up once (the first call compiles the code), then time.
    searchFiles(many, { query: 'holiday', filters: {}, sort: 'best', now: NOW });
    const started = performance.now();
    const hits = searchFiles(many, {
      query: 'holiday',
      filters: { size: '10-100mb', date: '30-days', extension: 'mp4' },
      sort: 'name',
      now: NOW,
    });
    const elapsed = performance.now() - started;
    assert.ok(hits.length > 0);
    assert.ok(elapsed < 50, `took ${elapsed.toFixed(1)} ms`);
  });
});
