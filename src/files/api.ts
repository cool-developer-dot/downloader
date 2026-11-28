/**
 * The File Manager's API (F12). Every Files screen calls only this file; names and return shapes are the contract
 * agreed with Hamza on 2026-11-26 and never change (new fields may be added as optional).
 *
 * Folders are the app database's `media_folders`, nested by `parent_id` (DB v11); files are the VidoraX library
 * (`getLibrary`). Nothing here touches files on disk except `rescanLibrary`, which repairs the library.
 */
import { getV2Engine } from '@/downloads/v2/engine-port';
import { useExternalCopiesStore } from '@/downloads/v2/save-location-store';
import { getInternalPlaybackUri, getLibrary, type MediaLibraryItem } from '@/library';
import { readDeviceStorageSnapshot, scanAppStorageAsync } from '@/storage-manager';
import { useDownloadsStore } from '@/store/downloads';
import { useMediaFolderAssignmentsStore } from '@/store/organization/folder-assignments';
import { useFoldersStore } from '@/store/organization/folders';
import type { MediaFolderItem } from '@/api/types';

import { loadSystemDownloadItems, useSystemDownloadsRevision } from './system-downloads/system-downloads';
import { useBinStore } from './trash/bin-store';
import { fileTypeOf as fileTypeOfImpl, type FileType } from './engine/file-types';
import {
  computeFolderStats,
  computeTypeCounts,
  listFolderEntries,
  withEffectiveParents,
  type FilesSort as FilesSortImpl,
} from './engine/files-query';
import { canCreateUnder, folderPathOf, indexFolders, moveProblem, type FolderNode } from './engine/folder-tree';

export type { FileType } from './engine/file-types';
export type FilesSort = FilesSortImpl;
export type FolderEntry = { id: string; name: string; parentId: string | null; createdAt: string; updatedAt: string };
export type FileEntry = MediaLibraryItem & { fileType: FileType; folderId: string | null };
export type FilesErrorCode = 'NAME_TAKEN' | 'INVALID_NAME' | 'TOO_DEEP' | 'CYCLE' | 'NOT_FOUND' | 'NOT_SUPPORTED';

export class FilesError extends Error {
  constructor(
    public code: FilesErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'FilesError';
  }
}

/** Which engine parts are live. Screens hide what is still false; each backend package flips its own flag. */
export const filesCapabilities = { nestedFolders: true, recycleBin: true, duplicates: true, folderAccess: true };

/**
 * Hidden files (F7 "Hide"). F7 registers where its hidden ids live; until then nothing is hidden. Kept as a provider
 * so this file never imports a screen-side store.
 */
let hiddenIdsProvider: () => ReadonlySet<string> = () => new Set();
export function setHiddenIdsProvider(provider: () => ReadonlySet<string>): void {
  hiddenIdsProvider = provider;
}

export function fileTypeOf(mime: string | null | undefined, fileName: string): FileType {
  return fileTypeOfImpl(mime, fileName);
}

async function loadFolders(): Promise<FolderNode[]> {
  const store = useFoldersStore.getState();
  await store.ensureReady();
  const { itemsById, orderedIds } = useFoldersStore.getState();
  return withEffectiveParents(
    orderedIds
      .map((id) => itemsById[id])
      .filter((item): item is MediaFolderItem => Boolean(item))
      .map((item) => ({
        id: item.id,
        name: item.name,
        parentId: item.parentId ?? null,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
  );
}

async function loadItems(): Promise<MediaLibraryItem[]> {
  const [{ items }, downloaded] = await Promise.all([getLibrary(), loadSystemDownloadItems()]);
  const assignments = useMediaFolderAssignmentsStore.getState();
  // The assignment cache is ahead of the catalog right after a move: use what the user just did.
  const library = items.map((item) => ({ ...item, folderId: assignments.getEffectiveFolderId(item.id, item.folderId) }));
  // The files the browser handed to Android's DownloadManager (pictures, documents, archives…): in no folder; while
  // in the Recycle bin they are hidden here, like a library item (the library leaves those out itself).
  const binned = useBinStore.getState().entries;
  return [...library, ...downloaded.filter((item) => !binned[item.id])];
}

export async function listFolder(
  folderId: string | null,
  opts?: { sort?: FilesSort; foldersFirst?: boolean; includeHidden?: boolean; type?: FileType },
): Promise<{ folders: FolderEntry[]; files: FileEntry[] }> {
  const [folders, items] = await Promise.all([loadFolders(), loadItems()]);
  const result = listFolderEntries({ folders, items, folderId, options: opts, hiddenIds: hiddenIdsProvider() });
  return { folders: result.folders, files: result.files };
}

export async function folderStats(ids: readonly string[]): Promise<Record<string, { itemCount: number; totalBytes: number }>> {
  const [folders, items] = await Promise.all([loadFolders(), loadItems()]);
  return computeFolderStats(ids, folders, items);
}

export async function folderPath(folderId: string): Promise<FolderEntry[]> {
  const folders = await loadFolders();
  return folderPathOf(folderId, indexFolders(folders));
}

export async function fullPathOf(itemId: string): Promise<{ appPath: string; publicCopies: string[] } | null> {
  const appPath = getInternalPlaybackUri(itemId);
  if (!appPath) {
    return null;
  }
  const record = useExternalCopiesStore.getState().records[itemId];
  const publicCopies = record && record.status === 'copied' ? [record.documentUri] : [];
  return { appPath, publicCopies };
}

export async function storageSpace(): Promise<{ freeBytes: number; totalBytes: number; vidoraxBytes: number }> {
  const device = readDeviceStorageSnapshot();
  const app = await scanAppStorageAsync().catch(() => null);
  return {
    freeBytes: device.freeBytes ?? 0,
    totalBytes: device.totalBytes ?? 0,
    vidoraxBytes: app?.totalBytes ?? 0,
  };
}

export async function typeCounts(): Promise<Record<FileType, { count: number; bytes: number }>> {
  return computeTypeCounts(await loadItems());
}

/**
 * #973 Rescan media: the native engine drops items whose file is gone or empty, then the library is re-read with
 * every file checked again. `missing` = items still listed whose file can't be found (legacy downloads).
 */
export async function rescanLibrary(): Promise<{ checked: number; missing: number; fixed: number; thumbnailsMade: number }> {
  const engine = getV2Engine();
  const removed = (await engine?.reconcileLibrary?.(null).catch(() => [] as string[])) ?? [];
  const { items } = await getLibrary({ forceReconcile: true });
  return {
    checked: items.length + removed.length,
    missing: items.filter((item) => item.localAvailability === 'missing').length,
    fixed: removed.length,
    thumbnailsMade: 0,
  };
}

function mapStorageError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string } | null)?.code;
  if (/already exists/i.test(message)) {
    throw new FilesError('NAME_TAKEN', message);
  }
  if (code === 'NOT_FOUND' || /not found/i.test(message)) {
    throw new FilesError('NOT_FOUND', message);
  }
  if (code === 'VALIDATION_FAILED' || /required/i.test(message)) {
    throw new FilesError('INVALID_NAME', message);
  }
  throw error;
}

const BAD_NAME = /[/\\:*?"<>|]/;

export async function createFolder(name: string, parentId: string | null): Promise<FolderEntry> {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 120 || BAD_NAME.test(trimmed)) {
    throw new FilesError('INVALID_NAME');
  }
  const folders = await loadFolders();
  const problem = canCreateUnder(parentId, indexFolders(folders));
  if (problem) {
    throw new FilesError(problem);
  }
  try {
    const created = await useFoldersStore.getState().createFolder(trimmed, parentId);
    return {
      id: created.id,
      name: created.name,
      parentId: created.parentId ?? null,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };
  } catch (error) {
    return mapStorageError(error);
  }
}

export async function moveFolder(id: string, newParentId: string | null): Promise<void> {
  const folders = await loadFolders();
  const problem = moveProblem(id, newParentId, folders, indexFolders(folders));
  if (problem) {
    throw new FilesError(problem);
  }
  try {
    await useFoldersStore.getState().moveFolder(id, newParentId);
  } catch (error) {
    mapStorageError(error);
  }
}

/** Fires when the library, the folders or an item's folder change. Returns the unsubscribe. */
export function subscribeFiles(listener: () => void): () => void {
  const unsubscribers = [
    useFoldersStore.subscribe(listener),
    useDownloadsStore.subscribe(listener),
    useMediaFolderAssignmentsStore.subscribe(listener),
    useSystemDownloadsRevision.subscribe(listener),
    useBinStore.subscribe(listener),
  ];
  return () => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
  };
}
