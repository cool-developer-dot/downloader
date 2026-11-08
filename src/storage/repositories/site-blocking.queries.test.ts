import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { DATABASE_VERSION, TABLE_NAMES } from '@/storage/constants';
import { migrateDatabase } from '@/storage/sqlite/migrations';
import { applyBrowserTables } from '@/storage/sqlite/schema';

import {
  addListSite,
  addTimeUsed,
  endFocus,
  loadSiteLimits,
  pruneTimeUsedBefore,
  removeListSite,
  removeTimeLimit,
  setTimeLimit,
  startFocus,
  type SiteBlockingDb,
} from './site-blocking.queries.ts';

/** B14 — the site-blocking queries and the v4 migration on a real SQLite (Node's built-in), with the app's schema. */

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
      await task();
    },
  };
  return { sqlite, db: db as SiteBlockingDb & typeof db };
}

const version = (sqlite: DatabaseSync) => (sqlite.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
const tables = (sqlite: DatabaseSync) =>
  (sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((t) => t.name);
const B14_TABLES = [TABLE_NAMES.siteBlockLists, TABLE_NAMES.siteTimeLimits, TABLE_NAMES.siteTimeUsage, TABLE_NAMES.focusSession];

describe('B14 database (DATABASE_VERSION 4)', () => {
  test('a v3 database moves to v4: the new tables appear and bookmarks / history stay; running twice changes nothing', async () => {
    const { sqlite, db } = openDb();
    await migrateDatabase(db as never);
    assert.equal(DATABASE_VERSION, 4);
    // Back to how a 1.1.0 + B9 phone has it: version 3, with data, without the B14 tables.
    for (const name of B14_TABLES) sqlite.exec(`DROP TABLE ${name}`);
    sqlite.exec('PRAGMA user_version = 3');
    sqlite
      .prepare(`INSERT INTO ${TABLE_NAMES.bookmarks} (id, url, title, hostname, created_at, updated_at) VALUES ('b1', 'https://a.test/', 'A', 'a.test', 'x', 'x')`)
      .run();

    await migrateDatabase(db as never);
    assert.equal(version(sqlite), 4);
    for (const name of B14_TABLES) assert.ok(tables(sqlite).includes(name), name);
    await addListSite(db, 'blocked', 'blocked.example', '2026-11-09T00:00:00Z');

    sqlite.exec('PRAGMA user_version = 3');
    await migrateDatabase(db as never);
    await applyBrowserTables(db as never);
    assert.equal(version(sqlite), 4);
    assert.equal((sqlite.prepare(`SELECT COUNT(*) AS n FROM ${TABLE_NAMES.bookmarks}`).get() as { n: number }).n, 1);
    assert.deepEqual((await loadSiteLimits(db, '2026-11-09')).blockedSites, ['blocked.example'], 'kept');
  });

  test('a fresh install gets v4 with the tables; a profile database gets them on open', async () => {
    const fresh = openDb();
    await migrateDatabase(fresh.db as never);
    assert.equal(version(fresh.sqlite), 4);
    const profile = openDb();
    await applyBrowserTables(profile.db as never);
    await applyBrowserTables(profile.db as never);
    for (const name of B14_TABLES) assert.ok(tables(profile.sqlite).includes(name), name);
  });

  test('lists, limits, time used and the focus timer survive a restart (read back from the file)', async () => {
    const { sqlite, db } = openDb();
    await applyBrowserTables(db as never);
    await addListSite(db, 'blocked', 'b.example', 't1');
    await addListSite(db, 'blocked', 'b.example', 't2');
    await addListSite(db, 'focus', 'social.example', 't1');
    await setTimeLimit(db, 'limited.example', 15, 't1');
    await setTimeLimit(db, 'limited.example', 1, 't2');
    await addTimeUsed(db, '2026-11-08', 'limited.example', 600);
    await addTimeUsed(db, '2026-11-09', 'limited.example', 30);
    await addTimeUsed(db, '2026-11-09', 'limited.example', 30.4);
    await addTimeUsed(db, '2026-11-09', 'limited.example', 0);
    const endsAt = await startFocus(db, 1_000_000, 25);
    assert.equal(endsAt, 1_000_000 + 25 * 60_000);

    // "Restart": a new connection reads the same rows.
    const again = openDb(sqlite).db;
    const state = await loadSiteLimits(again, '2026-11-09');
    assert.deepEqual(state.blockedSites, ['b.example']);
    assert.deepEqual(state.focusSites, ['social.example']);
    assert.deepEqual(state.timeLimits, { 'limited.example': 1 });
    assert.deepEqual(state.usage, { 'limited.example': 60 }, 'today only, summed');
    assert.equal(state.usageDay, '2026-11-09');
    assert.equal(state.focusEndsAt, endsAt);

    await pruneTimeUsedBefore(again, '2026-11-09');
    assert.equal((sqlite.prepare(`SELECT COUNT(*) AS n FROM ${TABLE_NAMES.siteTimeUsage}`).get() as { n: number }).n, 1);
    await removeTimeLimit(again, 'limited.example');
    await removeListSite(again, 'blocked', 'b.example');
    await endFocus(again);
    const after = await loadSiteLimits(again, '2026-11-09');
    assert.deepEqual(after.blockedSites, []);
    assert.deepEqual(after.timeLimits, {});
    assert.deepEqual(after.usage, {});
    assert.equal(after.focusEndsAt, null);
    assert.deepEqual(after.focusSites, ['social.example'], 'the distracting list stays after focus ends');
  });
});
