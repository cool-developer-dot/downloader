/**
 * Files F1 · #753 Categories, #779 File type icons: what a VidoraX file is. Pure.
 *
 * Faran's F12 contract names `fileTypeOf()` and `FileType`; until `src/files/api.ts` merges, `files-source.ts` exports
 * this one. The MIME type decides when it is specific; a missing or generic type (`application/octet-stream`) falls
 * back to the name's extension, and anything still unknown is `other` (the plain file icon).
 */

export const FILE_TYPES = ['video', 'audio', 'image', 'doc', 'archive', 'apk', 'other'] as const;

export type FileType = (typeof FILE_TYPES)[number];

export function isFileType(value: unknown): value is FileType {
  return typeof value === 'string' && (FILE_TYPES as readonly string[]).includes(value);
}

const VIDEO_EXTENSIONS = new Set([
  'mp4', 'm4v', 'mkv', 'webm', 'mov', 'avi', 'wmv', 'flv', 'f4v', 'ts', 'm2ts', 'mts', '3gp', '3g2', 'mpg', 'mpeg',
  'vob', 'ogv', 'divx',
]);
const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'flac', 'wma', 'amr', 'mka']);
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'avif', 'svg', 'tif', 'tiff']);
const DOC_EXTENSIONS = new Set([
  'pdf', 'txt', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf', 'csv', 'epub', 'md',
  'srt', 'vtt', 'ass', 'ssa',
]);
const ARCHIVE_EXTENSIONS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz']);
const APK_EXTENSIONS = new Set(['apk', 'apks', 'xapk']);

const VIDEO_MIME_TYPES = new Set(['application/mp2t', 'application/x-mpegurl', 'application/vnd.apple.mpegurl']);
const DOC_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/rtf',
  'application/epub+zip',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
]);
const ARCHIVE_MIME_TYPES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/vnd.rar',
  'application/x-rar-compressed',
  'application/x-rar',
  'application/x-7z-compressed',
  'application/x-tar',
  'application/gzip',
  'application/x-gzip',
  'application/x-bzip2',
  'application/x-xz',
]);
const APK_MIME_TYPES = new Set(['application/vnd.android.package-archive']);

/**
 * The extension of a file name, lower case, without the dot; '' when there is none. A name that is only an extension
 * (`.mp4`) or ends with a dot has none.
 */
export function fileExtension(name: string | null | undefined): string {
  const value = (name ?? '').trim();
  const dot = value.lastIndexOf('.');
  if (dot <= 0 || dot === value.length - 1) {
    return '';
  }
  return value.slice(dot + 1).toLowerCase();
}

function typeFromMime(mime: string): FileType | null {
  if (!mime || mime === 'application/octet-stream' || mime === 'binary/octet-stream') {
    return null;
  }
  if (APK_MIME_TYPES.has(mime)) {
    return 'apk';
  }
  if (mime.startsWith('video/') || VIDEO_MIME_TYPES.has(mime)) {
    return 'video';
  }
  if (mime.startsWith('audio/')) {
    return 'audio';
  }
  if (mime.startsWith('image/')) {
    return 'image';
  }
  if (ARCHIVE_MIME_TYPES.has(mime)) {
    return 'archive';
  }
  if (
    DOC_MIME_TYPES.has(mime) ||
    mime.startsWith('text/') ||
    mime.startsWith('application/vnd.openxmlformats-officedocument.') ||
    mime.startsWith('application/vnd.oasis.opendocument.')
  ) {
    return 'doc';
  }
  return null;
}

function typeFromExtension(extension: string): FileType {
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (DOC_EXTENSIONS.has(extension)) return 'doc';
  if (ARCHIVE_EXTENSIONS.has(extension)) return 'archive';
  if (APK_EXTENSIONS.has(extension)) return 'apk';
  return 'other';
}

/** The file's type from its MIME type, else its name's extension; `other` when neither says. */
export function fileTypeOf(file: { mimeType?: string | null; fileName?: string | null }): FileType {
  const mime = (file.mimeType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return typeFromMime(mime) ?? typeFromExtension(fileExtension(file.fileName));
}

/** True for a PDF (the in-app viewer opens it). */
export function isPdfFile(file: { mimeType?: string | null; fileName?: string | null }): boolean {
  const mime = (file.mimeType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return mime === 'application/pdf' || fileExtension(file.fileName) === 'pdf';
}

/** True for a ZIP (the only archive the archive import reads). */
export function isZipFile(file: { mimeType?: string | null; fileName?: string | null }): boolean {
  const mime = (file.mimeType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return mime === 'application/zip' || mime === 'application/x-zip-compressed' || fileExtension(file.fileName) === 'zip';
}
