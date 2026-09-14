import { pagination } from '@/constants';
import { RECENT_SEARCH_LIMIT, TABLE_NAMES } from '@/storage/constants';
import {
  buildPaginatedResult,
  normalizePagination,
  StorageError,
  toStorageError,
  type CreateRecentSearchInput,
  type ListRecentSearchesOptions,
  type PaginatedResult,
  type RecentSearchEntry,
  type RecentSearchSortField,
} from '@/storage/types';
import { createId, normalizeSearchQuery, nowIso } from '@/storage/utils';

import { getDatabase, withDatabaseTransaction } from '../sqlite/client';

interface RecentSearchRow {
  id: string;
  query: string;
  searched_at: string;
  created_at: string;
}

const SORT_COLUMN_MAP: Record<RecentSearchSortField, string> = {
  searchedAt: 'searched_at',
  createdAt: 'created_at',
  query: 'query',
};

function mapRecentSearchRow(row: RecentSearchRow): RecentSearchEntry {
  return {
    id: row.id,
    query: row.query,
    searchedAt: row.searched_at,
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

  return {
    clause: `WHERE query LIKE ?`,
    params: [`%${normalized}%`],
  };
}

export class RecentSearchRepository {
  async create(input: CreateRecentSearchInput): Promise<RecentSearchEntry> {
    const query = normalizeSearchQuery(input.query);

    if (!query) {
      throw new StorageError('Search query is required', 'VALIDATION_FAILED');
    }

    const existing = await this.findByQuery(query);
    const searchedAt = input.searchedAt ?? nowIso();

    if (existing) {
      return this.touch(existing.id, searchedAt);
    }

    const id = await createId();
    const now = nowIso();

    try {
      await withDatabaseTransaction(async (db) => {
        await db.runAsync(
          `INSERT INTO ${TABLE_NAMES.recentSearches}
            (id, query, searched_at, created_at)
           VALUES (?, ?, ?, ?)`,
          id,
          query,
          searchedAt,
          now,
        );

        await this.trimToLimit(db, RECENT_SEARCH_LIMIT);
      });

      const entry = await this.findById(id);

      if (!entry) {
        throw new StorageError('Failed to read created recent search', 'QUERY_FAILED');
      }

      return entry;
    } catch (error) {
      throw toStorageError(error, 'Failed to create recent search', 'QUERY_FAILED');
    }
  }

  async findById(id: string): Promise<RecentSearchEntry | null> {
    try {
      const db = await getDatabase();
      const row = await db.getFirstAsync<RecentSearchRow>(
        `SELECT * FROM ${TABLE_NAMES.recentSearches} WHERE id = ? LIMIT 1`,
        id,
      );

      return row ? mapRecentSearchRow(row) : null;
    } catch (error) {
      throw toStorageError(error, 'Failed to find recent search', 'QUERY_FAILED');
    }
  }

  async findByQuery(query: string): Promise<RecentSearchEntry | null> {
    try {
      const normalized = normalizeSearchQuery(query);
      const db = await getDatabase();
      const row = await db.getFirstAsync<RecentSearchRow>(
        `SELECT * FROM ${TABLE_NAMES.recentSearches} WHERE query = ? LIMIT 1`,
        normalized,
      );

      return row ? mapRecentSearchRow(row) : null;
    } catch (error) {
      throw toStorageError(error, 'Failed to find recent search by query', 'QUERY_FAILED');
    }
  }

  async list(
    options: ListRecentSearchesOptions = {},
  ): Promise<PaginatedResult<RecentSearchEntry>> {
    try {
      const { page, pageSize, offset } = normalizePagination(options, {
        page: pagination.initialPage,
        pageSize: pagination.defaultPageSize,
        maxPageSize: pagination.maxPageSize,
      });

      const sortBy = options.sortBy ?? 'searchedAt';
      const sortDirection = options.sortDirection === 'asc' ? 'ASC' : 'DESC';
      const sortColumn = SORT_COLUMN_MAP[sortBy] ?? SORT_COLUMN_MAP.searchedAt;
      const { clause, params } = buildSearchClause(options.query);

      const db = await getDatabase();

      const countRow = await db.getFirstAsync<{ total: number }>(
        `SELECT COUNT(*) as total FROM ${TABLE_NAMES.recentSearches} ${clause}`,
        ...params,
      );

      const rows = await db.getAllAsync<RecentSearchRow>(
        `SELECT * FROM ${TABLE_NAMES.recentSearches}
         ${clause}
         ORDER BY ${sortColumn} ${sortDirection}
         LIMIT ? OFFSET ?`,
        ...params,
        pageSize,
        offset,
      );

      return buildPaginatedResult(
        rows.map(mapRecentSearchRow),
        countRow?.total ?? 0,
        page,
        pageSize,
      );
    } catch (error) {
      throw toStorageError(error, 'Failed to list recent searches', 'QUERY_FAILED');
    }
  }

  async search(
    query: string,
    options: Omit<ListRecentSearchesOptions, 'query'> = {},
  ): Promise<PaginatedResult<RecentSearchEntry>> {
    return this.list({ ...options, query });
  }

  async delete(id: string): Promise<boolean> {
    try {
      const db = await getDatabase();
      const result = await db.runAsync(
        `DELETE FROM ${TABLE_NAMES.recentSearches} WHERE id = ?`,
        id,
      );

      return result.changes > 0;
    } catch (error) {
      throw toStorageError(error, 'Failed to delete recent search', 'QUERY_FAILED');
    }
  }

  async clear(): Promise<number> {
    try {
      const db = await getDatabase();
      const countRow = await db.getFirstAsync<{ total: number }>(
        `SELECT COUNT(*) as total FROM ${TABLE_NAMES.recentSearches}`,
      );
      await db.runAsync(`DELETE FROM ${TABLE_NAMES.recentSearches}`);
      return countRow?.total ?? 0;
    } catch (error) {
      throw toStorageError(error, 'Failed to clear recent searches', 'QUERY_FAILED');
    }
  }

  private async touch(id: string, searchedAt: string): Promise<RecentSearchEntry> {
    try {
      const db = await getDatabase();

      await db.runAsync(
        `UPDATE ${TABLE_NAMES.recentSearches}
         SET searched_at = ?
         WHERE id = ?`,
        searchedAt,
        id,
      );

      const updated = await this.findById(id);

      if (!updated) {
        throw new StorageError('Failed to read updated recent search', 'QUERY_FAILED');
      }

      return updated;
    } catch (error) {
      throw toStorageError(error, 'Failed to update recent search', 'QUERY_FAILED');
    }
  }

  private async trimToLimit(
    db: Awaited<ReturnType<typeof getDatabase>>,
    limit: number,
  ): Promise<void> {
    await db.runAsync(
      `DELETE FROM ${TABLE_NAMES.recentSearches}
       WHERE id IN (
         SELECT id FROM ${TABLE_NAMES.recentSearches}
         ORDER BY searched_at DESC
         LIMIT -1 OFFSET ?
       )`,
      limit,
    );
  }
}

export const recentSearchRepository = new RecentSearchRepository();
