/**
 * The short format label a library row shows ("MP4", "MOV", "WebM"), from the MIME type the native library
 * records for the file. That type follows the container proven from the file's own bytes, so a QuickTime file is
 * `video/quicktime` and must read "MOV" — not fall back to nothing, and never to "MP4".
 */
const LABEL_BY_MIME: Record<string, string> = {
  'video/mp4': 'MP4',
  'video/x-m4v': 'MP4',
  'video/webm': 'WebM',
  'audio/webm': 'WebM',
  'video/mp2t': 'TS',
  'video/mp2ts': 'TS',
  'application/mp2t': 'TS',
  'video/quicktime': 'MOV',
  'video/x-msvideo': 'AVI',
  'video/avi': 'AVI',
  'video/msvideo': 'AVI',
  'video/x-ms-wmv': 'WMV',
  'video/x-matroska': 'MKV',
  'video/matroska': 'MKV',
  'video/3gpp': '3GP',
  'video/x-flv': 'FLV',
  'audio/mp4': 'M4A',
  'audio/x-m4a': 'M4A',
};

/** Null for an unknown or missing type: better no label than a wrong one. Parameters and case are ignored. */
export function libraryFormatLabel(mimeType: string | null | undefined): string | null {
  if (!mimeType) {
    return null;
  }
  const key = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  return LABEL_BY_MIME[key] ?? null;
}
