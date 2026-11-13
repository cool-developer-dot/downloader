import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { TABLE_NAMES } from '@/storage/constants';
import { applyBrowserTables } from '@/storage/sqlite/schema';

import { deleteBrowsingDataSince, listHistoryForExport, type BrowsingDataDb } from './browsing-data.queries.ts';

/**
 * B10 — the browsing-data queries on a real SQLite (Node's built-in), with the app's own browser tables
 * (`applyBrowserTables`, the same statements expo-sqlite runs on the phone).
 */

type Param = string | number | null;

function openDb() {
  const sqlite = new DatabaseSync(':memory:');
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
  };
  return { sqlite, db };
}

async function setUp() {
  const { sqlite, db } = openDb();
  await applyBrowserTables(db as unknown as Parameters<typeof applyBrowserTables>[0]);
  return { sqlite, db: db as BrowsingDataDb & typeof db };
}

const NOW = Date.parse('2026-11-08T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function insertHistory(sqlite: DatabaseSync, rows: { id: string; url: string; title: string; visitedAt: string }[]) {
  const statement = sqlite.prepare(
    `INSERT INTO ${TABLE_NAMES.browserHistory} (id, url, title, hostname, visited_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  sqlite.exec('BEGIN');
  for (const row of rows) {
    statement.run(row.id, row.url, row.title, new URL(row.url).hostname, row.visitedAt, row.visitedAt);
  }
  sqlite.exec('COMMIT');
}

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
}

async function seedAllTables(sqlite: DatabaseSync) {
  insertHistory(sqlite, [
    { id: 'h1', url: 'https://a.test/1', title: 'A', visitedAt: ago(10 * MIN) },
    { id: 'h2', url: 'https://a.test/2', title: 'B', visitedAt: ago(3 * HOUR) },
    { id: 'h3', url: 'https://a.test/3', title: 'C', visitedAt: ago(3 * DAY) },
    { id: 'h4', url: 'https://a.test/4', title: 'D', visitedAt: ago(20 * DAY) },
    { id: 'h5', url: 'https://a.test/5', title: 'E', visitedAt: ago(60 * DAY) },
  ]);
  const searches = sqlite.prepare(
    `INSERT INTO ${TABLE_NAMES.recentSearches} (id, query, searched_at, created_at) VALUES (?, ?, ?, ?)`,
  );
  searches.run('s1', 'lahore', ago(30 * MIN), ago(30 * MIN));
  searches.run('s2', 'karachi', ago(10 * DAY), ago(10 * DAY));
  const urls = sqlite.prepare(
    `INSERT INTO ${TABLE_NAMES.recentUrls} (id, url, title, hostname, accessed_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  urls.run('u1', 'https://a.test/1', 'A', 'a.test', ago(10 * MIN), ago(10 * MIN));
  urls.run('u2', 'https://a.test/5', 'E', 'a.test', ago(60 * DAY), ago(60 * DAY));
}

describe('B10 #98 clear by time range (real SQLite, app schema)', () => {
  test('last hour removes only what happened in the last hour', async () => {
    const { sqlite, db } = await setUp();
    await seedAllTables(sqlite);
    const cleared = await deleteBrowsingDataSince(db, ago(HOUR));
    assert.deepEqual(cleared, { history: 1, recentUrls: 1, recentSearches: 1 });
    assert.equal(count(sqlite, TABLE_NAMES.browserHistory), 4);
    assert.equal(count(sqlite, TABLE_NAMES.recentSearches), 1);
    assert.equal(count(sqlite, TABLE_NAMES.recentUrls), 1);
  });

  test('each range keeps what is older than it', async () => {
    for (const [since, remaining] of [
      [ago(DAY), 3],
      [ago(7 * DAY), 2],
      [ago(28 * DAY), 1],
    ] as const) {
      const { sqlite, db } = await setUp();
      await seedAllTables(sqlite);
      await deleteBrowsingDataSince(db, since);
      assert.equal(count(sqlite, TABLE_NAMES.browserHistory), remaining, since);
    }
  });

  test('all time empties the three tables, and runs again safely', async () => {
    const { sqlite, db } = await setUp();
    await seedAllTables(sqlite);
    assert.deepEqual(await deleteBrowsingDataSince(db, null), { history: 5, recentUrls: 2, recentSearches: 2 });
    assert.deepEqual(await deleteBrowsingDataSince(db, null), { history: 0, recentUrls: 0, recentSearches: 0 });
    assert.equal(count(sqlite, TABLE_NAMES.browserHistory), 0);
  });
});

describe('B10 #103 export rows', () => {
  test('one row per page: latest title, last visit, visit count, newest first', async () => {
    const { sqlite, db } = await setUp();
    insertHistory(sqlite, [
      { id: '1', url: 'https://ur.wikipedia.org/wiki/x', title: 'پرانا عنوان', visitedAt: ago(5 * DAY) },
      { id: '2', url: 'https://ur.wikipedia.org/wiki/x', title: 'لاہور', visitedAt: ago(2 * HOUR) },
      { id: '3', url: 'https://example.com/', title: 'Example', visitedAt: ago(DAY) },
      { id: '4', url: 'https://ur.wikipedia.org/wiki/x', title: 'درمیانی', visitedAt: ago(3 * DAY) },
    ]);
    assert.deepEqual(await listHistoryForExport(db), [
      { url: 'https://ur.wikipedia.org/wiki/x', title: 'لاہور', lastVisitedAt: ago(2 * HOUR), visitCount: 3 },
      { url: 'https://example.com/', title: 'Example', lastVisitedAt: ago(DAY), visitCount: 1 },
    ]);
  });

  test('empty history exports nothing', async () => {
    const { db } = await setUp();
    assert.deepEqual(await listHistoryForExport(db), []);
  });
});

describe('B10 #95 search with 5,000 entries (the statements HistoryRepository.list runs)', () => {
  test('title and URL both match, and a page of results comes back fast', async () => {
    const { sqlite, db } = await setUp();
    const rows = Array.from({ length: 5000 }, (_, i) => ({
      id: `id${i}`,
      url: `https://site${i % 50}.example/path/${i}${i === 4321 ? '/needle-in-path' : ''}`,
      title: i === 1234 ? 'Badshahi Mosque — لاہور' : `Page ${i}`,
      visitedAt: ago(i * MIN),
    }));
    insertHistory(sqlite, rows);

    // history.repository.ts buildSearchClause + list(): COUNT, then one page ordered by visit time.
    const search = async (query: string) => {
      const like = `%${query.trim()}%`;
      const where = 'WHERE (title LIKE ? OR url LIKE ? OR hostname LIKE ?)';
      const total = await db.getFirstAsync<{ total: number }>(
        `SELECT COUNT(*) as total FROM ${TABLE_NAMES.browserHistory} ${where}`,
        like,
        like,
        like,
      );
      const page = await db.getAllAsync<{ id: string }>(
        `SELECT * FROM ${TABLE_NAMES.browserHistory} ${where} ORDER BY visited_at DESC LIMIT ? OFFSET ?`,
        like,
        like,
        like,
        20,
        0,
      );
      return { total: Number(total?.total ?? 0), ids: page.map((r) => r.id) };
    };

    const started = performance.now();
    const byTitle = await search('badshahi');
    const byUrdu = await search('لاہور');
    const byPath = await search('needle-in-path');
    const byHost = await search('site7.example');
    const none = await search('nothing-like-this');
    const elapsed = performance.now() - started;

    assert.deepEqual(byTitle, { total: 1, ids: ['id1234'] }); // case-insensitive for A–Z
    assert.deepEqual(byUrdu, { total: 1, ids: ['id1234'] });
    assert.deepEqual(byPath, { total: 1, ids: ['id4321'] });
    assert.equal(byHost.total, 100); // every 50th row is on site7.example (host and URL)
    assert.equal(none.total, 0);
    // Five full searches over 5,000 rows (each a COUNT and a page): well under the 100 ms a keystroke allows.
    assert.ok(elapsed < 250, `5 searches took ${elapsed.toFixed(1)} ms`);
  });
});
