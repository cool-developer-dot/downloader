import type { SQLiteDatabase } from 'expo-sqlite';

import { DATABASE_VERSION, TABLE_NAMES } from '@/storage/constants';

/**
 * Apply pragmas outside any transaction.
 * WAL mode cannot be changed from within a transaction (expo-sqlite).
 */
export async function configureDatabasePragmas(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL');
  await db.execAsync('PRAGMA foreign_keys = ON');
  await db.execAsync('PRAGMA synchronous = NORMAL');
}

export async function applySchema(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS ${TABLE_NAMES.browserHistory} (
      id TEXT PRIMARY KEY NOT NULL,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      hostname TEXT NOT NULL,
      visited_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_browser_history_visited_at
      ON ${TABLE_NAMES.browserHistory}(visited_at DESC);
    CREATE INDEX IF NOT EXISTS idx_browser_history_created_at
      ON ${TABLE_NAMES.browserHistory}(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_browser_history_hostname
      ON ${TABLE_NAMES.browserHistory}(hostname);
    CREATE INDEX IF NOT EXISTS idx_browser_history_url
      ON ${TABLE_NAMES.browserHistory}(url);
    CREATE INDEX IF NOT EXISTS idx_browser_history_title
      ON ${TABLE_NAMES.browserHistory}(title);

    CREATE TABLE IF NOT EXISTS ${TABLE_NAMES.bookmarks} (
      id TEXT PRIMARY KEY NOT NULL,
      url TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      hostname TEXT NOT NULL,
      favicon_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_bookmarks_created_at
      ON ${TABLE_NAMES.bookmarks}(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_bookmarks_updated_at
      ON ${TABLE_NAMES.bookmarks}(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_bookmarks_hostname
      ON ${TABLE_NAMES.bookmarks}(hostname);
    CREATE INDEX IF NOT EXISTS idx_bookmarks_title
      ON ${TABLE_NAMES.bookmarks}(title);

    CREATE TABLE IF NOT EXISTS ${TABLE_NAMES.recentSearches} (
      id TEXT PRIMARY KEY NOT NULL,
      query TEXT NOT NULL UNIQUE,
      searched_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_recent_searches_searched_at
      ON ${TABLE_NAMES.recentSearches}(searched_at DESC);
    CREATE INDEX IF NOT EXISTS idx_recent_searches_query
      ON ${TABLE_NAMES.recentSearches}(query);

    CREATE TABLE IF NOT EXISTS ${TABLE_NAMES.recentUrls} (
      id TEXT PRIMARY KEY NOT NULL,
      url TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      hostname TEXT NOT NULL,
      accessed_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_recent_urls_accessed_at
      ON ${TABLE_NAMES.recentUrls}(accessed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_recent_urls_hostname
      ON ${TABLE_NAMES.recentUrls}(hostname);
  `);

  await applyCatalogSchema(db);
  await db.execAsync(`PRAGMA user_version = ${DATABASE_VERSION}`);
}

/**
 * Phase 1A local catalog tables (idempotent CREATE IF NOT EXISTS).
 * Safe to run on fresh installs (via applySchema) and upgrades (via migrate v2).
 */
export async function applyCatalogSchema(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS ${TABLE_NAMES.downloadsCatalog} (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      source_url TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT '',
      thumbnail_url TEXT NOT NULL DEFAULT '',
      file_name TEXT NOT NULL,
      folder_id TEXT,
      file_size TEXT NOT NULL DEFAULT '0',
      status TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      quality TEXT,
      resolution TEXT,
      bitrate INTEGER,
      retry_count INTEGER NOT NULL DEFAULT 0,
      worker_state TEXT,
      error_code TEXT,
      error_message TEXT,
      favorite INTEGER NOT NULL DEFAULT 0,
      mime_type TEXT,
      duration REAL,
      downloaded_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_downloads_catalog_status
      ON ${TABLE_NAMES.downloadsCatalog}(status);
    CREATE INDEX IF NOT EXISTS idx_downloads_catalog_created_at
      ON ${TABLE_NAMES.downloadsCatalog}(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_downloads_catalog_folder_id
      ON ${TABLE_NAMES.downloadsCatalog}(folder_id);
    CREATE INDEX IF NOT EXISTS idx_downloads_catalog_favorite
      ON ${TABLE_NAMES.downloadsCatalog}(favorite);
    CREATE INDEX IF NOT EXISTS idx_downloads_catalog_updated_at
      ON ${TABLE_NAMES.downloadsCatalog}(updated_at DESC);

    CREATE TABLE IF NOT EXISTS ${TABLE_NAMES.mediaFolders} (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_media_folders_normalized_name
      ON ${TABLE_NAMES.mediaFolders}(normalized_name);
    CREATE INDEX IF NOT EXISTS idx_media_folders_created_at
      ON ${TABLE_NAMES.mediaFolders}(created_at DESC);

    CREATE TABLE IF NOT EXISTS ${TABLE_NAMES.urlFavorites} (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      platform TEXT NOT NULL,
      source_url TEXT NOT NULL UNIQUE,
      thumbnail_url TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_url_favorites_created_at
      ON ${TABLE_NAMES.urlFavorites}(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_url_favorites_platform
      ON ${TABLE_NAMES.urlFavorites}(platform);
  `);
}
