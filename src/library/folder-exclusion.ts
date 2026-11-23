/**
 * P9 #628 Include / Exclude Folders: library folders the user hides from the Library (its list, Most played and
 * search, and its Continue watching row). Pure. Hiding never deletes or moves a file, and never changes which folder
 * a video is in.
 *
 * A folder is named by its id; videos in no folder ("Unfiled / Downloads") by `UNFILED_FOLDER_SELECTION_ID`.
 * Choosing a hidden folder in the Folder filter still shows it: the user asked for that folder.
 */

import { UNFILED_FOLDER_SELECTION_ID } from './constants';

export const MAX_EXCLUDED_FOLDERS = 500;

/** The key a video's folder is hidden by. */
export function folderKeyOf(item: { folderId: string | null }): string {
  return item.folderId ?? UNFILED_FOLDER_SELECTION_ID;
}

/** The stored list read back tolerantly: unique, non-empty strings, in order. */
export function normalizeExcludedFolderIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry === 'string' && entry.trim() && !seen.has(entry)) {
      seen.add(entry);
    }
  }
  return [...seen].slice(0, MAX_EXCLUDED_FOLDERS);
}

/** Shows (`hidden` false) or hides one folder. */
export function setFolderExcluded(excluded: readonly string[], folderKey: string, hidden: boolean): string[] {
  if (hidden) {
    return folderKey && !excluded.includes(folderKey)
      ? normalizeExcludedFolderIds([...excluded, folderKey])
      : normalizeExcludedFolderIds(excluded);
  }
  return excluded.filter((id) => id !== folderKey);
}

export function isFolderExcluded(excluded: readonly string[], folderKey: string): boolean {
  return excluded.includes(folderKey);
}

/**
 * Leaves out the videos in hidden folders. When the Folder filter names a folder, that folder's videos stay (and the
 * filter shows only them anyway).
 */
export function applyFolderExclusion<T extends { folderId: string | null }>(
  items: readonly T[],
  excluded: readonly string[] | null | undefined,
  query?: { filter?: string; folderId?: string | null },
): T[] {
  if (!excluded || excluded.length === 0) {
    return [...items];
  }
  const hidden = new Set(excluded);
  if (query?.filter === 'folder' && query.folderId) {
    hidden.delete(query.folderId);
  }
  return items.filter((item) => !hidden.has(folderKeyOf(item)));
}

/** How many of these videos the hidden folders leave out. */
export function countExcluded(items: readonly { folderId: string | null }[], excluded: readonly string[]): number {
  if (excluded.length === 0) {
    return 0;
  }
  const hidden = new Set(excluded);
  return items.reduce((n, item) => (hidden.has(folderKeyOf(item)) ? n + 1 : n), 0);
}
