/**
 * F12: the Files views over the library, pure. `listFolderEntries` is one folder's contents, `computeFolderStats` the
 * size and item count of folders with their subfolders (#771, #772), `computeTypeCounts` the per-type totals.
 */
import { FILE_TYPES, fileTypeOf, type FileType } from './file-types';
import { childFolders, descendantIds, effectiveParentId, indexFolders, type FolderNode } from './folder-tree';

/** The fields of a library item the engine reads (a `MediaLibraryItem` has them all). */
export type FilesItemInput = {
  id: string;
  displayName: string;
  fileName: string;
  mimeType: string | null;
  fileSize: string;
  downloadedAt: string | null;
  folderId: string | null;
};

export type FilesSort = { by: 'name' | 'date' | 'size' | 'type'; dir: 'asc' | 'desc' };

export const DEFAULT_FILES_SORT: FilesSort = { by: 'name', dir: 'asc' };

export type ListFolderOptions = {
  sort?: FilesSort;
  foldersFirst?: boolean;
  includeHidden?: boolean;
  type?: FileType;
};

export function bytesOf(fileSize: string | null | undefined): number {
  const n = Number(fileSize ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function dateMs(value: string | null | undefined): number {
  const ms = value ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

function compareBy<T>(sort: FilesSort, key: (x: T) => { name: string; date: number; size: number; type: string; id: string }) {
  const sign = sort.dir === 'desc' ? -1 : 1;
  return (a: T, b: T): number => {
    const ka = key(a);
    const kb = key(b);
    let primary = 0;
    switch (sort.by) {
      case 'date':
        primary = ka.date - kb.date;
        break;
      case 'size':
        primary = ka.size - kb.size;
        break;
      case 'type':
        primary = collator.compare(ka.type, kb.type);
        break;
      default:
        primary = 0;
    }
    if (primary === 0) {
      primary = collator.compare(ka.name, kb.name);
    }
    if (primary === 0) {
      // Stable: the same order every time, whatever the input order.
      primary = ka.id < kb.id ? -1 : ka.id > kb.id ? 1 : 0;
    }
    return primary * sign;
  };
}

export type ListedFile<T extends FilesItemInput> = T & { fileType: FileType; folderId: string | null };

export type FolderListingResult<T extends FilesItemInput> = {
  folders: FolderNode[];
  files: ListedFile<T>[];
};

/** The folder a file effectively sits in: its folder when that still exists, otherwise the root. */
export function effectiveFolderId(item: FilesItemInput, folderIds: ReadonlySet<string>): string | null {
  return item.folderId != null && folderIds.has(item.folderId) ? item.folderId : null;
}

/**
 * One folder's subfolders and files (`folderId` null = the root). With `type`, files of that type from every folder
 * (the type tiles), and no folders. Hidden ids are left out unless `includeHidden`.
 */
export function listFolderEntries<T extends FilesItemInput>(input: {
  folders: readonly FolderNode[];
  items: readonly T[];
  folderId: string | null;
  options?: ListFolderOptions;
  hiddenIds?: ReadonlySet<string>;
}): FolderListingResult<T> {
  const { folders, items, folderId } = input;
  const options = input.options ?? {};
  const sort = options.sort ?? DEFAULT_FILES_SORT;
  const index = indexFolders(folders);
  const folderIds = new Set(index.keys());
  const hidden = options.includeHidden ? null : input.hiddenIds ?? null;

  const files = items
    .filter((item) => !hidden || !hidden.has(item.id))
    .map((item) => ({ ...item, fileType: fileTypeOf(item.mimeType, item.fileName), folderId: effectiveFolderId(item, folderIds) }))
    .filter((item) => (options.type ? item.fileType === options.type : item.folderId === folderId))
    .sort(
      compareBy(sort, (x: ListedFile<T>) => ({
        name: x.displayName || x.fileName,
        date: dateMs(x.downloadedAt),
        size: bytesOf(x.fileSize),
        type: x.fileType,
        id: x.id,
      })),
    );

  const folderSort: FilesSort = sort.by === 'name' || sort.by === 'date' ? sort : { by: 'name', dir: 'asc' };
  const subfolders = options.type
    ? []
    : childFolders(folderId, folders, index).sort(
        compareBy(folderSort, (f: FolderNode) => ({ name: f.name, date: dateMs(f.createdAt), size: 0, type: '', id: f.id })),
      );
  return { folders: subfolders, files };
}

export type FolderStats = { itemCount: number; totalBytes: number };

/** Item count and bytes of each folder, its subfolders included (hidden files count; they still take space). */
export function computeFolderStats(
  ids: readonly string[],
  folders: readonly FolderNode[],
  items: readonly FilesItemInput[],
): Record<string, FolderStats> {
  const index = indexFolders(folders);
  const folderIds = new Set(index.keys());
  const direct = new Map<string, FolderStats>();
  for (const item of items) {
    const folder = effectiveFolderId(item, folderIds);
    if (folder == null) {
      continue;
    }
    const stats = direct.get(folder) ?? { itemCount: 0, totalBytes: 0 };
    stats.itemCount += 1;
    stats.totalBytes += bytesOf(item.fileSize);
    direct.set(folder, stats);
  }
  const out: Record<string, FolderStats> = {};
  for (const id of ids) {
    if (!index.has(id)) {
      continue;
    }
    const total: FolderStats = { itemCount: 0, totalBytes: 0 };
    for (const member of [id, ...descendantIds(id, folders, index)]) {
      const stats = direct.get(member);
      if (stats) {
        total.itemCount += stats.itemCount;
        total.totalBytes += stats.totalBytes;
      }
    }
    out[id] = total;
  }
  return out;
}

export function computeTypeCounts(items: readonly FilesItemInput[]): Record<FileType, { count: number; bytes: number }> {
  const out = Object.fromEntries(FILE_TYPES.map((type) => [type, { count: 0, bytes: 0 }])) as Record<
    FileType,
    { count: number; bytes: number }
  >;
  for (const item of items) {
    const bucket = out[fileTypeOf(item.mimeType, item.fileName)];
    bucket.count += 1;
    bucket.bytes += bytesOf(item.fileSize);
  }
  return out;
}

/** Folder rows in the shape the API returns, with each folder's effective parent. */
export function withEffectiveParents(folders: readonly FolderNode[]): FolderNode[] {
  const index = indexFolders(folders);
  return folders.map((folder) => ({ ...folder, parentId: effectiveParentId(folder, index) }));
}
