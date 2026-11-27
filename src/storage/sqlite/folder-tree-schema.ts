import type { SQLiteDatabase } from 'expo-sqlite';

import { TABLE_NAMES } from '@/storage/constants';

/**
 * F12 (app DB v11): nested library folders. Adds `media_folders.parent_id` (null = the root) and makes folder names
 * unique per parent instead of across the whole app. Idempotent: fresh installs and every upgrade path run it, and
 * running it twice changes nothing. Existing folders stay at the root; no folder or item is touched.
 */
export async function applyFolderTreeSchema(db: SQLiteDatabase): Promise<void> {
  const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${TABLE_NAMES.mediaFolders})`);
  if (columns.length === 0) {
    // No media_folders table in this database (a browser-profile database, or a test fixture): nothing to change.
    return;
  }
  if (!columns.some((column) => column.name === 'parent_id')) {
    await db.execAsync(`ALTER TABLE ${TABLE_NAMES.mediaFolders} ADD COLUMN parent_id TEXT`);
  }
  await db.execAsync(`
    DROP INDEX IF EXISTS idx_media_folders_normalized_name;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_media_folders_parent_name
      ON ${TABLE_NAMES.mediaFolders}(IFNULL(parent_id, ''), normalized_name);
    CREATE INDEX IF NOT EXISTS idx_media_folders_parent_id
      ON ${TABLE_NAMES.mediaFolders}(parent_id);
  `);
}
