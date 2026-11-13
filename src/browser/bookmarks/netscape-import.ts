/**
 * B9 #84 — reading a bookmark file in the standard Netscape format (what Chrome, Firefox, Edge and VidoraX export).
 * Pure, and the file is only ever read as text: no HTML parser, nothing rendered, nothing run. One pass over the tags
 * that matter (`<DL>`, `</DL>`, `<H3>`, `<A>`, `<DD>`); everything else (unclosed `<DT>` / `<p>`, comments, huge base64
 * `ICON=` attributes) is skipped over. Tag names in any case.
 */

export type ImportedBookmark = {
  /** Folder names from the top of the file down. */
  path: string[];
  url: string;
  title: string;
  /** ISO time from ADD_DATE (seconds since 1970), or null. */
  addedAt: string | null;
  tags: string[];
  note: string;
};

export type ParsedBookmarkFile = {
  bookmarks: ImportedBookmark[];
  /** Folders in file order (so empty ones are created too). */
  folders: { path: string[]; isBookmarksBar: boolean }[];
  /** `<A>` entries that aren't http(s) pages (javascript:, place:, file: …). */
  invalid: number;
  /** The file didn't look like a bookmark file at all. */
  notBookmarkFile: boolean;
};

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** The attributes of a tag (`NAME="value"`), names upper-cased. A huge value (ICON) is skipped without copying. */
function attributes(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z_:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const name = m[1].toUpperCase();
    if (name === 'ICON' || name === 'ICON_URI') continue;
    out[name] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? '');
  }
  return out;
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

function isWebUrl(url: string): boolean {
  return /^https?:\/\/[^\s/?#]+/i.test(url);
}

function dateFrom(seconds: string | undefined): string | null {
  if (!seconds || !/^\d{1,13}$/.test(seconds)) return null;
  let n = Number(seconds);
  // Some exporters write milliseconds or microseconds.
  while (n > 1e11) n = Math.floor(n / 1000);
  return n > 0 ? new Date(n * 1000).toISOString() : null;
}

function splitTags(raw: string | undefined): string[] {
  return raw ? raw.split(',').map((t) => t.trim()).filter(Boolean) : [];
}

const TAG = /<\s*(\/?)\s*(dl|h3|a|dd)\b([^>]*)>/gi;

export function parseBookmarkFile(text: string): ParsedBookmarkFile {
  const result: ParsedBookmarkFile = { bookmarks: [], folders: [], invalid: 0, notBookmarkFile: false };
  result.notBookmarkFile = !/<\s*dl\b/i.test(text);
  // Searches from the current position (never re-reading or copying the rest of the file: 5,000 bookmarks stay linear).
  const closeH3 = /<\s*\/\s*h3\s*>/gi;
  const closeA = /<\s*\/\s*a\s*>/gi;
  const nextEntry = /<\s*\/?\s*(dt|dl|h3|a)\b/gi;
  const until = (re: RegExp, from: number): number => {
    re.lastIndex = from;
    const found = re.exec(text);
    return found ? found.index : -1;
  };
  // One entry per open <DL>: its folder name, or null for a list without a heading (the file's outer one).
  const lists: (string | null)[] = [];
  const stackPath = (): string[] => lists.filter((name): name is string => name != null);
  let pendingFolder: string | null = null;
  let lastBookmark: ImportedBookmark | null = null;
  TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG.exec(text))) {
    const closing = m[1] === '/';
    const name = m[2].toLowerCase();
    if (name === 'dl') {
      if (closing) {
        lists.pop();
      } else {
        lists.push(pendingFolder);
        pendingFolder = null;
      }
      lastBookmark = null;
      continue;
    }
    if (closing) continue;
    if (name === 'h3') {
      const end = until(closeH3, TAG.lastIndex);
      const inner = end >= 0 ? text.slice(TAG.lastIndex, end) : '';
      if (end >= 0) TAG.lastIndex = end;
      const attrs = attributes(m[3]);
      pendingFolder = stripTags(inner).slice(0, 80) || 'Folder';
      result.folders.push({ path: [...stackPath(), pendingFolder], isBookmarksBar: attrs.PERSONAL_TOOLBAR_FOLDER === 'true' });
      lastBookmark = null;
      continue;
    }
    if (name === 'a') {
      const end = until(closeA, TAG.lastIndex);
      const inner = end >= 0 ? text.slice(TAG.lastIndex, end) : '';
      if (end >= 0) TAG.lastIndex = end;
      const attrs = attributes(m[3]);
      const url = (attrs.HREF ?? '').trim();
      if (!isWebUrl(url)) {
        result.invalid += 1;
        lastBookmark = null;
        continue;
      }
      const bookmark: ImportedBookmark = {
        path: stackPath(),
        url,
        title: stripTags(inner).slice(0, 500) || url,
        addedAt: dateFrom(attrs.ADD_DATE),
        tags: splitTags(attrs.TAGS),
        note: '',
      };
      result.bookmarks.push(bookmark);
      lastBookmark = bookmark;
      continue;
    }
    if (name === 'dd' && lastBookmark) {
      // A description: the text up to the next tag that starts an entry or a list.
      const stop = until(nextEntry, TAG.lastIndex);
      lastBookmark.note = stripTags(text.slice(TAG.lastIndex, stop >= 0 ? stop : text.length)).slice(0, 2000);
      lastBookmark = null;
    }
  }
  return result;
}

// --- #85 Export ------------------------------------------------------------------------------------------------

export type ExportNode = {
  name: string;
  isBookmarksBar: boolean;
  createdAt: string;
  folders: ExportNode[];
  bookmarks: { url: string; title: string; createdAt: string; updatedAt: string; note: string; tags: string[] }[];
};

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function seconds(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
}

/** The whole tree as a bookmark file other browsers import (folders, dates, Firefox-style TAGS, notes as `<DD>`). */
export function bookmarkFileHtml(root: ExportNode, now: Date): string {
  const lines = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<!-- This is an automatically generated file.',
    '     It will be read and overwritten.',
    '     DO NOT EDIT! -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
  ];
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const write = (node: ExportNode, indent: string) => {
    for (const folder of node.folders) {
      const created = seconds(folder.createdAt) || nowSeconds;
      const bar = folder.isBookmarksBar ? ' PERSONAL_TOOLBAR_FOLDER="true"' : '';
      lines.push(`${indent}<DT><H3 ADD_DATE="${created}" LAST_MODIFIED="${created}"${bar}>${escapeHtml(folder.name)}</H3>`);
      lines.push(`${indent}<DL><p>`);
      write(folder, `${indent}    `);
      lines.push(`${indent}</DL><p>`);
    }
    for (const b of node.bookmarks) {
      if (!isWebUrl(b.url)) continue;
      const tags = b.tags.length ? ` TAGS="${escapeHtml(b.tags.join(','))}"` : '';
      lines.push(
        `${indent}<DT><A HREF="${escapeHtml(b.url)}" ADD_DATE="${seconds(b.createdAt)}" LAST_MODIFIED="${seconds(
          b.updatedAt,
        )}"${tags}>${escapeHtml(b.title.trim() || b.url)}</A>`,
      );
      if (b.note.trim()) lines.push(`${indent}<DD>${escapeHtml(b.note.trim())}`);
    }
  };
  write(root, '    ');
  lines.push('</DL><p>', '');
  return lines.join('\n');
}
