/**
 * B23 #261 — highlights: the pure rules and the page scripts (tested under Node / node:vm).
 *
 * A highlight is a **text anchor**: the exact text plus up to 32 characters before and after it, as the page's text
 * nodes give them (Range.toString, not the selection's rendered text). It is restored on the next visit by finding the
 * occurrence whose surroundings match best and wrapping it in `<mark>`. Only anchors and the colour go into a page —
 * never the note.
 */

export const HIGHLIGHT_COLORS = {
  yellow: '#FFF176',
  green: '#A5D6A7',
  blue: '#90CAF9',
  pink: '#F48FB1',
} as const;
export type HighlightColor = keyof typeof HIGHLIGHT_COLORS;
export const HIGHLIGHT_COLOR_IDS = Object.keys(HIGHLIGHT_COLORS) as HighlightColor[];

export const ANCHOR_CONTEXT = 32;
export const MAX_HIGHLIGHT_TEXT = 2000;
export const MAX_NOTE = 2000;
export const ANNOTATE_MESSAGE = 'vidorax_annotate';

export type HighlightAnchor = { exact: string; prefix: string; suffix: string };
export type PageAnchor = HighlightAnchor & { id: string; color: HighlightColor };

export function isHighlightColor(value: unknown): value is HighlightColor {
  return typeof value === 'string' && value in HIGHLIGHT_COLORS;
}

/** The address highlights are kept under: the page without its #fragment. */
export function pageKey(url: string): string {
  const hash = url.indexOf('#');
  return (hash >= 0 ? url.slice(0, hash) : url).trim();
}

/** A cleaned anchor, or null (empty, or only spaces). */
export function cleanAnchor(input: { exact?: unknown; prefix?: unknown; suffix?: unknown }): HighlightAnchor | null {
  const exact = typeof input.exact === 'string' ? input.exact.slice(0, MAX_HIGHLIGHT_TEXT) : '';
  if (!exact.trim()) return null;
  const prefix = typeof input.prefix === 'string' ? input.prefix.slice(-ANCHOR_CONTEXT) : '';
  const suffix = typeof input.suffix === 'string' ? input.suffix.slice(0, ANCHOR_CONTEXT) : '';
  return { exact, prefix, suffix };
}

/**
 * The page function that finds an anchor in the page's text: every occurrence of `exact` is scored by how much of
 * the prefix (backwards) and suffix (forwards) matches; the best wins, -1 when the text is gone. Kept as source so
 * the same code runs in pages and in tests.
 */
export const FIND_ANCHOR_SOURCE = `function __vidoraxFindAnchor(text, exact, prefix, suffix) {
  if (!exact) return -1;
  var best = -1, bestScore = -1, from = 0, at;
  while ((at = text.indexOf(exact, from)) !== -1) {
    var i = 0, j = 0;
    while (i < prefix.length && at - 1 - i >= 0 && text.charAt(at - 1 - i) === prefix.charAt(prefix.length - 1 - i)) i++;
    var end = at + exact.length;
    while (j < suffix.length && end + j < text.length && text.charAt(end + j) === suffix.charAt(j)) j++;
    if (i + j > bestScore) { bestScore = i + j; best = at; }
    if (i + j === prefix.length + suffix.length) break;
    from = at + 1;
  }
  return best;
}`;

/**
 * Set by B8's read script (selection-read-script.ts) when the selection is page text: the anchor for B23's Highlight.
 * The Highlight item asks for it with this script, which posts it back once and forgets it.
 */
export const ANCHOR_REQUEST_SCRIPT = `(function () {
  try {
    var c = window.__vidoraxSelectionContext;
    window.__vidoraxSelectionContext = null;
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: '${ANNOTATE_MESSAGE}', kind: 'anchor',
      exact: c && c.exact || '', prefix: c && c.prefix || '', suffix: c && c.suffix || '' }));
  } catch (e) {}
})();
true;`;

/** Wraps each anchor found on the page in `<mark>` (anchors already shown are skipped). Posts how many were found. */
export function restoreHighlightsScript(anchors: readonly PageAnchor[]): string {
  const list = anchors.map((a) => ({
    id: a.id,
    exact: a.exact.slice(0, MAX_HIGHLIGHT_TEXT),
    prefix: a.prefix.slice(-ANCHOR_CONTEXT),
    suffix: a.suffix.slice(0, ANCHOR_CONTEXT),
    color: HIGHLIGHT_COLORS[a.color] ?? HIGHLIGHT_COLORS.yellow,
  }));
  return `(function () {
  try {
    ${FIND_ANCHOR_SOURCE}
    var list = ${JSON.stringify(list)};
    var body = document.body;
    if (!body) return;
    var found = 0;
    for (var k = 0; k < list.length; k++) {
      var a = list[k];
      if (document.querySelector('mark[data-vidorax-hl="' + a.id + '"]')) { found++; continue; }
      var walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null);
      var nodes = [], text = '', node;
      while ((node = walker.nextNode())) { nodes.push({ node: node, start: text.length }); text += node.data; }
      var at = __vidoraxFindAnchor(text, a.exact, a.prefix, a.suffix);
      if (at < 0) continue;
      var end = at + a.exact.length;
      found++;
      for (var n = 0; n < nodes.length; n++) {
        var item = nodes[n], s = item.start, e = s + item.node.data.length;
        if (e <= at || s >= end) continue;
        var parent = item.node.parentNode;
        if (!parent || /^(SCRIPT|STYLE|TEXTAREA|NOSCRIPT)$/.test(parent.nodeName)) continue;
        var target = item.node;
        if (at > s) target = target.splitText(at - s);
        if (end < e) target.splitText(end - Math.max(at, s));
        var mark = document.createElement('mark');
        mark.setAttribute('data-vidorax-hl', a.id);
        mark.style.backgroundColor = a.color;
        mark.style.color = 'inherit';
        target.parentNode.insertBefore(mark, target);
        mark.appendChild(target);
      }
    }
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: '${ANNOTATE_MESSAGE}', kind: 'restored', found: found, of: list.length }));
  } catch (e) {}
})();
true;`;
}

/** Takes one highlight off the page (its marks unwrapped). */
export function removeHighlightScript(id: string): string {
  return `(function () {
  try {
    var marks = document.querySelectorAll('mark[data-vidorax-hl="' + ${JSON.stringify(id.replace(/[^A-Za-z0-9-]/g, ''))} + '"]');
    for (var i = 0; i < marks.length; i++) {
      var m = marks[i], p = m.parentNode;
      while (m.firstChild) p.insertBefore(m.firstChild, m);
      p.removeChild(m);
      p.normalize && p.normalize();
    }
  } catch (e) {}
})();
true;`;
}

export type AnnotateMessage =
  | { kind: 'anchor'; anchor: HighlightAnchor | null }
  | { kind: 'restored'; found: number; of: number }
  | { kind: 'lang'; lang: string; sample: string };

/** A page message for B23 (anchor, restore count, language), bounded; undefined for anything else. */
export function parseAnnotateMessage(raw: string): AnnotateMessage | undefined {
  if (typeof raw !== 'string' || raw.length > 20_000 || !raw.includes(ANNOTATE_MESSAGE)) return undefined;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (!data || data.type !== ANNOTATE_MESSAGE) return undefined;
  if (data.kind === 'anchor') return { kind: 'anchor', anchor: cleanAnchor(data) };
  if (data.kind === 'restored') {
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
    return { kind: 'restored', found: n(data.found), of: n(data.of) };
  }
  if (data.kind === 'lang') {
    return {
      kind: 'lang',
      lang: typeof data.lang === 'string' ? data.lang.slice(0, 35) : '',
      sample: typeof data.sample === 'string' ? data.sample.slice(0, 4000) : '',
    };
  }
  return undefined;
}

/** All-highlights search: text, note, title or address contains every word (case-insensitive). */
export function matchesHighlightQuery(
  h: { text: string; note: string; pageTitle: string; pageUrl: string },
  query: string,
  fold: (s: string) => string = (s) => s.toLowerCase(),
): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold(`${h.text}\n${h.note}\n${h.pageTitle}\n${h.pageUrl}`);
  return words.every((w) => hay.includes(w));
}

/** The text a shared highlight carries: the quote, the note, the page. */
export function shareTextFor(h: { text: string; note: string; pageTitle: string; pageUrl: string }): string {
  return [`“${h.text.trim()}”`, h.note.trim(), [h.pageTitle.trim(), h.pageUrl].filter(Boolean).join('\n')]
    .filter(Boolean)
    .join('\n\n');
}
