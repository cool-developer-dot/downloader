/**
 * F12 (#835 MIME type): what kind of file a library item is, from its MIME type and, when that is empty or generic,
 * its extension. Pure: the Files tab's type tiles, icons, filters and the Storage page all read it.
 */
export type FileType = 'video' | 'audio' | 'image' | 'doc' | 'archive' | 'apk' | 'other';

export const FILE_TYPES: readonly FileType[] = ['video', 'audio', 'image', 'doc', 'archive', 'apk', 'other'];

const APK_MIME = 'application/vnd.android.package-archive';

/** MIME types that say nothing about the content: decide by extension instead. */
const GENERIC_MIMES = new Set(['', 'application/octet-stream', 'binary/octet-stream', 'application/unknown', 'application/download', 'application/force-download']);

const DOC_MIMES = new Set([
  'application/pdf',
  'application/epub+zip',
  'application/rtf',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/json',
  'application/xml',
]);

const ARCHIVE_MIMES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/x-rar-compressed',
  'application/vnd.rar',
  'application/x-7z-compressed',
  'application/x-tar',
  'application/gzip',
  'application/x-gzip',
  'application/x-bzip2',
  'application/x-xz',
]);

const EXTENSIONS: Record<string, FileType> = {
  mp4: 'video', m4v: 'video', mkv: 'video', webm: 'video', mov: 'video', avi: 'video', flv: 'video', ts: 'video',
  m2ts: 'video', mts: 'video', '3gp': 'video', wmv: 'video', mpg: 'video', mpeg: 'video', ogv: 'video', m3u8: 'video',
  mp3: 'audio', m4a: 'audio', aac: 'audio', wav: 'audio', flac: 'audio', ogg: 'audio', oga: 'audio', opus: 'audio',
  wma: 'audio', amr: 'audio', mka: 'audio',
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', heic: 'image', heif: 'image', bmp: 'image',
  avif: 'image', svg: 'image',
  pdf: 'doc', epub: 'doc', txt: 'doc', md: 'doc', rtf: 'doc', doc: 'doc', docx: 'doc', xls: 'doc', xlsx: 'doc',
  csv: 'doc', ppt: 'doc', pptx: 'doc', odt: 'doc', ods: 'doc', odp: 'doc', json: 'doc', xml: 'doc', html: 'doc',
  htm: 'doc', srt: 'doc', vtt: 'doc',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive', tgz: 'archive', bz2: 'archive',
  xz: 'archive',
  apk: 'apk', apks: 'apk', xapk: 'apk',
};

/** The lower-case extension without the dot ("" when there is none; a name that is only ".mp4" has none). */
export function extensionOf(fileName: string): string {
  const name = fileName.trim();
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) {
    return '';
  }
  return name.slice(dot + 1).toLowerCase();
}

function fromMime(mime: string): FileType | null {
  if (GENERIC_MIMES.has(mime)) {
    return null;
  }
  if (mime === APK_MIME) {
    return 'apk';
  }
  if (mime.startsWith('video/') || mime === 'application/x-mpegurl' || mime === 'application/vnd.apple.mpegurl' || mime === 'application/dash+xml') {
    return 'video';
  }
  if (mime.startsWith('audio/')) {
    return 'audio';
  }
  if (mime.startsWith('image/')) {
    return 'image';
  }
  if (mime.startsWith('text/') || DOC_MIMES.has(mime) || mime.startsWith('application/vnd.openxmlformats-officedocument.')) {
    return 'doc';
  }
  if (ARCHIVE_MIMES.has(mime)) {
    return 'archive';
  }
  return null;
}

export function fileTypeOf(mime: string | null | undefined, fileName: string): FileType {
  const cleanMime = (mime ?? '').split(';')[0]!.trim().toLowerCase();
  return fromMime(cleanMime) ?? EXTENSIONS[extensionOf(fileName)] ?? 'other';
}
