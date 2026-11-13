import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { DATABASE_VERSION, TABLE_NAMES } from '@/storage/constants';
import { migrateDatabase } from '@/storage/sqlite/migrations';
import { applyBrowserTables } from '@/storage/sqlite/schema';

import { deleteUserScript, listUserScripts, saveUserScript, type UserScriptsDb } from './user-scripts.queries.ts';

/** B19 #199 — user scripts and the v6 migration on a real SQLite (Node's built-in), with the app's schema. */

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
  return { sqlite, db: db as UserScriptsDb & typeof db };
}

const version = (sqlite: DatabaseSync) => (sqlite.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;

describe('B19 user scripts (DATABASE_VERSION 6 and later)', () => {
  test('a v5 database gets the table, keeps its data, and running it twice changes nothing', async () => {
    const { sqlite, db } = openDb();
    await migrateDatabase(db as never);
    assert.ok(DATABASE_VERSION >= 6);
    sqlite.exec(`DROP TABLE ${TABLE_NAMES.userScripts}`);
    sqlite.exec('PRAGMA user_version = 5');
    sqlite.prepare(`INSERT INTO ${TABLE_NAMES.notes} (id, text, page_url, page_title, created_at, updated_at) VALUES ('n', 'kept', '', '', 'x', 'x')`).run();
    await migrateDatabase(db as never);
    assert.equal(version(sqlite), DATABASE_VERSION);
    sqlite.exec('PRAGMA user_version = 5');
    await migrateDatabase(db as never);
    await applyBrowserTables(db as never);
    assert.equal(version(sqlite), DATABASE_VERSION);
    assert.equal((sqlite.prepare(`SELECT COUNT(*) AS n FROM ${TABLE_NAMES.notes}`).get() as { n: number }).n, 1);
  });

  test('save (insert and update by id), list, delete', async () => {
    const { db } = openDb();
    await applyBrowserTables(db as never);
    const base = { id: 'a', name: 'One', code: 'x()', matches: ['*://*.a.test/*'], runAt: 'start' as const, enabled: true, allowIncognito: false };
    await saveUserScript(db, base, '2026-11-09T10:00:00Z');
    await saveUserScript(db, { ...base, id: 'b', name: 'Two', runAt: 'end', enabled: false, allowIncognito: true }, '2026-11-09T11:00:00Z');
    await saveUserScript(db, { ...base, name: 'One (edited)' }, '2026-11-09T12:00:00Z');
    const list = await listUserScripts(db);
    assert.deepEqual(list.map((s) => [s.id, s.name, s.runAt, s.enabled, s.allowIncognito]), [
      ['a', 'One (edited)', 'start', true, false],
      ['b', 'Two', 'end', false, true],
    ]);
    assert.deepEqual(list[0].matches, ['*://*.a.test/*']);
    assert.equal(await deleteUserScript(db, 'a'), true);
    assert.equal((await listUserScripts(db)).length, 1);
  });
});
