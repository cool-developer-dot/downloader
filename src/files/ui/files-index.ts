/**
 * Files F1: VidoraX's own files and folders as the Files screens see them. Pure: built from the library's items and
 * the folder list, so it is tested without a phone. `files-source.ts` feeds it the app's real stores.
 *
 * Folder membership is the library's logical folder (`folderId`); a file whose folder no longer exists counts as
 * unfiled (it shows at the top level). Stats count a folder's subfolders too.
 */

import { fileTypeOf, FILE_TYPES, type FileType } from './file-types';
import { folderLookupOf, folderSubtreeIds, parentFolderId, folderChain, type FolderNodeLike } from './folder-tree';

export type FileEntry = {
  id: string;
  /** The file name with its extension ("clip.mp4"); the title when the library knows no file name. */
  name: string;
  /** The library's title (may differ from the file name). */
  title: string;
  type: FileType;
  mimeType: string | null;
  /** Bytes; 0 when unknown. */
  sizeBytes: number;
  /** When it was downloaded (ISO), the date Files shows and sorts by. */
  date: string | null;
  folderId: string | null;
  thumbnailUri: string | null;
};

export type FolderEntry = {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string | null;
};

export type FolderListing = {
  /** The folder listed; `null` for the top level. */
  folder: FolderEntry | null;
  folders: FolderEntry[];
  files: FileEntry[];
};

export type FolderStats = { itemCount: number; totalBytes: number };

export type TypeCount = { count: number; bytes: number };
export type TypeCounts = Record<FileType, TypeCount>;

export type FilesIndex = { files: FileEntry[]; folders: FolderEntry[] };

/** What the library item must carry (a subset of `MediaLibraryItem`). */
export type FileSourceItem = {
  id: string;
  displayName: string;
  fileName: string;
  mimeType: string | null;
  fileSize: string;
  downloadedAt: string | null;
  folderId: string | null;
  thumbnailUri: string | null;
};

/** What a folder record must carry (`MediaFolderItem`, plus `parentId` once F12 adds it). */
export type FolderSourceItem = {
  id: string;
  name: string;
  parentId?: string | null;
  createdAt?: string | null;
};

function parseBytes(value: string | null | undefined): number {
  if (!value || !/^\d+$/.test(value)) {
    return 0;
  }
  const bytes = Number(value);
  return Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
}

export function toFileEntry(item: FileSourceItem): FileEntry {
  const name = item.fileName?.trim() || item.displayName?.trim() || item.id;
  return {
    id: item.id,
    name,
    title: item.displayName?.trim() || name,
    type: fileTypeOf({ mimeType: item.mimeType, fileName: name }),
    mimeType: item.mimeType,
    sizeBytes: parseBytes(item.fileSize),
    date: item.downloadedAt,
    folderId: item.folderId,
    thumbnailUri: item.thumbnailUri,
  };
}

export function toFolderEntry(folder: FolderSourceItem): FolderEntry {
  return {
    id: folder.id,
    name: folder.name,
    parentId: folder.parentId ?? null,
    createdAt: folder.createdAt ?? null,
  };
}

/** The index over the library items and folders (duplicate ids keep their first entry). */
export function buildFilesIndex(items: readonly FileSourceItem[], folders: readonly FolderSourceItem[]): FilesIndex {
  const folderEntries: FolderEntry[] = [];
  const folderIds = new Set<string>();
  for (const folder of folders) {
    if (!folder?.id || folderIds.has(folder.id)) continue;
    folderIds.add(folder.id);
    folderEntries.push(toFolderEntry(folder));
  }
  const fileEntries: FileEntry[] = [];
  const fileIds = new Set<string>();
  for (const item of items) {
    if (!item?.id || fileIds.has(item.id)) continue;
    fileIds.add(item.id);
    const entry = toFileEntry(item);
    // A file whose folder is gone is unfiled.
    fileEntries.push(entry.folderId && !folderIds.has(entry.folderId) ? { ...entry, folderId: null } : entry);
  }
  return { files: fileEntries, folders: folderEntries };
}

/** The folder's direct subfolders and files; the top level (`null`) lists the top-level folders and unfiled files. */
export function listFolderIn(index: FilesIndex, folderId: string | null): FolderListing {
  const lookup = folderLookupOf<FolderNodeLike>(index.folders);
  const folder = folderId ? (index.folders.find((entry) => entry.id === folderId) ?? null) : null;
  if (folderId && !folder) {
    return { folder: null, folders: [], files: [] };
  }
  const target = folder?.id ?? null;
  return {
    folder,
    folders: index.folders.filter((entry) => entry.id !== target && parentFolderId(entry.id, lookup) === target),
    files: index.files.filter((file) => (file.folderId ?? null) === target),
  };
}

/** Item count and total size of a folder, its subfolders included (an item is a file or a subfolder). */
export function folderStatsIn(index: FilesIndex, folderId: string): FolderStats {
  const lookup = folderLookupOf<FolderNodeLike>(index.folders);
  if (!lookup(folderId)) {
    return { itemCount: 0, totalBytes: 0 };
  }
  const subtree = new Set(folderSubtreeIds(folderId, index.folders));
  let itemCount = subtree.size - 1;
  let totalBytes = 0;
  for (const file of index.files) {
    if (file.folderId && subtree.has(file.folderId)) {
      itemCount += 1;
      totalBytes += file.sizeBytes;
    }
  }
  return { itemCount, totalBytes };
}

/** The folder's path from the top level down to itself; empty when it does not exist. */
export function folderPathIn(index: FilesIndex, folderId: string): FolderEntry[] {
  return folderChain(folderId, folderLookupOf(index.folders));
}

export function emptyTypeCounts(): TypeCounts {
  const counts = {} as TypeCounts;
  for (const type of FILE_TYPES) {
    counts[type] = { count: 0, bytes: 0 };
  }
  return counts;
}

/** How many files of each type, and their total size. */
export function typeCountsOf(files: readonly Pick<FileEntry, 'type' | 'sizeBytes'>[]): TypeCounts {
  const counts = emptyTypeCounts();
  for (const file of files) {
    const bucket = counts[file.type] ?? counts.other;
    bucket.count += 1;
    bucket.bytes += file.sizeBytes;
  }
  return counts;
}
