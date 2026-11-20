/**
 * Dangerous File Warning (#157): a non-video WebView download is checked before it is handed to Android's
 * DownloadManager. A file that installs an app or runs a program — by its name's extension or its MIME type — needs
 * the user's confirmation first. Videos (anything the native classifier or the MIME type calls a video or a
 * streaming manifest) are never checked. Pure: no React Native, no I/O.
 */

export const DANGEROUS_EXTENSIONS: readonly string[] = [
  'apk',
  'apks',
  'xapk',
  'exe',
  'msi',
  'bat',
  'cmd',
  'scr',
  'jar',
  'vbs',
  'sh',
  'dex',
  // P8 #461: more Windows program and shortcut types.
  'com',
  'pif',
  'ps1',
  'hta',
  'wsf',
  'cpl',
  'lnk',
];

/**
 * P8 #461: names a person reads as a video, picture, document or subtitle. Such a name in front of a program's
 * extension (`clip.mp4.exe`), or on a file sent as a program, is a disguise. Kept equal to the native lists
 * (`RiskyDownloads.HARMLESS_EXTENSIONS`, `ContentSniff.HARMLESS_EXTENSIONS`).
 */
export const HARMLESS_EXTENSIONS: readonly string[] = [
  'mp4', 'm4v', 'mkv', 'webm', 'mov', 'avi', 'wmv', 'flv', 'f4v', 'ts', '3gp', '3g2', 'mpg', 'mpeg', 'vob', 'divx',
  'mp3', 'm4a', 'aac', 'wav', 'ogg', 'opus',
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'bmp',
  'pdf', 'txt', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'srt', 'vtt', 'ass', 'ssa', 'sub',
];

/** MIME types of the same kinds of file. */
export const DANGEROUS_MIME_TYPES: readonly string[] = [
  'application/vnd.android.package-archive',
  'application/x-msdownload',
  'application/x-ms-dos-executable',
  'application/x-msdos-program',
  'application/x-dosexec',
  'application/x-executable',
  'application/x-msi',
  'application/x-ms-installer',
  'application/x-ole-storage',
  'application/x-bat',
  'application/x-msdos-batch',
  'application/java-archive',
  'application/x-java-archive',
  'application/x-sh',
  'application/x-shellscript',
  'text/x-shellscript',
  'text/x-sh',
  'application/x-vbscript',
  'text/vbscript',
  'application/x-dex',
];

const STREAMING_MANIFEST_TYPES = new Set([
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'audio/mpegurl',
  'audio/x-mpegurl',
  'application/dash+xml',
]);

export type DownloadDangerInput = {
  url: string;
  contentDisposition: string | null | undefined;
  mimeType: string | null | undefined;
  /** The native classifier's hint for the download (`WebDownloadEvent.hint`). */
  hint?: string | null;
};

export type DownloadDangerVerdict = {
  dangerous: boolean;
  /** The name to show the user: Content-Disposition's file name, else the URL's last path segment, else ''. */
  fileName: string;
  /**
   * `double-extension` (`clip.mp4.exe`) and `disguised` (a video-looking name sent as a program) are P8's Malware
   * Warning: the stronger message. `extension` / `mime`: an honestly named app or program file (H17).
   */
  reason: DownloadDangerReason | null;
};

export type DownloadDangerReason = 'double-extension' | 'disguised' | 'extension' | 'mime';

function normalizedMime(mimeType: string | null | undefined): string {
  return (mimeType ?? '').split(';')[0]!.trim().toLowerCase();
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** The file name a Content-Disposition header names (`filename*=` preferred, then `filename=`), or null. */
export function fileNameFromContentDisposition(contentDisposition: string | null | undefined): string | null {
  if (!contentDisposition) {
    return null;
  }
  const extended = /filename\*\s*=\s*(?:[\w-]+'[^']*')?("?)([^";]+)\1/i.exec(contentDisposition);
  if (extended?.[2]) {
    const name = safeDecode(extended[2].trim());
    if (name) {
      return name;
    }
  }
  const plain = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/i.exec(contentDisposition);
  const name = (plain?.[1] ?? plain?.[2] ?? '').trim();
  return name || null;
}

/** The URL's last path segment, decoded, or null. */
export function fileNameFromUrl(url: string): string | null {
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1];
    return last ? safeDecode(last) : null;
  } catch {
    return null;
  }
}

/** A name's extension in lower case (`archive.tar.SH` → `sh`), or null. */
export function fileExtension(name: string | null | undefined): string | null {
  const base = (name ?? '').trim().split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) {
    return null;
  }
  return base.slice(dot + 1).toLowerCase();
}

/** P8 #461: `clip.MP4.exe` — a harmless-looking extension right before a program's. */
export function hasDoubleExtension(name: string | null | undefined): boolean {
  const base = (name ?? '').trim().split(/[\\/]/).pop() ?? '';
  const last = fileExtension(base);
  if (!last || !DANGEROUS_EXTENSIONS.includes(last)) {
    return false;
  }
  const inner = fileExtension(base.slice(0, base.length - last.length - 1));
  return inner != null && HARMLESS_EXTENSIONS.includes(inner);
}

export function isVideoDownload(input: Pick<DownloadDangerInput, 'mimeType' | 'hint'>): boolean {
  if (input.hint === 'progressive' || input.hint === 'manifest-hls' || input.hint === 'manifest-dash') {
    return true;
  }
  const mime = normalizedMime(input.mimeType);
  return mime.startsWith('video/') || STREAMING_MANIFEST_TYPES.has(mime);
}

/** Pure: whether this download needs the warning, and the name to show. */
export function assessDownloadDanger(input: DownloadDangerInput): DownloadDangerVerdict {
  const dispositionName = fileNameFromContentDisposition(input.contentDisposition);
  const urlName = fileNameFromUrl(input.url);
  const fileName = dispositionName ?? urlName ?? '';
  if (isVideoDownload(input)) {
    return { dangerous: false, fileName, reason: null };
  }
  const names = [dispositionName, urlName];
  if (names.some((name) => hasDoubleExtension(name))) {
    return { dangerous: true, fileName, reason: 'double-extension' };
  }
  const extensions = names.map((name) => fileExtension(name));
  const programMime = DANGEROUS_MIME_TYPES.includes(normalizedMime(input.mimeType));
  if (programMime && extensions.some((ext) => ext != null && HARMLESS_EXTENSIONS.includes(ext))) {
    return { dangerous: true, fileName, reason: 'disguised' };
  }
  if (extensions.some((ext) => ext != null && DANGEROUS_EXTENSIONS.includes(ext))) {
    return { dangerous: true, fileName, reason: 'extension' };
  }
  if (programMime) {
    return { dangerous: true, fileName, reason: 'mime' };
  }
  return { dangerous: false, fileName, reason: null };
}

/**
 * Pure orchestration: true when the download may go to the system downloader — it is not dangerous, or the user
 * confirmed (`confirm` shows the dialog). A confirm that throws counts as Cancel.
 */
export async function allowSystemDownload(
  input: DownloadDangerInput,
  confirm: (fileName: string, reason: DownloadDangerReason | null) => Promise<boolean>,
): Promise<boolean> {
  const verdict = assessDownloadDanger(input);
  if (!verdict.dangerous) {
    return true;
  }
  try {
    return (await confirm(verdict.fileName, verdict.reason)) === true;
  } catch {
    return false;
  }
}

/**
 * Pure: one warning per file at a time. The WebView can report the same download twice in a row; while a warning
 * for that URL is open, a repeat is dropped (false) and the first answer decides.
 */
export function createSystemDownloadGate(
  confirm: (fileName: string, reason: DownloadDangerReason | null) => Promise<boolean>,
): (input: DownloadDangerInput) => Promise<boolean> {
  const open = new Set<string>();
  return async (input) => {
    if (!assessDownloadDanger(input).dangerous) {
      return true;
    }
    if (open.has(input.url)) {
      return false;
    }
    open.add(input.url);
    try {
      return await allowSystemDownload(input, confirm);
    } finally {
      open.delete(input.url);
    }
  };
}

/**
 * H17 native routing: a download the native side sent only for the warning (`hint: 'risky'` — an app or program
 * file that used to go straight to DownloadManager). It is handed to the system downloader only after the warning was
 * confirmed; a cancel drops it. True when it was handed over.
 */
export async function routeRiskyDownload(
  input: DownloadDangerInput,
  confirm: (input: DownloadDangerInput) => Promise<boolean>,
  handOff: () => Promise<void>,
): Promise<boolean> {
  let allowed = false;
  try {
    allowed = (await confirm(input)) === true;
  } catch {
    allowed = false;
  }
  if (!allowed) {
    return false;
  }
  await handOff();
  return true;
}

const MAX_DISPLAY_NAME = 80;

/**
 * Pure: the file name as the warning shows it. Control characters and Unicode direction overrides are removed, so a
 * name like `photo\u202egpj.exe` cannot display as `photoexe.jpg`; long names are shortened in the middle, keeping
 * the extension visible.
 */
export function displayFileName(name: string): string {
  const clean = name.replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim();
  const points = Array.from(clean);
  if (points.length <= MAX_DISPLAY_NAME) {
    return clean;
  }
  const tail = points.slice(-20).join('');
  return `${points.slice(0, MAX_DISPLAY_NAME - 21).join('')}…${tail}`;
}
