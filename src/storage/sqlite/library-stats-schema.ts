import { TABLE_NAMES } from '@/storage/constants';

import type { SchemaDb } from './bookmark-organizer-schema';

/**
 * P9 #708 / #626 / #705 — play counts and video bookmarks. App database (`vidorax.db`) only: run by `applySchema`
 * (fresh installs) and by the migration to v10; NOT part of `applyBrowserTables`, which also runs on every browser
 * profile's database. `CREATE … IF NOT EXISTS` only: safe to run twice, and it never touches another table.
 *
 * Why a table of its own for play counts (not columns on `downloads_catalog`): the Library's videos are not all in the
 * catalog. Only downloads made through the older store path are written there; videos the v2 engine keeps live in the
 * native library database, and videos already on the phone are `device:<MediaStore id>`. So `media_play_stats` is
 * keyed by the media id the Player plays, whatever its source.
 *
 * `duration_ms` / `duration_checked_at` (#711): a video's length as the background backfill measured it from its file
 * (`library/LengthProbe.kt`), and when it was last looked at (also set when no length could be read, so an unreadable
 * file isn't read again and again). A row made only for a length has `play_count` 0: it isn't a play.
 *
 * `media_id` is plain text everywhere, never a foreign key (the same reason as P7's `playlist_items`). The browser's
 * bookmarks are `bookmarks`, so the Player's are `video_bookmarks`.
 */
export async function applyLibraryStatsTables(db: Pick<SchemaDb, 'execAsync'>): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS ${TABLE_NAMES.mediaPlayStats} (
      media_id TEXT PRIMARY KEY NOT NULL,
      play_count INTEGER NOT NULL DEFAULT 0,
      last_played_at TEXT,
      duration_ms INTEGER,
      duration_checked_at TEXT
    );

    CREATE TABLE IF NOT EXISTS ${TABLE_NAMES.videoBookmarks} (
      id TEXT PRIMARY KEY NOT NULL,
      media_id TEXT NOT NULL,
      position_ms INTEGER NOT NULL,
      name TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_video_bookmarks_media
      ON ${TABLE_NAMES.videoBookmarks}(media_id, position_ms);
  `);
}
