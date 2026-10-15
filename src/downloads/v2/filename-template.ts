/**
 * Filename Template (#379). The v2 engine names a download after the `title` it is given (the library file is
 * `<Safe Title>_<shortId>.<ext>`, the gallery copy `<Safe Title>.<ext>`, the row shows the title), so the template
 * is applied to that title before the download is created. The default template, `{title}`, returns the title
 * exactly as before — nothing is cleaned or cut — so a user who never changes it sees no difference.
 *
 * Tokens: {title} {site} {date} {time} {quality} {id}. `{id}` is the download's id, which the engine only assigns
 * when it creates the download; before that it is empty (the engine already ends every file name with a short id).
 * Pure: no React Native, no settings access.
 */

export const DEFAULT_FILENAME_TEMPLATE = '{title}';
export const FILENAME_TOKENS = ['title', 'site', 'date', 'time', 'quality', 'id'] as const;
export type FilenameToken = (typeof FILENAME_TOKENS)[number];

/** Longest template the settings keep. */
export const MAX_TEMPLATE_LENGTH = 200;
/** Longest name the template produces, in Unicode code points (Urdu and other scripts stay whole characters). */
export const MAX_NAME_LENGTH = 120;
export const FALLBACK_NAME = 'Video';

export type FilenameValues = Partial<Record<FilenameToken, string | null | undefined>>;

/** Characters no file system on Android (or a PC the file is copied to) accepts, and control characters. */
const ILLEGAL_CHARACTERS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;
const SEPARATORS = '-_·|.';
const TOKEN = /\{([a-z]+)\}/gi;

function codePoints(value: string): string[] {
  return Array.from(value);
}

function capCodePoints(value: string, max: number): string {
  const points = codePoints(value);
  return points.length <= max ? value : points.slice(0, max).join('');
}

/** A template as the settings keep it: trimmed, without control characters, capped; empty means the default. */
export function normalizeFilenameTemplate(raw: unknown): string {
  if (typeof raw !== 'string') {
    return DEFAULT_FILENAME_TEMPLATE;
  }
  const cleaned = capCodePoints(raw.replace(/[\u0000-\u001f\u007f]/g, ' ').trim(), MAX_TEMPLATE_LENGTH).trim();
  return cleaned || DEFAULT_FILENAME_TEMPLATE;
}

export function isDefaultFilenameTemplate(template: unknown): boolean {
  return normalizeFilenameTemplate(template) === DEFAULT_FILENAME_TEMPLATE;
}

/**
 * Makes a string safe as a file name: illegal characters become spaces, whitespace collapses to one space, a
 * separator repeated around an empty token collapses to one, leading/trailing separators and dots go, and the
 * result is capped at `MAX_NAME_LENGTH` code points. Letters of any script are kept as they are.
 */
export function sanitizeFileName(value: string): string {
  let name = value.replace(ILLEGAL_CHARACTERS, ' ').replace(/\s+/g, ' ');
  // "a -  - b" (an empty token between two separators) → "a - b"
  name = name.replace(/([-_·|.])(?:\s*\1)+/g, '$1');
  const edge = new RegExp(`^[\\s${escapeForClass(SEPARATORS)}]+|[\\s${escapeForClass(SEPARATORS)}]+$`, 'g');
  name = name.replace(edge, '');
  name = capCodePoints(name, MAX_NAME_LENGTH).replace(edge, '');
  return name;
}

function escapeForClass(chars: string): string {
  return chars.replace(/[\\\]^-]/g, '\\$&');
}

/** Pure: the template with its tokens filled in and the result made safe. Unknown `{tokens}` stay as typed. */
export function renderFilenameTemplate(template: string, values: FilenameValues): string {
  const normalized = normalizeFilenameTemplate(template);
  const filled = normalized.replace(TOKEN, (match, rawName: string) => {
    const name = rawName.toLowerCase() as FilenameToken;
    if (!(FILENAME_TOKENS as readonly string[]).includes(name)) {
      return match;
    }
    const value = values[name];
    return typeof value === 'string' ? value.replace(ILLEGAL_CHARACTERS, ' ') : '';
  });
  const name = sanitizeFileName(filled);
  if (name) {
    return name;
  }
  const fallback = sanitizeFileName(values.title ?? '');
  return fallback || FALLBACK_NAME;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** `YYYY-MM-DD` in local time. */
export function formatTemplateDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `HH-mm` in local time (a colon is not allowed in file names). */
export function formatTemplateTime(date: Date): string {
  return `${pad(date.getHours())}-${pad(date.getMinutes())}`;
}

/** The site label: the page's host without `www.`, else the engine's site id (generic websites have none). */
export function templateSiteLabel(pageUrl: string | null | undefined, site: string | null | undefined): string {
  if (pageUrl) {
    try {
      const host = new URL(pageUrl).hostname.replace(/^www\./i, '');
      if (host) {
        return host;
      }
    } catch {
      // fall through to the site id
    }
  }
  return site && site !== 'web' ? site : '';
}

export type FilenameTemplateInput = {
  template: string | null | undefined;
  title: string;
  pageUrl?: string | null;
  site?: string | null;
  qualityLabel?: string | null;
  id?: string | null;
  now: Date;
};

/**
 * Pure: the title the engine should name this download after. With the default template (or none) the given
 * title comes back untouched.
 */
export function applyFilenameTemplate(input: FilenameTemplateInput): string {
  if (isDefaultFilenameTemplate(input.template)) {
    return input.title;
  }
  const validDate = Number.isFinite(input.now.getTime());
  return renderFilenameTemplate(input.template ?? DEFAULT_FILENAME_TEMPLATE, {
    title: input.title,
    site: templateSiteLabel(input.pageUrl, input.site),
    date: validDate ? formatTemplateDate(input.now) : '',
    time: validDate ? formatTemplateTime(input.now) : '',
    quality: input.qualityLabel?.trim() ?? '',
    id: input.id ?? '',
  });
}
