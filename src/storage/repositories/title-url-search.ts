import { foldedLikePattern, foldedSql, needsUrduFold } from './urdu-fold-sql';

/**
 * The search clause of History (B10) and the bookmarks list: title, address or host contains the trimmed query (A–Z
 * case ignored, SQLite LIKE). B24 #271: an Urdu / Arabic-script query also matches titles typed with the other letter
 * forms, diacritics or digits (`urdu-fold-sql.ts`). Pure, so it is tested on SQLite under Node.
 */
export function titleUrlHostSearchClause(query: string | undefined): { clause: string; params: string[] } {
  const normalized = query?.trim();
  if (!normalized) return { clause: '', params: [] };
  const like = `%${normalized}%`;
  if (needsUrduFold(normalized)) {
    return {
      clause: `WHERE (${foldedSql('title')} LIKE ? ESCAPE '\\' OR url LIKE ? OR hostname LIKE ?)`,
      params: [foldedLikePattern(normalized), like, like],
    };
  }
  return { clause: `WHERE (title LIKE ? OR url LIKE ? OR hostname LIKE ?)`, params: [like, like, like] };
}
