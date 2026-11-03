import { RECENT_SEARCH_LIMIT, TABLE_NAMES } from '@/storage/constants';
import { toStorageError } from '@/storage/types';
import { createId, extractHostname, normalizeSearchQuery, normalizeUrl, nowIso } from '@/storage/utils';

import { getBrowserDatabase, withBrowserDatabaseTransaction } from '../sqlite/browser-database';

/**
 * B20 #209 / #210 — one browser profile's bookmarks, history and recent searches, read whole for a backup or an
 * export, and merged back on restore. Works on any profile (not only the active one), so a backup covers them all.
 * Merging never replaces or deletes: a bookmark whose address is already saved, a visit already recorded (same
 * address and time) and a search already listed are skipped (a search keeps its newer time).
 */

export type ProfileBookmarkRow = { url: string; title: string; createdAt: string };
export type ProfileVisitRow = { url: string; title: string; visitedAt: string };
export type ProfileSearchRow = { query: string; searchedAt: string };

export type ProfileBrowserData = {
  bookmarks: ProfileBookmarkRow[];
  history: ProfileVisitRow[];
  searches: ProfileSearchRow[];
};

export type ProfileDataLimits = { bookmarks: number; history: number; searches: number };

export type MergeCounts = { bookmarks: number; history: number; searches: number };

export const browserProfileDataRepository = {
  async read(profileId: string, limits: ProfileDataLimits): Promise<ProfileBrowserData> {
    try {
      const db = await getBrowserDatabase(profileId);
      const bookmarks = await db.getAllAsync<{ url: string; title: string; created_at: string }>(
        `SELECT url, title, created_at FROM ${TABLE_NAMES.bookmarks} ORDER BY created_at DESC LIMIT ?`,
        limits.bookmarks,
      );
      const history = await db.getAllAsync<{ url: string; title: string; visited_at: string }>(
        `SELECT url, title, visited_at FROM ${TABLE_NAMES.browserHistory} ORDER BY visited_at DESC LIMIT ?`,
        limits.history,
      );
      const searches = await db.getAllAsync<{ query: string; searched_at: string }>(
        `SELECT query, searched_at FROM ${TABLE_NAMES.recentSearches} ORDER BY searched_at DESC LIMIT ?`,
        limits.searches,
      );
      return {
        bookmarks: bookmarks.map((row) => ({ url: row.url, title: row.title, createdAt: row.created_at })),
        history: history.map((row) => ({ url: row.url, title: row.title, visitedAt: row.visited_at })),
        searches: searches.map((row) => ({ query: row.query, searchedAt: row.searched_at })),
      };
    } catch (error) {
      throw toStorageError(error, 'Failed to read browser profile data', 'QUERY_FAILED');
    }
  },

  /** Adds what the profile doesn't have yet; returns how many of each were added. */
  async merge(profileId: string, data: ProfileBrowserData): Promise<MergeCounts> {
    try {
      return await withBrowserDatabaseTransaction(async (db) => {
        const counts: MergeCounts = { bookmarks: 0, history: 0, searches: 0 };
        const now = nowIso();

        const bookmark = await db.prepareAsync(
          `INSERT OR IGNORE INTO ${TABLE_NAMES.bookmarks}
             (id, url, title, hostname, favicon_url, created_at, updated_at)
           VALUES (?, ?, ?, ?, NULL, ?, ?)`,
        );
        try {
          for (const row of data.bookmarks) {
            const url = normalizeUrl(row.url);
            const hostname = extractHostname(url);
            const result = await bookmark.executeAsync(await createId(), url, row.title || hostname || url, hostname, row.createdAt, now);
            counts.bookmarks += result.changes;
          }
        } finally {
          await bookmark.finalizeAsync();
        }

        const visit = await db.prepareAsync(
          `INSERT INTO ${TABLE_NAMES.browserHistory} (id, url, title, hostname, visited_at, created_at)
           SELECT ?, ?, ?, ?, ?, ?
           WHERE NOT EXISTS (SELECT 1 FROM ${TABLE_NAMES.browserHistory} WHERE url = ? AND visited_at = ?)`,
        );
        try {
          for (const row of data.history) {
            const url = normalizeUrl(row.url);
            const hostname = extractHostname(url);
            const result = await visit.executeAsync(
              await createId(),
              url,
              row.title || hostname || url,
              hostname,
              row.visitedAt,
              now,
              url,
              row.visitedAt,
            );
            counts.history += result.changes;
          }
        } finally {
          await visit.finalizeAsync();
        }

        const search = await db.prepareAsync(
          `INSERT INTO ${TABLE_NAMES.recentSearches} (id, query, searched_at, created_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(query) DO UPDATE SET searched_at = excluded.searched_at
           WHERE excluded.searched_at > searched_at`,
        );
        try {
          for (const row of data.searches) {
            const query = normalizeSearchQuery(row.query);
            if (!query) continue;
            const existing = await db.getFirstAsync<{ n: number }>(
              `SELECT COUNT(*) AS n FROM ${TABLE_NAMES.recentSearches} WHERE query = ?`,
              query,
            );
            await search.executeAsync(await createId(), query, row.searchedAt, now);
            if (!existing?.n) counts.searches += 1;
          }
        } finally {
          await search.finalizeAsync();
        }
        // The list keeps its usual length: the newest searches stay.
        await db.runAsync(
          `DELETE FROM ${TABLE_NAMES.recentSearches}
           WHERE id NOT IN (SELECT id FROM ${TABLE_NAMES.recentSearches} ORDER BY searched_at DESC LIMIT ?)`,
          RECENT_SEARCH_LIMIT,
        );
        return counts;
      }, profileId);
    } catch (error) {
      throw toStorageError(error, 'Failed to restore browser profile data', 'QUERY_FAILED');
    }
  },
};
