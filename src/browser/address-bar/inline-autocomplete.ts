/**
 * B4 #24 URL inline autocomplete. While the user types an address, the best visited or bookmarked site that starts
 * with what they typed is completed inline, the added part selected: → or Enter accepts it, Backspace removes it.
 * Pure.
 *
 * Rules:
 * - Only a single word that can start an address (no spaces, no path yet): `wik`, `www.wik`, `https://wik`.
 * - The match starts at the beginning of a site (with or without `www.`) — `ipedia` never completes `wikipedia.org`.
 * - Candidates are the visited/bookmarked hosts without `www.` plus their registrable domains (`en.wikipedia.org`
 *   also offers `wikipedia.org`), ranked by everything recorded on them — visits plus 2 per bookmark, summed over
 *   their pages, so a site used often beats one bookmarked once — then shorter.
 * - What the user typed is kept as typed (case, scheme, `www.`); only the rest is added.
 */

export type AutocompleteSource = {
  host: string;
  visits: number;
  bookmarked: boolean;
};

export type RankedHost = { host: string; score: number };

const TYPED_PREFIX = /^((?:https?:\/\/)?(?:www\.)?)(.*)$/i;
const HOST_CHARS = /^[a-z0-9.-]+$/i;

/** Ranked completion candidates from history/bookmark rows; `domainOf` gives the registrable domain. */
export function rankAutocompleteHosts(
  sources: readonly AutocompleteSource[],
  domainOf: (host: string) => string | null,
): RankedHost[] {
  const scores = new Map<string, number>();
  const keyOf = (host: string) => host.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  const add = (key: string, score: number) => {
    if (!key || !HOST_CHARS.test(key)) return;
    scores.set(key, (scores.get(key) ?? 0) + score);
  };
  for (const source of sources) {
    const score = Math.max(0, source.visits) + (source.bookmarked ? 2 : 0);
    const key = keyOf(source.host);
    add(key, score);
    const domain = domainOf(source.host.toLowerCase());
    // `www.bbc.com` and `bbc.com` are the same site: one row counts once.
    if (domain && keyOf(domain) !== key) add(keyOf(domain), score);
  }
  return [...scores.entries()]
    .map(([host, score]) => ({ host, score }))
    .sort((a, b) => b.score - a.score || a.host.length - b.host.length || (a.host < b.host ? -1 : 1));
}

/**
 * The full text to show for `typed` (typed + the completed part), or null when nothing should be completed.
 * `caretAtEnd` false (the user moved the caret into the text) → never completes.
 */
export function inlineCompletion(
  typed: string,
  candidates: readonly RankedHost[],
  options: { caretAtEnd?: boolean } = {},
): string | null {
  if (options.caretAtEnd === false) return null;
  if (!typed || /\s/.test(typed)) return null;
  const match = TYPED_PREFIX.exec(typed);
  if (!match) return null;
  const core = match[2]!;
  // Nothing typed yet beyond the scheme/www., or already past the host (a path or query).
  if (!core || /[/?#:@]/.test(core) || !HOST_CHARS.test(core)) return null;
  const needle = core.toLowerCase();
  for (const candidate of candidates) {
    if (candidate.host.length > needle.length && candidate.host.startsWith(needle)) {
      return typed + candidate.host.slice(needle.length);
    }
  }
  return null;
}

/**
 * What a caret or selection move does to a completion that is showing (`typed` + the selected rest = `shown`):
 * - `accept`: the caret at the very end (→, a tap at the end) or Select all — the completed text becomes ordinary text
 *   (so Delete after Select all clears everything);
 * - `drop`: the caret or a selection inside what was typed — never complete in the middle;
 * - `keep`: anything else, e.g. the completion's own selection, or the caret just after a typed letter.
 */
export function completionOnSelection(
  typed: string,
  shown: string,
  selection: { start: number; end: number },
): 'accept' | 'drop' | 'keep' {
  const collapsed = selection.start === selection.end;
  if (collapsed) {
    if (selection.end === shown.length) return 'accept';
    return selection.end < typed.length ? 'drop' : 'keep';
  }
  if (selection.start === 0 && selection.end === shown.length) return 'accept';
  return selection.end <= typed.length ? 'drop' : 'keep';
}
