// Stand-in for Faran's F12 `src/files/api.ts`: replaced by `export * from '@/files/api';` once F12 merges.
/**
 * Files F1: the only door the Files screens use to VidoraX's files and folders. It has the F12 contract's names and
 * meanings, built on what exists today:
 * - the library, assembled exactly as the Player tab assembles it (same repository setup, availability check and
 *   folder assignments), so every count matches the Player tab's;
 * - `useFoldersStore` / `useMediaFolderAssignmentsStore` (read only; Faran owns them);
 * - the device-storage service for free space.
 *
 * Folders are flat today: `listFolder(null)` returns every folder plus the unfiled files, `listFolder(id)` that
 * folder's files and no subfolders, `folderPath(id)` just that folder, and `moveFolder` does nothing yet. The tree
 * logic underneath (`folder-tree.ts`) already follows parent ids, so nesting works the day F12 adds them.
 */

import type { DownloadItem } from '@/api';
import { listLocalRecords } from '@/downloads/engine/persistence';
import { ensureV2LibraryHydrated, reconcileV2Library } from '@/downloads/v2';
import {
  assembleCanonicalItems,
  configureLibraryRepository,
  filterByAvailability,
  reconcileAvailability,
  type FileAssessment,
} from '@/library';
import { getCachedFavoriteMediaIds } from '@/storage/services/catalog-persist';
import { readDeviceStorageSnapshot } from '@/storage-manager/services/device-storage.service';
import {
  selectAllDownloadItems,
  selectDownloadCatalogIdentityRevision,
  selectLibraryTransferRevision,
  useDownloadsStore,
} from '@/store/downloads';
import { useFavoritesStore } from '@/store/favorites';
import { useMediaFolderAssignmentsStore } from '@/store/organization/folder-assignments';
import { useFoldersStore } from '@/store/organization/folders';

import {
  buildFilesIndex,
  folderPathIn,
  folderStatsIn,
  listFolderIn,
  toFolderEntry,
  typeCountsOf,
  type FilesIndex,
  type FolderEntry,
  type FolderListing,
  type FolderStats,
  type TypeCounts,
} from './files-index';

export { fileTypeOf, type FileType } from './file-types';
export type { FileEntry, FolderEntry, FolderListing, FolderStats, TypeCount, TypeCounts } from './files-index';

export type StorageSpace = { freeBytes: number | null; totalBytes: number | null };

/** A built index is reused while the stores it came from are unchanged, for at most this long. */
const INDEX_REUSE_MS = 1500;

type CachedIndex = {
  at: number;
  signature: readonly unknown[];
  promise: Promise<FilesIndex>;
};

let cached: CachedIndex | null = null;

function configureRepository(): void {
  // The same dependencies the Player tab gives the library, so Files works even before the Player tab was opened.
  configureLibraryRepository({
    getDownloadItems: () => selectAllDownloadItems(useDownloadsStore.getState()),
    getTransfers: () => useDownloadsStore.getState().transferById,
    getFavoriteSourceKeys: () => new Set(Object.keys(useFavoritesStore.getState().urlIndex)),
    getFavoriteMediaIds: () => getCachedFavoriteMediaIds(),
  });
}

function storeSignature(): readonly unknown[] {
  const downloads = useDownloadsStore.getState();
  return [
    selectDownloadCatalogIdentityRevision(downloads),
    selectLibraryTransferRevision(downloads),
    useFoldersStore.getState().itemsById,
    useMediaFolderAssignmentsStore.getState().folderIdByMediaId,
    useFavoritesStore.getState().urlIndex,
  ];
}

function sameSignature(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
}

async function buildIndex(force: boolean): Promise<FilesIndex> {
  configureRepository();
  // The v2 library loads a moment after launch; opening Files first loads it now (as the Player tab does).
  await ensureV2LibraryHydrated().catch(() => undefined);
  await useFoldersStore.getState().ensureReady().catch(() => undefined);
  const [records, availabilityById] = await Promise.all([
    listLocalRecords().catch(() => []),
    reconcileAvailability(undefined, { force }).catch(() => ({}) as Record<string, never>),
  ]);
  const assessments: Record<string, FileAssessment> = {};
  for (const [id, availability] of Object.entries(availabilityById)) {
    assessments[id] = { availability, verifiedBytes: null };
  }
  const downloads: DownloadItem[] = selectAllDownloadItems(useDownloadsStore.getState());
  const foldersById = useFoldersStore.getState().itemsById;
  const folderNameByFolderId: Record<string, string | null> = {};
  for (const [id, folder] of Object.entries(foldersById)) {
    folderNameByFolderId[id] = folder?.name ?? null;
  }
  const items = assembleCanonicalItems({
    downloads,
    records,
    transfers: useDownloadsStore.getState().transferById,
    remoteById: {},
    favoriteKeys: new Set(Object.keys(useFavoritesStore.getState().urlIndex)),
    favoriteMediaIds: getCachedFavoriteMediaIds(),
    assessments,
    folderIdByMediaId: useMediaFolderAssignmentsStore.getState().folderIdByMediaId,
    folderNameByFolderId,
  });
  const folders = useFoldersStore.getState().orderedIds
    .map((id) => foldersById[id])
    .filter((folder): folder is NonNullable<typeof folder> => Boolean(folder));
  // What the Player tab lists: files on the phone (`available`), never a missing one.
  return buildFilesIndex(filterByAvailability(items), folders);
}

function loadIndex(force = false): Promise<FilesIndex> {
  const signature = storeSignature();
  const now = Date.now();
  if (!force && cached && now - cached.at < INDEX_REUSE_MS && sameSignature(cached.signature, signature)) {
    return cached.promise;
  }
  const promise = buildIndex(force);
  cached = { at: now, signature, promise };
  promise.catch(() => {
    if (cached?.promise === promise) {
      cached = null;
    }
  });
  return promise;
}

/** A folder's subfolders and files; `null` lists the top level (every folder, plus the files in no folder). */
export async function listFolder(folderId: string | null): Promise<FolderListing> {
  return listFolderIn(await loadIndex(), folderId);
}

/** How many items a folder holds and their total size, subfolders included. */
export async function folderStats(folderId: string): Promise<FolderStats> {
  return folderStatsIn(await loadIndex(), folderId);
}

/** The folder's path from the top level down to itself (just the folder while folders are flat). */
export async function folderPath(folderId: string): Promise<FolderEntry[]> {
  return folderPathIn(await loadIndex(), folderId);
}

/** The file's full path on the phone, for the Details page (F3); null when it cannot be found. */
export async function fullPathOf(itemId: string): Promise<string | null> {
  try {
    const { resolveCompletedMedia } = await import('@/downloads/completed-file/action-service');
    const media = await resolveCompletedMedia(itemId);
    return media.finalPath || null;
  } catch {
    return null;
  }
}

/** Free and total bytes of the phone's internal storage (null when Android doesn't say). */
export async function storageSpace(): Promise<StorageSpace> {
  const snapshot = readDeviceStorageSnapshot();
  return { freeBytes: snapshot.freeBytes, totalBytes: snapshot.totalBytes };
}

/** How many files of each type VidoraX keeps, and their size. */
export async function typeCounts(): Promise<TypeCounts> {
  return typeCountsOf((await loadIndex()).files);
}

/** Checks the library against the files on the phone again (pull to refresh), and reloads the folders. */
export async function rescanLibrary(): Promise<void> {
  configureRepository();
  cached = null;
  await Promise.all([
    reconcileV2Library({ force: true }).catch(() => undefined),
    useFoldersStore.getState().refetch().catch(() => undefined),
  ]);
  await loadIndex(true);
}

/** Creates a folder (always at the top level while folders are flat; `parentId` is used once F12 lands). */
export async function createFolder(name: string, _parentId: string | null = null): Promise<FolderEntry> {
  const folder = await useFoldersStore.getState().createFolder(name);
  cached = null;
  return toFolderEntry(folder);
}

/** Moves a folder under another one. Does nothing until F12 adds nesting. */
export async function moveFolder(_folderId: string, _parentId: string | null): Promise<void> {
  return undefined;
}
