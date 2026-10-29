/**
 * B4 #33 Search shortcuts: `keyword query` in the address bar searches a site directly (`w Lahore` → Wikipedia).
 * Defaults: g Google, b Bing, d DuckDuckGo, w Wikipedia. The user adds, edits and deletes their own in Browser
 * settings → Search. Pure: the list comes in through `bindSearchShortcutsReader` (the settings store), so parsing is
 * tested under Node.
 *
 * A shortcut is either a built-in engine (`engine`, which then also uses the user's Safe Search, language and region)
 * or a URL template with `%s` for the query. Templates must be http(s); the query is always URL-encoded.
 */

import {
  buildEngineSearchUrl,
  getSearchEngine,
  normalizeSearchEngineId,
  SEARCH_ENGINES,
  type SearchEngineId,
} from './search-engines.ts';

export type SearchShortcut = {
  keyword: string;
  name: string;
  /** Built-in engine shortcut (follows the user's search settings). */
  engine?: SearchEngineId;
  /** Otherwise a template like `https://en.wikipedia.org/w/index.php?search=%s`. */
  template?: string;
};

export const MAX_SEARCH_SHORTCUTS = 30;
export const MAX_SHORTCUT_KEYWORD = 16;
export const MAX_SHORTCUT_NAME = 40;
export const MAX_SHORTCUT_TEMPLATE = 300;

export const DEFAULT_SEARCH_SHORTCUTS: readonly SearchShortcut[] = [
  { keyword: 'g', name: 'Google', engine: 'google' },
  { keyword: 'b', name: 'Bing', engine: 'bing' },
  { keyword: 'd', name: 'DuckDuckGo', engine: 'duckduckgo' },
  { keyword: 'w', name: 'Wikipedia', template: 'https://en.wikipedia.org/w/index.php?search=%s' },
];

export type ShortcutValidation =
  | { ok: true; shortcut: SearchShortcut }
  | { ok: false; reason: 'keyword' | 'keyword-taken' | 'name' | 'template' };

/** A keyword is one word of letters/digits (any script), no spaces or punctuation that could start an address. */
export function isValidShortcutKeyword(keyword: string): boolean {
  return /^[\p{L}\p{N}_-]{1,16}$/u.test(keyword);
}

export function isValidShortcutTemplate(template: string): boolean {
  if (template.length > MAX_SHORTCUT_TEMPLATE || !template.includes('%s')) return false;
  try {
    const url = new URL(template.replace(/%s/g, 'x'));
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Validates a shortcut the user typed (keyword unique among `others`, case-insensitive). */
export function validateShortcut(
  input: { keyword: string; name: string; template: string },
  others: readonly SearchShortcut[],
): ShortcutValidation {
  const keyword = input.keyword.trim();
  const name = input.name.trim();
  const template = input.template.trim();
  if (!isValidShortcutKeyword(keyword)) return { ok: false, reason: 'keyword' };
  if (others.some((s) => s.keyword.toLowerCase() === keyword.toLowerCase())) return { ok: false, reason: 'keyword-taken' };
  if (!name || name.length > MAX_SHORTCUT_NAME) return { ok: false, reason: 'name' };
  if (!isValidShortcutTemplate(template)) return { ok: false, reason: 'template' };
  return { ok: true, shortcut: { keyword, name, template } };
}

/** The stored list (a JSON string setting) read defensively: unknown entries dropped, keywords de-duplicated. */
export function parseSearchShortcuts(raw: unknown): SearchShortcut[] {
  let list: unknown = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      return [...DEFAULT_SEARCH_SHORTCUTS];
    }
  }
  if (!Array.isArray(list)) return [...DEFAULT_SEARCH_SHORTCUTS];
  const out: SearchShortcut[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const s = item as Partial<SearchShortcut>;
    const keyword = typeof s.keyword === 'string' ? s.keyword.trim() : '';
    const name = typeof s.name === 'string' ? s.name.trim().slice(0, MAX_SHORTCUT_NAME) : '';
    if (!isValidShortcutKeyword(keyword) || !name || seen.has(keyword.toLowerCase())) continue;
    if (typeof s.engine === 'string' && s.engine in SEARCH_ENGINES) {
      out.push({ keyword, name, engine: normalizeSearchEngineId(s.engine) });
    } else if (typeof s.template === 'string' && isValidShortcutTemplate(s.template.trim())) {
      out.push({ keyword, name, template: s.template.trim() });
    } else {
      continue;
    }
    seen.add(keyword.toLowerCase());
    if (out.length >= MAX_SEARCH_SHORTCUTS) break;
  }
  return out;
}

export function serializeSearchShortcuts(list: readonly SearchShortcut[]): string {
  return JSON.stringify(
    list.slice(0, MAX_SEARCH_SHORTCUTS).map((s) =>
      s.engine ? { keyword: s.keyword, name: s.name, engine: s.engine } : { keyword: s.keyword, name: s.name, template: s.template },
    ),
  );
}

export const DEFAULT_SEARCH_SHORTCUTS_JSON = serializeSearchShortcuts(DEFAULT_SEARCH_SHORTCUTS);

/** The results URL of a shortcut for `query`. */
export function buildShortcutUrl(shortcut: SearchShortcut, query: string): string {
  const q = query.trim().replace(/\s+/g, ' ');
  if (shortcut.engine) {
    return buildEngineSearchUrl(q, { ...getSearchEngine().settings, engine: shortcut.engine });
  }
  return shortcut.template!.replace(/%s/g, encodeURIComponent(q));
}

export type ShortcutMatch = { shortcut: SearchShortcut; query: string; url: string };

/**
 * `keyword query` → the shortcut search, when the first word is a shortcut keyword (case-insensitive) and something
 * follows it. `w` alone, or `www.example.com`, is never a shortcut.
 */
export function matchSearchShortcut(input: string, shortcuts: readonly SearchShortcut[]): ShortcutMatch | null {
  const match = /^(\S+)\s+(\S.*)$/u.exec(input.trim());
  if (!match) return null;
  const keyword = match[1]!.toLowerCase();
  const query = match[2]!.trim();
  const shortcut = shortcuts.find((s) => s.keyword.toLowerCase() === keyword);
  if (!shortcut || !query) return null;
  return { shortcut, query, url: buildShortcutUrl(shortcut, query) };
}

type ShortcutsReader = () => readonly SearchShortcut[];
let readShortcuts: ShortcutsReader = () => DEFAULT_SEARCH_SHORTCUTS;

/** The settings store binds the user's list here at startup. */
export function bindSearchShortcutsReader(reader: ShortcutsReader): void {
  readShortcuts = reader;
}

export function getSearchShortcuts(): readonly SearchShortcut[] {
  return readShortcuts();
}
