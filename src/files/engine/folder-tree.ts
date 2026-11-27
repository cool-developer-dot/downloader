/**
 * F12: the folder tree of the VidoraX library (folders live in the app database's `media_folders`, nested by
 * `parent_id` since DB v11). Pure helpers: paths, children, descendants and the move rules.
 */
export type FolderNode = {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Root is level 0; a folder at the root is level 1. Deeper than this is refused. */
export const MAX_FOLDER_DEPTH = 8;

export type FolderIndex = ReadonlyMap<string, FolderNode>;

export function indexFolders(folders: readonly FolderNode[]): Map<string, FolderNode> {
  const map = new Map<string, FolderNode>();
  for (const folder of folders) {
    map.set(folder.id, folder);
  }
  return map;
}

/**
 * The parent to use for a folder: its own parent when that parent exists, otherwise the root. A broken chain (parent
 * deleted, or a loop) never hides a folder — it shows at the root.
 */
export function effectiveParentId(folder: FolderNode, index: FolderIndex): string | null {
  const parentId = folder.parentId;
  if (parentId == null || !index.has(parentId) || parentId === folder.id) {
    return null;
  }
  // Loop guard: walk up; reaching the folder again means the chain is broken.
  const seen = new Set<string>([folder.id]);
  let current: string | null = parentId;
  while (current != null) {
    if (seen.has(current)) {
      return null;
    }
    seen.add(current);
    const next = index.get(current);
    if (!next) {
      return null;
    }
    current = next.parentId != null && index.has(next.parentId) ? next.parentId : null;
  }
  return parentId;
}

/** Root first, ending with the folder itself; [] when the folder is unknown. */
export function folderPathOf(folderId: string, index: FolderIndex): FolderNode[] {
  const path: FolderNode[] = [];
  const seen = new Set<string>();
  let current = index.get(folderId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    const parentId = effectiveParentId(current, index);
    current = parentId != null ? index.get(parentId) : undefined;
  }
  return path;
}

export function childFolders(parentId: string | null, folders: readonly FolderNode[], index: FolderIndex): FolderNode[] {
  return folders.filter((folder) => effectiveParentId(folder, index) === parentId);
}

/** Every folder under `folderId` (not the folder itself). */
export function descendantIds(folderId: string, folders: readonly FolderNode[], index: FolderIndex): Set<string> {
  const byParent = new Map<string | null, string[]>();
  for (const folder of folders) {
    const parent = effectiveParentId(folder, index);
    const list = byParent.get(parent) ?? [];
    list.push(folder.id);
    byParent.set(parent, list);
  }
  const out = new Set<string>();
  const stack = [...(byParent.get(folderId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (out.has(id) || id === folderId) {
      continue;
    }
    out.add(id);
    stack.push(...(byParent.get(id) ?? []));
  }
  return out;
}

/** How many levels a folder and its deepest descendant take (a folder with no children = 1). */
function subtreeHeight(folderId: string, folders: readonly FolderNode[], index: FolderIndex): number {
  let best = 1;
  for (const id of descendantIds(folderId, folders, index)) {
    const depthBelow = folderPathOf(id, index).length - folderPathOf(folderId, index).length + 1;
    best = Math.max(best, depthBelow);
  }
  return best;
}

export type MoveProblem = 'NOT_FOUND' | 'CYCLE' | 'TOO_DEEP';

/** Why `folderId` can't move under `newParentId` (null = the root), or null when it can. */
export function moveProblem(
  folderId: string,
  newParentId: string | null,
  folders: readonly FolderNode[],
  index: FolderIndex,
): MoveProblem | null {
  if (!index.has(folderId) || (newParentId != null && !index.has(newParentId))) {
    return 'NOT_FOUND';
  }
  if (newParentId === folderId || (newParentId != null && descendantIds(folderId, folders, index).has(newParentId))) {
    return 'CYCLE';
  }
  const parentDepth = newParentId == null ? 0 : folderPathOf(newParentId, index).length;
  if (parentDepth + subtreeHeight(folderId, folders, index) > MAX_FOLDER_DEPTH) {
    return 'TOO_DEEP';
  }
  return null;
}

/** Whether a new folder may be made under `parentId`. */
export function canCreateUnder(parentId: string | null, index: FolderIndex): 'NOT_FOUND' | 'TOO_DEEP' | null {
  if (parentId == null) {
    return null;
  }
  if (!index.has(parentId)) {
    return 'NOT_FOUND';
  }
  return folderPathOf(parentId, index).length + 1 > MAX_FOLDER_DEPTH ? 'TOO_DEEP' : null;
}
