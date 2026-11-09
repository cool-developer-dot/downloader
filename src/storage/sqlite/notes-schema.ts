import { TABLE_NAMES } from '@/storage/constants';

import type { SchemaDb } from './bookmark-organizer-schema';

/**
 * B22 #252 — the notes table, per browser profile: part of `applyBrowserTables`, so it runs for the app database
 * (migration to v5, fresh installs) and for every browser profile's database (B20) on open. `CREATE … IF NOT EXISTS`
 * only: safe to run any number of times; no existing table changes.
 */
export async function applyNotesTables(db: Pick<SchemaDb, 'execAsync'>): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS ${TABLE_NAMES.notes} (
      id TEXT PRIMARY KEY NOT NULL,
      text TEXT NOT NULL,
      page_url TEXT NOT NULL DEFAULT '',
      page_title TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON ${TABLE_NAMES.notes}(updated_at DESC);
  `);
}
