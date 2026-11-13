import { TABLE_NAMES } from '@/storage/constants';

import type { SchemaDb } from './bookmark-organizer-schema';

/**
 * B14 — the tables the user's site blocking needs, per browser profile: the site blocker and focus mode's lists
 * (#276, #278), daily time limits and the time used per day (#277), and the focus timer (#278). Part of
 * `applyBrowserTables`, so it runs for the app database (migration to v4, fresh installs) and for every browser
 * profile's database (B20) on open. Only `CREATE … IF NOT EXISTS`: safe to run any number of times. No existing table
 * changes.
 */
export async function applySiteBlockingTables(db: Pick<SchemaDb, 'execAsync'>): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS ${TABLE_NAMES.siteBlockLists} (
      list TEXT NOT NULL CHECK (list IN ('blocked', 'focus')),
      site TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (list, site)
    );

    CREATE TABLE IF NOT EXISTS ${TABLE_NAMES.siteTimeLimits} (
      site TEXT PRIMARY KEY NOT NULL,
      minutes INTEGER NOT NULL CHECK (minutes BETWEEN 1 AND 1440),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ${TABLE_NAMES.siteTimeUsage} (
      day TEXT NOT NULL,
      site TEXT NOT NULL,
      seconds INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, site)
    );

    CREATE TABLE IF NOT EXISTS ${TABLE_NAMES.focusSession} (
      id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
      started_at INTEGER NOT NULL,
      ends_at INTEGER NOT NULL,
      minutes INTEGER NOT NULL
    );
  `);
}
