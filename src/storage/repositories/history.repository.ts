import { pagination } from '@/constants';
import { TABLE_NAMES } from '@/storage/constants';
import {
  buildPaginatedResult,
  normalizePagination,
  StorageError,
  toStorageError,
  type BrowserHistoryEntry,
  type CreateHistoryInput,
  type HistorySortField,
  type ListHistoryOptions,
  type PaginatedResult,
  type UpdateHistoryInput,
} from '@/storage/types';
import { createId, extractHostname, normalizeUrl, nowIso } from '@/storage/utils';

import { getDatabase, withDatabaseTransaction } from '../sqlite/client';

/** Coalesce rapid revisits of the same URL into a single local row. */
export const LOCAL_HISTORY_DEDUP_WINDOW_MS = 5 * 60 * 1000;

interface HistoryRow {
  id: string;
  url: string;
  title: string;
  hostname: string;
  visited_at: string;
  created_at: string;
}

const SORT_COLUMN_MAP: Record<HistorySortField, string> = {
  visitedAt: 'visited_at',
  createdAt: 'created_at',
  title: 'title',
  hostname: 'hostname',
};

function mapHistoryRow(row: HistoryRow): BrowserHistoryEntry {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    hostname: row.hostname,
    visitedAt: row.visited_at,
    createdAt: row.created_at,
  };
}

function buildSearchClause(query: string | undefined): {
  clause: string;
  params: string[];
} {
  const normalized = query?.trim();

  if (!normalized) {
    return { clause: '', params: [] };
  }

  const like = `%${normalized}%`;

  return {
    clause: `WHERE (title LIKE ? OR url LIKE ? OR hostname LIKE ?)`,
    params: [like, like, like],
  };
}

export class HistoryRepository {
  async create(input: CreateHistoryInput): Promise<BrowserHistoryEntry> {
    const url = normalizeUrl(input.url);

    if (!url) {
      throw new StorageError('History URL is required', 'VALIDATION_FAILED');
    }

    const now = nowIso();
    const visitedAt = input.visitedAt ?? now;
    const title = input.title?.trim() || url;
    const hostname = input.hostname?.trim() || extractHostname(url);

    try {
      const duplicate = await this.findRecentDuplicate(url, visitedAt);

      if (duplicate) {
        return this.update(duplicate.id, {
          title,
          hostname,
          visitedAt,
        });
      }

      const id = input.id?.trim() || (await createId());
      const db = await getDatabase();

      await db.runAsync(
        `INSERT INTO ${TABLE_NAMES.browserHistory}
          (id, url, title, hostname, visited_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        id,
        url,
        title,
        hostname,
        visitedAt,
        now,
      );

      const entry = await this.findById(id);

      if (!entry) {
        throw new StorageError('Failed to read created history entry', 'QUERY_FAILED');
      }

      return entry;
    } catch (error) {
      throw toStorageError(error, 'Failed to create history entry', 'QUERY_FAILED');
    }
  }

  async createMany(inputs: CreateHistoryInput[]): Promise<BrowserHistoryEntry[]> {
    if (inputs.length === 0) {
      return [];
    }

    return withDatabaseTransaction(async () => {
      const created: BrowserHistoryEntry[] = [];

      for (const input of inputs) {
        created.push(await this.create(input));
      }

      return created;
    });
  }

  /**
   * Upsert a remote history item into the local cache by primary key.
   * Preserves server IDs so subsequent deletes stay in sync.
   */
  async upsertRemote(entry: BrowserHistoryEntry): Promise<BrowserHistoryEntry> {
    try {
      const existing = await this.findById(entry.id);
      const db = await getDatabase();

      if (existing) {
        await db.runAsync(
          `UPDATE ${TABLE_NAMES.browserHistory}
           SET url = ?, title = ?, hostname = ?, visited_at = ?, created_at = ?
           WHERE id = ?`,
          entry.url,
          entry.title,
          entry.hostname,
          entry.visitedAt,
          entry.createdAt,
          entry.id,
        );
      } else {
        await db.runAsync(
          `INSERT INTO ${TABLE_NAMES.browserHistory}
            (id, url, title, hostname, visited_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          entry.id,
          entry.url,
          entry.title,
          entry.hostname,
          entry.visitedAt,
          entry.createdAt,
        );
      }

      const saved = await this.findById(entry.id);

      if (!saved) {
        throw new StorageError('Failed to read upserted history entry', 'QUERY_FAILED');
      }

      return saved;
    } catch (error) {
      throw toStorageError(error, 'Failed to upsert history entry', 'QUERY_FAILED');
    }
  }

  async upsertManyRemote(entries: BrowserHistoryEntry[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    await withDatabaseTransaction(async () => {
      for (const entry of entries) {
        await this.upsertRemote(entry);
      }
    });
  }

  async replaceId(fromId: string, toId: string): Promise<BrowserHistoryEntry | null> {
    if (fromId === toId) {
      return this.findById(fromId);
    }

    try {
      const existing = await this.findById(fromId);

      if (!existing) {
        return null;
      }

      const conflict = await this.findById(toId);
      const db = await getDatabase();

      if (conflict) {
        await db.runAsync(`DELETE FROM ${TABLE_NAMES.browserHistory} WHERE id = ?`, fromId);
        return conflict;
      }

      await db.runAsync(
        `UPDATE ${TABLE_NAMES.browserHistory} SET id = ? WHERE id = ?`,
        toId,
        fromId,
      );

      return this.findById(toId);
    } catch (error) {
      throw toStorageError(error, 'Failed to replace history id', 'QUERY_FAILED');
    }
  }

  async findRecentDuplicate(
    url: string,
    visitedAt: string,
    windowMs = LOCAL_HISTORY_DEDUP_WINDOW_MS,
  ): Promise<BrowserHistoryEntry | null> {
    try {
      const visitedMs = new Date(visitedAt).getTime();
      if (Number.isNaN(visitedMs)) {
        return null;
      }

      const windowStart = new Date(visitedMs - windowMs).toISOString();
      const db = await getDatabase();
      const row = await db.getFirstAsync<HistoryRow>(
        `SELECT * FROM ${TABLE_NAMES.browserHistory}
         WHERE url = ? AND visited_at >= ?
         ORDER BY visited_at DESC
         LIMIT 1`,
        url,
        windowStart,
      );

      return row ? mapHistoryRow(row) : null;
    } catch (error) {
      throw toStorageError(error, 'Failed to find recent history duplicate', 'QUERY_FAILED');
    }
  }

  async findById(id: string): Promise<BrowserHistoryEntry | null> {
    try {
      const db = await getDatabase();
      const row = await db.getFirstAsync<HistoryRow>(
        `SELECT * FROM ${TABLE_NAMES.browserHistory} WHERE id = ? LIMIT 1`,
        id,
      );

      return row ? mapHistoryRow(row) : null;
    } catch (error) {
      throw toStorageError(error, 'Failed to find history entry', 'QUERY_FAILED');
    }
  }

  async list(options: ListHistoryOptions = {}): Promise<PaginatedResult<BrowserHistoryEntry>> {
    try {
      const { page, pageSize, offset } = normalizePagination(options, {
        page: pagination.initialPage,
        pageSize: pagination.defaultPageSize,
        maxPageSize: pagination.maxPageSize,
      });

      const sortBy = options.sortBy ?? 'visitedAt';
      const sortDirection = options.sortDirection === 'asc' ? 'ASC' : 'DESC';
      const sortColumn = SORT_COLUMN_MAP[sortBy] ?? SORT_COLUMN_MAP.visitedAt;
      const { clause, params } = buildSearchClause(options.query);

      const db = await getDatabase();

      const countRow = await db.getFirstAsync<{ total: number }>(
        `SELECT COUNT(*) as total FROM ${TABLE_NAMES.browserHistory} ${clause}`,
        ...params,
      );

      const rows = await db.getAllAsync<HistoryRow>(
        `SELECT * FROM ${TABLE_NAMES.browserHistory}
         ${clause}
         ORDER BY ${sortColumn} ${sortDirection}
         LIMIT ? OFFSET ?`,
        ...params,
        pageSize,
        offset,
      );

      return buildPaginatedResult(
        rows.map(mapHistoryRow),
        countRow?.total ?? 0,
        page,
        pageSize,
      );
    } catch (error) {
      throw toStorageError(error, 'Failed to list history', 'QUERY_FAILED');
    }
  }

  async search(
    query: string,
    options: Omit<ListHistoryOptions, 'query'> = {},
  ): Promise<PaginatedResult<BrowserHistoryEntry>> {
    return this.list({ ...options, query });
  }

  async update(id: string, input: UpdateHistoryInput): Promise<BrowserHistoryEntry> {
    const existing = await this.findById(id);

    if (!existing) {
      throw new StorageError('History entry not found', 'NOT_FOUND');
    }

    const url = input.url !== undefined ? normalizeUrl(input.url) : existing.url;
    const title = input.title !== undefined ? input.title.trim() || url : existing.title;
    const hostname =
      input.hostname !== undefined
        ? input.hostname.trim() || extractHostname(url)
        : input.url !== undefined
          ? extractHostname(url)
          : existing.hostname;
    const visitedAt = input.visitedAt ?? existing.visitedAt;

    try {
      const db = await getDatabase();

      await db.runAsync(
        `UPDATE ${TABLE_NAMES.browserHistory}
         SET url = ?, title = ?, hostname = ?, visited_at = ?
         WHERE id = ?`,
        url,
        title,
        hostname,
        visitedAt,
        id,
      );

      const updated = await this.findById(id);

      if (!updated) {
        throw new StorageError('Failed to read updated history entry', 'QUERY_FAILED');
      }

      return updated;
    } catch (error) {
      throw toStorageError(error, 'Failed to update history entry', 'QUERY_FAILED');
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      const db = await getDatabase();
      const result = await db.runAsync(
        `DELETE FROM ${TABLE_NAMES.browserHistory} WHERE id = ?`,
        id,
      );

      return result.changes > 0;
    } catch (error) {
      throw toStorageError(error, 'Failed to delete history entry', 'QUERY_FAILED');
    }
  }

  async deleteMany(ids: string[]): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }

    return withDatabaseTransaction(async (db) => {
      let deleted = 0;

      for (const id of ids) {
        const result = await db.runAsync(
          `DELETE FROM ${TABLE_NAMES.browserHistory} WHERE id = ?`,
          id,
        );
        deleted += result.changes;
      }

      return deleted;
    });
  }

  async clear(): Promise<number> {
    try {
      const db = await getDatabase();
      const countRow = await db.getFirstAsync<{ total: number }>(
        `SELECT COUNT(*) as total FROM ${TABLE_NAMES.browserHistory}`,
      );
      await db.runAsync(`DELETE FROM ${TABLE_NAMES.browserHistory}`);
      return countRow?.total ?? 0;
    } catch (error) {
      throw toStorageError(error, 'Failed to clear history', 'QUERY_FAILED');
    }
  }

  async getRecentUrls(limit = 20): Promise<BrowserHistoryEntry[]> {
    try {
      const safeLimit = Math.max(1, Math.min(limit, pagination.maxPageSize));
      const db = await getDatabase();

      const rows = await db.getAllAsync<HistoryRow>(
        `SELECT h.*
         FROM ${TABLE_NAMES.browserHistory} h
         INNER JOIN (
           SELECT url, MAX(visited_at) AS max_visited_at
           FROM ${TABLE_NAMES.browserHistory}
           GROUP BY url
         ) latest
           ON latest.url = h.url AND latest.max_visited_at = h.visited_at
         ORDER BY h.visited_at DESC
         LIMIT ?`,
        safeLimit,
      );

      return rows.map(mapHistoryRow);
    } catch (error) {
      throw toStorageError(error, 'Failed to load recent URLs', 'QUERY_FAILED');
    }
  }

  /**
   * Top sites by visit frequency — used by the omnibox intelligence layer.
   */
  async getFrequentlyVisited(
    limit = 20,
  ): Promise<(BrowserHistoryEntry & { visitCount: number })[]> {
    try {
      const safeLimit = Math.max(1, Math.min(limit, pagination.maxPageSize));
      const db = await getDatabase();

      const rows = await db.getAllAsync<HistoryRow & { visit_count: number }>(
        `SELECT
           h.id,
           h.url,
           h.title,
           h.hostname,
           h.visited_at,
           h.created_at,
           freq.visit_count AS visit_count
         FROM ${TABLE_NAMES.browserHistory} h
         INNER JOIN (
           SELECT
             url,
             COUNT(*) AS visit_count,
             MAX(visited_at) AS max_visited_at
           FROM ${TABLE_NAMES.browserHistory}
           GROUP BY url
           HAVING COUNT(*) >= 2
         ) freq
           ON freq.url = h.url AND freq.max_visited_at = h.visited_at
         ORDER BY freq.visit_count DESC, h.visited_at DESC
         LIMIT ?`,
        safeLimit,
      );

      return rows.map((row) => ({
        ...mapHistoryRow(row),
        visitCount: Number(row.visit_count) || 0,
      }));
    } catch (error) {
      throw toStorageError(error, 'Failed to load frequently visited sites', 'QUERY_FAILED');
    }
  }
}

export const historyRepository = new HistoryRepository();
