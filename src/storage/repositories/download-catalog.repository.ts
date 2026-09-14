import type { DownloadItem, DownloadStatus } from '@/api/types';
import { pagination } from '@/constants';
import { TABLE_NAMES } from '@/storage/constants';
import {
  buildPaginatedResult,
  normalizePagination,
  toStorageError,
  type DownloadCatalogEntry,
  type ListDownloadCatalogOptions,
  type PaginatedResult,
  type UpsertDownloadCatalogInput,
} from '@/storage/types';
import { nowIso } from '@/storage/utils';

import { getDatabase } from '../sqlite/client';

interface CatalogRow {
  id: string;
  title: string;
  source_url: string;
  platform: string;
  thumbnail_url: string;
  file_name: string;
  folder_id: string | null;
  file_size: string;
  status: string;
  progress: number;
  quality: string | null;
  resolution: string | null;
  bitrate: number | null;
  retry_count: number;
  worker_state: string | null;
  error_code: string | null;
  error_message: string | null;
  favorite: number;
  mime_type: string | null;
  duration: number | null;
  downloaded_at: string | null;
  created_at: string;
  updated_at: string;
}

const STATUSES = new Set<string>([
  'QUEUED',
  'DOWNLOADING',
  'PAUSED',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

function mapRow(row: CatalogRow): DownloadCatalogEntry {
  const status = (
    STATUSES.has(row.status) ? row.status : 'QUEUED'
  ) as DownloadStatus;

  return {
    id: row.id,
    title: row.title,
    sourceUrl: row.source_url,
    platform: row.platform ?? '',
    thumbnailUrl: row.thumbnail_url ?? '',
    fileName: row.file_name,
    folderId: row.folder_id,
    fileSize: row.file_size ?? '0',
    status,
    progress: Math.max(0, Math.min(100, Math.trunc(row.progress ?? 0))),
    quality: row.quality,
    resolution: row.resolution,
    bitrate:
      typeof row.bitrate === 'number' && Number.isFinite(row.bitrate)
        ? Math.trunc(row.bitrate)
        : null,
    retryCount: Math.max(0, Math.trunc(row.retry_count ?? 0)),
    workerState: (row.worker_state as DownloadCatalogEntry['workerState']) ?? null,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    favorite: row.favorite === 1,
    mimeType: row.mime_type,
    duration:
      typeof row.duration === 'number' && Number.isFinite(row.duration)
        ? row.duration
        : null,
    downloadedAt: row.downloaded_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Map catalog → API DownloadItem shape used by existing UI/stores. */
/** Map catalog → API DownloadItem shape used by existing UI/stores. */
function containerFromPersistedMime(mimeType: string | null): string | null {
  if (!mimeType) {
    return null;
  }
  const key = mimeType.trim().toLowerCase();
  if (key === 'video/mp4') {
    return 'mp4';
  }
  if (key === 'video/webm' || key === 'audio/webm') {
    return 'webm';
  }
  if (key === 'video/mp2t' || key === 'application/mp2t') {
    return 'ts';
  }
  if (key === 'audio/mp4') {
    return 'm4a';
  }
  return null;
}

export function catalogEntryToDownloadItem(
  entry: DownloadCatalogEntry,
): DownloadItem {
  return {
    id: entry.id,
    userId: '',
    title: entry.title,
    sourceUrl: entry.sourceUrl,
    platform: entry.platform,
    thumbnailUrl: entry.thumbnailUrl,
    fileName: entry.fileName,
    folderId: entry.folderId,
    fileSize: entry.fileSize,
    status: entry.status,
    progress: entry.progress,
    quality: entry.quality,
    resolution: entry.resolution,
    bitrate: entry.bitrate,
    mimeType: entry.mimeType,
    container: containerFromPersistedMime(entry.mimeType),
    retryCount: entry.retryCount,
    workerState: entry.workerState,
    errorCode: entry.errorCode,
    errorMessage: entry.errorMessage,
    downloadedAt: entry.downloadedAt,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

export function downloadItemToCatalogInput(
  item: DownloadItem,
  extras?: { favorite?: boolean; mimeType?: string | null; duration?: number | null },
): UpsertDownloadCatalogInput {
  return {
    id: item.id,
    title: item.title,
    sourceUrl: item.sourceUrl,
    platform: item.platform,
    thumbnailUrl: item.thumbnailUrl,
    fileName: item.fileName,
    folderId: item.folderId,
    fileSize: item.fileSize,
    status: item.status,
    progress: item.progress,
    quality: item.quality,
    resolution: item.resolution,
    bitrate: item.bitrate,
    retryCount: item.retryCount,
    workerState: item.workerState,
    errorCode: item.errorCode,
    errorMessage: item.errorMessage,
    downloadedAt: item.downloadedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    favorite: extras?.favorite,
    mimeType: extras?.mimeType !== undefined ? extras.mimeType : item.mimeType,
    duration: extras?.duration,
  };
}

export class DownloadCatalogRepository {
  async getById(id: string): Promise<DownloadCatalogEntry | null> {
    const trimmed = id.trim();
    if (!trimmed) {
      return null;
    }

    try {
      const db = await getDatabase();
      const row = await db.getFirstAsync<CatalogRow>(
        `SELECT * FROM ${TABLE_NAMES.downloadsCatalog} WHERE id = ? LIMIT 1`,
        trimmed,
      );
      return row ? mapRow(row) : null;
    } catch (error) {
      throw toStorageError(error, 'Failed to read download catalog');
    }
  }

  async list(
    options: ListDownloadCatalogOptions = {},
  ): Promise<PaginatedResult<DownloadCatalogEntry>> {
    const { page, pageSize, offset } = normalizePagination(
      {
        page: options.page,
        pageSize: options.limit ?? pagination.defaultPageSize,
      },
      {
        page: pagination.initialPage,
        pageSize: pagination.defaultPageSize,
        maxPageSize: pagination.maxPageSize,
      },
    );

    const clauses: string[] = [];
    const params: (string | number)[] = [];

    if (options.status) {
      clauses.push('status = ?');
      params.push(options.status);
    }

    const search = options.search?.trim();
    if (search) {
      const like = `%${search}%`;
      clauses.push(
        '(title LIKE ? OR file_name LIKE ? OR source_url LIKE ? OR platform LIKE ?)',
      );
      params.push(like, like, like, like);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

    let orderBy = 'created_at DESC, id DESC';
    if (options.sort === 'oldest') {
      orderBy = 'created_at ASC, id ASC';
    } else if (options.sort === 'alphabetical') {
      orderBy = 'title COLLATE NOCASE ASC, id ASC';
    }

    try {
      const db = await getDatabase();
      const countRow = await db.getFirstAsync<{ total: number }>(
        `SELECT COUNT(*) as total FROM ${TABLE_NAMES.downloadsCatalog} ${where}`,
        ...params,
      );
      const total = countRow?.total ?? 0;

      const rows = await db.getAllAsync<CatalogRow>(
        `SELECT * FROM ${TABLE_NAMES.downloadsCatalog}
         ${where}
         ORDER BY ${orderBy}
         LIMIT ? OFFSET ?`,
        ...params,
        pageSize,
        offset,
      );

      return buildPaginatedResult(rows.map(mapRow), total, page, pageSize);
    } catch (error) {
      throw toStorageError(error, 'Failed to list download catalog');
    }
  }

  async listAllIds(): Promise<string[]> {
    try {
      const db = await getDatabase();
      const rows = await db.getAllAsync<{ id: string }>(
        `SELECT id FROM ${TABLE_NAMES.downloadsCatalog}`,
      );
      return rows.map((row) => row.id);
    } catch (error) {
      throw toStorageError(error, 'Failed to list catalog ids');
    }
  }

  async listFavoriteMediaIds(): Promise<string[]> {
    try {
      const db = await getDatabase();
      const rows = await db.getAllAsync<{ id: string }>(
        `SELECT id FROM ${TABLE_NAMES.downloadsCatalog} WHERE favorite = 1`,
      );
      return rows.map((row) => row.id);
    } catch (error) {
      throw toStorageError(error, 'Failed to list favorite media ids');
    }
  }

  /**
   * Insert or update. Never changes `id`.
   * Existing rows keep unspecified fields; required columns get safe defaults on insert.
   */
  async upsert(input: UpsertDownloadCatalogInput): Promise<DownloadCatalogEntry> {
    const id = input.id.trim();
    if (!id) {
      throw toStorageError(new Error('id required'), 'Download id is required');
    }

    const now = nowIso();

    try {
      const existing = await this.getById(id);
      const db = await getDatabase();

      if (!existing) {
        const title =
          input.title?.trim() ||
          input.fileName?.trim() ||
          input.sourceUrl?.trim() ||
          'Download';
        const fileName = input.fileName?.trim() || `${id}.bin`;
        const sourceUrl = input.sourceUrl?.trim() || '';
        const status = input.status ?? 'QUEUED';

        await db.runAsync(
          `INSERT INTO ${TABLE_NAMES.downloadsCatalog} (
            id, title, source_url, platform, thumbnail_url, file_name, folder_id,
            file_size, status, progress, quality, resolution, bitrate, retry_count,
            worker_state, error_code, error_message, favorite, mime_type, duration,
            downloaded_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          id,
          title,
          sourceUrl,
          input.platform?.trim() || '',
          input.thumbnailUrl?.trim() || '',
          fileName,
          input.folderId ?? null,
          input.fileSize ?? '0',
          status,
          input.progress ?? 0,
          input.quality ?? null,
          input.resolution ?? null,
          input.bitrate ?? null,
          input.retryCount ?? 0,
          input.workerState ?? null,
          input.errorCode ?? null,
          input.errorMessage ?? null,
          input.favorite === true ? 1 : 0,
          input.mimeType ?? null,
          input.duration ?? null,
          input.downloadedAt ?? null,
          input.createdAt ?? now,
          input.updatedAt ?? now,
        );

        return {
          id,
          title,
          sourceUrl,
          platform: input.platform?.trim() || '',
          thumbnailUrl: input.thumbnailUrl?.trim() || '',
          fileName,
          folderId: input.folderId ?? null,
          fileSize: input.fileSize ?? '0',
          status,
          progress: Math.max(0, Math.min(100, Math.trunc(input.progress ?? 0))),
          quality: input.quality ?? null,
          resolution: input.resolution ?? null,
          bitrate: input.bitrate ?? null,
          retryCount: input.retryCount ?? 0,
          workerState: input.workerState ?? null,
          errorCode: input.errorCode ?? null,
          errorMessage: input.errorMessage ?? null,
          favorite: input.favorite === true,
          mimeType: input.mimeType ?? null,
          duration: input.duration ?? null,
          downloadedAt: input.downloadedAt ?? null,
          createdAt: input.createdAt ?? now,
          updatedAt: input.updatedAt ?? now,
        };
      }

      const next: DownloadCatalogEntry = {
        ...existing,
        title:
          input.title !== undefined
            ? input.title.trim() || existing.title
            : existing.title,
        sourceUrl:
          input.sourceUrl !== undefined
            ? input.sourceUrl.trim() || existing.sourceUrl
            : existing.sourceUrl,
        platform:
          input.platform !== undefined
            ? input.platform.trim()
            : existing.platform,
        thumbnailUrl:
          input.thumbnailUrl !== undefined
            ? input.thumbnailUrl.trim()
            : existing.thumbnailUrl,
        fileName:
          input.fileName !== undefined
            ? input.fileName.trim() || existing.fileName
            : existing.fileName,
        folderId:
          input.folderId !== undefined ? input.folderId : existing.folderId,
        fileSize:
          input.fileSize !== undefined ? input.fileSize : existing.fileSize,
        status: input.status ?? existing.status,
        progress:
          input.progress !== undefined ? input.progress : existing.progress,
        quality:
          input.quality !== undefined ? input.quality : existing.quality,
        resolution:
          input.resolution !== undefined
            ? input.resolution
            : existing.resolution,
        bitrate:
          input.bitrate !== undefined ? input.bitrate : existing.bitrate,
        retryCount:
          input.retryCount !== undefined
            ? input.retryCount
            : existing.retryCount,
        workerState:
          input.workerState !== undefined
            ? input.workerState
            : existing.workerState,
        errorCode:
          input.errorCode !== undefined
            ? input.errorCode
            : existing.errorCode,
        errorMessage:
          input.errorMessage !== undefined
            ? input.errorMessage
            : existing.errorMessage,
        favorite:
          input.favorite !== undefined ? input.favorite : existing.favorite,
        mimeType:
          input.mimeType !== undefined ? input.mimeType : existing.mimeType,
        duration:
          input.duration !== undefined ? input.duration : existing.duration,
        downloadedAt:
          input.downloadedAt !== undefined
            ? input.downloadedAt
            : existing.downloadedAt,
        updatedAt: input.updatedAt ?? now,
      };

      await db.runAsync(
        `UPDATE ${TABLE_NAMES.downloadsCatalog} SET
          title = ?, source_url = ?, platform = ?, thumbnail_url = ?, file_name = ?,
          folder_id = ?, file_size = ?, status = ?, progress = ?, quality = ?,
          resolution = ?, bitrate = ?, retry_count = ?, worker_state = ?,
          error_code = ?, error_message = ?, favorite = ?, mime_type = ?,
          duration = ?, downloaded_at = ?, updated_at = ?
         WHERE id = ?`,
        next.title,
        next.sourceUrl,
        next.platform,
        next.thumbnailUrl,
        next.fileName,
        next.folderId,
        next.fileSize,
        next.status,
        next.progress,
        next.quality,
        next.resolution,
        next.bitrate,
        next.retryCount,
        next.workerState,
        next.errorCode,
        next.errorMessage,
        next.favorite ? 1 : 0,
        next.mimeType,
        next.duration,
        next.downloadedAt,
        next.updatedAt,
        id,
      );

      return next;
    } catch (error) {
      throw toStorageError(error, 'Failed to upsert download catalog');
    }
  }

  /**
   * Insert only if missing — preserves existing downloadId and richer metadata.
   */
  async insertIfAbsent(
    input: UpsertDownloadCatalogInput,
  ): Promise<{ created: boolean; entry: DownloadCatalogEntry }> {
    const existing = await this.getById(input.id);
    if (existing) {
      return { created: false, entry: existing };
    }
    const entry = await this.upsert(input);
    return { created: true, entry };
  }

  async setFavorite(id: string, favorite: boolean): Promise<DownloadCatalogEntry | null> {
    const existing = await this.getById(id);
    if (!existing) {
      return null;
    }
    return this.upsert({ id, favorite, updatedAt: nowIso() });
  }

  async setFolderId(
    id: string,
    folderId: string | null,
  ): Promise<DownloadCatalogEntry | null> {
    const existing = await this.getById(id);
    if (!existing) {
      return null;
    }
    return this.upsert({ id, folderId, updatedAt: nowIso() });
  }

  async clearFolderAssignments(folderId: string): Promise<number> {
    const trimmed = folderId.trim();
    if (!trimmed) {
      return 0;
    }
    try {
      const db = await getDatabase();
      const result = await db.runAsync(
        `UPDATE ${TABLE_NAMES.downloadsCatalog}
         SET folder_id = NULL, updated_at = ?
         WHERE folder_id = ?`,
        nowIso(),
        trimmed,
      );
      return result.changes ?? 0;
    } catch (error) {
      throw toStorageError(error, 'Failed to clear folder assignments');
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
        `DELETE FROM ${TABLE_NAMES.downloadsCatalog} WHERE id = ?`,
        trimmed,
      );
      return (result.changes ?? 0) > 0;
    } catch (error) {
      throw toStorageError(error, 'Failed to delete catalog row');
    }
  }
}

export const downloadCatalogRepository = new DownloadCatalogRepository();
