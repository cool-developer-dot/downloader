/**
 * Pure rules of design 43 "Link grabber": how a found link reads (file name, host), which chip it belongs to, the
 * pattern download's `file[01-20].jpg` expansion and the include / exclude rules. No React Native.
 */

export type LinkKind = 'video' | 'audio' | 'docs' | 'images' | 'other';
export type LinkFilter = 'all' | Exclude<LinkKind, 'other'>;

export const LINK_FILTERS: readonly LinkFilter[] = ['all', 'video', 'audio', 'docs', 'images'];

const VIDEO = new Set(['mp4', 'm4v', 'f4v', 'mov', 'webm', 'mkv', '3gp', '3g2', 'avi', 'divx', 'wmv', 'flv', 'ogv', 'mpg', 'mpeg', 'vob', 'ts', 'm3u8', 'mpd']);
const AUDIO = new Set(['mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'flac', 'wma']);
const DOCS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'epub', 'zip', 'rar', '7z', 'apk']);
const IMAGES = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif', 'heic']);

/** Links one pattern may expand to at most (Batch Add takes 50 at a time). */
export const MAX_PATTERN_LINKS = 200;

const RANGE = /\[(\d+)-(\d+)\]/;

function parse(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null;
  } catch {
    return null;
  }
}

function lastSegment(parsed: URL): string {
  const segments = parsed.pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1] ?? '';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** The file extension of a link's path, lowercase, without the query; "" when it has none. */
export function linkExtension(url: string): string {
  const parsed = parse(url);
  if (!parsed) {
    return '';
  }
  const name = lastSegment(parsed);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function linkKind(url: string): LinkKind {
  const extension = linkExtension(url);
  if (VIDEO.has(extension)) return 'video';
  if (AUDIO.has(extension)) return 'audio';
  if (DOCS.has(extension)) return 'docs';
  if (IMAGES.has(extension)) return 'images';
  return 'other';
}

export function matchesFilter(url: string, filter: LinkFilter): boolean {
  return filter === 'all' || linkKind(url) === filter;
}

/** The link's host without `www.`; "" for anything that is not a web link. */
export function linkHost(url: string): string {
  return parse(url)?.hostname.replace(/^www\./i, '') ?? '';
}

/** The row title: the file name at the end of the path, else the host. */
export function linkFileName(url: string): string {
  const parsed = parse(url);
  if (!parsed) {
    return url;
  }
  return lastSegment(parsed) || linkHost(url) || url;
}

/** The page card's title: "example.com/files" — host without `www.` plus the path without its trailing slash. */
export function pageHostPath(url: string | null | undefined): string {
  const parsed = url ? parse(url) : null;
  if (!parsed) {
    return '';
  }
  const path = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.hostname.replace(/^www\./i, '')}${path}`;
}

/**
 * `https://x.com/file[01-20].jpg` → the 20 links, zero-padded to the width the range was written in. A web link
 * without a range is itself; anything else expands to nothing. Capped at `max` links.
 */
export function expandPattern(pattern: string, max = MAX_PATTERN_LINKS): string[] {
  const trimmed = pattern.trim();
  const match = RANGE.exec(trimmed);
  if (!match) {
    return parse(trimmed) ? [trimmed] : [];
  }
  const [token, fromText, toText] = match;
  const from = Number(fromText);
  const to = Number(toText);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
    return [];
  }
  const width = fromText.length === toText.length || fromText.startsWith('0') ? fromText.length : 0;
  const out: string[] = [];
  for (let value = from; value <= to && out.length < max; value += 1) {
    const url = trimmed.replace(token, String(value).padStart(width, '0'));
    if (parse(url)) {
      out.push(url);
    }
  }
  return out;
}

export type LinkRules = { include: string; exclude: string };

/** Only links containing the include text (when given), minus those containing the exclude text; case-insensitive. */
export function applyRules(links: readonly string[], rules: LinkRules): string[] {
  const include = rules.include.trim().toLowerCase();
  const exclude = rules.exclude.trim().toLowerCase();
  return links.filter((url) => {
    const lower = url.toLowerCase();
    if (include && !lower.includes(include)) {
      return false;
    }
    return !(exclude && lower.includes(exclude));
  });
}

/** New links appended to the found ones, without repeats, in order. */
export function mergeLinks(existing: readonly string[], added: readonly string[]): string[] {
  const seen = new Set(existing);
  const out = [...existing];
  for (const url of added) {
    if (!seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}
