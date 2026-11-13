import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { DATABASE_VERSION, TABLE_NAMES } from '@/storage/constants';
import { migrateDatabase } from '@/storage/sqlite/migrations';
import { applyBrowserTables } from '@/storage/sqlite/schema';

import {
  addWatch,
  allHighlights,
  countWatches,
  deleteHighlight,
  deleteWatch,
  highlightsForPage,
  insertHighlight,
  listWatches,
  recordCheck,
  updateHighlight,
  type AnnotateDb,
} from './annotate.queries.ts';

/** B23 — highlights, watched pages and the v7 migration on a real SQLite (Node's built-in), with the app's schema. */

type Param = string | number | null;

function openDb() {
  const sqlite = new DatabaseSync(':memory:');
  const db = {
    async execAsync(sql: string) {
      sqlite.exec(sql);
    },
    async runAsync(sql: string, ...params: Param[]) {
      return { changes: Number(sqlite.prepare(sql).run(...params).changes) };
    },
    async getAllAsync<T>(sql: string, ...params: Param[]) {
      return sqlite.prepare(sql).all(...params) as T[];
    },
    async getFirstAsync<T>(sql: string, ...params: Param[]) {
      return (sqlite.prepare(sql).get(...params) ?? null) as T | null;
    },
    async withTransactionAsync(task: () => Promise<void>) {
      await task();
    },
  };
  return { sqlite, db: db as AnnotateDb & typeof db };
}

const version = (sqlite: DatabaseSync) => (sqlite.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;

describe('B23 annotate tables (DATABASE_VERSION 7 and later)', () => {
  test('a v6 database gets both tables, keeps its data, and running it twice changes nothing', async () => {
    const { sqlite, db } = openDb();
    await migrateDatabase(db as never);
    assert.ok(DATABASE_VERSION >= 7);
    sqlite.exec(`DROP TABLE ${TABLE_NAMES.highlights}; DROP TABLE ${TABLE_NAMES.pageWatches}; PRAGMA user_version = 6`);
    sqlite.prepare(`INSERT INTO ${TABLE_NAMES.userScripts} (id, name, code, created_at, updated_at) VALUES ('u', 'kept', 'x', 'x', 'x')`).run();
    await migrateDatabase(db as never);
    assert.equal(version(sqlite), DATABASE_VERSION);
    sqlite.exec('PRAGMA user_version = 6');
    await migrateDatabase(db as never);
    await applyBrowserTables(db as never);
    assert.equal(version(sqlite), DATABASE_VERSION);
    assert.equal((sqlite.prepare(`SELECT COUNT(*) AS n FROM ${TABLE_NAMES.userScripts}`).get() as { n: number }).n, 1);
  });

  test('highlights: per page, all (newest first), edit, delete', async () => {
    const { db } = openDb();
    await applyBrowserTables(db as never);
    const base = { pageTitle: 'Guide', prefix: 'the ', suffix: ' at', note: '' };
    await insertHighlight(db, { ...base, id: 'a', pageUrl: 'https://x.test/p', text: 'Fort', color: 'yellow', createdAt: '2026-11-09T10:00:00Z' });
    await insertHighlight(db, { ...base, id: 'b', pageUrl: 'https://x.test/p', text: 'Mosque', color: 'pink', createdAt: '2026-11-09T11:00:00Z' });
    await insertHighlight(db, { ...base, id: 'c', pageUrl: 'https://y.test/', text: 'Other', color: 'blue', createdAt: '2026-11-09T12:00:00Z' });
    assert.deepEqual((await highlightsForPage(db, 'https://x.test/p')).map((h) => h.id), ['a', 'b']);
    assert.deepEqual((await allHighlights(db)).map((h) => h.id), ['c', 'b', 'a']);
    await updateHighlight(db, 'a', 'green', 'see this');
    const a = (await highlightsForPage(db, 'https://x.test/p'))[0];
    assert.deepEqual([a.color, a.note, a.prefix, a.suffix], ['green', 'see this', 'the ', ' at']);
    assert.equal(await deleteHighlight(db, 'a'), true);
    assert.equal((await allHighlights(db)).length, 2);
  });

  test('watched pages: one row per address, checks recorded, removed', async () => {
    const { db } = openDb();
    await applyBrowserTables(db as never);
    assert.equal(await addWatch(db, { id: 'w1', url: 'https://x.test/', title: 'X', hash: 'h1' }, '2026-11-09T10:00:00Z'), true);
    assert.equal(await addWatch(db, { id: 'w2', url: 'https://x.test/', title: 'X again', hash: 'h9' }, '2026-11-09T10:01:00Z'), false);
    assert.equal(await countWatches(db), 1);
    await recordCheck(db, 'w1', { status: 'ok', hash: 'h2', title: 'X v2', changed: true }, '2026-11-09T16:00:00Z');
    let [w] = await listWatches(db);
    assert.deepEqual([w.hash, w.title, w.lastChangedAt, w.status], ['h2', 'X v2', '2026-11-09T16:00:00Z', 'ok']);
    await recordCheck(db, 'w1', { status: 'failed', changed: false }, '2026-11-09T22:00:00Z');
    [w] = await listWatches(db);
    assert.deepEqual([w.hash, w.title, w.lastChangedAt, w.lastCheckedAt, w.status], ['h2', 'X v2', '2026-11-09T16:00:00Z', '2026-11-09T22:00:00Z', 'failed']);
    assert.equal(await deleteWatch(db, 'w1'), true);
    assert.equal(await countWatches(db), 0);
  });
});
