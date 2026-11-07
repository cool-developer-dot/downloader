/**
 * B10 #95 — showing where a History search matched. Pure.
 *
 * The search itself is SQLite's `LIKE '%query%'` on title, URL and host (HistoryRepository): the trimmed query as one
 * piece, ignoring case for A–Z only. The highlight follows the same rule, so what is marked is exactly what matched.
 */

export type HighlightPart = { text: string; match: boolean };

/** Lower-cases A–Z only, like SQLite's LIKE; keeps every other character (and the string's length) as it is. */
function foldAscii(value: string): string {
  return value.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}

/** Splits `text` into matched and unmatched parts (every occurrence of the trimmed query). */
export function splitHighlight(text: string, query: string): HighlightPart[] {
  const needle = foldAscii(query.trim());
  if (!text) return [];
  if (!needle) return [{ text, match: false }];
  const haystack = foldAscii(text);
  const parts: HighlightPart[] = [];
  let from = 0;
  while (from <= text.length) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    if (at > from) parts.push({ text: text.slice(from, at), match: false });
    parts.push({ text: text.slice(at, at + needle.length), match: true });
    from = at + needle.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), match: false });
  return parts;
}

export function matchesQuery(text: string, query: string): boolean {
  const needle = foldAscii(query.trim());
  return needle.length > 0 && foldAscii(text).includes(needle);
}

/**
 * The second line of a History row: the host, as today — but while searching, the full address when the match is
 * only in its path or query (so the user sees why the row is listed).
 */
export function historySubtitle(entry: { url: string; hostname: string }, query: string): string {
  const host = entry.hostname || entry.url;
  if (!query.trim() || matchesQuery(host, query) || !matchesQuery(entry.url, query)) return host;
  return entry.url;
}
