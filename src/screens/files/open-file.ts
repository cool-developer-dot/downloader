/**
 * Files F1: opens a tapped file the way `openTargetOf` says (Player, PDF viewer, details, or Android's Open with).
 * Every handoff reuses the existing flows: `openPlayer`, the B17 PDF viewer, Download details (P8's malware warning)
 * and the completed-file Open with (which shows P8's warning first when a file isn't what its name says).
 */

import { Directory, File, Paths } from 'expo-file-system';

import type { FileEntry } from '@/files/ui/files-index';
import { downloadDetailsPath, navigation, openPlayer, routePaths } from '@/navigation';

import { openTargetOf } from './utils/open-target';

export type OpenFileResult = 'opened' | 'cancelled' | 'no-app' | 'failed';

/** The B17 viewer reads PDFs only from this cache folder (`PdfFiles.DIR`), and deletes them when it closes. */
const PDF_CACHE_DIR = 'pdf';

function plainPath(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//, ''));
}

async function openPdf(file: FileEntry): Promise<OpenFileResult> {
  const { resolveCompletedMedia } = await import('@/downloads/completed-file/action-service');
  const media = await resolveCompletedMedia(file.id);
  const dir = new Directory(Paths.cache, PDF_CACHE_DIR);
  dir.create({ idempotent: true, intermediates: true });
  const copy = new File(dir, `files-${file.id.replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`);
  if (copy.exists) {
    copy.delete();
  }
  await new File(media.finalPath).copy(copy);
  const title = (file.name || file.title).slice(0, 120);
  navigation.push(`${routePaths.pdfViewer}?path=${encodeURIComponent(plainPath(copy.uri))}&title=${encodeURIComponent(title)}`);
  return 'opened';
}

async function openWithAndroid(file: FileEntry): Promise<OpenFileResult> {
  const { openCompletedFile } = await import('@/downloads/completed-file/action-service');
  const result = await openCompletedFile(file.id);
  if (result.ok) {
    return result.kind === 'cancelled' ? 'cancelled' : 'opened';
  }
  return result.error.code === 'NO_COMPATIBLE_APP' ? 'no-app' : 'failed';
}

/** Opens `file`; `playable` is the list it was picked from (the Player's ⏮ / ⏭ step through its videos). */
export async function openFileEntry(file: FileEntry, playable: readonly string[]): Promise<OpenFileResult> {
  try {
    switch (openTargetOf(file)) {
      case 'player':
        openPlayer(file.id, playable.includes(file.id) ? playable : [file.id]);
        return 'opened';
      case 'pdf':
        return await openPdf(file);
      case 'apk-details':
        // File details (F3) once it lands; Download details shows P8's malware warning today. Never an install button.
        navigation.push(downloadDetailsPath(file.id));
        return 'opened';
      case 'archive':
      case 'open-with':
      default:
        return await openWithAndroid(file);
    }
  } catch {
    return 'failed';
  }
}

/** The file's details page (Download details until F3's File details lands). */
export function openFileDetails(fileId: string): void {
  navigation.push(downloadDetailsPath(fileId));
}
