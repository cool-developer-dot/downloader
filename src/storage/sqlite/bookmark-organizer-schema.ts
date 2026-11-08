import { TABLE_NAMES } from '@/storage/constants';

/**
 * B9 — the tables and columns bookmark folders, tags, notes, order and the reading list need. Part of
 * `applyBrowserTables`, so it runs for the app database (migration to v3, fresh installs) and for every browser
 * profile's database (B20) on open. Safe to run any number of times: `CREATE … IF NOT EXISTS`, and each column is added
 * only when `PRAGMA table_info` doesn't list it.
 *
 * Existing bookmarks stay in the root folder (`folder_id` NULL). Their order — the Bookmarks screen's newest first —
 * becomes `position` 0, 1, 2… in the same step that adds the column, so a second run changes nothing. (Bookmarks added
 * later without a position sort first, newest first, as today.)
 *
 * The reading list is its own table, not `kind = 'reading'` rows in `bookmarks`: `bookmarks.url` is UNIQUE (B20's
 * restore relies on it), so a page couldn't be both bookmarked and on the reading list, and dropping that constraint
 * would mean rebuilding the table that holds the user's bookmarks.
 */

/** The part of expo-sqlite's database used here (node:sqlite in tests). */
export type SchemaDb = {
  execAsync(sql: string): Promise<void>;
  getAllAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T[]>;
};

export async function applyBookmarkOrganizerTables(db: SchemaDb): Promise<void> {
  const B = TABLE_NAMES.bookmarks;
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS ${TABLE_NAMES.bookmarkFolders} (
      id TEXT PRIMARY KEY NOT NULL,
      parent_id TEXT REFERENCES ${TABLE_NAMES.bookmarkFolders}(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bookmark_folders_parent
      ON ${TABLE_NAMES.bookmarkFolders}(parent_id, position);

    CREATE TABLE IF NOT EXISTS ${TABLE_NAMES.bookmarkTags} (
      bookmark_id TEXT NOT NULL REFERENCES ${B}(id) ON DELETE CASCADE ON UPDATE CASCADE,
      tag TEXT NOT NULL,
      PRIMARY KEY (bookmark_id, tag)
    );
    CREATE INDEX IF NOT EXISTS idx_bookmark_tags_tag ON ${TABLE_NAMES.bookmarkTags}(tag);

    CREATE TABLE IF NOT EXISTS ${TABLE_NAMES.readingList} (
      id TEXT PRIMARY KEY NOT NULL,
      url TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      hostname TEXT NOT NULL,
      created_at TEXT NOT NULL,
      read_at TEXT,
      offline_uri TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_reading_list_read ON ${TABLE_NAMES.readingList}(read_at, created_at DESC);
  `);

  const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${B})`);
  const has = (name: string) => columns.some((column) => column.name === name);
  if (!has('folder_id')) {
    await db.execAsync(`ALTER TABLE ${B} ADD COLUMN folder_id TEXT`);
  }
  if (!has('note')) {
    await db.execAsync(`ALTER TABLE ${B} ADD COLUMN note TEXT NOT NULL DEFAULT ''`);
  }
  if (!has('position')) {
    await db.execAsync(`ALTER TABLE ${B} ADD COLUMN position INTEGER`);
    // Today's order (newest first) becomes the root folder's order.
    await db.execAsync(`
      UPDATE ${B} SET position = (
        SELECT ranked.rn FROM (
          SELECT id, ROW_NUMBER() OVER (ORDER BY created_at DESC, id) - 1 AS rn FROM ${B}
        ) AS ranked WHERE ranked.id = ${B}.id
      );
    `);
  }
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_bookmarks_folder_position ON ${B}(folder_id, position);`);
}
