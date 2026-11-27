import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { describe, test } from 'node:test';

import type { SQLiteDatabase } from 'expo-sqlite';

import { applyFolderTreeSchema } from './folder-tree-schema';

function fakeDb(columns: string[]) {
  const exec: string[] = [];
  const db = {
    getAllAsync: async () => columns.map((name) => ({ name })),
    execAsync: async (sql: string) => {
      exec.push(sql);
      if (/ADD COLUMN parent_id/.test(sql)) {
        columns.push('parent_id');
      }
    },
  };
  return { db: db as unknown as SQLiteDatabase, exec, columns };
}

describe('applyFolderTreeSchema (app DB v11)', () => {
  test('adds parent_id once, swaps the name index for a per-parent one', async () => {
    const { db, exec } = fakeDb(['id', 'name', 'normalized_name', 'created_at', 'updated_at']);
    await applyFolderTreeSchema(db);
    assert.equal(exec.filter((sql) => /ADD COLUMN parent_id/.test(sql)).length, 1);
    const indexSql = exec.join('\n');
    assert.match(indexSql, /DROP INDEX IF EXISTS idx_media_folders_normalized_name/);
    assert.match(indexSql, /UNIQUE INDEX IF NOT EXISTS idx_media_folders_parent_name[\s\S]*IFNULL\(parent_id, ''\), normalized_name/);
  });

  test('running it twice does not add the column again', async () => {
    const { db, exec } = fakeDb(['id', 'name', 'normalized_name', 'created_at', 'updated_at']);
    await applyFolderTreeSchema(db);
    await applyFolderTreeSchema(db);
    assert.equal(exec.filter((sql) => /ADD COLUMN/.test(sql)).length, 1);
  });

  test('a database without media_folders is left alone', async () => {
    const { db, exec } = fakeDb([]);
    await applyFolderTreeSchema(db);
    assert.equal(exec.length, 0);
  });

  test('a fresh table that already has parent_id is left as is', async () => {
    const { db, exec } = fakeDb(['id', 'name', 'normalized_name', 'parent_id', 'created_at', 'updated_at']);
    await applyFolderTreeSchema(db);
    assert.equal(exec.filter((sql) => /ADD COLUMN/.test(sql)).length, 0);
  });
});

describe('applyFolderTreeSchema on real SQLite (a v10 media_folders table)', () => {
  type Param = string | number | null;

  function v10Database() {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`
      CREATE TABLE media_folders (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, normalized_name TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE UNIQUE INDEX idx_media_folders_normalized_name ON media_folders(normalized_name);
      INSERT INTO media_folders VALUES ('f1', 'Movies', 'movies', '2026-11-01', '2026-11-01');
      INSERT INTO media_folders VALUES ('f2', 'Music', 'music', '2026-11-01', '2026-11-01');
    `);
    const db = {
      async execAsync(sql: string) {
        sqlite.exec(sql);
      },
      async getAllAsync<T>(sql: string, ...params: Param[]) {
        return sqlite.prepare(sql).all(...params) as T[];
      },
    };
    return { sqlite, db: db as unknown as SQLiteDatabase };
  }

  test('old folders stay, at the root; a name may repeat in another parent but not in the same one', async () => {
    const { sqlite, db } = v10Database();
    await applyFolderTreeSchema(db);
    const rows = sqlite.prepare('SELECT id, parent_id FROM media_folders ORDER BY id').all() as { id: string; parent_id: string | null }[];
    assert.deepEqual(rows.map((r) => [r.id, r.parent_id]), [['f1', null], ['f2', null]]);
    // "Movies" inside Music is fine now…
    sqlite.exec(`INSERT INTO media_folders VALUES ('f3', 'Movies', 'movies', '2026-11-02', '2026-11-02', 'f2')`);
    // …a second "Movies" at the root is not.
    assert.throws(() => sqlite.exec(`INSERT INTO media_folders VALUES ('f4', 'Movies', 'movies', '2026-11-02', '2026-11-02', NULL)`));
    // Nor a second "Movies" inside Music.
    assert.throws(() => sqlite.exec(`INSERT INTO media_folders VALUES ('f5', 'Movies', 'movies', '2026-11-02', '2026-11-02', 'f2')`));
    await applyFolderTreeSchema(db); // twice: no error, nothing changes
    assert.equal((sqlite.prepare('SELECT COUNT(*) AS n FROM media_folders').get() as { n: number }).n, 3);
  });
});
