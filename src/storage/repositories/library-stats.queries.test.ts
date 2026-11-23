import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { DATABASE_VERSION, TABLE_NAMES } from '@/storage/constants';
import { applyLibraryStatsTables } from '@/storage/sqlite/library-stats-schema';
import { migrateDatabase } from '@/storage/sqlite/migrations';
import { applyBrowserTables, applySchema } from '@/storage/sqlite/schema';
import { MAX_BOOKMARKS_PER_VIDEO } from '@/player/video-bookmarks';

import {
  addVideoBookmark,
  deleteVideoBookmark,
  forgetLibraryStats,
  getPlayStats,
  listMediaLengths,
  listPlayStats,
  listVideoBookmarks,
  recordPlay,
  renameVideoBookmark,
  saveMediaLength,
  VideoBookmarkError,
  type LibraryStatsDb,
} from './library-stats.queries.ts';

/** P9 — the v10 migration, play counts and video bookmarks on a real SQLite (Node's built-in), with the app's schema. */

type Param = string | number | null;

function openDb(sqlite = new DatabaseSync(':memory:')) {
  const db = {
    async execAsync(sql: string) {
      sqlite.exec(sql);
    },
    async runAsync(sql: string, ...params: Param[]) {
      const result = sqlite.prepare(sql).run(...params);
      return { changes: Number(result.changes) };
    },
    async getAllAsync<T>(sql: string, ...params: Param[]) {
      return sqlite.prepare(sql).all(...params) as T[];
    },
    async getFirstAsync<T>(sql: string, ...params: Param[]) {
      return (sqlite.prepare(sql).get(...params) ?? null) as T | null;
    },
    async withTransactionAsync(task: () => Promise<void>) {
      sqlite.exec('BEGIN');
      try {
        await task();
        sqlite.exec('COMMIT');
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { sqlite, db: db as LibraryStatsDb & typeof db };
}

const version = (sqlite: DatabaseSync) =>
  (sqlite.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
const tables = (sqlite: DatabaseSync) =>
  (sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as {
    name: string;
  }[]).map((t) => t.name);
const indexes = (sqlite: DatabaseSync) =>
  (sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`).all() as { name: string }[]).map((i) => i.name);
const columns = (sqlite: DatabaseSync, table: string) =>
  sqlite.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
  }[];
const rowCount = (sqlite: DatabaseSync, table: string) =>
  Number((sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);

const P9_TABLES = [TABLE_NAMES.mediaPlayStats, TABLE_NAMES.videoBookmarks];

/** Every row of every table (or of all but `except`), rows sorted, so two snapshots compare exactly. */
function snapshot(sqlite: DatabaseSync, except: readonly string[] = []): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const name of tables(sqlite).sort()) {
    if (except.includes(name)) continue;
    out[name] = (sqlite.prepare(`SELECT * FROM ${name}`).all() as object[]).map((row) => JSON.stringify(row)).sort();
  }
  return out;
}

/** Only these tables' rows (the v9 phone's), so a later package's new tables never enter the comparison. */
const snapshotOf = (sqlite: DatabaseSync, only: readonly string[]) =>
  Object.fromEntries(Object.entries(snapshot(sqlite)).filter(([name]) => only.includes(name)));

const NOW = '2026-11-23T10:00:00.000Z';
const LATER = '2026-11-23T11:00:00.000Z';
const LATEST = '2026-11-23T12:00:00.000Z';

/**
 * One real row for each table a v9 phone has, parents before children (foreign keys are on). Urdu text where users
 * type names. `focus_session` allows only id 1.
 */
const V9_ROWS: readonly [table: string, sql: string, params: Param[]][] = [
  [TABLE_NAMES.browserHistory, '(id, url, title, hostname, visited_at, created_at) VALUES (?, ?, ?, ?, ?, ?)', ['h1', 'https://a.test/', 'A', 'a.test', NOW, NOW]],
  [TABLE_NAMES.bookmarkFolders, '(id, parent_id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', ['bf1', null, 'کام', 0, NOW, NOW]],
  [TABLE_NAMES.bookmarks, '(id, url, title, hostname, favicon_url, created_at, updated_at, folder_id, note, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', ['b1', 'https://a.test/', 'A', 'a.test', null, NOW, NOW, 'bf1', 'a note', 0]],
  [TABLE_NAMES.bookmarkTags, '(bookmark_id, tag) VALUES (?, ?)', ['b1', 'news']],
  [TABLE_NAMES.readingList, '(id, url, title, hostname, created_at, read_at, offline_uri) VALUES (?, ?, ?, ?, ?, ?, ?)', ['r1', 'https://a.test/read', 'Read', 'a.test', NOW, null, null]],
  [TABLE_NAMES.recentSearches, '(id, query, searched_at, created_at) VALUES (?, ?, ?, ?)', ['q1', 'اردو', NOW, NOW]],
  [TABLE_NAMES.recentUrls, '(id, url, title, hostname, accessed_at, created_at) VALUES (?, ?, ?, ?, ?, ?)', ['u1', 'https://a.test/', 'A', 'a.test', NOW, NOW]],
  [TABLE_NAMES.downloadsCatalog, '(id, title, source_url, file_name, folder_id, status, favorite, duration, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', ['d1', 'Clip', 'https://a.test/clip.mp4', 'clip.mp4', 'f1', 'COMPLETED', 1, 61.5, NOW, NOW]],
  [TABLE_NAMES.mediaFolders, '(id, name, normalized_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', ['f1', 'اردو ڈرامے', 'اردو ڈرامے', NOW, NOW]],
  [TABLE_NAMES.urlFavorites, '(id, title, platform, source_url, thumbnail_url, created_at) VALUES (?, ?, ?, ?, ?, ?)', ['uf1', 'Fav', 'web', 'https://a.test/fav', '', NOW]],
  [TABLE_NAMES.siteBlockLists, '(list, site, created_at) VALUES (?, ?, ?)', ['blocked', 'bad.test', NOW]],
  [TABLE_NAMES.siteTimeLimits, '(site, minutes, created_at, updated_at) VALUES (?, ?, ?, ?)', ['a.test', 30, NOW, NOW]],
  [TABLE_NAMES.siteTimeUsage, '(day, site, seconds) VALUES (?, ?, ?)', ['2026-11-23', 'a.test', 120]],
  [TABLE_NAMES.focusSession, '(id, started_at, ends_at, minutes) VALUES (?, ?, ?, ?)', [1, 1_000, 2_000, 25]],
  [TABLE_NAMES.notes, '(id, text, page_url, page_title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', ['n1', 'remember this', 'https://a.test/', 'A', NOW, NOW]],
  [TABLE_NAMES.userScripts, '(id, name, code, matches, run_at, enabled, allow_incognito, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', ['us1', 'Dark', 'void 0', '["*"]', 'end', 1, 0, NOW, NOW]],
  [TABLE_NAMES.highlights, '(id, page_url, page_title, exact, created_at) VALUES (?, ?, ?, ?, ?)', ['hl1', 'https://a.test/', 'A', 'important words', NOW]],
  [TABLE_NAMES.pageWatches, '(id, url, title, hash, status, last_checked_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', ['pw1', 'https://a.test/news', 'News', 'abc', 'ok', NOW, NOW]],
  [TABLE_NAMES.savedPages, '(id, url, title, size, created_at) VALUES (?, ?, ?, ?, ?)', ['s1', 'https://a.test/page', 'Page', 2048, NOW]],
  [TABLE_NAMES.playlists, '(id, name, created_at, updated_at) VALUES (?, ?, ?, ?)', ['p1', 'میری پسندیدہ ویڈیوز', NOW, NOW]],
  [TABLE_NAMES.playlistItems, '(playlist_id, media_id, position, title, file_name, duration, added_at) VALUES (?, ?, ?, ?, ?, ?, ?)', ['p1', 'd1', 0, 'Clip', 'clip.mp4', 61.5, NOW]],
];

/**
 * The tables a v9 phone (P7) has, frozen here: a later package's tables (P11…) are not part of it. 21 tables, one
 * row each in `V9_ROWS`.
 */
const V9_TABLES: readonly string[] = V9_ROWS.map(([table]) => table);

/** A phone on v9 (P7): every table up to playlists, a real row in every one of them, nothing newer. */
async function v9Database() {
  const { sqlite, db } = openDb();
  await migrateDatabase(db as never);
  // Children first (foreign keys are on): P9's tables, and any a later package adds.
  for (const name of tables(sqlite).reverse()) {
    if (!V9_TABLES.includes(name)) sqlite.exec(`DROP TABLE ${name}`);
  }
  sqlite.exec('PRAGMA user_version = 9');
  for (const [table, values, params] of V9_ROWS) {
    sqlite.prepare(`INSERT INTO ${table} ${values}`).run(...params);
  }
  return { sqlite, db };
}

async function freshDb() {
  const opened = openDb();
  await migrateDatabase(opened.db as never);
  return opened;
}

describe('P9 database v10 (play counts, video bookmarks)', () => {
  test('DATABASE_VERSION is 10 or later and names the two new tables (not the browser’s `bookmarks`)', () => {
    assert.ok(DATABASE_VERSION >= 10, 'P9 made it 10; later packages go on (P11)');
    assert.equal(TABLE_NAMES.mediaPlayStats, 'media_play_stats');
    assert.equal(TABLE_NAMES.videoBookmarks, 'video_bookmarks');
    assert.equal(TABLE_NAMES.bookmarks, 'bookmarks');
  });

  test('a fresh install (version 0) gets the current version, both tables with their columns, and the index', async () => {
    const { sqlite, db } = openDb();
    assert.equal(version(sqlite), 0);
    await migrateDatabase(db as never);
    assert.equal(version(sqlite), DATABASE_VERSION);
    for (const name of P9_TABLES) assert.ok(tables(sqlite).includes(name), name);

    const stats = columns(sqlite, TABLE_NAMES.mediaPlayStats);
    assert.deepEqual(
      stats.map((c) => [c.name, c.type, c.notnull, c.dflt_value, c.pk]),
      [
        ['media_id', 'TEXT', 1, null, 1],
        ['play_count', 'INTEGER', 1, '0', 0],
        ['last_played_at', 'TEXT', 0, null, 0],
        // #711 backfill: the measured length, and when it was looked at (in the same 9 → 10 table, no new bump).
        ['duration_ms', 'INTEGER', 0, null, 0],
        ['duration_checked_at', 'TEXT', 0, null, 0],
      ],
    );
    const marks = columns(sqlite, TABLE_NAMES.videoBookmarks);
    assert.deepEqual(
      marks.map((c) => [c.name, c.type, c.notnull, c.pk]),
      [
        ['id', 'TEXT', 1, 1],
        ['media_id', 'TEXT', 1, 0],
        ['position_ms', 'INTEGER', 1, 0],
        ['name', 'TEXT', 0, 0],
        ['created_at', 'TEXT', 1, 0],
      ],
    );
    assert.ok(indexes(sqlite).includes('idx_video_bookmarks_media'));
    // media_id is plain text: no foreign key anywhere in P9's tables.
    for (const name of P9_TABLES) {
      assert.deepEqual(sqlite.prepare(`PRAGMA foreign_key_list(${name})`).all(), [], name);
    }
  });

  test('applySchema alone (the fresh-install path) creates them too and records the current version', async () => {
    const { sqlite, db } = openDb();
    await applySchema(db as never);
    assert.equal(version(sqlite), DATABASE_VERSION);
    for (const name of P9_TABLES) assert.ok(tables(sqlite).includes(name), name);
  });

  test('the v9 test phone really has a row in every table it has (P7’s playlists included), and no P9 table', async () => {
    const { sqlite } = await v9Database();
    const present = tables(sqlite).sort();
    assert.equal(V9_TABLES.length, 21);
    assert.deepEqual(present, [...V9_TABLES].sort(), 'sqlite_master lists exactly the v9 tables');
    // Every table that existed before P9 is in the v9 set (the TABLE_NAMES of P7 and earlier).
    const beforeP9 = Object.values(TABLE_NAMES).filter((name) => !(P9_TABLES as readonly string[]).includes(name));
    for (const name of beforeP9.slice(0, beforeP9.indexOf(TABLE_NAMES.playlistItems) + 1)) {
      assert.ok(V9_TABLES.includes(name), `${name} is in the v9 set`);
    }
    for (const name of present) {
      assert.ok(rowCount(sqlite, name) >= 1, `${name} has a row`);
    }
    assert.ok(present.includes(TABLE_NAMES.playlists) && present.includes(TABLE_NAMES.playlistItems));
    for (const name of P9_TABLES) assert.ok(!present.includes(name), `${name} absent on v9`);
  });

  test('an upgrade from v9 with real rows: the current version, the tables appear, every old row is unchanged', async () => {
    const { sqlite, db } = await v9Database();
    const before = snapshot(sqlite);
    assert.deepEqual(Object.keys(before).sort(), [...V9_TABLES].sort());
    for (const name of P9_TABLES) assert.ok(!tables(sqlite).includes(name), `${name} absent on v9`);

    await migrateDatabase(db as never);

    assert.equal(version(sqlite), DATABASE_VERSION);
    for (const name of P9_TABLES) assert.ok(tables(sqlite).includes(name), name);
    assert.deepEqual(snapshotOf(sqlite, V9_TABLES), before);
    for (const name of P9_TABLES) assert.equal(rowCount(sqlite, name), 0, `${name} starts empty`);
    assert.deepEqual(await listPlayStats(db), []);
  });

  test('running the migration again (and the table DDL twice) keeps every row, P9’s included', async () => {
    const { sqlite, db } = await v9Database();
    await migrateDatabase(db as never);
    await recordPlay(db, 'd1', NOW);
    await addVideoBookmark(db, { id: 'k1', mediaId: 'd1', positionMs: 5_000, name: 'Goal', nowIso: NOW });
    const before = snapshot(sqlite);

    sqlite.exec('PRAGMA user_version = 9');
    await migrateDatabase(db as never);
    await migrateDatabase(db as never);
    await applyLibraryStatsTables(db);
    await applyLibraryStatsTables(db);

    assert.equal(version(sqlite), DATABASE_VERSION);
    assert.deepEqual(snapshot(sqlite), before);
  });

  test('a browser-profile database (applyBrowserTables) never gets the P9 tables', async () => {
    const { sqlite, db } = openDb();
    await applyBrowserTables(db as never);
    for (const name of P9_TABLES) assert.ok(!tables(sqlite).includes(name), name);
  });
});

describe('P9 play counts (real SQLite)', () => {
  test('#708 the first counted play makes the row; each one after adds 1 and moves the time', async () => {
    const { db } = await freshDb();
    assert.equal(await getPlayStats(db, 'd1'), null);
    assert.deepEqual(await recordPlay(db, 'd1', NOW), { mediaId: 'd1', playCount: 1, lastPlayedAt: NOW });
    assert.deepEqual(await recordPlay(db, 'd1', LATER), { mediaId: 'd1', playCount: 2, lastPlayedAt: LATER });
    assert.equal(await recordPlay(db, '  ', NOW), null);
    // A phone video counts under its own id.
    assert.equal((await recordPlay(db, 'device:77', NOW))?.playCount, 1);
  });

  test('#626 the list: most played first, ties by the latest counted play, then id', async () => {
    const { db } = await freshDb();
    await recordPlay(db, 'a', NOW);
    await recordPlay(db, 'b', NOW);
    await recordPlay(db, 'b', LATER);
    await recordPlay(db, 'c', LATEST);
    await recordPlay(db, 'z', NOW);
    assert.deepEqual(
      (await listPlayStats(db)).map((s) => [s.mediaId, s.playCount]),
      [
        ['b', 2],
        ['c', 1],
        ['a', 1],
        ['z', 1],
      ],
    );
  });
});

describe('P9 video bookmarks (real SQLite)', () => {
  test('#705 add with and without a name; listed by time; same time keeps the order they were added in', async () => {
    const { db } = await freshDb();
    const named = await addVideoBookmark(db, { id: 'k1', mediaId: 'd1', positionMs: 90_000, name: '  The   goal ', nowIso: NOW });
    assert.equal(named.name, 'The goal');
    const plain = await addVideoBookmark(db, { id: 'k2', mediaId: 'd1', positionMs: 12_345.6, nowIso: NOW });
    assert.equal(plain.name, null);
    assert.equal(plain.positionMs, 12_346);
    await addVideoBookmark(db, { id: 'k0', mediaId: 'd1', positionMs: 90_000, name: '   ', nowIso: LATER });
    await addVideoBookmark(db, { id: 'k9', mediaId: 'other', positionMs: 1_000, nowIso: NOW });

    assert.deepEqual(
      (await listVideoBookmarks(db, 'd1')).map((b) => [b.id, b.positionMs, b.name]),
      [
        ['k2', 12_346, null],
        ['k1', 90_000, 'The goal'],
        ['k0', 90_000, null],
      ],
    );
    assert.deepEqual((await listVideoBookmarks(db, 'other')).map((b) => b.id), ['k9']);
    assert.deepEqual(await listVideoBookmarks(db, 'nothing'), []);
  });

  test('#705 positions are clamped to the video: never below 0, never past the end; kept when the length is unknown', async () => {
    const { db } = await freshDb();
    const early = await addVideoBookmark(db, { id: 'a', mediaId: 'd1', positionMs: -500, durationMs: 60_000, nowIso: NOW });
    const late = await addVideoBookmark(db, { id: 'b', mediaId: 'd1', positionMs: 75_000, durationMs: 60_000, nowIso: NOW });
    const unknown = await addVideoBookmark(db, { id: 'c', mediaId: 'd1', positionMs: 75_000, durationMs: null, nowIso: NOW });
    const broken = await addVideoBookmark(db, { id: 'd', mediaId: 'd1', positionMs: Number.NaN, durationMs: 60_000, nowIso: NOW });
    assert.deepEqual([early.positionMs, late.positionMs, unknown.positionMs, broken.positionMs], [0, 60_000, 75_000, 0]);
    assert.deepEqual(
      (await listVideoBookmarks(db, 'd1')).map((b) => b.positionMs),
      [0, 0, 60_000, 75_000],
    );
  });

  test('#705 rename (trimmed, Urdu kept, empty back to no name) and delete; a missing id changes nothing', async () => {
    const { db } = await freshDb();
    await addVideoBookmark(db, { id: 'k1', mediaId: 'd1', positionMs: 1_000, nowIso: NOW });
    await addVideoBookmark(db, { id: 'k2', mediaId: 'd1', positionMs: 2_000, name: 'Keep', nowIso: NOW });
    assert.equal(await renameVideoBookmark(db, 'k1', '  اہم لمحہ  '), true);
    assert.equal((await listVideoBookmarks(db, 'd1'))[0]?.name, 'اہم لمحہ');
    assert.equal(await renameVideoBookmark(db, 'k1', ''), true);
    assert.equal((await listVideoBookmarks(db, 'd1'))[0]?.name, null);
    assert.equal(await renameVideoBookmark(db, 'missing', 'X'), false);

    assert.equal(await deleteVideoBookmark(db, 'k1'), true);
    assert.equal(await deleteVideoBookmark(db, 'k1'), false);
    assert.deepEqual((await listVideoBookmarks(db, 'd1')).map((b) => [b.id, b.name]), [['k2', 'Keep']]);
  });

  test('#705 at most 100 per video, and a bookmark needs a video', async () => {
    const { db } = await freshDb();
    for (let i = 0; i < MAX_BOOKMARKS_PER_VIDEO; i += 1) {
      await addVideoBookmark(db, { id: `k${i}`, mediaId: 'd1', positionMs: i * 1_000, nowIso: NOW });
    }
    await assert.rejects(
      addVideoBookmark(db, { id: 'one-too-many', mediaId: 'd1', positionMs: 0, nowIso: NOW }),
      (e: VideoBookmarkError) => e instanceof VideoBookmarkError && e.code === 'FULL',
    );
    // Another video is not affected.
    await addVideoBookmark(db, { id: 'x', mediaId: 'd2', positionMs: 0, nowIso: NOW });
    await assert.rejects(
      addVideoBookmark(db, { id: 'y', mediaId: '  ', positionMs: 0, nowIso: NOW }),
      (e: VideoBookmarkError) => e.code === 'NO_MEDIA',
    );
  });

  test('a deleted video’s play count and bookmarks go with it; nothing else changes', async () => {
    const { sqlite, db } = await v9Database();
    await migrateDatabase(db as never);
    await recordPlay(db, 'd1', NOW);
    await recordPlay(db, 'd2', NOW);
    await addVideoBookmark(db, { id: 'k1', mediaId: 'd1', positionMs: 1_000, nowIso: NOW });
    await addVideoBookmark(db, { id: 'k2', mediaId: 'd2', positionMs: 1_000, nowIso: NOW });
    const others = snapshot(sqlite, P9_TABLES);

    assert.equal(await forgetLibraryStats(db, ['d1', ' ']), 2);

    assert.equal(await getPlayStats(db, 'd1'), null);
    assert.deepEqual(await listVideoBookmarks(db, 'd1'), []);
    assert.equal((await getPlayStats(db, 'd2'))?.playCount, 1);
    assert.deepEqual((await listVideoBookmarks(db, 'd2')).map((b) => b.id), ['k2']);
    assert.deepEqual(snapshot(sqlite, P9_TABLES), others);
  });
});

describe('P9 lengths (#711 background backfill, real SQLite)', () => {
  test('a measured length is kept with when it was looked at; a row made for a length is not a play', async () => {
    const { db } = await freshDb();
    await saveMediaLength(db, 'v1', 61_400.6, NOW);
    await saveMediaLength(db, 'v2', null, NOW);
    assert.deepEqual(await listMediaLengths(db), [
      { mediaId: 'v1', durationMs: 61_401, checkedAt: NOW },
      { mediaId: 'v2', durationMs: null, checkedAt: NOW },
    ]);
    // Not a play: Most played and the counts don't see it.
    assert.deepEqual(await listPlayStats(db), []);
    assert.deepEqual(await getPlayStats(db, 'v1'), { mediaId: 'v1', playCount: 0, lastPlayedAt: null });
  });

  test('a known length is never replaced by "unknown"; a later reading updates it; blank ids are ignored', async () => {
    const { db } = await freshDb();
    await saveMediaLength(db, 'v1', 61_000, NOW);
    await saveMediaLength(db, 'v1', null, LATER);
    assert.deepEqual(await listMediaLengths(db), [{ mediaId: 'v1', durationMs: 61_000, checkedAt: LATER }]);
    await saveMediaLength(db, 'v1', 62_000, LATER);
    assert.equal((await listMediaLengths(db))[0]!.durationMs, 62_000);
    await saveMediaLength(db, '  ', 5_000, NOW);
    await saveMediaLength(db, 'v3', -4, NOW);
    assert.deepEqual(
      (await listMediaLengths(db)).map((row) => [row.mediaId, row.durationMs]),
      [
        ['v1', 62_000],
        ['v3', null],
      ],
    );
  });

  test('plays and lengths share the row without touching each other', async () => {
    const { db } = await freshDb();
    await saveMediaLength(db, 'v1', 30_000, NOW);
    assert.deepEqual(await recordPlay(db, 'v1', LATER), { mediaId: 'v1', playCount: 1, lastPlayedAt: LATER });
    await saveMediaLength(db, 'v1', 31_000, LATER);
    assert.equal((await getPlayStats(db, 'v1'))?.playCount, 1);
    assert.deepEqual(await listMediaLengths(db), [{ mediaId: 'v1', durationMs: 31_000, checkedAt: LATER }]);
    // Counted first, measured later: the same.
    await recordPlay(db, 'v2', NOW);
    await saveMediaLength(db, 'v2', 9_000, LATER);
    assert.equal((await getPlayStats(db, 'v2'))?.playCount, 1);
    // A deleted video's length goes with its row.
    await forgetLibraryStats(db, ['v1']);
    assert.deepEqual((await listMediaLengths(db)).map((row) => row.mediaId), ['v2']);
  });
});
