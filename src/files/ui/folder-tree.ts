/**
 * Files F1 · #742 Back, #743 Up one level: the folder tree, walked only through parent ids. Pure.
 *
 * VidoraX's folders are flat until Faran's F12 adds `parentId`; everything here already works on a nested tree, so
 * breadcrumbs, "Up to {parent}", the back walk and the deleted-folder fallback need no change the day it lands. A
 * parent that no longer exists ends the walk there (the folder then sits at the top level), and a parent loop never
 * hangs: the folder is treated as a top-level one.
 */

export type FolderNodeLike = {
  id: string;
  name: string;
  /** `null` (or missing) for a top-level folder. */
  parentId?: string | null;
};

export type FolderLookup<T extends FolderNodeLike = FolderNodeLike> = (id: string) => T | null | undefined;

/** A lookup over a list of folders (the last one wins on a duplicate id). */
export function folderLookupOf<T extends FolderNodeLike>(folders: readonly T[]): FolderLookup<T> {
  const byId = new Map<string, T>();
  for (const folder of folders) {
    byId.set(folder.id, folder);
  }
  return (id) => byId.get(id);
}

/**
 * The folders from the top level down to `folderId` (itself last). Empty when the folder does not exist. A missing
 * parent cuts the chain above it; a parent loop leaves the folder alone at the top level.
 */
export function folderChain<T extends FolderNodeLike>(folderId: string | null | undefined, lookup: FolderLookup<T>): T[] {
  if (!folderId) {
    return [];
  }
  const self = lookup(folderId);
  if (!self) {
    return [];
  }
  const chain: T[] = [self];
  const seen = new Set<string>([self.id]);
  let parentId = self.parentId ?? null;
  while (parentId) {
    if (seen.has(parentId)) {
      // A loop: no honest path exists, so the folder is shown at the top level.
      return [self];
    }
    const parent = lookup(parentId);
    if (!parent) {
      break;
    }
    seen.add(parent.id);
    chain.unshift(parent);
    parentId = parent.parentId ?? null;
  }
  return chain;
}

/** The folder one level up from `folderId`: its parent, or `null` for the top level (the Files tab). */
export function parentFolderId(folderId: string | null | undefined, lookup: FolderLookup): string | null {
  const chain = folderChain(folderId, lookup);
  return chain.length >= 2 ? chain[chain.length - 2]!.id : null;
}

/**
 * Where a screen showing a folder goes when that folder is gone: the nearest folder of the path it last showed that
 * still exists (deepest first), or `null` for the top level. `lastKnownChain` is that path's ids, top level first.
 */
export function nearestExistingFolder(lastKnownChain: readonly string[], exists: (id: string) => boolean): string | null {
  for (let index = lastKnownChain.length - 1; index >= 0; index -= 1) {
    const id = lastKnownChain[index]!;
    if (exists(id)) {
      return id;
    }
  }
  return null;
}

/** The ids of `folderId` and every folder under it (loop-safe), `folderId` first. */
export function folderSubtreeIds(folderId: string, folders: readonly FolderNodeLike[]): string[] {
  const children = new Map<string, string[]>();
  for (const folder of folders) {
    const parentId = folder.parentId ?? null;
    if (parentId) {
      const list = children.get(parentId) ?? [];
      list.push(folder.id);
      children.set(parentId, list);
    }
  }
  const out: string[] = [];
  const seen = new Set<string>();
  const stack = [folderId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
    for (const child of children.get(id) ?? []) {
      stack.push(child);
    }
  }
  return out;
}

/**
 * Whether `folder` belongs at the top level: no parent, a parent that does not exist, or a parent loop (so no folder
 * ever disappears from the tree).
 */
export function isTopLevelFolder<T extends FolderNodeLike>(folder: T, lookup: FolderLookup<T>): boolean {
  const chain = folderChain(folder.id, lookup);
  return chain.length <= 1;
}
