/**
 * Files F1 · #742 Back, #743 Up one level: the folder screen's breadcrumb ("Files › Movies › 2026"), its "Up to
 * {parent}" row and where Back goes. Pure, and written against parent ids only, so it already walks nested folders.
 */

import { folderChain, parentFolderId, type FolderLookup, type FolderNodeLike } from '@/files/ui/folder-tree';

export type Crumb = {
  /** The folder's id; `null` for the first crumb, the Files tab. */
  id: string | null;
  label: string;
  /** The last crumb: the folder on screen (not tappable). */
  current: boolean;
};

/**
 * The crumbs from the Files tab down to `folderId`. A folder that doesn't exist gives the Files crumb alone; a missing
 * parent or a parent loop ends the path at the top level (`folderChain`).
 */
export function buildBreadcrumbs(folderId: string | null | undefined, lookup: FolderLookup, rootLabel: string): Crumb[] {
  const chain = folderChain(folderId, lookup);
  const crumbs: Crumb[] = [{ id: null, label: rootLabel, current: chain.length === 0 }];
  chain.forEach((folder, index) => {
    crumbs.push({ id: folder.id, label: folder.name, current: index === chain.length - 1 });
  });
  return crumbs;
}

/** The "Up to {parent}" row's folder: the parent of a nested folder; `null` for a top-level one (no row then). */
export function upTarget<T extends FolderNodeLike>(folderId: string | null | undefined, lookup: FolderLookup<T>): T | null {
  const chain = folderChain(folderId, lookup);
  return chain.length >= 2 ? chain[chain.length - 2]! : null;
}

/** Where header back and Android back go from `folderId`: its parent, or `null` for the Files tab. */
export function backTarget(folderId: string | null | undefined, lookup: FolderLookup): string | null {
  return parentFolderId(folderId, lookup);
}

/** The path read by TalkBack: "Files, Movies, 2026". */
export function breadcrumbSpeech(crumbs: readonly Crumb[]): string {
  return crumbs.map((crumb) => crumb.label).join(', ');
}
