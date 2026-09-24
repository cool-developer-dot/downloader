import type { FavoriteItem, FavoriteListSort, FavoritePlatform } from '@/api/types';
import { pagination } from '@/constants';
import { TABLE_NAMES } from '@/storage/constants';
import {
  buildPaginatedResult,
  normalizePagination,
  toStorageError,
  type CreateUrlFavoriteInput,
  type PaginatedResult,
  type UrlFavoriteEntry,
} from '@/storage/types';
import { createId, nowIso } from '@/storage/utils';

import { normalizeFavoriteSourceKey } from '../utils/favorite-key';

import { getDatabase } from '../sqlite/client';

interface FavoriteRow {
  id: string;
  title: string;
  platform: string;
  source_url: string;
  thumbnail_url: string;
  created_at: string;
}

function mapRow(row: FavoriteRow): UrlFavoriteEntry {
  return {
    id: row.id,
    title: row.title,
    platform: row.platform as FavoritePlatform,
    sourceUrl: row.source_url,
    thumbnailUrl: row.thumbnail_url ?? '',
    createdAt: row.created_at,
  };
}

export function urlFavoriteToApiItem(entry: UrlFavoriteEntry): FavoriteItem {
  return {
    id: entry.id,
    userId: '',
    title: entry.title,
    platform: entry.platform,
    sourceUrl: entry.sourceUrl,
    thumbnailUrl: entry.thumbnailUrl,
    createdAt: entry.createdAt,
  };
}

export { normalizeFavoriteSourceKey } from '../utils/favorite-key';

export class UrlFavoriteRepository {
  async list(options?: {
    page?: number;
    limit?: number;
    search?: string;
    sort?: FavoriteListSort;
  }): Promise<PaginatedResult<UrlFavoriteEntry>> {
    const { page, pageSize, offset } = normalizePagination(
      {
        page: options?.page,
        pageSize: options?.limit ?? pagination.defaultPageSize,
      },
      {
        page: pagination.initialPage,
        pageSize: pagination.defaultPageSize,
        maxPageSize: pagination.maxPageSize,
      },
    );

    const clauses: string[] = [];
    const params: string[] = [];
    const search = options?.search?.trim();
    if (search) {
      const like = `%${search}%`;
      clauses.push('(title LIKE ? OR source_url LIKE ? OR platform LIKE ?)');
      params.push(like, like, like);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    let orderBy = 'created_at DESC, id DESC';
    if (options?.sort === 'oldest') {
      orderBy = 'created_at ASC, id ASC';
    } else if (options?.sort === 'alphabetical') {
      orderBy = 'title COLLATE NOCASE ASC, id ASC';
    }

    try {
      const db = await getDatabase();
      const countRow = await db.getFirstAsync<{ total: number }>(
        `SELECT COUNT(*) as total FROM ${TABLE_NAMES.urlFavorites} ${where}`,
        ...params,
      );
      const rows = await db.getAllAsync<FavoriteRow>(
        `SELECT * FROM ${TABLE_NAMES.urlFavorites}
         ${where}
         ORDER BY ${orderBy}
         LIMIT ? OFFSET ?`,
        ...params,
        pageSize,
        offset,
      );

      return buildPaginatedResult(
        rows.map(mapRow),
        countRow?.total ?? 0,
        page,
        pageSize,
      );
    } catch (error) {
      throw toStorageError(error, 'Failed to list favorites');
    }
  }

  async getBySourceUrl(sourceUrl: string): Promise<UrlFavoriteEntry | null> {
    const key = normalizeFavoriteSourceKey(sourceUrl);
    if (!key) {
      return null;
    }
    try {
      const db = await getDatabase();
      // Exact match on stored canonical URL; also try raw trim.
      const row =
        (await db.getFirstAsync<FavoriteRow>(
          `SELECT * FROM ${TABLE_NAMES.urlFavorites} WHERE source_url = ? LIMIT 1`,
          key,
        )) ??
        (await db.getFirstAsync<FavoriteRow>(
          `SELECT * FROM ${TABLE_NAMES.urlFavorites} WHERE source_url = ? LIMIT 1`,
          sourceUrl.trim(),
        ));
      return row ? mapRow(row) : null;
    } catch (error) {
      throw toStorageError(error, 'Failed to resolve favorite');
    }
  }

  async getById(id: string): Promise<UrlFavoriteEntry | null> {
    const trimmed = id.trim();
    if (!trimmed) {
      return null;
    }
    try {
      const db = await getDatabase();
      const row = await db.getFirstAsync<FavoriteRow>(
        `SELECT * FROM ${TABLE_NAMES.urlFavorites} WHERE id = ? LIMIT 1`,
        trimmed,
      );
      return row ? mapRow(row) : null;
    } catch (error) {
      throw toStorageError(error, 'Failed to read favorite');
    }
  }

  async upsert(input: CreateUrlFavoriteInput): Promise<UrlFavoriteEntry> {
    const sourceUrl = normalizeFavoriteSourceKey(input.sourceUrl);
    if (!sourceUrl) {
      throw toStorageError(new Error('url'), 'Favorite source URL is required');
    }

    const existing = await this.getBySourceUrl(sourceUrl);
    const now = nowIso();
    const title = input.title.trim() || sourceUrl;
    const thumbnailUrl = input.thumbnailUrl.trim();
    const platform = input.platform;

    try {
      const db = await getDatabase();
      if (existing) {
        await db.runAsync(
          `UPDATE ${TABLE_NAMES.urlFavorites}
           SET title = ?, platform = ?, thumbnail_url = ?, source_url = ?
           WHERE id = ?`,
          title,
          platform,
          thumbnailUrl,
          sourceUrl,
          existing.id,
        );
        const updated = await this.getById(existing.id);
        if (!updated) {
          throw new Error('Favorite update failed');
        }
        return updated;
      }

      const id = input.id?.trim() || (await createId());
      await db.runAsync(
        `INSERT INTO ${TABLE_NAMES.urlFavorites}
          (id, title, platform, source_url, thumbnail_url, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        id,
        title,
        platform,
        sourceUrl,
        thumbnailUrl,
        input.createdAt ?? now,
      );
      const created = await this.getById(id);
      if (!created) {
        throw new Error('Favorite create failed');
      }
      return created;
    } catch (error) {
      throw toStorageError(error, 'Failed to save favorite');
    }
  }

  async delete(id: string): Promise<boolean> {
    const trimmed = id.trim();
    if (!trimmed) {
      return false;
    }
    try {
      const db = await getDatabase();
      const result = await db.runAsync(
        `DELETE FROM ${TABLE_NAMES.urlFavorites} WHERE id = ?`,
        trimmed,
      );
      return (result.changes ?? 0) > 0;
    } catch (error) {
      throw toStorageError(error, 'Failed to delete favorite');
    }
  }

  async deleteBySourceUrl(sourceUrl: string): Promise<boolean> {
    const existing = await this.getBySourceUrl(sourceUrl);
    if (!existing) {
      return false;
    }
    return this.delete(existing.id);
  }

  async listAllSourceKeys(): Promise<string[]> {
    try {
      const db = await getDatabase();
      const rows = await db.getAllAsync<{ source_url: string }>(
        `SELECT source_url FROM ${TABLE_NAMES.urlFavorites}`,
      );
      return rows
        .map((row) => normalizeFavoriteSourceKey(row.source_url))
        .filter(Boolean);
    } catch (error) {
      throw toStorageError(error, 'Failed to list favorite keys');
    }
  }
}

export const urlFavoriteRepository = new UrlFavoriteRepository();
