import { TABLE_NAMES } from '@/storage/constants';

/**
 * B10 — clearing browsing data by time range (#98, #99) and the history export (#103). The SQL lives in plain
 * functions over a minimal database interface, so tests run them on a real SQLite (`node:sqlite`) with the app's own
 * schema; `browsing-data.repository.ts` runs them on the active browser profile's database.
 */

/** The part of expo-sqlite's database these queries use. */
export type BrowsingDataDb = {
  runAsync(sql: string, ...params: (string | number | null)[]): Promise<{ changes: number }>;
  getAllAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T[]>;
};

export type BrowsingDataCleared = { history: number; recentUrls: number; recentSearches: number };

/**
 * Deletes history visits, recent URLs and recent searches made at or after `sinceIso` (an ISO time); `null` deletes
 * them all ("All time"). Times are stored as ISO strings, so they compare as text.
 */
export async function deleteBrowsingDataSince(db: BrowsingDataDb, sinceIso: string | null): Promise<BrowsingDataCleared> {
  if (sinceIso == null) {
    const history = await db.runAsync(`DELETE FROM ${TABLE_NAMES.browserHistory}`);
    const recentUrls = await db.runAsync(`DELETE FROM ${TABLE_NAMES.recentUrls}`);
    const recentSearches = await db.runAsync(`DELETE FROM ${TABLE_NAMES.recentSearches}`);
    return { history: history.changes, recentUrls: recentUrls.changes, recentSearches: recentSearches.changes };
  }
  const history = await db.runAsync(`DELETE FROM ${TABLE_NAMES.browserHistory} WHERE visited_at >= ?`, sinceIso);
  const recentUrls = await db.runAsync(`DELETE FROM ${TABLE_NAMES.recentUrls} WHERE accessed_at >= ?`, sinceIso);
  const recentSearches = await db.runAsync(
    `DELETE FROM ${TABLE_NAMES.recentSearches} WHERE searched_at >= ?`,
    sinceIso,
  );
  return { history: history.changes, recentUrls: recentUrls.changes, recentSearches: recentSearches.changes };
}

/** One page in the history export: its latest title, its last visit and how many visits History holds for it. */
export type HistoryExportRow = { title: string; url: string; lastVisitedAt: string; visitCount: number };

type ExportRow = { url: string; title: string; last_visited_at: string; visit_count: number };

/**
 * Every page in History, most recently visited first. A page is one URL; its title is the one of its latest visit.
 * (History merges revisits within 5 minutes into one entry, so the count is of those entries.)
 */
export async function listHistoryForExport(db: BrowsingDataDb): Promise<HistoryExportRow[]> {
  const rows = await db.getAllAsync<ExportRow>(
    `SELECT agg.url AS url,
            agg.visit_count AS visit_count,
            agg.last_visited_at AS last_visited_at,
            (SELECT h.title FROM ${TABLE_NAMES.browserHistory} h
              WHERE h.url = agg.url ORDER BY h.visited_at DESC LIMIT 1) AS title
       FROM (SELECT url, COUNT(*) AS visit_count, MAX(visited_at) AS last_visited_at
               FROM ${TABLE_NAMES.browserHistory}
              GROUP BY url) agg
      ORDER BY agg.last_visited_at DESC`,
  );
  return rows.map((row) => ({
    url: row.url,
    title: row.title ?? '',
    lastVisitedAt: row.last_visited_at,
    visitCount: Number(row.visit_count) || 0,
  }));
}
