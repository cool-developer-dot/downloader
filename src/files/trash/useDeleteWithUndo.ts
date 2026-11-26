/**
 * Files F8 · #804 Undo: one door for every delete — Files, the Player tab, Downloads and batch. It keeps F2's Confirm
 * before delete (the dialog is `DeleteUndoHost`'s), sends the files through F13's `deleteItems` (today the stand-in
 * `trash-port`), and shows "{n} moved to Recycle bin · Undo" for 6 seconds. With the bin off, the dialog says
 * "forever" and the bar has no Undo. Private files never come here: deleting from Private stays permanent.
 */

import { useCallback } from 'react';

import { filesCapabilities } from '@/files/api';
import { isConfirmBeforeDeleteOn } from '@/files/ui/files-view-settings';
import { deleteItems, getBinSettings, restoreFromBin } from '@/files/ui/trash-port';
import { createUndoSnackbar } from '@/files/ui/undo-snackbar';
import { createStore } from '@/store/shared/create-store';

export type DeleteSource = Parameters<typeof deleteItems>[1]['source'];
export type DeleteResult = Awaited<ReturnType<typeof deleteItems>>;

export type DeleteRequest = {
  ids: readonly string[];
  source: DeleteSource;
  /** The file's name, for "Delete “clip.mp4” forever?" when one file goes. */
  name?: string;
  /** After the delete (also when nothing could be deleted). */
  onDone?: (result: DeleteResult) => void;
};

/** The bar after a delete (one per batch; a newer delete replaces it). */
export const deleteUndoSnackbar = createUndoSnackbar();

/** The delete waiting for its Confirm before delete answer (`DeleteUndoHost` shows the dialog). */
export const useDeleteConfirmStore = createStore<{ pending: DeleteRequest | null; busy: boolean }>()(() => ({
  pending: null,
  busy: false,
}));

/** Whether a delete goes to the bin now: F13 is live and the bin is switched on. */
export function binIsOn(): boolean {
  return filesCapabilities.recycleBin && getBinSettings().enabled;
}

/** Deletes now (no dialog) and shows the bar. */
export async function runDelete(request: DeleteRequest): Promise<DeleteResult> {
  const ids = [...new Set(request.ids)];
  let result: DeleteResult = { trashed: [], deleted: [] };
  try {
    result = await deleteItems(ids, { source: request.source });
  } catch {
    // Shown below as "couldn't be deleted".
  }
  deleteUndoSnackbar.show(result, ids.length);
  request.onDone?.(result);
  return result;
}

/** Undo for the bar's batch: brings its files back from the bin (to the same folder). Returns how many. */
export async function undoDelete(batchId: number): Promise<number> {
  const ids = deleteUndoSnackbar.take(batchId);
  if (!ids || ids.length === 0) {
    return 0;
  }
  await restoreFromBin(ids);
  return ids.length;
}

/** Asks first when Confirm before delete is on; otherwise deletes at once. */
export function requestDelete(request: DeleteRequest): void {
  if (request.ids.length === 0) {
    return;
  }
  if (isConfirmBeforeDeleteOn()) {
    useDeleteConfirmStore.setState({ pending: request, busy: false });
    return;
  }
  void runDelete(request);
}

export function useDeleteWithUndo() {
  const request = useCallback((ids: readonly string[], options: Omit<DeleteRequest, 'ids'>) => {
    requestDelete({ ids, ...options });
  }, []);
  return { requestDelete: request };
}
