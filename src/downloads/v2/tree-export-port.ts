import { getVidoraMedia, isVidoraMediaAvailable } from '@modules/vidorax-media';
import type { FolderCopy } from '@modules/vidorax-media/src/VidoraMedia.types';

/**
 * The native side of Save Location (#297) and Show in Folder (#398): the `VidoraMedia` functions backed by
 * library/TreeExport.kt. Null on builds without them, and the feature then stays hidden.
 */
export type TreeExportPort = {
  copyToFolder(id: string, treeUri: string, subfolders: string[]): Promise<FolderCopy>;
  getFolderCopyProgress(id: string): { bytesDone: number; totalBytes: number } | null;
  hasFolderAccess(treeUri: string): Promise<boolean>;
  releaseFolderAccess(treeUri: string): Promise<void>;
  getFolderName(treeUri: string): Promise<string | null>;
  openFolder(folderUri: string): Promise<boolean>;
};

let override: TreeExportPort | null | undefined;

export function getTreeExportPort(): TreeExportPort | null {
  if (override !== undefined) {
    return override;
  }
  if (!isVidoraMediaAvailable()) {
    return null;
  }
  const media = getVidoraMedia();
  if (
    typeof media.copyToFolder !== 'function' ||
    typeof media.getFolderCopyProgress !== 'function' ||
    typeof media.hasFolderAccess !== 'function' ||
    typeof media.releaseFolderAccess !== 'function' ||
    typeof media.getFolderName !== 'function' ||
    typeof media.openFolder !== 'function'
  ) {
    return null;
  }
  return media as unknown as TreeExportPort;
}

/** `undefined` restores the real module. */
export function setTreeExportPortForTests(port: TreeExportPort | null | undefined): void {
  override = port;
}

/**
 * Opens the Android folder picker (Storage Access Framework). The chosen folder's read/write grant is persisted by
 * expo-file-system when it is picked. Resolves with the folder's tree URI, or null when the user backed out.
 */
export async function pickTreeFolder(): Promise<string | null> {
  try {
    const { Directory } = await import('expo-file-system');
    const directory = await Directory.pickDirectoryAsync();
    // expo-file-system adds a trailing slash to a directory's URI; the grant is held for the URI without it.
    const uri = typeof directory?.uri === 'string' ? directory.uri.replace(/\/+$/, '') : '';
    return uri.startsWith('content://') ? uri : null;
  } catch {
    // Cancelled, or no picker on this device.
    return null;
  }
}
