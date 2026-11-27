/**
 * Files F4: the selection bar's actions, and which of them work on what is selected. Pure.
 *
 * - Move to folder: files only (moving a folder under another one waits for F12's nesting).
 * - Share: several files in one share sheet; hidden while a folder is selected, off while a selected file is missing.
 * - Delete: the selected files (folders are not deleted from here); it moves them to the bin once F8 lands.
 * - Add to playlist: only when every selected item can play (videos and audio files, no folder).
 * - Move to Private: files that can move, and only when every selected item can.
 * - More ⋮: shown when a later package puts something in it (F5 Rename, F7 Tag, Color and Hide).
 */

import type { FileType } from './file-types';

export const BATCH_ACTIONS = ['move', 'share', 'delete', 'add-to-playlist', 'move-to-private', 'more'] as const;
export type BatchAction = (typeof BATCH_ACTIONS)[number];

export type BatchItem =
  | { kind: 'folder'; id: string }
  | { kind: 'file'; id: string; type: FileType; missing?: boolean; canMoveToPrivate?: boolean };

export type BatchActionState = { visible: boolean; enabled: boolean };

/**
 * `nestedFolders` is the F12 contract's `filesCapabilities.nestedFolders`: while it is false, a selection with a folder
 * can't be moved (moving a folder is hidden); once true, Move moves the folders too.
 */
export function batchActionsFor(
  items: readonly BatchItem[],
  options: { moreItems: number; nestedFolders?: boolean },
): Record<BatchAction, BatchActionState> {
  const files = items.filter((item): item is Extract<BatchItem, { kind: 'file' }> => item.kind === 'file');
  const anyFolder = files.length < items.length;
  const anyMissing = files.some((file) => file.missing === true);
  const hasItems = items.length > 0;
  const allPlayable = hasItems && !anyFolder && files.every((file) => !file.missing && (file.type === 'video' || file.type === 'audio'));
  const allLockable = hasItems && !anyFolder && files.every((file) => !file.missing && file.canMoveToPrivate === true);
  return {
    // F12: with a folder selected, Move (that is, "Move folder") is hidden until nested folders are live.
    move: { visible: !anyFolder || options.nestedFolders === true, enabled: hasItems && (!anyFolder || options.nestedFolders === true) },
    share: { visible: !anyFolder, enabled: files.length > 0 && !anyFolder && !anyMissing },
    delete: { visible: true, enabled: files.length > 0 },
    'add-to-playlist': { visible: true, enabled: allPlayable },
    'move-to-private': { visible: true, enabled: allLockable },
    more: { visible: options.moreItems > 0, enabled: hasItems && options.moreItems > 0 },
  };
}
