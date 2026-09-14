import { pagination } from '@/constants';
import { TABLE_NAMES } from '@/storage/constants';
import {
  buildPaginatedResult,
  normalizePagination,
  StorageError,
  toStorageError,
  type BookmarkEntry,
  type CreateBookmarkInput,
  type BookmarkSortField,
  type ListBookmarksOptions,
  type PaginatedResult,
  type UpdateBookmarkInput,
} from '@/storage/types';
import { createId, extractHostname, normalizeUrl, nowIso } from '@/storage/utils';

import { getDatabase, withDatabaseTransaction } from '../sqlite/client';

interface BookmarkRow {
  id: string;
  url: string;
  title: string;
  hostname: string;
  favicon_url: string | null;
  created_at: string;
  updated_at: string;
}

const SORT_COLUMN_MAP: Record<BookmarkSortField, string> = {
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  title: 'title',
  hostname: 'hostname',
};

function mapBookmarkRow(row: BookmarkRow): BookmarkEntry {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    hostname: row.hostname,
    faviconUrl: row.favicon_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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

export class BookmarkRepository {
  async create(input: CreateBookmarkInput): Promise<BookmarkEntry> {
    const url = normalizeUrl(input.url);

    if (!url) {
      throw new StorageError('Bookmark URL is required', 'VALIDATION_FAILED');
    }

    const existing = await this.findByUrl(url);

    if (existing) {
      return this.update(existing.id, {
        title: input.title ?? existing.title,
        hostname: input.hostname ?? existing.hostname,
        faviconUrl:
          input.faviconUrl !== undefined ? input.faviconUrl : existing.faviconUrl,
      });
    }

    const id = input.id?.trim() || (await createId());
    const now = nowIso();
    const title = input.title?.trim() || url;
    const hostname = input.hostname?.trim() || extractHostname(url);
    const faviconUrl = input.faviconUrl ?? null;

    try {
      const db = await getDatabase();

      await db.runAsync(
        `INSERT INTO ${TABLE_NAMES.bookmarks}
          (id, url, title, hostname, favicon_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        id,
        url,
        title,
        hostname,
        faviconUrl,
        now,
        now,
      );

      const entry = await this.findById(id);

      if (!entry) {
        throw new StorageError('Failed to read created bookmark', 'QUERY_FAILED');
      }

      return entry;
    } catch (error) {
      throw toStorageError(error, 'Failed to create bookmark', 'QUERY_FAILED');
    }
  }

  async findById(id: string): Promise<BookmarkEntry | null> {
    try {
      const db = await getDatabase();
      const row = await db.getFirstAsync<BookmarkRow>(
        `SELECT * FROM ${TABLE_NAMES.bookmarks} WHERE id = ? LIMIT 1`,
        id,
      );

      return row ? mapBookmarkRow(row) : null;
    } catch (error) {
      throw toStorageError(error, 'Failed to find bookmark', 'QUERY_FAILED');
    }
  }

  /**
   * Upsert a remote bookmark into the local cache by primary key.
   * Preserves server IDs so subsequent deletes stay in sync.
   */
  async upsertRemote(entry: BookmarkEntry): Promise<BookmarkEntry> {
    try {
      const existing = await this.findById(entry.id);
      const byUrl = await this.findByUrl(entry.url);
      const db = await getDatabase();

      if (byUrl && byUrl.id !== entry.id) {
        await db.runAsync(`DELETE FROM ${TABLE_NAMES.bookmarks} WHERE id = ?`, byUrl.id);
      }

      if (existing || (byUrl && byUrl.id === entry.id)) {
        await db.runAsync(
          `UPDATE ${TABLE_NAMES.bookmarks}
           SET url = ?, title = ?, hostname = ?, favicon_url = ?, created_at = ?, updated_at = ?
           WHERE id = ?`,
          entry.url,
          entry.title,
          entry.hostname,
          entry.faviconUrl,
          entry.createdAt,
          entry.updatedAt,
          entry.id,
        );
      } else {
        await db.runAsync(
          `INSERT INTO ${TABLE_NAMES.bookmarks}
            (id, url, title, hostname, favicon_url, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          entry.id,
          entry.url,
          entry.title,
          entry.hostname,
          entry.faviconUrl,
          entry.createdAt,
          entry.updatedAt,
        );
      }

      const saved = await this.findById(entry.id);

      if (!saved) {
        throw new StorageError('Failed to read upserted bookmark', 'QUERY_FAILED');
      }

      return saved;
    } catch (error) {
      throw toStorageError(error, 'Failed to upsert bookmark', 'QUERY_FAILED');
    }
  }

  async upsertManyRemote(entries: BookmarkEntry[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    await withDatabaseTransaction(async () => {
      for (const entry of entries) {
        await this.upsertRemote(entry);
      }
    });
  }

  async replaceId(fromId: string, toId: string): Promise<BookmarkEntry | null> {
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
        await db.runAsync(`DELETE FROM ${TABLE_NAMES.bookmarks} WHERE id = ?`, fromId);
        return conflict;
      }

      await db.runAsync(
        `UPDATE ${TABLE_NAMES.bookmarks} SET id = ? WHERE id = ?`,
        toId,
        fromId,
      );

      return this.findById(toId);
    } catch (error) {
      throw toStorageError(error, 'Failed to replace bookmark id', 'QUERY_FAILED');
    }
  }

  async findByUrl(url: string): Promise<BookmarkEntry | null> {
    try {
      const normalized = normalizeUrl(url);
      const db = await getDatabase();
      const row = await db.getFirstAsync<BookmarkRow>(
        `SELECT * FROM ${TABLE_NAMES.bookmarks} WHERE url = ? LIMIT 1`,
        normalized,
      );

      return row ? mapBookmarkRow(row) : null;
    } catch (error) {
      throw toStorageError(error, 'Failed to find bookmark by URL', 'QUERY_FAILED');
    }
  }

  async list(options: ListBookmarksOptions = {}): Promise<PaginatedResult<BookmarkEntry>> {
    try {
      const { page, pageSize, offset } = normalizePagination(options, {
        page: pagination.initialPage,
        pageSize: pagination.defaultPageSize,
        maxPageSize: pagination.maxPageSize,
      });

      const sortBy = options.sortBy ?? 'createdAt';
      const sortDirection = options.sortDirection === 'asc' ? 'ASC' : 'DESC';
      const sortColumn = SORT_COLUMN_MAP[sortBy] ?? SORT_COLUMN_MAP.createdAt;
      const { clause, params } = buildSearchClause(options.query);

      const db = await getDatabase();

      const countRow = await db.getFirstAsync<{ total: number }>(
        `SELECT COUNT(*) as total FROM ${TABLE_NAMES.bookmarks} ${clause}`,
        ...params,
      );

      const rows = await db.getAllAsync<BookmarkRow>(
        `SELECT * FROM ${TABLE_NAMES.bookmarks}
         ${clause}
         ORDER BY ${sortColumn} ${sortDirection}
         LIMIT ? OFFSET ?`,
        ...params,
        pageSize,
        offset,
      );

      return buildPaginatedResult(
        rows.map(mapBookmarkRow),
        countRow?.total ?? 0,
        page,
        pageSize,
      );
    } catch (error) {
      throw toStorageError(error, 'Failed to list bookmarks', 'QUERY_FAILED');
    }
  }

  async search(
    query: string,
    options: Omit<ListBookmarksOptions, 'query'> = {},
  ): Promise<PaginatedResult<BookmarkEntry>> {
    return this.list({ ...options, query });
  }

  async update(id: string, input: UpdateBookmarkInput): Promise<BookmarkEntry> {
    const existing = await this.findById(id);

    if (!existing) {
      throw new StorageError('Bookmark not found', 'NOT_FOUND');
    }

    const url = input.url !== undefined ? normalizeUrl(input.url) : existing.url;
    const title = input.title !== undefined ? input.title.trim() || url : existing.title;
    const hostname =
      input.hostname !== undefined
        ? input.hostname.trim() || extractHostname(url)
        : input.url !== undefined
          ? extractHostname(url)
          : existing.hostname;
    const faviconUrl =
      input.faviconUrl !== undefined ? input.faviconUrl : existing.faviconUrl;
    const updatedAt = nowIso();

    try {
      const db = await getDatabase();

      await db.runAsync(
        `UPDATE ${TABLE_NAMES.bookmarks}
         SET url = ?, title = ?, hostname = ?, favicon_url = ?, updated_at = ?
         WHERE id = ?`,
        url,
        title,
        hostname,
        faviconUrl,
        updatedAt,
        id,
      );

      const updated = await this.findById(id);

      if (!updated) {
        throw new StorageError('Failed to read updated bookmark', 'QUERY_FAILED');
      }

      return updated;
    } catch (error) {
      throw toStorageError(error, 'Failed to update bookmark', 'QUERY_FAILED');
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      const db = await getDatabase();
      const result = await db.runAsync(
        `DELETE FROM ${TABLE_NAMES.bookmarks} WHERE id = ?`,
        id,
      );

      return result.changes > 0;
    } catch (error) {
      throw toStorageError(error, 'Failed to delete bookmark', 'QUERY_FAILED');
    }
  }

  async deleteByUrl(url: string): Promise<boolean> {
    try {
      const normalized = normalizeUrl(url);
      const db = await getDatabase();
      const result = await db.runAsync(
        `DELETE FROM ${TABLE_NAMES.bookmarks} WHERE url = ?`,
        normalized,
      );

      return result.changes > 0;
    } catch (error) {
      throw toStorageError(error, 'Failed to delete bookmark by URL', 'QUERY_FAILED');
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
          `DELETE FROM ${TABLE_NAMES.bookmarks} WHERE id = ?`,
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
        `SELECT COUNT(*) as total FROM ${TABLE_NAMES.bookmarks}`,
      );
      await db.runAsync(`DELETE FROM ${TABLE_NAMES.bookmarks}`);
      return countRow?.total ?? 0;
    } catch (error) {
      throw toStorageError(error, 'Failed to clear bookmarks', 'QUERY_FAILED');
    }
  }

  async existsByUrl(url: string): Promise<boolean> {
    const entry = await this.findByUrl(url);
    return entry !== null;
  }
}

export const bookmarkRepository = new BookmarkRepository();
