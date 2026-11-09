import { TABLE_NAMES } from '@/storage/constants';

import type { SchemaDb } from './bookmark-organizer-schema';

/**
 * B23 — highlights (#261) and watched pages (#289), per browser profile: part of `applyBrowserTables` (app database
 * migration to v7, fresh installs, every profile database on open). `CREATE … IF NOT EXISTS` only: safe to run twice.
 */
export async function applyAnnotateTables(db: Pick<SchemaDb, 'execAsync'>): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS ${TABLE_NAMES.highlights} (
      id TEXT PRIMARY KEY NOT NULL,
      page_url TEXT NOT NULL,
      page_title TEXT NOT NULL DEFAULT '',
      exact TEXT NOT NULL,
      prefix TEXT NOT NULL DEFAULT '',
      suffix TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT 'yellow',
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_highlights_page ON ${TABLE_NAMES.highlights} (page_url);
    CREATE TABLE IF NOT EXISTS ${TABLE_NAMES.pageWatches} (
      id TEXT PRIMARY KEY NOT NULL,
      url TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL DEFAULT '',
      hash TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ok',
      last_checked_at TEXT,
      last_changed_at TEXT,
      created_at TEXT NOT NULL
    );
  `);
}
