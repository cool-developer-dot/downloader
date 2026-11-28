/**
 * Files F3 · design 45: the rows of a file's ⋮ sheet, in the design's order, and which of them apply. Pure.
 *
 * Rows that can't apply are hidden: Play on anything but a video or an audio file; Open with on an APK (Android
 * would hand it to the package installer, and VidoraX never installs: that needs REQUEST_INSTALL_PACKAGES); Lock
 * file, Save to… and Verify checksum when this build or this file can't do them; and, for a file that is missing on
 * the phone, everything but Details and Delete.
 */

import type { FileType } from '@/files/ui/file-types';

export const FILE_ACTIONS = [
  'play',
  'details',
  'show-in-folder',
  'share',
  'send-to-device',
  'save-to',
  'lock',
  'checksum',
  'open-with',
  'rename',
  'delete',
] as const;

export type FileAction = (typeof FILE_ACTIONS)[number];

export type FileActionContext = {
  type: FileType;
  /** The file is no longer on the phone. */
  missing: boolean;
  /** Move to Private works for it (a native-engine library item, and the vault exists). */
  canLock: boolean;
  /** The folder picker and `copyToFolder` exist on this build. */
  canSaveTo: boolean;
  /** `computeChecksum` exists on this build. */
  canChecksum: boolean;
  /**
   * A file the browser handed to Android's DownloadManager (a picture, a document, an archive…), not a library item:
   * it plays or opens, shares and deletes; the library-only rows (Details, Show in folder, Save to…, Lock, checksum,
   * Rename) don't apply.
   */
  systemDownload?: boolean;
};

const SYSTEM_DOWNLOAD_ACTIONS: readonly FileAction[] = ['play', 'share', 'send-to-device', 'open-with', 'delete'];

function applies(action: FileAction, context: FileActionContext): boolean {
  if (context.systemDownload && !SYSTEM_DOWNLOAD_ACTIONS.includes(action)) {
    return false;
  }
  switch (action) {
    case 'play':
      return context.type === 'video' || context.type === 'audio';
    case 'open-with':
      return context.type !== 'apk';
    case 'lock':
      return context.canLock;
    case 'save-to':
      return context.canSaveTo;
    case 'checksum':
      return context.canChecksum;
    default:
      return true;
  }
}

/** The sheet's rows for one file, in the design's order. */
export function fileActionsFor(context: FileActionContext): FileAction[] {
  if (context.missing) {
    return ['details', 'delete'];
  }
  return FILE_ACTIONS.filter((action) => applies(action, context));
}
