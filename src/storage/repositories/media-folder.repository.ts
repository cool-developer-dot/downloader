import type { MediaFolderItem } from '@/api/types';
import { TABLE_NAMES } from '@/storage/constants';
import {
  StorageError,
  toStorageError,
  type MediaFolderEntry,
} from '@/storage/types';
import { createId, nowIso } from '@/storage/utils';

import { getDatabase } from '../sqlite/client';

interface FolderRow {
  id: string;
  name: string;
  normalized_name: string;
  created_at: string;
  updated_at: string;
}

export function normalizeFolderName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function mapRow(row: FolderRow): MediaFolderEntry {
  return {
    id: row.id,
    name: row.name,
    normalizedName: row.normalized_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function folderEntryToApiItem(entry: MediaFolderEntry): MediaFolderItem {
  return {
    id: entry.id,
    name: entry.name,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

export class MediaFolderRepository {
  async list(): Promise<MediaFolderEntry[]> {
    try {
      const db = await getDatabase();
      const rows = await db.getAllAsync<FolderRow>(
        `SELECT * FROM ${TABLE_NAMES.mediaFolders}
         ORDER BY created_at DESC, id DESC`,
      );
      return rows.map(mapRow);
    } catch (error) {
      throw toStorageError(error, 'Failed to list folders');
    }
  }

  async getById(id: string): Promise<MediaFolderEntry | null> {
    const trimmed = id.trim();
    if (!trimmed) {
      return null;
    }
    try {
      const db = await getDatabase();
      const row = await db.getFirstAsync<FolderRow>(
        `SELECT * FROM ${TABLE_NAMES.mediaFolders} WHERE id = ? LIMIT 1`,
        trimmed,
      );
      return row ? mapRow(row) : null;
    } catch (error) {
      throw toStorageError(error, 'Failed to read folder');
    }
  }

  async create(name: string): Promise<MediaFolderEntry> {
    const trimmed = name.trim().replace(/\s+/g, ' ');
    if (!trimmed) {
      throw new StorageError('Folder name is required', 'VALIDATION_FAILED');
    }

    const normalized = normalizeFolderName(trimmed);
    const now = nowIso();
    const id = await createId();

    try {
      const db = await getDatabase();
      const existing = await db.getFirstAsync<FolderRow>(
        `SELECT * FROM ${TABLE_NAMES.mediaFolders}
         WHERE normalized_name = ? LIMIT 1`,
        normalized,
      );
      if (existing) {
        throw new StorageError(
          'A folder with this name already exists',
          'VALIDATION_FAILED',
        );
      }

      await db.runAsync(
        `INSERT INTO ${TABLE_NAMES.mediaFolders}
          (id, name, normalized_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        id,
        trimmed,
        normalized,
        now,
        now,
      );

      const created = await this.getById(id);
      if (!created) {
        throw new Error('Folder create failed');
      }
      return created;
    } catch (error) {
      if (error instanceof StorageError) {
        throw error;
      }
      throw toStorageError(error, 'Failed to create folder');
    }
  }

  async rename(id: string, name: string): Promise<MediaFolderEntry> {
    const trimmedId = id.trim();
    const trimmed = name.trim().replace(/\s+/g, ' ');
    if (!trimmedId) {
      throw new StorageError('Folder id is required', 'VALIDATION_FAILED');
    }
    if (!trimmed) {
      throw new StorageError('Folder name is required', 'VALIDATION_FAILED');
    }

    const normalized = normalizeFolderName(trimmed);
    const now = nowIso();

    try {
      const existing = await this.getById(trimmedId);
      if (!existing) {
        throw new StorageError('Folder not found', 'NOT_FOUND');
      }

      const db = await getDatabase();
      const conflict = await db.getFirstAsync<FolderRow>(
        `SELECT * FROM ${TABLE_NAMES.mediaFolders}
         WHERE normalized_name = ? AND id != ? LIMIT 1`,
        normalized,
        trimmedId,
      );
      if (conflict) {
        throw new StorageError(
          'A folder with this name already exists',
          'VALIDATION_FAILED',
        );
      }

      await db.runAsync(
        `UPDATE ${TABLE_NAMES.mediaFolders}
         SET name = ?, normalized_name = ?, updated_at = ?
         WHERE id = ?`,
        trimmed,
        normalized,
        now,
        trimmedId,
      );

      const updated = await this.getById(trimmedId);
      if (!updated) {
        throw new Error('Folder rename failed');
      }
      return updated;
    } catch (error) {
      if (error instanceof StorageError) {
        throw error;
      }
      throw toStorageError(error, 'Failed to rename folder');
    }
  }

  /**
   * Deletes the folder row only. Caller must clear media folder_id assignments.
   */
  async delete(id: string): Promise<boolean> {
    const trimmed = id.trim();
    if (!trimmed) {
      return false;
    }
    try {
      const db = await getDatabase();
      const result = await db.runAsync(
        `DELETE FROM ${TABLE_NAMES.mediaFolders} WHERE id = ?`,
        trimmed,
      );
      return (result.changes ?? 0) > 0;
    } catch (error) {
      throw toStorageError(error, 'Failed to delete folder');
    }
  }

  async insertIfAbsent(entry: MediaFolderEntry): Promise<boolean> {
    try {
      const existing = await this.getById(entry.id);
      if (existing) {
        return false;
      }
      const db = await getDatabase();
      await db.runAsync(
        `INSERT OR IGNORE INTO ${TABLE_NAMES.mediaFolders}
          (id, name, normalized_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        entry.id,
        entry.name,
        entry.normalizedName || normalizeFolderName(entry.name),
        entry.createdAt,
        entry.updatedAt,
      );
      return true;
    } catch (error) {
      throw toStorageError(error, 'Failed to seed folder');
    }
  }
}

export const mediaFolderRepository = new MediaFolderRepository();
