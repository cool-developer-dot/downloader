/**
 * F17: reads the File Manager's data for a backup (`files` section) and applies a restored one. The pure rules are in
 * files-section.ts. The File Manager screens' own MMKV keys join through `registerFilesBackupKey` (each package
 * registers its keys and how its store reloads them), so this file never reaches into a screen's store.
 */
import { getLowSpaceSettings, setLowSpaceSettings } from '@/files/cleanup/cleanup-api';
import { normalizeLowSpaceSettings } from '@/files/cleanup/cleanup-model';
import { normalizeBinSettings } from '@/files/trash/bin-model';
import { getBinSettings, setBinSettings } from '@/files/trash/trash-api';
import { getLibrary } from '@/library';
import { useItemNotesStore, useItemTagsStore } from '@/library/item-organize-store';
import { mmkvGetObject, mmkvSetObject } from '@/storage/mmkv';
import { downloadCatalogRepository, mediaFolderRepository } from '@/storage/repositories';
import { useMediaFolderAssignmentsStore } from '@/store/organization/folder-assignments';
import { useFoldersStore } from '@/store/organization/folders';

import { mergeItemData, readBackupFiles, type BackupFiles } from './files-section';

type Registered = { key: string; reload: () => void };
const registered = new Map<string, Registered>();

/**
 * F2 / F7 / F10 (Hamza): adds one of the File Manager screens' MMKV keys (`vidorax.files.*`) to backups. `reload`
 * makes the key's store read MMKV again after a restore (for a zustand persist store: `useX.persist.rehydrate()`).
 * Never register anything holding a PIN or a Private file.
 */
export function registerFilesBackupKey(key: string, reload: () => void): void {
  if (/^vidorax\.files\.[A-Za-z0-9.]+$/.test(key)) {
    registered.set(key, { key, reload });
  }
}

export async function collectFilesBackup(): Promise<BackupFiles> {
  const [folders, library] = await Promise.all([mediaFolderRepository.list(), getLibrary().catch(() => ({ items: [] }))]);
  const assignments = useMediaFolderAssignmentsStore.getState();
  const folderOf: Record<string, string | null> = {};
  for (const item of library.items) {
    const folderId = assignments.getEffectiveFolderId(item.id, item.folderId);
    if (folderId) {
      folderOf[item.id] = folderId;
    }
  }
  const extra: Record<string, unknown> = {};
  for (const { key } of registered.values()) {
    const value = mmkvGetObject<unknown>(key);
    if (value !== undefined && value !== null) {
      extra[key] = value;
    }
  }
  return readBackupFiles({
    folders: folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId ?? null,
      createdAt: folder.createdAt,
      updatedAt: folder.updatedAt,
    })),
    folderOf,
    tags: useItemTagsStore.getState().tagsById,
    notes: useItemNotesStore.getState().notesById,
    bin: getBinSettings(),
    lowSpace: getLowSpaceSettings(),
    extra,
  });
}

export type FilesRestoreSummary = { foldersAdded: number; itemsUpdated: number; settings: number };

export async function restoreFilesBackup(raw: unknown, mode: 'merge' | 'replace'): Promise<FilesRestoreSummary> {
  const files = readBackupFiles(raw);
  let foldersAdded = 0;
  for (const folder of files.folders) {
    const added = await mediaFolderRepository
      .insertIfAbsent({ ...folder, normalizedName: '' })
      .catch(() => false);
    if (added) {
      foldersAdded += 1;
    }
  }
  if (foldersAdded > 0) {
    await useFoldersStore.getState().refetch();
  }

  const { items } = await getLibrary().catch(() => ({ items: [] as { id: string }[] }));
  const existing = new Set(items.map((item) => item.id));
  const merged = mergeItemData(
    { tags: useItemTagsStore.getState().tagsById, notes: useItemNotesStore.getState().notesById },
    files,
    existing,
    mode,
  );
  useItemTagsStore.setState({ tagsById: merged.tags });
  useItemNotesStore.setState({ notesById: merged.notes });
  const folderIds = new Set((await mediaFolderRepository.list()).map((folder) => folder.id));
  const assignments: Record<string, string | null> = {};
  for (const [mediaId, folderId] of Object.entries(merged.folderOf)) {
    const target = folderId && folderIds.has(folderId) ? folderId : null;
    if (await downloadCatalogRepository.setFolderId(mediaId, target).catch(() => null)) {
      assignments[mediaId] = target;
    }
  }
  if (Object.keys(assignments).length > 0) {
    useMediaFolderAssignmentsStore.getState().syncFromRemoteAssignments(assignments);
  }
  const itemsUpdated = new Set([
    ...Object.keys(merged.folderOf),
    ...Object.keys(files.tags).filter((id) => existing.has(id)),
    ...Object.keys(files.notes).filter((id) => existing.has(id)),
  ]).size;

  let settings = 0;
  if (files.bin) {
    const bin = normalizeBinSettings(files.bin);
    setBinSettings(bin);
    settings += 1;
  }
  if (files.lowSpace) {
    setLowSpaceSettings(normalizeLowSpaceSettings(files.lowSpace));
    settings += 1;
  }
  for (const [key, value] of Object.entries(files.extra)) {
    const target = registered.get(key);
    if (!target) {
      continue; // a key this build's screens don't use
    }
    mmkvSetObject(key, value);
    try {
      target.reload();
    } catch {
      // The value is stored; the screen reads it on its next start.
    }
    settings += 1;
  }
  return { foldersAdded, itemsUpdated, settings };
}
