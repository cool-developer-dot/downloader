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
  /** F12 (app DB v11); undefined only on a database not yet migrated. */
  parent_id?: string | null;
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
    parentId: row.parent_id ?? null,
    normalizedName: row.normalized_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function folderEntryToApiItem(entry: MediaFolderEntry): MediaFolderItem {
  return {
    id: entry.id,
    name: entry.name,
    parentId: entry.parentId ?? null,
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

  /** A folder with this name already in `parentId` (null = the root), other than `exceptId`. */
  private async findSibling(
    normalized: string,
    parentId: string | null,
    exceptId: string | null,
  ): Promise<FolderRow | null> {
    const db = await getDatabase();
    return db.getFirstAsync<FolderRow>(
      `SELECT * FROM ${TABLE_NAMES.mediaFolders}
       WHERE normalized_name = ? AND IFNULL(parent_id, '') = ? AND id != ? LIMIT 1`,
      normalized,
      parentId ?? '',
      exceptId ?? '',
    );
  }

  async create(name: string, parentId: string | null = null): Promise<MediaFolderEntry> {
    const trimmed = name.trim().replace(/\s+/g, ' ');
    if (!trimmed) {
      throw new StorageError('Folder name is required', 'VALIDATION_FAILED');
    }

    const normalized = normalizeFolderName(trimmed);
    const now = nowIso();
    const id = await createId();

    try {
      const db = await getDatabase();
      if (parentId != null && !(await this.getById(parentId))) {
        throw new StorageError('Parent folder not found', 'NOT_FOUND');
      }
      const existing = await this.findSibling(normalized, parentId, null);
      if (existing) {
        throw new StorageError(
          'A folder with this name already exists',
          'VALIDATION_FAILED',
        );
      }

      await db.runAsync(
        `INSERT INTO ${TABLE_NAMES.mediaFolders}
          (id, name, normalized_name, parent_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        id,
        trimmed,
        normalized,
        parentId,
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
      const conflict = await this.findSibling(normalized, existing.parentId ?? null, trimmedId);
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
   * F12: moves a folder under `parentId` (null = the root). The caller checks loops and depth (`moveProblem` in
   * src/files/engine/folder-tree.ts); this refuses only a name already used in the new parent.
   */
  async move(id: string, parentId: string | null): Promise<MediaFolderEntry> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new StorageError('Folder not found', 'NOT_FOUND');
    }
    try {
      if (parentId != null && !(await this.getById(parentId))) {
        throw new StorageError('Parent folder not found', 'NOT_FOUND');
      }
      if (await this.findSibling(existing.normalizedName, parentId, existing.id)) {
        throw new StorageError('A folder with this name already exists', 'VALIDATION_FAILED');
      }
      const db = await getDatabase();
      await db.runAsync(
        `UPDATE ${TABLE_NAMES.mediaFolders} SET parent_id = ?, updated_at = ? WHERE id = ?`,
        parentId,
        nowIso(),
        existing.id,
      );
      const moved = await this.getById(existing.id);
      if (!moved) {
        throw new Error('Folder move failed');
      }
      return moved;
    } catch (error) {
      if (error instanceof StorageError) {
        throw error;
      }
      throw toStorageError(error, 'Failed to move folder');
    }
  }

  /**
   * Deletes the folder row. Its subfolders move up into its parent (a clashing name gets " (2)", " (3)", …). The caller
   * moves the folder's items (`downloadCatalogRepository.moveFolderAssignments`); files are never deleted here.
   */
  async delete(id: string): Promise<boolean> {
    const trimmed = id.trim();
    if (!trimmed) {
      return false;
    }
    try {
      const db = await getDatabase();
      const folder = await this.getById(trimmed);
      if (folder) {
        const parentId = folder.parentId ?? null;
        const children = await db.getAllAsync<FolderRow>(
          `SELECT * FROM ${TABLE_NAMES.mediaFolders} WHERE parent_id = ?`,
          trimmed,
        );
        for (const child of children) {
          let name = child.name;
          let attempt = 2;
          while (await this.findSibling(normalizeFolderName(name), parentId, child.id)) {
            name = `${child.name} (${attempt})`;
            attempt += 1;
          }
          await db.runAsync(
            `UPDATE ${TABLE_NAMES.mediaFolders}
             SET parent_id = ?, name = ?, normalized_name = ?, updated_at = ?
             WHERE id = ?`,
            parentId,
            name,
            normalizeFolderName(name),
            nowIso(),
            child.id,
          );
        }
      }
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
          (id, name, normalized_name, parent_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        entry.id,
        entry.name,
        entry.normalizedName || normalizeFolderName(entry.name),
        entry.parentId ?? null,
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
