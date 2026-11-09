import * as SQLite from 'expo-sqlite';

import { DEFAULT_PROFILE_ID, getActiveProfileId, profileDatabaseName } from '@/storage/profile/active-profile';
import { toStorageError } from '@/storage/types';

import { getDatabase } from './client';
import { applyBrowserTables, configureDatabasePragmas } from './schema';

/**
 * B20 — the database holding the active browser profile's history, bookmarks, recent searches and recent URLs. The
 * browser repositories use it instead of `getDatabase`. The default profile's is the app database, so nothing moves
 * on upgrade; every other profile has `vidorax-profile-<id>.db` with only the browser tables. Downloads, the library
 * and favorites stay in the app database for every profile.
 */

/**
 * `PRAGMA user_version` of a profile database. 1: B20's tables (+ B9's, added on open). 2 (B14): the site-blocking
 * tables. 3 (B22): notes. 4 (B19): user scripts. The browser tables are applied on every open whatever the number,
 * so it only records the layout.
 */
export const BROWSER_PROFILE_DATABASE_VERSION = 4;

const profileDatabases = new Map<string, Promise<SQLite.SQLiteDatabase>>();

async function openProfileDatabase(id: string): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(profileDatabaseName(id));
  try {
    await configureDatabasePragmas(db);
    // Every open: the browser tables check the real schema, so a package's later change reaches old files too.
    await applyBrowserTables(db);
    await db.execAsync(`PRAGMA user_version = ${BROWSER_PROFILE_DATABASE_VERSION}`);
    return db;
  } catch (error) {
    try {
      await db.closeAsync();
    } catch {
      // Already failing.
    }
    throw toStorageError(error, 'Failed to open the browser profile database', 'DATABASE_INIT_FAILED');
  }
}

/** The database of browser profile `id` (default: the active one). */
export function getBrowserDatabase(id: string = getActiveProfileId()): Promise<SQLite.SQLiteDatabase> {
  if (id === DEFAULT_PROFILE_ID) {
    return getDatabase();
  }
  let pending = profileDatabases.get(id);
  if (!pending) {
    pending = openProfileDatabase(id);
    profileDatabases.set(id, pending);
    pending.catch(() => {
      if (profileDatabases.get(id) === pending) {
        profileDatabases.delete(id);
      }
    });
  }
  return pending;
}

export async function withBrowserDatabaseTransaction<T>(
  task: (db: SQLite.SQLiteDatabase) => Promise<T>,
  id: string = getActiveProfileId(),
): Promise<T> {
  const db = await getBrowserDatabase(id);
  try {
    let result!: T;
    await db.withTransactionAsync(async () => {
      result = await task(db);
    });
    return result;
  } catch (error) {
    throw toStorageError(error, 'Database transaction failed', 'TRANSACTION_FAILED');
  }
}

/** Closes a profile's database (it reopens on the next use). Never the app database. */
export async function closeBrowserProfileDatabase(id: string): Promise<void> {
  if (id === DEFAULT_PROFILE_ID) {
    return;
  }
  const pending = profileDatabases.get(id);
  profileDatabases.delete(id);
  if (!pending) {
    return;
  }
  try {
    const db = await pending;
    await db.closeAsync();
  } catch {
    // Not open, or already closed.
  }
}

/** Deletes a profile's database file (a deleted profile, or the end of guest mode). Never the app database. */
export async function deleteBrowserProfileDatabase(id: string): Promise<void> {
  if (id === DEFAULT_PROFILE_ID) {
    return;
  }
  await closeBrowserProfileDatabase(id);
  try {
    await SQLite.deleteDatabaseAsync(profileDatabaseName(id));
  } catch {
    // No file yet: nothing to delete.
  }
}
