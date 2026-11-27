/**
 * Files F1: VidoraX's own files and folders in the F12 contract's shapes (`src/files/api.ts`). Pure, so it is tested
 * without a phone. Faran's engine (`src/files/engine`) serves the screens; these helpers give the screens their types
 * and the counts they compute themselves (a locked folder's or a hidden file's files left out).
 *
 * Folder membership is the library's logical folder (`folderId`); a file whose folder no longer exists counts as
 * unfiled (it shows at the top level). Stats count a folder's subfolders too. Parent ids are followed generically, so
 * the same code serves the nested tree once F12 adds it (the tests use a nested tree).
 */

import type { FileEntry, FilesSort, FileType, FolderEntry } from '@/files/api';
import type { MediaLibraryItem } from '@/library/types';

import { fileBytes, fileLabel } from './file-fields';
import { fileTypeOf, FILE_TYPES } from './file-types';
import { folderLookupOf, folderSubtreeIds, parentFolderId, folderChain, type FolderNodeLike } from './folder-tree';

export type { FileEntry, FolderEntry } from '@/files/api';
// F5: the name Files shows (the title with the file's extension) lives with `fileLabel`.
export { fileDisplayName } from './file-fields';

export type FolderStats = { itemCount: number; totalBytes: number };
export type TypeCount = { count: number; bytes: number };
export type TypeCounts = Record<FileType, TypeCount>;
/** What `listFolder` answers. */
export type FolderContents = { folders: FolderEntry[]; files: FileEntry[] };
export type FilesIndex = { files: FileEntry[]; folders: FolderEntry[] };

/** What a folder record carries (`MediaFolderItem`, plus `parentId` once F12 adds it). */
export type FolderSourceItem = {
  id: string;
  name: string;
  parentId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export function toFileEntry(item: MediaLibraryItem): FileEntry {
  return { ...item, fileType: fileTypeOf({ mimeType: item.mimeType, fileName: item.fileName }), folderId: item.folderId ?? null };
}

/** Until F12 nests folders, every folder is at the root (`parentId` null), whatever the record says. */
export function atTheRoot(folders: readonly FolderSourceItem[]): FolderSourceItem[] {
  return folders.map((folder) => ({ ...folder, parentId: null }));
}

export function toFolderEntry(folder: FolderSourceItem): FolderEntry {
  const createdAt = folder.createdAt ?? '';
  return { id: folder.id, name: folder.name, parentId: folder.parentId ?? null, createdAt, updatedAt: folder.updatedAt ?? createdAt };
}

/** The index over the library items and folders (duplicate ids keep their first entry). */
export function buildFilesIndex(items: readonly MediaLibraryItem[], folders: readonly FolderSourceItem[]): FilesIndex {
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

export function findFolderIn(index: FilesIndex, folderId: string): FolderEntry | null {
  return index.folders.find((entry) => entry.id === folderId) ?? null;
}

const TYPE_ORDER = new Map<FileType, number>(FILE_TYPES.map((type, position) => [type, position]));

/** Files in the contract's sort (stable: ties keep the order given; a missing date sorts last). */
export function sortFilesBy(files: readonly FileEntry[], sort: FilesSort): FileEntry[] {
  const direction = sort.dir === 'desc' ? -1 : 1;
  const keyed = files.map((file, position) => ({ file, position }));
  keyed.sort((a, b) => {
    let order = 0;
    if (sort.by === 'name') {
      order = fileLabel(a.file).localeCompare(fileLabel(b.file), undefined, { sensitivity: 'base', numeric: true });
    } else if (sort.by === 'size') {
      order = fileBytes(a.file) - fileBytes(b.file);
    } else if (sort.by === 'type') {
      order = (TYPE_ORDER.get(a.file.fileType) ?? 0) - (TYPE_ORDER.get(b.file.fileType) ?? 0);
    } else {
      const left = a.file.downloadedAt ? Date.parse(a.file.downloadedAt) : Number.NaN;
      const right = b.file.downloadedAt ? Date.parse(b.file.downloadedAt) : Number.NaN;
      if (Number.isNaN(left) || Number.isNaN(right)) {
        return Number.isNaN(left) === Number.isNaN(right) ? a.position - b.position : Number.isNaN(left) ? 1 : -1;
      }
      order = left - right;
    }
    return order !== 0 ? order * direction : a.position - b.position;
  });
  return keyed.map((entry) => entry.file);
}

/**
 * The folder's direct subfolders and files; the top level (`null`) lists the top-level folders and unfiled files. An
 * unknown folder lists nothing. With `type`, it lists every file of that type in the folder and everything under it
 * (the whole library from the top level) and no folders, as a type tile needs.
 */
export function listFolderIn(
  index: FilesIndex,
  folderId: string | null,
  opts?: { sort?: FilesSort; type?: FileType },
): FolderContents {
  const lookup = folderLookupOf<FolderNodeLike>(index.folders);
  if (folderId && !lookup(folderId)) {
    return { folders: [], files: [] };
  }
  let folders: FolderEntry[];
  let files: FileEntry[];
  if (opts?.type) {
    const within = folderId ? new Set(folderSubtreeIds(folderId, index.folders)) : null;
    folders = [];
    files = index.files.filter(
      (file) => file.fileType === opts.type && (within === null || (file.folderId !== null && within.has(file.folderId))),
    );
  } else {
    folders = index.folders.filter((entry) => entry.id !== folderId && parentFolderId(entry.id, lookup) === folderId);
    files = index.files.filter((file) => (file.folderId ?? null) === folderId);
  }
  return { folders, files: opts?.sort ? sortFilesBy(files, opts.sort) : files };
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
      totalBytes += fileBytes(file);
    }
  }
  return { itemCount, totalBytes };
}

/** `folderStats` for several folders at once (an unknown id counts 0). */
export function folderStatsOf(index: FilesIndex, ids: readonly string[]): Record<string, FolderStats> {
  const stats: Record<string, FolderStats> = {};
  for (const id of ids) {
    stats[id] = folderStatsIn(index, id);
  }
  return stats;
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
export function typeCountsOf(files: readonly Pick<FileEntry, 'fileType' | 'fileSize'>[]): TypeCounts {
  const counts = emptyTypeCounts();
  for (const file of files) {
    const bucket = counts[file.fileType] ?? counts.other;
    bucket.count += 1;
    bucket.bytes += fileBytes(file);
  }
  return counts;
}
