import { TABLE_NAMES } from '@/storage/constants';

import type { SchemaDb } from './bookmark-organizer-schema';

/**
 * P7 #617 / #618 / #629 — playlists and the videos in them. App database (`vidorax.db`) only: run by `applySchema`
 * (fresh installs) and by the migration to v9; NOT part of `applyBrowserTables`, which also runs on every browser
 * profile's database. `CREATE … IF NOT EXISTS` only: safe to run twice, and it never touches another table.
 *
 * `media_id` is plain text, not a foreign key: library videos are not SQLite rows (the download id), and videos already
 * on the phone are `device:<MediaStore id>`. An entry whose video is gone stays and shows as missing. `title`,
 * `file_name` and `duration` are what was known when the video was added: they name a missing entry and fill the
 * M3U8 export. The only foreign key is item → playlist (`ON DELETE CASCADE`; `PRAGMA foreign_keys = ON` is set on
 * open). A video is in a playlist at most once (the primary key), so the play queue never holds the same id twice.
 */
export async function applyPlaylistTables(db: Pick<SchemaDb, 'execAsync'>): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS ${TABLE_NAMES.playlists} (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_playlists_updated_at
      ON ${TABLE_NAMES.playlists}(updated_at DESC);

    CREATE TABLE IF NOT EXISTS ${TABLE_NAMES.playlistItems} (
      playlist_id TEXT NOT NULL REFERENCES ${TABLE_NAMES.playlists}(id) ON DELETE CASCADE,
      media_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      file_name TEXT NOT NULL DEFAULT '',
      duration REAL,
      added_at TEXT NOT NULL,
      PRIMARY KEY (playlist_id, media_id)
    );
    CREATE INDEX IF NOT EXISTS idx_playlist_items_position
      ON ${TABLE_NAMES.playlistItems}(playlist_id, position);
    CREATE INDEX IF NOT EXISTS idx_playlist_items_media
      ON ${TABLE_NAMES.playlistItems}(media_id);
  `);
}
