/**
 * P7 #629 — reading M3U / M3U8 playlists and writing M3U8. Pure (tested under Node); no file access here.
 *
 * Reading: a leading byte-order mark is dropped; lines end in CRLF, CR or LF (mixed is fine); blank lines and `#`
 * comments are skipped; `#EXTINF:<seconds>[ attributes],<title>` names the next location. The title is everything
 * after the first comma that is not inside double quotes (`tvg-name="a, b"` attributes keep their commas; a title
 * may have commas of its own). VidoraX playlists are local only: a `http://` / `https://` line (or any other network
 * address, `rtsp://`, `ftp://`…) is skipped and counted. `file://` URIs are percent-decoded; plain Windows and POSIX
 * paths are kept exactly as written (never decoded: `%` is a valid file-name character).
 *
 * Writing (export): `#EXTM3U`, then per video `#EXTINF:<seconds or -1>,<title>` and a path line, UTF-8, LF. The
 * path line is the video's file name alone — a path relative to the playlist file. VidoraX's library files are
 * private to the app (other apps can't open those paths) and are not in one shared folder, so the name is what
 * another player can resolve: save the playlist next to the videos (or copies of them) and it plays there.
 */

export type M3uEntry = {
  /** The location line as written (trimmed). */
  location: string;
  /** From `#EXTINF`; null when there was none or it was empty. */
  title: string | null;
  /** From `#EXTINF`; null when unknown (`-1`) or missing. */
  durationSeconds: number | null;
};

export type M3uParse = {
  entries: M3uEntry[];
  /** Network addresses (http, https and other `scheme://` links) left out. */
  skippedRemote: number;
  /** The file started with `#EXTM3U`. */
  extended: boolean;
};

const URL_SCHEME = /^([a-z][a-z0-9+.-]*):\/\//i;
const LOCAL_SCHEMES = new Set(['file', 'content']);

/** True for a line that is a network address (`http://`, `https://`, `rtsp://`…), never a local file. */
export function isRemoteLocation(location: string): boolean {
  const scheme = URL_SCHEME.exec(location.trim())?.[1]?.toLowerCase();
  return scheme != null && !LOCAL_SCHEMES.has(scheme);
}

/** Index of the first comma outside double quotes, or -1. */
function firstUnquotedComma(text: string): number {
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      return i;
    }
  }
  return -1;
}

/** `#EXTINF:123.5 tvg-id="x",Title, with commas` → duration 123.5 and the title. */
export function parseExtinf(line: string): { title: string | null; durationSeconds: number | null } {
  const body = line.replace(/^#EXTINF:/i, '');
  const comma = firstUnquotedComma(body);
  const head = comma >= 0 ? body.slice(0, comma) : body;
  const title = comma >= 0 ? body.slice(comma + 1).trim() : '';
  const number = /^\s*(-?\d+(?:\.\d+)?)/.exec(head)?.[1];
  const seconds = number != null ? Number(number) : Number.NaN;
  return {
    title: title || null,
    durationSeconds: Number.isFinite(seconds) && seconds >= 0 ? seconds : null,
  };
}

export function parseM3u(text: string): M3uParse {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = body.split(/\r\n|\r|\n/);
  const entries: M3uEntry[] = [];
  let skippedRemote = 0;
  let extended = false;
  let pending: { title: string | null; durationSeconds: number | null } | null = null;
  let first = true;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      continue;
    }
    if (line.startsWith('#')) {
      if (first && /^#EXTM3U\b/i.test(line)) {
        extended = true;
      } else if (/^#EXTINF:/i.test(line)) {
        pending = parseExtinf(line);
      }
      first = false;
      continue;
    }
    first = false;
    if (isRemoteLocation(line)) {
      skippedRemote += 1;
      pending = null;
      continue;
    }
    entries.push({ location: line, title: pending?.title ?? null, durationSeconds: pending?.durationSeconds ?? null });
    pending = null;
  }
  return { entries, skippedRemote, extended };
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    // A stray `%` (not an escape): keep the text as written.
    return text;
  }
}

/**
 * The folders and file name of a local location, in order: `file://` URIs percent-decoded; a `content://` document
 * URI reduced to its document's path (`…/document/primary%3AMovies%2Fx.mp4` → `Movies/x.mp4`); plain Windows / POSIX
 * paths split on `\` and `/` as written. `.` and `..` are dropped (a relative path's start), and so is a drive
 * (`C:`). Null for a network address.
 */
export function locationSegments(location: string): string[] | null {
  const trimmed = location.trim();
  if (isRemoteLocation(trimmed)) {
    return null;
  }
  let path = trimmed;
  const scheme = URL_SCHEME.exec(trimmed)?.[1]?.toLowerCase();
  if (scheme === 'file') {
    path = safeDecode(trimmed.replace(/^file:\/\/(localhost)?/i, ''));
  } else if (scheme === 'content') {
    const last = trimmed.split('/').pop() ?? '';
    const documentId = safeDecode(last);
    const colon = documentId.indexOf(':');
    path = colon >= 0 ? documentId.slice(colon + 1) : documentId;
  }
  return path
    .split(/[\\/]+/)
    .filter((segment) => segment && segment !== '.' && segment !== '..' && !/^[a-z]:$/i.test(segment));
}

/** The file name of a location (its last segment), or '' for a network address. */
export function locationFileName(location: string): string {
  const segments = locationSegments(location);
  return segments && segments.length > 0 ? segments[segments.length - 1]! : '';
}

export type M3u8Line = { title: string; fileName: string; durationSeconds: number | null };

/** One line of text: control characters (a line break in a title would start a new entry) become spaces. */
function oneLine(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f ? ' ' : ch;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** `#EXTM3U` + `#EXTINF:<seconds or -1>,<title>` + the file name, per video. Entries without any name are left out. */
export function writeM3u8(lines: readonly M3u8Line[]): string {
  const out = ['#EXTM3U'];
  for (const line of lines) {
    const fileName = oneLine(line.fileName) || oneLine(line.title);
    if (!fileName) {
      continue;
    }
    const seconds =
      line.durationSeconds != null && Number.isFinite(line.durationSeconds) && line.durationSeconds > 0
        ? Math.round(line.durationSeconds)
        : -1;
    const title = oneLine(line.title) || fileName.replace(/\.[^.]+$/, '');
    out.push(`#EXTINF:${seconds},${title}`);
    // A name starting with `#` would be read back as a comment.
    out.push(fileName.startsWith('#') ? `./${fileName}` : fileName);
  }
  return `${out.join('\n')}\n`;
}
