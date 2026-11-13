import { foldSearchText } from '@/utils/search-text';

/**
 * B24 #271 — Urdu matching in the SQLite searches (history, bookmarks, notes), the same folding the tab search uses
 * (`foldSearchText`): expo-sqlite has no custom functions, so a column is folded with `replace()` — letter variants
 * (Arabic ي / ك / ه / ة and alef / hamza forms → the Urdu letters), Eastern digits → 0–9, and the common diacritics and
 * tatweel removed. Used only when the query has Arabic-script letters or Eastern digits, so every other search stays
 * exactly as it was.
 */

const PAIRS: readonly [string, string][] = [
  ['\u064A', '\u06CC'], // ي → ی
  ['\u0649', '\u06CC'], // ى → ی
  ['\u0626', '\u06CC'], // ئ → ی
  ['\u0643', '\u06A9'], // ك → ک
  ['\u0647', '\u06C1'], // ه → ہ
  ['\u06D5', '\u06C1'], // ە → ہ
  ['\u0629', '\u06C1'], // ة → ہ
  ['\u0623', '\u0627'], // أ → ا
  ['\u0625', '\u0627'], // إ → ا
  ['\u0622', '\u0627'], // آ → ا
  ['\u0671', '\u0627'], // ٱ → ا
  ['\u0624', '\u0648'], // ؤ → و
  ...Array.from({ length: 10 }, (_, i) => [String.fromCharCode(0x0660 + i), String(i)] as [string, string]),
  ...Array.from({ length: 10 }, (_, i) => [String.fromCharCode(0x06f0 + i), String(i)] as [string, string]),
  // Harakat, superscript alef, tatweel.
  ...['\u064B', '\u064C', '\u064D', '\u064E', '\u064F', '\u0650', '\u0651', '\u0652', '\u0653', '\u0654', '\u0670', '\u0640'].map(
    (c) => [c, ''] as [string, string],
  ),
];

const CHAR_FOLD = new Map(PAIRS);

/**
 * One character as the SQL fold sees it ('' when dropped), with A–Z lower-cased as LIKE does — for marking exactly
 * what the search matched (history highlight).
 */
export function foldChar(ch: string): string {
  const folded = CHAR_FOLD.get(ch);
  if (folded !== undefined) return folded;
  return ch >= 'A' && ch <= 'Z' ? ch.toLowerCase() : ch;
}

/** True when a query needs the Urdu fold (Arabic-script letters or Eastern digits). */
export function needsUrduFold(query: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F]/.test(query);
}

/** `column` folded in SQL (nested replace(); every pair is a literal, no user text). */
export function foldedSql(column: string): string {
  let expr = column;
  for (const [from, to] of PAIRS) expr = `replace(${expr}, '${from}', '${to}')`;
  return expr;
}

/** The LIKE pattern for a folded query (`%`, `_` and `\` escaped; use with ESCAPE '\'). */
export function foldedLikePattern(query: string): string {
  return `%${foldSearchText(query).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
