/**
 * Files F1: what tapping a file does. Pure.
 *
 * - video or audio: the Player;
 * - a PDF: the in-app viewer (`/pdf-viewer`);
 * - a ZIP: the archive import — but that screen only takes a token Android hands VidoraX for a file another app
 *   opened, and nothing turns a library file into one yet, so a ZIP goes to Android's Open with until Faran's native
 *   side can (see `ZIP_OPENS_WITH_ANDROID`);
 * - an APK: its details page with the malware warning (File details once F3 lands; Download details today). There is
 *   never an install button: installing needs REQUEST_INSTALL_PACKAGES, a new permission;
 * - images and every other file: Android's Open with.
 */

import { isPdfFile, isZipFile } from '@/files/ui/file-types';
import type { FileEntry } from '@/files/ui/files-index';

export type OpenTarget = 'player' | 'pdf' | 'archive' | 'apk-details' | 'open-with';

/** The archive import can't open a library file yet (no token for it), so a ZIP is opened with another app. */
export const ZIP_OPENS_WITH_ANDROID = true;

export function openTargetOf(file: Pick<FileEntry, 'type' | 'mimeType' | 'name'>): OpenTarget {
  const named = { mimeType: file.mimeType, fileName: file.name };
  switch (file.type) {
    case 'video':
    case 'audio':
      return 'player';
    case 'apk':
      return 'apk-details';
    case 'doc':
      return isPdfFile(named) ? 'pdf' : 'open-with';
    case 'archive':
      return isZipFile(named) && !ZIP_OPENS_WITH_ANDROID ? 'archive' : 'open-with';
    default:
      return 'open-with';
  }
}

/** The ids the Player steps through from a list: its playable files, in the order shown. */
export function playableQueue(files: readonly Pick<FileEntry, 'id' | 'type'>[]): string[] {
  return files.filter((file) => file.type === 'video' || file.type === 'audio').map((file) => file.id);
}
