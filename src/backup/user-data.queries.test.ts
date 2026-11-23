import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { DATABASE_VERSION, TABLE_NAMES } from '@/storage/constants';
import { migrateDatabase } from '@/storage/sqlite/migrations';
import { MAX_BOOKMARKS_PER_VIDEO } from '@/player/video-bookmarks';
import { addPlaylistItems, createPlaylist } from '@/storage/repositories/playlists.queries';
import { addVideoBookmark, recordPlay } from '@/storage/repositories/library-stats.queries';

import { appBackupJson, parseAppBackup } from './backup-format.ts';
import { readUserData, restoreUserData, type UserDataDb } from './user-data.queries.ts';

/**
 * P11 #700 — the database part of a backup on a real SQLite (Node's built-in) with the app's own schema (v10, no P11
 * schema change): read → file → restore gives the same rows; Merge adds and is idempotent; Replace is exact; a failure
 * writes nothing; no other table is touched.
 */

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
  return { sqlite, db: db as UserDataDb & typeof db };
}

async function freshDb() {
  const opened = openDb();
  await migrateDatabase(opened.db as never);
  return opened;
}

const T1 = '2026-11-20T10:00:00.000Z';
const T2 = '2026-11-21T10:00:00.000Z';
const T3 = '2026-11-22T10:00:00.000Z';
const NOW = '2026-11-23T10:00:00.000Z';

/** A phone with data in every table P11 backs up, and in others it never touches. */
async function phoneWithData() {
  const opened = await freshDb();
  const { db, sqlite } = opened;
  await createPlaylist(db, { id: 'p1', name: 'Road trip', nowIso: T1 });
  await addPlaylistItems(
    db,
    'p1',
    [
      { mediaId: 'video-1', title: 'One', fileName: 'one.mp4', durationSeconds: 61 },
      { mediaId: 'device:42', title: 'اردو ڈرامہ', fileName: 'urdu.mp4' },
    ],
    T1,
  );
  await createPlaylist(db, { id: 'p2', name: 'Empty', nowIso: T2 });
  await addVideoBookmark(db, { id: 'b1', mediaId: 'video-1', positionMs: 1500, name: 'Start', nowIso: T1 });
  await addVideoBookmark(db, { id: 'b2', mediaId: 'video-2', positionMs: 9000, nowIso: T2 });
  await recordPlay(db, 'video-1', T1);
  await recordPlay(db, 'video-1', T2);
  await recordPlay(db, 'video-2', T3);
  sqlite
    .prepare(`INSERT INTO ${TABLE_NAMES.mediaFolders} (id, name, normalized_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .run('f1', 'Cooking', 'cooking', T1, T1);
  sqlite
    .prepare(`INSERT INTO ${TABLE_NAMES.bookmarks} (id, url, title, hostname, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('web1', 'https://a.test/', 'A', 'a.test', T1, T1);
  return opened;
}

const OURS = [TABLE_NAMES.playlists, TABLE_NAMES.playlistItems, TABLE_NAMES.videoBookmarks, TABLE_NAMES.mediaPlayStats];

function snapshotOthers(sqlite: DatabaseSync): Record<string, string[]> {
  const names = (sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as {
    name: string;
  }[])
    .map((row) => row.name)
    .filter((name) => !(OURS as readonly string[]).includes(name))
    .sort();
  const out: Record<string, string[]> = {};
  for (const name of names) {
    out[name] = (sqlite.prepare(`SELECT * FROM ${name}`).all() as object[]).map((row) => JSON.stringify(row)).sort();
  }
  return out;
}

async function throughFile(db: UserDataDb) {
  const data = await readUserData(db);
  const parsed = parseAppBackup(appBackupJson(data, new Date(NOW)), {});
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error('not parsed');
  return { data, sections: parsed.backup.sections };
}

describe('P11 backup: the database part', () => {
  test('no schema change of its own: P7’s v9 and P9’s v10 tables are all it reads and writes', () => {
    assert.ok(DATABASE_VERSION >= 10);
  });

  test('read → file → Replace into an empty phone gives exactly the same rows', async () => {
    const source = await phoneWithData();
    const { data, sections } = await throughFile(source.db);
    assert.equal(data.playlists.length, 2);
    assert.deepEqual(
      data.playlists[0]!.items.map((item) => [item.mediaId, item.position]),
      [
        ['video-1', 0],
        ['device:42', 1],
      ],
    );
    assert.deepEqual(data.playStats, [
      { mediaId: 'video-1', playCount: 2, lastPlayedAt: T2 },
      { mediaId: 'video-2', playCount: 1, lastPlayedAt: T3 },
    ]);

    const target = await freshDb();
    await restoreUserData(target.db, sections, 'replace', NOW);
    assert.deepEqual(await readUserData(target.db), data);
  });

  test('Merge into the same phone changes nothing (it is all there already), and Merge is idempotent', async () => {
    const phone = await phoneWithData();
    const { data, sections } = await throughFile(phone.db);
    const first = await restoreUserData(phone.db, sections, 'merge', NOW);
    assert.deepEqual(first, { playlistsAdded: 0, playlistVideosAdded: 0, bookmarksAdded: 0, playCountsChanged: 0 });
    assert.deepEqual(await readUserData(phone.db), data);
  });

  test('Merge adds: a playlist matched by id or by name gets the videos it lacks at its end; a new one is added', async () => {
    const phone = await freshDb();
    await createPlaylist(phone.db, { id: 'phone-p', name: 'road TRIP', nowIso: T1 });
    await addPlaylistItems(phone.db, 'phone-p', [{ mediaId: 'mine', title: 'Mine', fileName: 'mine.mp4' }], T1);
    const source = await phoneWithData();
    const { sections } = await throughFile(source.db);

    const summary = await restoreUserData(phone.db, sections, 'merge', NOW);
    const after = await readUserData(phone.db);
    const roadTrip = after.playlists.find((playlist) => playlist.id === 'phone-p')!;
    assert.deepEqual(
      roadTrip.items.map((item) => item.mediaId),
      ['mine', 'video-1', 'device:42'],
      'matched by name: the phone’s video first, the file’s after it',
    );
    assert.equal(roadTrip.updatedAt, NOW);
    assert.equal(roadTrip.name, 'road TRIP', 'the phone’s name is kept');
    assert.ok(after.playlists.some((playlist) => playlist.id === 'p2' && playlist.updatedAt === T2), 'a new one keeps its dates');
    assert.equal(summary.playlistsAdded, 1);
    assert.equal(summary.playlistVideosAdded, 2);
  });

  test('Merge: a bookmark at the same moment of the same video isn’t doubled; full videos take no more', async () => {
    const phone = await freshDb();
    await addVideoBookmark(phone.db, { id: 'mine', mediaId: 'video-1', positionMs: 1500, name: 'Mine', nowIso: T1 });
    for (let i = 0; i < MAX_BOOKMARKS_PER_VIDEO; i += 1) {
      await addVideoBookmark(phone.db, { id: `full-${i}`, mediaId: 'full-video', positionMs: i * 1000, nowIso: T1 });
    }
    const summary = await restoreUserData(
      phone.db,
      {
        videoBookmarks: [
          { id: 'b1', mediaId: 'video-1', positionMs: 1500, name: 'Start', createdAt: T1 },
          { id: 'b3', mediaId: 'video-1', positionMs: 4000, name: null, createdAt: T2 },
          { id: 'b4', mediaId: 'full-video', positionMs: 999_999, name: null, createdAt: T2 },
        ],
      },
      'merge',
      NOW,
    );
    assert.equal(summary.bookmarksAdded, 1);
    const video1 = (await readUserData(phone.db)).videoBookmarks.filter((b) => b.mediaId === 'video-1');
    assert.deepEqual(
      video1.map((b) => [b.id, b.positionMs, b.name]),
      [
        ['mine', 1500, 'Mine'],
        ['b3', 4000, null],
      ],
    );
  });

  test('Merge: a play count keeps the higher count and the later date — never the sum', async () => {
    const phone = await freshDb();
    await recordPlay(phone.db, 'video-1', T3);
    await recordPlay(phone.db, 'video-2', T1);
    await recordPlay(phone.db, 'video-2', T1);
    await recordPlay(phone.db, 'video-2', T1);
    await restoreUserData(
      phone.db,
      {
        playStats: [
          { mediaId: 'video-1', playCount: 5, lastPlayedAt: T1 },
          { mediaId: 'video-2', playCount: 1, lastPlayedAt: T2 },
          { mediaId: 'video-3', playCount: 2, lastPlayedAt: null },
        ],
      },
      'merge',
      NOW,
    );
    assert.deepEqual((await readUserData(phone.db)).playStats, [
      { mediaId: 'video-1', playCount: 5, lastPlayedAt: T3 },
      { mediaId: 'video-2', playCount: 3, lastPlayedAt: T2 },
      { mediaId: 'video-3', playCount: 2, lastPlayedAt: null },
    ]);
  });

  test('Replace removes what isn’t in the file, for the sections the file has only', async () => {
    const phone = await phoneWithData();
    await restoreUserData(
      phone.db,
      {
        playlists: [{ id: 'only', name: 'Only', createdAt: T3, updatedAt: T3, items: [] }],
        playStats: [],
      },
      'replace',
      NOW,
    );
    const after = await readUserData(phone.db);
    assert.deepEqual(after.playlists, [{ id: 'only', name: 'Only', createdAt: T3, updatedAt: T3, items: [] }]);
    assert.deepEqual(after.playStats, []);
    assert.equal(after.videoBookmarks.length, 2, 'no bookmarks section in the file: left as they were');
    const orphans = phone.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${TABLE_NAMES.playlistItems}`).get() as { n: number };
    assert.equal(Number(orphans.n), 0, 'the old playlists’ videos went with them');
  });

  test('a restore that fails part-way writes nothing (one transaction)', async () => {
    const phone = await phoneWithData();
    const before = await readUserData(phone.db);
    let calls = 0;
    const failing: UserDataDb = {
      ...phone.db,
      runAsync: async (sql: string, ...params: Param[]) => {
        calls += 1;
        if (sql.includes(`INSERT INTO ${TABLE_NAMES.mediaPlayStats}`)) {
          throw new Error('disk full');
        }
        return phone.db.runAsync(sql, ...params);
      },
    };
    await assert.rejects(
      restoreUserData(
        failing,
        {
          playlists: [{ id: 'new', name: 'New', createdAt: T3, updatedAt: T3, items: [] }],
          playStats: [{ mediaId: 'video-9', playCount: 1, lastPlayedAt: T3 }],
        },
        'replace',
        NOW,
      ),
      /disk full/,
    );
    assert.ok(calls > 2, 'it had already deleted and inserted playlists');
    assert.deepEqual(await readUserData(phone.db), before);
  });

  test('no other table is read into the file or written by a restore', async () => {
    const phone = await phoneWithData();
    const before = snapshotOthers(phone.sqlite);
    const { sections } = await throughFile(phone.db);
    assert.deepEqual(Object.keys(sections).sort(), ['playStats', 'playlists', 'videoBookmarks']);
    await restoreUserData(phone.db, sections, 'replace', NOW);
    await restoreUserData(phone.db, sections, 'merge', NOW);
    assert.deepEqual(snapshotOthers(phone.sqlite), before);
  });
});
