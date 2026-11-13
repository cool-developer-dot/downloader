import { TABLE_NAMES } from '@/storage/constants';

import type { SchemaDb } from './bookmark-organizer-schema';

/**
 * B19 #199 — the user's own scripts, per browser profile: part of `applyBrowserTables` (app database migration to v6,
 * fresh installs, every profile database on open). `CREATE … IF NOT EXISTS` only: safe to run any number of times.
 */
export async function applyUserScriptsTables(db: Pick<SchemaDb, 'execAsync'>): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS ${TABLE_NAMES.userScripts} (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      matches TEXT NOT NULL DEFAULT '[]',
      run_at TEXT NOT NULL DEFAULT 'end' CHECK (run_at IN ('start', 'end')),
      enabled INTEGER NOT NULL DEFAULT 1,
      allow_incognito INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}
