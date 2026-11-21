import { Directory } from 'expo-file-system';
import { getVidoraMedia, isVidoraMediaAvailable } from '@modules/vidorax-media';
import type { FolderImportSummary } from '@modules/vidorax-media/src/VidoraMedia.types';

import { getSaveLocationSettings } from '@/downloads/v2/save-location-store';
import { withExpectedSystemScreen } from '@/security/app-lock/expected-system-screen';

/**
 * #512 Save to cloud and #507 Cloud folder, through the user's own cloud apps (Android's file screens): VidoraX has
 * no cloud account or server of its own. Null pieces on builds without the native functions; the actions then stay
 * hidden.
 */

function media() {
  return isVidoraMediaAvailable() ? getVidoraMedia() : null;
}

export function canSaveCopyAs(): boolean {
  return typeof media()?.saveCopyAs === 'function';
}

export function canImportFromFolder(): boolean {
  return typeof media()?.importFromFolder === 'function';
}

export type SaveCopyResult = { status: 'saved'; name: string } | { status: 'cancelled' } | { status: 'failed' };

/** Opens Android's save screen for library item [id] and writes the file where the user picks. */
export async function saveCopyAs(id: string): Promise<SaveCopyResult> {
  const native = media();
  if (!native?.saveCopyAs) return { status: 'failed' };
  try {
    const result = await withExpectedSystemScreen(() => native.saveCopyAs!(id));
    return result.status === 'saved' ? { status: 'saved', name: result.name } : { status: 'cancelled' };
  } catch {
    return { status: 'failed' };
  }
}

export function saveCopyProgress(id: string): number | null {
  try {
    const progress = media()?.getSaveCopyProgress?.(id);
    return progress && progress.totalBytes > 0 ? progress.bytesDone / progress.totalBytes : null;
  } catch {
    return null;
  }
}

export type FolderImportResult = ({ status: 'done' } & FolderImportSummary) | { status: 'cancelled' } | { status: 'failed' };

/** Lets the user pick a folder (a cloud app's, or the phone's), then copies its videos into the library. */
export async function importVideosFromFolder(): Promise<FolderImportResult> {
  const native = media();
  if (!native?.importFromFolder) return { status: 'failed' };
  let treeUri: string;
  try {
    const picked = await withExpectedSystemScreen(() => Directory.pickDirectoryAsync());
    if (!picked?.uri) return { status: 'cancelled' };
    treeUri = picked.uri;
  } catch {
    return { status: 'cancelled' };
  }
  try {
    const summary = await native.importFromFolder(treeUri);
    return { status: 'done', ...summary };
  } catch {
    return { status: 'failed' };
  } finally {
    // The folder was needed for this import only: its grant is given back — unless Save location copies there.
    if (getSaveLocationSettings().treeUri !== treeUri) void native.releaseFolderAccess?.(treeUri)?.catch?.(() => undefined);
  }
}

export function folderImportProgress() {
  try {
    return media()?.getFolderImportProgress?.() ?? null;
  } catch {
    return null;
  }
}

export function cancelFolderImport(): void {
  try {
    media()?.cancelFolderImport?.();
  } catch {
    // nothing running
  }
}
