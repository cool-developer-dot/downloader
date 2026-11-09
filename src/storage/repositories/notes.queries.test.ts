import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { DATABASE_VERSION, TABLE_NAMES } from '@/storage/constants';
import { migrateDatabase } from '@/storage/sqlite/migrations';
import { applyBrowserTables } from '@/storage/sqlite/schema';

import { deleteNote, insertNote, listNotes, updateNoteText, type NotesDb } from './notes.queries.ts';

/** B22 #252 — the notes queries and the v5 migration on a real SQLite (Node's built-in), with the app's schema. */

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
  return { sqlite, db: db as NotesDb & typeof db };
}

const version = (sqlite: DatabaseSync) => (sqlite.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;

describe('B22 notes (DATABASE_VERSION 5)', () => {
  test('a v4 database gets the notes table, keeps its data, and running it twice changes nothing', async () => {
    const { sqlite, db } = openDb();
    await migrateDatabase(db as never);
    assert.equal(DATABASE_VERSION, 5);
    sqlite.exec(`DROP TABLE ${TABLE_NAMES.notes}`);
    sqlite.exec('PRAGMA user_version = 4');
    sqlite
      .prepare(`INSERT INTO ${TABLE_NAMES.bookmarks} (id, url, title, hostname, created_at, updated_at) VALUES ('b1', 'https://a.test/', 'A', 'a.test', 'x', 'x')`)
      .run();
    await migrateDatabase(db as never);
    assert.equal(version(sqlite), 5);
    await insertNote(db, { id: 'n1', text: 'kept', pageUrl: '', pageTitle: '' }, '2026-11-09T10:00:00Z');
    sqlite.exec('PRAGMA user_version = 4');
    await migrateDatabase(db as never);
    await applyBrowserTables(db as never);
    assert.equal(version(sqlite), 5);
    assert.equal((await listNotes(db)).length, 1);
    assert.equal((sqlite.prepare(`SELECT COUNT(*) AS n FROM ${TABLE_NAMES.bookmarks}`).get() as { n: number }).n, 1);
  });

  test('add, list newest first, search text / title / address (% and _ are literal), edit, delete', async () => {
    const { db } = openDb();
    await applyBrowserTables(db as never);
    await insertNote(db, { id: 'a', text: 'Badshahi Mosque, 1673', pageUrl: 'https://en.wikipedia.org/wiki/Badshahi_Mosque', pageTitle: 'Badshahi Mosque' }, '2026-11-09T10:00:00Z');
    await insertNote(db, { id: 'b', text: '100% cotton', pageUrl: '', pageTitle: '' }, '2026-11-09T11:00:00Z');
    await insertNote(db, { id: 'c', text: 'لاہور قلعہ', pageUrl: 'https://ur.wikipedia.org/', pageTitle: 'لاہور' }, '2026-11-09T12:00:00Z');
    assert.deepEqual((await listNotes(db)).map((n) => n.id), ['c', 'b', 'a']);
    assert.deepEqual((await listNotes(db, 'mosque')).map((n) => n.id), ['a']);
    assert.deepEqual((await listNotes(db, 'wikipedia.org/wiki')).map((n) => n.id), ['a']);
    assert.deepEqual((await listNotes(db, 'لاہور')).map((n) => n.id), ['c']);
    assert.deepEqual((await listNotes(db, '100%')).map((n) => n.id), ['b']);
    assert.deepEqual((await listNotes(db, '%')).map((n) => n.id), ['b'], '% is not a wildcard');
    assert.equal(await updateNoteText(db, 'a', 'Badshahi Mosque (edited)', '2026-11-09T13:00:00Z'), true);
    assert.equal((await listNotes(db))[0].id, 'a', 'an edit moves it to the top');
    assert.equal(await deleteNote(db, 'b'), true);
    assert.equal(await deleteNote(db, 'b'), false);
    assert.deepEqual((await listNotes(db)).map((n) => n.id), ['a', 'c']);
  });
});
