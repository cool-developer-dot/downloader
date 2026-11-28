/**
 * Files: since Faran's 871c1f8e, the Files lists also hold the files the browser handed to Android's DownloadManager
 * (`sysdl:` ids: pictures, documents, archives, apps, audio). They live in Android's Downloads, not in VidoraX, so
 * what needs VidoraX's own file (rename, checksum, a VidoraX folder, a playlist, one share sheet) leaves them out.
 */
import { isSystemDownloadId } from '@/files/system-downloads/system-downloads-model';

export { isSystemDownloadId };

/** VidoraX's own files, in order: the files the browser handed to Android left out. */
export function libraryFilesOnly<T extends { id: string }>(files: readonly T[]): T[] {
  return files.filter((file) => !isSystemDownloadId(file.id));
}
