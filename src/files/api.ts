/**
 * F12 · the Files contract (Faran's). Written in F1 with today's fill-in bodies; from here on Faran owns this file and
 * swaps in his engine behind the same names and shapes.
 *
 * Until the engine lands, the bodies use what exists today (the heavy part is in `src/files/ui/files-fill-in.ts`,
 * loaded on first use so this file stays pure to import):
 * - every folder is at the root: `parentId` is always `null`, and `folderPath(id)` is `[thatFolder]` (`[]` if unknown);
 * - `moveFolder` throws `NOT_SUPPORTED`, and so does `createFolder` with a non-null parent;
 * - `rescanLibrary` runs the existing library reconcile and returns 0 for anything it can't count;
 * - `storageSpace` reads what the Storage screen reads; `fullPathOf` gives the file's path and no `publicCopies`;
 * - `subscribeFiles` fires when the library or the folders change (the existing stores).
 *
 * One spelling differs from the contract's text: `FilesError` assigns `code` in its constructor instead of declaring
 * it as a constructor parameter property, because Node's test runner (TypeScript strip-only mode) can't load parameter
 * properties. Its shape is the same: `new FilesError(code, message?)`, with `.code` and `.message`.
 */

import type { MediaLibraryItem } from '@/library/types';

import { fileTypeOf as fileTypeOfParts } from './ui/file-types';

export type FileType = 'video' | 'audio' | 'image' | 'doc' | 'archive' | 'apk' | 'other';
export type FilesSort = { by: 'name' | 'date' | 'size' | 'type'; dir: 'asc' | 'desc' };
export type FolderEntry = { id: string; name: string; parentId: string | null; createdAt: string; updatedAt: string };
export type FileEntry = MediaLibraryItem & { fileType: FileType; folderId: string | null };
export type FilesErrorCode = 'NAME_TAKEN' | 'INVALID_NAME' | 'TOO_DEEP' | 'CYCLE' | 'NOT_FOUND' | 'NOT_SUPPORTED';
export class FilesError extends Error {
  code: FilesErrorCode;
  constructor(code: FilesErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

/** Which engine parts are live. Hide any UI whose flag is false. I'll flip them to true as F12–F15 land. */
export const filesCapabilities = { nestedFolders: false, recycleBin: false, duplicates: false, folderAccess: false };

type FillIn = typeof import('./ui/files-fill-in');

let fillInPromise: Promise<FillIn> | null = null;

/** Today's implementation, loaded once on first use. */
function fillIn(): Promise<FillIn> {
  fillInPromise ??= import('./ui/files-fill-in');
  return fillInPromise;
}

/** Sync, pure: the MIME type decides, then the file name's extension. */
export function fileTypeOf(mime: string | null | undefined, fileName: string): FileType {
  return fileTypeOfParts({ mimeType: mime, fileName });
}

/** `null` = root; the type filter is used by the type tiles. */
export async function listFolder(
  folderId: string | null,
  opts?: { sort?: FilesSort; foldersFirst?: boolean; includeHidden?: boolean; type?: FileType },
): Promise<{ folders: FolderEntry[]; files: FileEntry[] }> {
  return (await fillIn()).listFolder(folderId, opts);
}

/** Includes subfolders. */
export async function folderStats(ids: readonly string[]): Promise<Record<string, { itemCount: number; totalBytes: number }>> {
  return (await fillIn()).folderStats(ids);
}

/** Root first, ending with the folder itself; `[]` if unknown. */
export async function folderPath(folderId: string): Promise<FolderEntry[]> {
  return (await fillIn()).folderPath(folderId);
}

export async function fullPathOf(itemId: string): Promise<{ appPath: string; publicCopies: string[] } | null> {
  return (await fillIn()).fullPathOf(itemId);
}

export async function storageSpace(): Promise<{ freeBytes: number; totalBytes: number; vidoraxBytes: number }> {
  return (await fillIn()).storageSpace();
}

export async function typeCounts(): Promise<Record<FileType, { count: number; bytes: number }>> {
  return (await fillIn()).typeCounts();
}

export async function rescanLibrary(): Promise<{ checked: number; missing: number; fixed: number; thumbnailsMade: number }> {
  return (await fillIn()).rescanLibrary();
}

/** Throws FilesError NAME_TAKEN | INVALID_NAME | TOO_DEEP (and NOT_SUPPORTED with a parent until nesting lands). */
export async function createFolder(name: string, parentId: string | null): Promise<FolderEntry> {
  if (parentId !== null) {
    throw new FilesError('NOT_SUPPORTED', 'Folders inside folders are not supported yet');
  }
  if (!name.trim()) {
    throw new FilesError('INVALID_NAME', 'Folder name is required');
  }
  return (await fillIn()).createFolder(name);
}

/** Throws CYCLE | TOO_DEEP | NAME_TAKEN | NOT_SUPPORTED (always NOT_SUPPORTED until nesting lands). */
export async function moveFolder(id: string, newParentId: string | null): Promise<void> {
  void id;
  void newParentId;
  throw new FilesError('NOT_SUPPORTED', 'Moving folders is not supported yet');
}

/** Fires when the library or the folders change. */
export function subscribeFiles(listener: () => void): () => void {
  let unsubscribe: (() => void) | null = null;
  let closed = false;
  fillIn()
    .then((module) => {
      if (!closed) {
        unsubscribe = module.subscribeFiles(listener);
      }
    })
    .catch(() => undefined);
  return () => {
    closed = true;
    unsubscribe?.();
  };
}
