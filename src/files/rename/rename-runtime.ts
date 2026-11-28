/**
 * Files F5: renaming one file, the same way as Download details and design 45's Rename — a native-engine library item
 * by its title (the app's own file keeps a stable name on the phone; Files shows the title with the extension), an
 * older (legacy) row by its file name.
 */

import { renameMediaFileOnDevice } from '@/downloads/engine';
import { getV2Engine, isEngineOwned, renameEngineLibraryItem } from '@/downloads/v2';
import { useDownloadsStore } from '@/store/downloads';

import { splitExtension } from './batch-rename';

export async function renameFileTo(id: string, newName: string): Promise<void> {
  if (isEngineOwned(useDownloadsStore.getState(), id)) {
    await renameEngineLibraryItem(getV2Engine(), id, splitExtension(newName)[0]);
    return;
  }
  await renameMediaFileOnDevice(id, newName);
  useDownloadsStore.getState().patchItem(id, { fileName: newName, title: newName });
}

/**
 * Replace in a clash: the file already there goes through F8's door into the Recycle bin, with Undo. The clash
 * dialog's Replace is the confirm, so F2's Confirm before delete doesn't ask a second time.
 */
export async function deleteForReplace(id: string): Promise<boolean> {
  const { runDelete } = await import('@/files/trash/useDeleteWithUndo');
  const result = await runDelete({ ids: [id], source: 'files' }).catch(() => ({ trashed: [] as string[], deleted: [] as string[] }));
  return result.trashed.includes(id) || result.deleted.includes(id);
}
