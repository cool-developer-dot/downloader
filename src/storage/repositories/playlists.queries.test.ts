import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { DATABASE_VERSION, TABLE_NAMES } from '@/storage/constants';
import { migrateDatabase } from '@/storage/sqlite/migrations';
import { applyPlaylistTables } from '@/storage/sqlite/playlist-schema';
import { applyBrowserTables, applySchema } from '@/storage/sqlite/schema';

import {
  addPlaylistItems,
  createPlaylist,
  deletePlaylist,
  getPlaylist,
  listPlaylistItems,
  listPlaylists,
  movePlaylistItem,
  playlistIdsWithMedia,
  PlaylistError,
  removePlaylistItem,
  renamePlaylist,
  type PlaylistsDb,
} from './playlists.queries.ts';

/** P7 — the v9 migration and the playlist queries on a real SQLite (Node's built-in), with the app's schema. */

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
  return { sqlite, db: db as PlaylistsDb & typeof db };
}

const version = (sqlite: DatabaseSync) =>
  (sqlite.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
const tables = (sqlite: DatabaseSync) =>
  (sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as {
    name: string;
  }[]).map((t) => t.name);
const P7_TABLES = [TABLE_NAMES.playlists, TABLE_NAMES.playlistItems];

/** Every row of every table (or of all but `except`), rows sorted, so two snapshots compare exactly. */
function snapshot(sqlite: DatabaseSync, except: readonly string[] = []): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const name of tables(sqlite).sort()) {
    if (except.includes(name)) continue;
    out[name] = (sqlite.prepare(`SELECT * FROM ${name}`).all() as object[]).map((row) => JSON.stringify(row)).sort();
  }
  return out;
}

const NOW = '2026-11-23T10:00:00.000Z';
const LATER = '2026-11-23T11:00:00.000Z';

/** A phone on v8 (B17): every table up to saved pages, real rows in several of them, no playlist tables. */
async function v8Database() {
  const { sqlite, db } = openDb();
  await migrateDatabase(db as never);
  for (const name of P7_TABLES) sqlite.exec(`DROP TABLE ${name}`);
  sqlite.exec('PRAGMA user_version = 8');
  sqlite
    .prepare(`INSERT INTO ${TABLE_NAMES.mediaFolders} (id, name, normalized_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .run('f1', 'Cooking', 'cooking', 'x', 'x');
  sqlite
    .prepare(`INSERT INTO ${TABLE_NAMES.mediaFolders} (id, name, normalized_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .run('f2', 'اردو ڈرامے', 'اردو ڈرامے', 'y', 'y');
  sqlite
    .prepare(`INSERT INTO ${TABLE_NAMES.bookmarks} (id, url, title, hostname, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('b1', 'https://a.test/', 'A', 'a.test', 'x', 'x');
  sqlite
    .prepare(`INSERT INTO ${TABLE_NAMES.notes} (id, text, page_url, page_title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('n1', 'remember this', 'https://a.test/', 'A', 'x', 'x');
  sqlite
    .prepare(`INSERT INTO ${TABLE_NAMES.savedPages} (id, url, title, size, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run('s1', 'https://a.test/page', 'Page', 2048, 'x');
  sqlite
    .prepare(
      `INSERT INTO ${TABLE_NAMES.downloadsCatalog} (id, title, source_url, file_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run('d1', 'Clip', 'https://a.test/clip.mp4', 'clip.mp4', 'COMPLETED', 'x', 'x');
  sqlite
    .prepare(`INSERT INTO ${TABLE_NAMES.browserHistory} (id, url, title, hostname, visited_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('h1', 'https://a.test/', 'A', 'a.test', 'x', 'x');
  return { sqlite, db };
}

describe('P7 database v9 (playlists)', () => {
  test('DATABASE_VERSION is 9 or later and names the two new tables', () => {
    assert.ok(DATABASE_VERSION >= 9, 'P7 made it 9; later packages go on (P9, P11)');
    assert.equal(TABLE_NAMES.playlists, 'playlists');
    assert.equal(TABLE_NAMES.playlistItems, 'playlist_items');
  });

  test('a fresh install (version 0) gets the current version with both tables, their indexes and the cascade', async () => {
    const { sqlite, db } = openDb();
    assert.equal(version(sqlite), 0);
    await migrateDatabase(db as never);
    assert.equal(version(sqlite), DATABASE_VERSION);
    for (const name of P7_TABLES) assert.ok(tables(sqlite).includes(name), name);
    const indexes = (sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`).all() as { name: string }[]).map(
      (i) => i.name,
    );
    for (const name of ['idx_playlists_updated_at', 'idx_playlist_items_position', 'idx_playlist_items_media']) {
      assert.ok(indexes.includes(name), name);
    }
    const keys = sqlite.prepare(`PRAGMA foreign_key_list(${TABLE_NAMES.playlistItems})`).all() as {
      table: string;
      on_delete: string;
    }[];
    assert.deepEqual(
      keys.map((k) => [k.table, k.on_delete]),
      [[TABLE_NAMES.playlists, 'CASCADE']],
    );
    assert.equal((sqlite.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys, 1);
  });

  test('applySchema alone (the fresh-install path) creates them too and records the current version', async () => {
    const { sqlite, db } = openDb();
    await applySchema(db as never);
    assert.equal(version(sqlite), DATABASE_VERSION);
    for (const name of P7_TABLES) assert.ok(tables(sqlite).includes(name), name);
  });

  test('an upgrade from v8 with real rows: the current version, the tables appear, every old row is unchanged', async () => {
    const { sqlite, db } = await v8Database();
    const before = snapshot(sqlite);
    assert.equal(before[TABLE_NAMES.mediaFolders]!.length, 2);
    assert.equal(before[TABLE_NAMES.downloadsCatalog]!.length, 1);
    for (const name of P7_TABLES) assert.ok(!tables(sqlite).includes(name), `${name} absent on v8`);

    await migrateDatabase(db as never);

    assert.equal(version(sqlite), DATABASE_VERSION);
    for (const name of P7_TABLES) assert.ok(tables(sqlite).includes(name), name);
    assert.deepEqual(snapshot(sqlite, P7_TABLES), before);
    assert.equal((await listPlaylists(db)).length, 0);
  });

  test('running the migration again (and the table DDL twice) keeps old rows and playlists as they are', async () => {
    const { sqlite, db } = await v8Database();
    await migrateDatabase(db as never);
    await createPlaylist(db, { id: 'p1', name: 'Road trip', nowIso: NOW });
    await addPlaylistItems(db, 'p1', [{ mediaId: 'd1', title: 'Clip', fileName: 'clip.mp4' }], NOW);
    const before = snapshot(sqlite);

    sqlite.exec('PRAGMA user_version = 8');
    await migrateDatabase(db as never);
    await migrateDatabase(db as never);
    await applyPlaylistTables(db);
    await applyPlaylistTables(db);

    assert.equal(version(sqlite), DATABASE_VERSION);
    assert.deepEqual(snapshot(sqlite), before);
  });

  test('a browser-profile database (applyBrowserTables) never gets the playlist tables', async () => {
    const { sqlite, db } = openDb();
    await applyBrowserTables(db as never);
    for (const name of P7_TABLES) assert.ok(!tables(sqlite).includes(name), name);
  });
});

async function freshDb() {
  const opened = openDb();
  await migrateDatabase(opened.db as never);
  return opened;
}

const item = (mediaId: string, title = mediaId, fileName = `${mediaId}.mp4`) => ({ mediaId, title, fileName });
const ids = async (db: PlaylistsDb, playlistId: string) =>
  (await listPlaylistItems(db, playlistId)).map((i) => [i.mediaId, i.position]);

describe('P7 playlist operations (real SQLite)', () => {
  test('#617 create: the name is trimmed, required, at most 80 characters; Urdu kept', async () => {
    const { db } = await freshDb();
    const trip = await createPlaylist(db, { id: 'p1', name: '  Road   trip ', nowIso: NOW });
    assert.equal(trip.name, 'Road trip');
    const urdu = await createPlaylist(db, { id: 'p2', name: 'میری پسندیدہ ویڈیوز', nowIso: LATER });
    assert.equal(urdu.name, 'میری پسندیدہ ویڈیوز');
    await assert.rejects(
      createPlaylist(db, { id: 'p3', name: '   ', nowIso: NOW }),
      (e: PlaylistError) => e instanceof PlaylistError && e.code === 'INVALID_NAME',
    );
    const long = await createPlaylist(db, { id: 'p4', name: 'x'.repeat(200), nowIso: NOW });
    assert.equal(long.name.length, 80);
    // Recently changed first.
    assert.deepEqual((await listPlaylists(db)).map((p) => p.id).slice(0, 1), ['p2']);
  });

  test('#617 add: appended in order; a video already there stays where it is and is counted', async () => {
    const { db } = await freshDb();
    await createPlaylist(db, { id: 'p1', name: 'A', nowIso: NOW });
    assert.deepEqual(await addPlaylistItems(db, 'p1', [item('v1'), item('v2')], NOW), { added: 2, alreadyThere: 0 });
    assert.deepEqual(
      await addPlaylistItems(db, 'p1', [item('v2'), item('v3'), item('v1'), item('v3'), item('device:77', 'Phone clip', 'Phone clip')], LATER),
      { added: 2, alreadyThere: 3 },
    );
    assert.deepEqual(await ids(db, 'p1'), [
      ['v1', 0],
      ['v2', 1],
      ['v3', 2],
      ['device:77', 3],
    ]);
    const playlist = await getPlaylist(db, 'p1');
    assert.equal(playlist?.itemCount, 4);
    assert.equal(playlist?.updatedAt, LATER);
    const stored = (await listPlaylistItems(db, 'p1')).find((i) => i.mediaId === 'device:77');
    assert.deepEqual([stored?.title, stored?.fileName, stored?.durationSeconds], ['Phone clip', 'Phone clip', null]);
    assert.deepEqual(await playlistIdsWithMedia(db, 'v2'), ['p1']);
  });

  test('#617 the same video can be in several playlists; a missing playlist is refused and nothing is written', async () => {
    const { db } = await freshDb();
    await createPlaylist(db, { id: 'p1', name: 'A', nowIso: NOW });
    await createPlaylist(db, { id: 'p2', name: 'B', nowIso: NOW });
    await addPlaylistItems(db, 'p1', [{ ...item('v1'), durationSeconds: 61.5 }], NOW);
    await addPlaylistItems(db, 'p2', [item('v1')], NOW);
    assert.deepEqual((await playlistIdsWithMedia(db, 'v1')).sort(), ['p1', 'p2']);
    assert.equal((await listPlaylistItems(db, 'p1'))[0]?.durationSeconds, 61.5);
    await assert.rejects(
      addPlaylistItems(db, 'nope', [item('v9')], NOW),
      (e: PlaylistError) => e instanceof PlaylistError && e.code === 'NOT_FOUND',
    );
    assert.deepEqual(await playlistIdsWithMedia(db, 'v9'), []);
  });

  test('#618 reorder: up / down, stopping at the ends; positions stay 0, 1, 2…', async () => {
    const { db } = await freshDb();
    await createPlaylist(db, { id: 'p1', name: 'A', nowIso: NOW });
    await addPlaylistItems(db, 'p1', [item('a'), item('b'), item('c')], NOW);
    assert.equal(await movePlaylistItem(db, 'p1', 'c', -1, LATER), true);
    assert.deepEqual(await ids(db, 'p1'), [
      ['a', 0],
      ['c', 1],
      ['b', 2],
    ]);
    assert.equal(await movePlaylistItem(db, 'p1', 'a', -1, LATER), false, 'already first');
    assert.equal(await movePlaylistItem(db, 'p1', 'b', 1, LATER), false, 'already last');
    assert.equal(await movePlaylistItem(db, 'p1', 'a', 1, LATER), true);
    assert.deepEqual((await ids(db, 'p1')).map(([id]) => id), ['c', 'a', 'b']);
    assert.equal(await movePlaylistItem(db, 'p1', 'zzz', 1, LATER), false, 'not in the playlist');
  });

  test('#618 remove: only that entry, the rest renumbered; other playlists keep the video', async () => {
    const { db } = await freshDb();
    await createPlaylist(db, { id: 'p1', name: 'A', nowIso: NOW });
    await createPlaylist(db, { id: 'p2', name: 'B', nowIso: NOW });
    await addPlaylistItems(db, 'p1', [item('a'), item('b'), item('c')], NOW);
    await addPlaylistItems(db, 'p2', [item('b')], NOW);
    assert.equal(await removePlaylistItem(db, 'p1', 'b', LATER), true);
    assert.equal(await removePlaylistItem(db, 'p1', 'b', LATER), false);
    assert.deepEqual(await ids(db, 'p1'), [
      ['a', 0],
      ['c', 1],
    ]);
    assert.deepEqual(await playlistIdsWithMedia(db, 'b'), ['p2']);
  });

  test('#618 rename: trimmed, Urdu kept, an empty name refused', async () => {
    const { db } = await freshDb();
    await createPlaylist(db, { id: 'p1', name: 'A', nowIso: NOW });
    assert.equal(await renamePlaylist(db, 'p1', '  سفر  ', LATER), true);
    assert.equal((await getPlaylist(db, 'p1'))?.name, 'سفر');
    await assert.rejects(renamePlaylist(db, 'p1', ' ', LATER), (e: PlaylistError) => e.code === 'INVALID_NAME');
    assert.equal(await renamePlaylist(db, 'missing', 'X', LATER), false);
  });

  test('#618 delete: the playlist and its entries go; no other table and no other playlist changes', async () => {
    const { sqlite, db } = await v8Database();
    await migrateDatabase(db as never);
    await createPlaylist(db, { id: 'p1', name: 'A', nowIso: NOW });
    await createPlaylist(db, { id: 'p2', name: 'B', nowIso: NOW });
    await addPlaylistItems(db, 'p1', [item('d1'), item('v2')], NOW);
    await addPlaylistItems(db, 'p2', [item('d1')], NOW);
    const before = snapshot(sqlite, P7_TABLES);

    assert.equal(await deletePlaylist(db, 'p1'), true);
    assert.equal(await deletePlaylist(db, 'p1'), false);

    assert.equal(await getPlaylist(db, 'p1'), null);
    assert.deepEqual(await listPlaylistItems(db, 'p1'), []);
    assert.equal(
      (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${TABLE_NAMES.playlistItems} WHERE playlist_id = 'p1'`).get() as { n: number }).n,
      0,
    );
    assert.deepEqual(await ids(db, 'p2'), [['d1', 0]]);
    // The download catalog row of the video (and every other table) is untouched.
    assert.deepEqual(snapshot(sqlite, P7_TABLES), before);
  });

  test('the foreign key alone also cascades (a row deleted outside deletePlaylist)', async () => {
    const { sqlite, db } = await freshDb();
    await createPlaylist(db, { id: 'p1', name: 'A', nowIso: NOW });
    await addPlaylistItems(db, 'p1', [item('a')], NOW);
    sqlite.exec(`DELETE FROM ${TABLE_NAMES.playlists} WHERE id = 'p1'`);
    assert.equal((sqlite.prepare(`SELECT COUNT(*) AS n FROM ${TABLE_NAMES.playlistItems}`).get() as { n: number }).n, 0);
  });
});
