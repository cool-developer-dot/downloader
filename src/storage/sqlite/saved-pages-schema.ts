import { TABLE_NAMES } from '@/storage/constants';

import type { SchemaDb } from './bookmark-organizer-schema';

/**
 * B17 #178 — saved (offline) pages, per browser profile: part of `applyBrowserTables` (app database migration to v8,
 * fresh installs, every profile database on open). The archive itself is a file (`offline-pages/<profile>/<id>.mht`).
 * `CREATE … IF NOT EXISTS` only: safe to run twice.
 */
export async function applySavedPagesTables(db: Pick<SchemaDb, 'execAsync'>): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS ${TABLE_NAMES.savedPages} (
      id TEXT PRIMARY KEY NOT NULL,
      url TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);
}
