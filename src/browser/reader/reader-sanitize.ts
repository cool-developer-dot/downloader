/**
 * B15 #161 — what reader mode shows of an article. Pure.
 *
 * Readability (run in the page) hands back the article as an HTML string. The app never renders that HTML: it is first
 * **sanitised** (`sanitizeReaderHtml` — a whitelist; scripts, styles, frames, forms, media, SVG and their contents
 * dropped; every attribute dropped except a link's http(s) `href` and an image's http(s) `src` / `alt`; `javascript:`,
 * `data:`… links become plain text) and then turned into **blocks** (`readerBlocks` — paragraphs, headings, list items,
 * quotes, code, images, rules) that the reader draws with the app's own views. Nothing from the page runs in the app.
 */

export type ReaderSpan = { text: string; bold?: boolean; italic?: boolean; code?: boolean; href?: string };

export type ReaderBlock =
  | { type: 'p'; spans: ReaderSpan[] }
  | { type: 'h'; level: 1 | 2 | 3; spans: ReaderSpan[] }
  | { type: 'li'; ordered: boolean; index: number; depth: number; spans: ReaderSpan[] }
  | { type: 'quote'; spans: ReaderSpan[] }
  | { type: 'pre'; text: string }
  | { type: 'img'; src: string; alt: string }
  | { type: 'hr' };

/** Dropped together with everything inside them. */
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'noscript', 'template', 'svg', 'math',
  'form', 'select', 'textarea', 'button', 'input', 'canvas', 'audio', 'video', 'source', 'track', 'head', 'title',
  'link', 'meta', 'base', 'dialog', 'portal', 'slot',
]);
const VOID = new Set(['br', 'hr', 'img', 'input', 'embed', 'link', 'meta', 'base', 'source', 'track', 'wbr', 'area', 'col', 'param']);
/** Kept as they are (attributes stripped). */
const KEEP = new Set(['p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'em', 'i', 'strong', 'b', 'a', 'img', 'hr', 'figcaption']);
/** Turned into a paragraph boundary. */
const AS_PARAGRAPH = new Set(['div', 'section', 'article', 'main', 'header', 'footer', 'aside', 'figure', 'tr', 'dd', 'dt', 'caption', 'details', 'summary', 'address', 'nav']);
/** Their text stays, the tag goes (inline). Anything else unknown: the same. */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©' };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(text: string): string {
  return escapeText(text).replace(/"/g, '&quot;');
}

/** An http(s) address (relative ones resolved against the article's address); anything else is null. */
export function safeUrl(raw: string | undefined, baseUrl: string): string | null {
  if (!raw) return null;
  // Control and whitespace characters are how "java\tscript:" sneaks past naive checks: strip them first.
  const cleaned = decodeEntities(raw).replace(/[\u0000-\u0020\u007f]/g, '');
  if (!cleaned || cleaned.length > 4096) return null;
  try {
    const url = new URL(cleaned, baseUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

type Token =
  | { kind: 'open'; name: string; attrs: Record<string, string>; selfClosing: boolean }
  | { kind: 'close'; name: string }
  | { kind: 'text'; text: string };

const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)|(<)/g;
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(html))) {
    if (m[2]) {
      const name = m[2].toLowerCase();
      if (m[1] === '/') {
        tokens.push({ kind: 'close', name });
        continue;
      }
      const rawAttrs = m[3] ?? '';
      const attrs: Record<string, string> = {};
      ATTR.lastIndex = 0;
      let a: RegExpExecArray | null;
      while ((a = ATTR.exec(rawAttrs))) {
        const key = a[1].toLowerCase();
        if (!(key in attrs)) attrs[key] = a[2] ?? a[3] ?? a[4] ?? '';
      }
      tokens.push({ kind: 'open', name, attrs, selfClosing: /\/\s*$/.test(rawAttrs) || VOID.has(name) });
    } else if (m[4] != null) {
      tokens.push({ kind: 'text', text: m[4] });
    } else if (m[5] != null) {
      tokens.push({ kind: 'text', text: '<' });
    }
    // Comments, CDATA, doctypes and processing instructions: dropped.
  }
  return tokens;
}

/** The article HTML with only the whitelist left (see the file comment). Output is our own, escaped HTML. */
export function sanitizeReaderHtml(html: string, baseUrl: string): string {
  const out: string[] = [];
  const open: string[] = [];
  let dropping: { name: string; depth: number } | null = null;
  for (const token of tokenize(html.slice(0, 3_000_000))) {
    if (dropping) {
      if (token.kind === 'open' && token.name === dropping.name && !token.selfClosing) dropping.depth += 1;
      else if (token.kind === 'close' && token.name === dropping.name && --dropping.depth === 0) dropping = null;
      continue;
    }
    if (token.kind === 'text') {
      out.push(escapeText(decodeEntities(token.text)));
      continue;
    }
    if (DROP_WITH_CONTENT.has(token.name)) {
      if (token.kind === 'open' && !token.selfClosing) dropping = { name: token.name, depth: 1 };
      continue;
    }
    const name = AS_PARAGRAPH.has(token.name) ? 'p' : token.name;
    if (!KEEP.has(name)) continue;
    if (token.kind === 'close') {
      if (VOID.has(name)) continue;
      const at = open.lastIndexOf(name);
      if (at < 0) continue;
      while (open.length > at) out.push(`</${open.pop()}>`);
      continue;
    }
    if (name === 'img') {
      const src = safeUrl(token.attrs.src, baseUrl);
      if (src) out.push(`<img src="${escapeAttr(src)}" alt="${escapeAttr(decodeEntities(token.attrs.alt ?? '').slice(0, 300))}">`);
      continue;
    }
    if (name === 'br' || name === 'hr') {
      out.push(`<${name}>`);
      continue;
    }
    if (name === 'a') {
      const href = safeUrl(token.attrs.href, baseUrl);
      // A link without a web address is plain text: no <a> at all.
      if (!href) continue;
      out.push(`<a href="${escapeAttr(href)}">`);
      if (!token.selfClosing) open.push('a');
      continue;
    }
    if (token.selfClosing) continue;
    out.push(`<${name}>`);
    open.push(name);
  }
  while (open.length) out.push(`</${open.pop()}>`);
  return out.join('');
}

type Marks = { bold: number; italic: number; code: number; href: string[] };

/** The sanitised HTML as blocks for the app's views (whitespace collapsed outside <pre>; empty blocks dropped). */
export function readerBlocks(sanitizedHtml: string): ReaderBlock[] {
  const blocks: ReaderBlock[] = [];
  const marks: Marks = { bold: 0, italic: 0, code: 0, href: [] };
  let spans: ReaderSpan[] = [];
  let pre: string | null = null;
  type Current = { type: 'p' } | { type: 'h'; level: 1 | 2 | 3 } | { type: 'quote' } | { type: 'li'; ordered: boolean; index: number; depth: number };
  // Widened on purpose: startBlock (a closure) changes it.
  let current = { type: 'p' } as Current;
  const lists: { ordered: boolean; count: number }[] = [];
  let quoteDepth = 0;

  const flush = () => {
    // Collapse white space across the spans, trim the ends, drop empty spans.
    const cleaned: ReaderSpan[] = [];
    for (const span of spans) {
      const prev = cleaned[cleaned.length - 1];
      let text = span.text;
      // One space between words across spans; none around a line break.
      if (prev && /[ \n]$/.test(prev.text)) text = text.replace(/^ +/, '');
      if (prev && text.startsWith('\n')) prev.text = prev.text.replace(/ +$/, '');
      if (!text) continue;
      if (prev && prev.bold === span.bold && prev.italic === span.italic && prev.code === span.code && prev.href === span.href) {
        prev.text += text;
      } else {
        cleaned.push({ ...span, text });
      }
    }
    if (cleaned.length) {
      cleaned[0].text = cleaned[0].text.replace(/^\s+/, '');
      cleaned[cleaned.length - 1].text = cleaned[cleaned.length - 1].text.replace(/\s+$/, '');
    }
    const kept = cleaned.filter((s) => s.text.length > 0);
    if (kept.some((s) => s.text.trim())) {
      if (current.type === 'h') blocks.push({ type: 'h', level: current.level, spans: kept });
      else if (current.type === 'li') blocks.push({ ...current, spans: kept });
      else blocks.push({ type: quoteDepth > 0 ? 'quote' : current.type, spans: kept } as ReaderBlock);
    }
    spans = [];
  };

  const startBlock = (next: typeof current) => {
    flush();
    current = next;
  };

  for (const token of tokenize(sanitizedHtml)) {
    if (token.kind === 'text') {
      const text = decodeEntities(token.text);
      if (pre != null) {
        pre += text;
        continue;
      }
      // HTML white space (not the no-break space) is one space outside <pre>.
      const span: ReaderSpan = { text: text.replace(/[ \t\n\r\f]+/g, ' ') };
      if (marks.bold) span.bold = true;
      if (marks.italic) span.italic = true;
      if (marks.code) span.code = true;
      if (marks.href.length) span.href = marks.href[marks.href.length - 1];
      spans.push(span);
      continue;
    }
    const opening = token.kind === 'open';
    switch (token.name) {
      case 'strong':
      case 'b':
        marks.bold += opening ? 1 : marks.bold > 0 ? -1 : 0;
        break;
      case 'em':
      case 'i':
        marks.italic += opening ? 1 : marks.italic > 0 ? -1 : 0;
        break;
      case 'code':
        if (pre == null) marks.code += opening ? 1 : marks.code > 0 ? -1 : 0;
        break;
      case 'a':
        if (opening) marks.href.push(token.attrs.href ?? '');
        else marks.href.pop();
        break;
      case 'br':
        if (pre != null) pre += '\n';
        else spans.push({ text: '\n' });
        break;
      case 'pre':
        if (opening) {
          flush();
          pre = '';
        } else if (pre != null) {
          const text = pre.replace(/^\n+|\s+$/g, '');
          if (text) blocks.push({ type: 'pre', text });
          pre = null;
        }
        break;
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6': {
        const level = Math.min(3, Number(token.name[1])) as 1 | 2 | 3;
        startBlock(opening ? { type: 'h', level } : { type: 'p' });
        break;
      }
      case 'ul':
      case 'ol':
        flush();
        if (opening) lists.push({ ordered: token.name === 'ol', count: 0 });
        else lists.pop();
        current = { type: 'p' };
        break;
      case 'li':
        if (opening) {
          const list = lists[lists.length - 1] ?? { ordered: false, count: 0 };
          list.count += 1;
          startBlock({ type: 'li', ordered: list.ordered, index: list.count, depth: Math.max(0, lists.length - 1) });
        } else {
          startBlock({ type: 'p' });
        }
        break;
      case 'blockquote':
        flush();
        quoteDepth += opening ? 1 : quoteDepth > 0 ? -1 : 0;
        current = { type: 'p' };
        break;
      case 'img':
        if (opening && token.attrs.src) {
          flush();
          blocks.push({ type: 'img', src: token.attrs.src, alt: decodeEntities(token.attrs.alt ?? '') });
        }
        break;
      case 'hr':
        flush();
        blocks.push({ type: 'hr' });
        break;
      default:
        // p, figcaption: a paragraph boundary.
        if (current.type !== 'li' || !opening) startBlock({ type: 'p' });
        else flush();
    }
  }
  flush();
  return blocks;
}

/** All the text of the blocks (reading time, language, read aloud). */
export function blockText(block: ReaderBlock): string {
  if (block.type === 'pre') return block.text;
  if (block.type === 'img' || block.type === 'hr') return '';
  return block.spans.map((s) => s.text).join('');
}
