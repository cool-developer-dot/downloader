import { pagination } from '@/constants';
import { RECENT_URL_LIMIT, TABLE_NAMES } from '@/storage/constants';
import {
  StorageError,
  toStorageError,
  type RecentUrlEntry,
  type UpsertRecentUrlInput,
} from '@/storage/types';
import { createId, extractHostname, normalizeUrl, nowIso } from '@/storage/utils';

import { getDatabase, withDatabaseTransaction } from '../sqlite/client';

interface RecentUrlRow {
  id: string;
  url: string;
  title: string;
  hostname: string;
  accessed_at: string;
  created_at: string;
}

function mapRecentUrlRow(row: RecentUrlRow): RecentUrlEntry {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    hostname: row.hostname,
    accessedAt: row.accessed_at,
    createdAt: row.created_at,
  };
}

export class RecentUrlRepository {
  async upsert(input: UpsertRecentUrlInput): Promise<RecentUrlEntry> {
    const url = normalizeUrl(input.url);

    if (!url) {
      throw new StorageError('URL is required', 'VALIDATION_FAILED');
    }

    const accessedAt = input.accessedAt ?? nowIso();
    const title = input.title?.trim() || url;
    const hostname = input.hostname?.trim() || extractHostname(url);

    try {
      const existing = await this.findByUrl(url);

      if (existing) {
        const db = await getDatabase();

        await db.runAsync(
          `UPDATE ${TABLE_NAMES.recentUrls}
           SET title = ?, hostname = ?, accessed_at = ?
           WHERE id = ?`,
          title,
          hostname,
          accessedAt,
          existing.id,
        );

        const updated = await this.findById(existing.id);

        if (!updated) {
          throw new StorageError('Failed to read updated recent URL', 'QUERY_FAILED');
        }

        return updated;
      }

      const id = await createId();
      const now = nowIso();

      await withDatabaseTransaction(async (db) => {
        await db.runAsync(
          `INSERT INTO ${TABLE_NAMES.recentUrls}
            (id, url, title, hostname, accessed_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          id,
          url,
          title,
          hostname,
          accessedAt,
          now,
        );

        await db.runAsync(
          `DELETE FROM ${TABLE_NAMES.recentUrls}
           WHERE id IN (
             SELECT id FROM ${TABLE_NAMES.recentUrls}
             ORDER BY accessed_at DESC
             LIMIT -1 OFFSET ?
           )`,
          RECENT_URL_LIMIT,
        );
      });

      const created = await this.findById(id);

      if (!created) {
        throw new StorageError('Failed to read created recent URL', 'QUERY_FAILED');
      }

      return created;
    } catch (error) {
      throw toStorageError(error, 'Failed to upsert recent URL', 'QUERY_FAILED');
    }
  }

  async findById(id: string): Promise<RecentUrlEntry | null> {
    try {
      const db = await getDatabase();
      const row = await db.getFirstAsync<RecentUrlRow>(
        `SELECT * FROM ${TABLE_NAMES.recentUrls} WHERE id = ? LIMIT 1`,
        id,
      );

      return row ? mapRecentUrlRow(row) : null;
    } catch (error) {
      throw toStorageError(error, 'Failed to find recent URL', 'QUERY_FAILED');
    }
  }

  async findByUrl(url: string): Promise<RecentUrlEntry | null> {
    try {
      const normalized = normalizeUrl(url);
      const db = await getDatabase();
      const row = await db.getFirstAsync<RecentUrlRow>(
        `SELECT * FROM ${TABLE_NAMES.recentUrls} WHERE url = ? LIMIT 1`,
        normalized,
      );

      return row ? mapRecentUrlRow(row) : null;
    } catch (error) {
      throw toStorageError(error, 'Failed to find recent URL by URL', 'QUERY_FAILED');
    }
  }

  async list(limit = 20): Promise<RecentUrlEntry[]> {
    try {
      const safeLimit = Math.max(1, Math.min(limit, pagination.maxPageSize));
      const db = await getDatabase();

      const rows = await db.getAllAsync<RecentUrlRow>(
        `SELECT * FROM ${TABLE_NAMES.recentUrls}
         ORDER BY accessed_at DESC
         LIMIT ?`,
        safeLimit,
      );

      return rows.map(mapRecentUrlRow);
    } catch (error) {
      throw toStorageError(error, 'Failed to list recent URLs', 'QUERY_FAILED');
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      const db = await getDatabase();
      const result = await db.runAsync(
        `DELETE FROM ${TABLE_NAMES.recentUrls} WHERE id = ?`,
        id,
      );

      return result.changes > 0;
    } catch (error) {
      throw toStorageError(error, 'Failed to delete recent URL', 'QUERY_FAILED');
    }
  }

  async clear(): Promise<number> {
    try {
      const db = await getDatabase();
      const countRow = await db.getFirstAsync<{ total: number }>(
        `SELECT COUNT(*) as total FROM ${TABLE_NAMES.recentUrls}`,
      );
      await db.runAsync(`DELETE FROM ${TABLE_NAMES.recentUrls}`);
      return countRow?.total ?? 0;
    } catch (error) {
      throw toStorageError(error, 'Failed to clear recent URLs', 'QUERY_FAILED');
    }
  }
}

export const recentUrlRepository = new RecentUrlRepository();
