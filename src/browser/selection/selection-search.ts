/**
 * B8 #72 — turning selected text into a search. Pure.
 *
 * Whitespace (line breaks from a selection across paragraphs, tabs) is collapsed the way a search box does. Text longer
 * than 300 characters is cut — at the last space in its final 40 characters when there is one, so a word isn't split —
 * and `truncated` tells the caller to show a short note.
 */

export const SELECTION_SEARCH_MAX = 300;
const WORD_BREAK_WINDOW = 40;

export type SelectionSearch = { query: string; truncated: boolean };

export function prepareSelectionSearch(text: string, max: number = SELECTION_SEARCH_MAX): SelectionSearch | null {
  if (typeof text !== 'string') return null;
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  if (normalized.length <= max) return { query: normalized, truncated: false };

  let end = max;
  // Never split a surrogate pair (emoji, rare scripts).
  const last = normalized.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  let cut = normalized.slice(0, end);
  const space = cut.lastIndexOf(' ');
  if (space >= end - WORD_BREAK_WINDOW && space > 0) cut = cut.slice(0, space);
  return { query: cut.trim(), truncated: true };
}
