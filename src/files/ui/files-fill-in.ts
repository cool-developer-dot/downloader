/**
 * Files F1: today's implementation behind the F12 contract (`src/files/api.ts` loads this on first use), until
 * Faran's engine lands. Built on what exists:
 * - the library, assembled exactly as the Player tab assembles it (same repository setup, availability check and
 *   folder assignments);
 * - `useFoldersStore` / `useMediaFolderAssignmentsStore` (read only, except `createFolder`; Faran owns them);
 * - the Storage screen's own services for free space and VidoraX's size.
 *
 * As the contract's fill-in list says: every folder is at the root (`parentId` null), `folderPath(id)` is
 * `[thatFolder]`, and `rescanLibrary` runs the existing reconcile and counts what it can.
 */

import type { DownloadItem } from '@/api';
import { listLocalRecords } from '@/downloads/engine/persistence';
import { ensureV2LibraryHydrated, reconcileV2Library } from '@/downloads/v2';
import type { FileType, FilesSort, FolderEntry } from '@/files/api';
import {
  assembleCanonicalItems,
  configureLibraryRepository,
  filterByAvailability,
  reconcileAvailability,
  type FileAssessment,
} from '@/library';
import { getCachedFavoriteMediaIds } from '@/storage/services/catalog-persist';
import { readDeviceStorageSnapshot } from '@/storage-manager/services/device-storage.service';
import { scanAppStorageAsync } from '@/storage-manager/services/storage-scanner.service';
import {
  selectAllDownloadItems,
  selectDownloadCatalogIdentityRevision,
  selectLibraryTransferRevision,
  useDownloadsStore,
} from '@/store/downloads';
import { useFavoritesStore } from '@/store/favorites';
import { useLibraryStore } from '@/store/library';
import { useMediaFolderAssignmentsStore } from '@/store/organization/folder-assignments';
import { useFoldersStore } from '@/store/organization/folders';

import { filesErrorFromFolderStore } from './folder-errors';
import {
  atTheRoot,
  buildFilesIndex,
  findFolderIn,
  folderPathIn,
  folderStatsOf,
  listFolderIn,
  toFolderEntry,
  typeCountsOf,
  type FilesIndex,
  type FolderContents,
  type FolderSourceItem,
  type TypeCounts,
} from './files-index';

/** A built index is reused while the stores it came from are unchanged, for at most this long. */
const INDEX_REUSE_MS = 1500;
/** VidoraX's own size comes from a folder scan; it is reused for this long. */
const APP_SIZE_REUSE_MS = 30_000;

type CachedIndex = { at: number; signature: readonly unknown[]; promise: Promise<FilesIndex> };

let cached: CachedIndex | null = null;
let appSize: { at: number; promise: Promise<number> } | null = null;

function configureRepository(): void {
  // The same dependencies the Player tab gives the library, so Files works even before the Player tab was opened.
  configureLibraryRepository({
    getDownloadItems: () => selectAllDownloadItems(useDownloadsStore.getState()),
    getTransfers: () => useDownloadsStore.getState().transferById,
    getFavoriteSourceKeys: () => new Set(Object.keys(useFavoritesStore.getState().urlIndex)),
    getFavoriteMediaIds: () => getCachedFavoriteMediaIds(),
  });
}

/** What the files depend on: the downloads catalog, the library, the folders, the assignments and the favourites. */
function storeSignature(): readonly unknown[] {
  const downloads = useDownloadsStore.getState();
  return [
    selectDownloadCatalogIdentityRevision(downloads),
    selectLibraryTransferRevision(downloads),
    useLibraryStore.getState().sourceRevision,
    useFoldersStore.getState().itemsById,
    useMediaFolderAssignmentsStore.getState().folderIdByMediaId,
    useFavoritesStore.getState().urlIndex,
  ];
}

function sameSignature(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
}

/** Today's folders, all at the root (nesting is F12's). */
function folderRecords(): FolderSourceItem[] {
  const { itemsById, orderedIds } = useFoldersStore.getState();
  return orderedIds
    .map((id) => itemsById[id])
    .filter((folder): folder is NonNullable<typeof folder> => Boolean(folder));
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
  // What the Player tab lists: files on the phone (`available`), never a missing one.
  return buildFilesIndex(filterByAvailability(items), atTheRoot(folderRecords()));
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

export async function listFolder(
  folderId: string | null,
  opts?: { sort?: FilesSort; foldersFirst?: boolean; includeHidden?: boolean; type?: FileType },
): Promise<FolderContents> {
  return listFolderIn(await loadIndex(), folderId, { sort: opts?.sort, type: opts?.type });
}

export async function folderStats(ids: readonly string[]): Promise<Record<string, { itemCount: number; totalBytes: number }>> {
  return folderStatsOf(await loadIndex(), ids);
}

/** `[thatFolder]` while folders are flat; `[]` when it doesn't exist. */
export async function folderPath(folderId: string): Promise<FolderEntry[]> {
  const index = await loadIndex();
  return findFolderIn(index, folderId) ? folderPathIn(index, folderId) : [];
}

export async function fullPathOf(itemId: string): Promise<{ appPath: string; publicCopies: string[] } | null> {
  try {
    const { resolveCompletedMedia } = await import('@/downloads/completed-file/action-service');
    const media = await resolveCompletedMedia(itemId);
    return media.finalPath ? { appPath: media.finalPath, publicCopies: [] } : null;
  } catch {
    return null;
  }
}

function vidoraxBytes(): Promise<number> {
  const now = Date.now();
  if (!appSize || now - appSize.at > APP_SIZE_REUSE_MS) {
    const promise = scanAppStorageAsync()
      .then((breakdown) => breakdown.totalBytes)
      .catch(() => 0);
    appSize = { at: now, promise };
  }
  return appSize.promise;
}

/** The Storage screen's numbers: Android's free and total bytes, and VidoraX's own size (0 when unknown). */
export async function storageSpace(): Promise<{ freeBytes: number; totalBytes: number; vidoraxBytes: number }> {
  const device = readDeviceStorageSnapshot();
  return { freeBytes: device.freeBytes ?? 0, totalBytes: device.totalBytes ?? 0, vidoraxBytes: await vidoraxBytes() };
}

export async function typeCounts(): Promise<TypeCounts> {
  return typeCountsOf((await loadIndex()).files);
}

/** The existing library reconcile, then a fresh index; it can count the files checked and the ones found missing. */
export async function rescanLibrary(): Promise<{ checked: number; missing: number; fixed: number; thumbnailsMade: number }> {
  configureRepository();
  cached = null;
  appSize = null;
  const [removed] = await Promise.all([
    reconcileV2Library({ force: true }).catch(() => [] as string[]),
    useFoldersStore.getState().refetch().catch(() => undefined),
  ]);
  const index = await loadIndex(true);
  return { checked: index.files.length, missing: removed.length, fixed: 0, thumbnailsMade: 0 };
}

/** At the root; NAME_TAKEN and INVALID_NAME follow the folder repository's own rules. */
export async function createFolder(name: string): Promise<FolderEntry> {
  try {
    const folder = await useFoldersStore.getState().createFolder(name);
    cached = null;
    return toFolderEntry({ ...folder, parentId: null });
  } catch (cause) {
    throw filesErrorFromFolderStore(cause);
  }
}

/** Calls `listener` whenever the library or the folders change (the same stores the index is built from). */
export function subscribeFiles(listener: () => void): () => void {
  let last = storeSignature();
  const check = () => {
    const next = storeSignature();
    if (!sameSignature(last, next)) {
      last = next;
      listener();
    }
  };
  const unsubscribes = [
    useDownloadsStore.subscribe(check),
    useLibraryStore.subscribe(check),
    useFoldersStore.subscribe(check),
    useMediaFolderAssignmentsStore.subscribe(check),
    useFavoritesStore.subscribe(check),
  ];
  return () => {
    for (const unsubscribe of unsubscribes) {
      unsubscribe();
    }
  };
}
