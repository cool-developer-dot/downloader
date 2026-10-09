/**
 * Bounded reading of fetched HTML for the direct analyzer: tags, attributes, script blocks and embedded JSON, found by
 * scanning text. There is no DOM and nothing on the page is ever executed.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeHtmlEntities(text: string): string {
  if (!text.includes('&')) {
    return text;
  }
  return text.replace(/&(#[xX][0-9a-fA-F]{1,6}|#\d{1,7}|[a-zA-Z]{2,8});/g, (match, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = hex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** JSON-in-JavaScript escapes that pages put around URLs (`https:\/\/`, `/`, `&`). */
export function unescapeScriptText(text: string): string {
  if (!text.includes('\\')) {
    return text;
  }
  return text
    .replace(/\\u002[fF]/g, '/')
    .replace(/\\u0026/g, '&')
    .replace(/\\u003[dD]/g, '=')
    .replace(/\\u0025/g, '%')
    .replace(/\\\//g, '/');
}

export type ScannedTag = {
  name: string;
  /** Lower-cased names; values entity-decoded. */
  attrs: Record<string, string>;
  start: number;
  /** Index just past the closing `>`. */
  end: number;
};

/** A tag's attribute text is bounded: a page cannot make one tag cost more than this. */
const MAX_TAG_LENGTH = 512 * 1024;

function isSpace(c: string): boolean {
  return c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '\f';
}

/** The tag that starts at `start` (`html[start] === '<'`), quote-aware; null when it is not a well-formed start tag. */
export function parseTagAt(html: string, start: number): ScannedTag | null {
  if (html[start] !== '<') {
    return null;
  }
  const limit = Math.min(html.length, start + MAX_TAG_LENGTH);
  let i = start + 1;
  const nameStart = i;
  while (i < limit && /[A-Za-z0-9:-]/.test(html[i]!)) {
    i += 1;
  }
  if (i === nameStart) {
    return null;
  }
  const name = html.slice(nameStart, i).toLowerCase();
  const attrs: Record<string, string> = {};
  while (i < limit) {
    while (i < limit && isSpace(html[i]!)) {
      i += 1;
    }
    const c = html[i];
    if (c === undefined) {
      return null;
    }
    if (c === '>') {
      return { name, attrs, start, end: i + 1 };
    }
    if (c === '/') {
      i += 1;
      continue;
    }
    const attrStart = i;
    while (i < limit && !isSpace(html[i]!) && html[i] !== '=' && html[i] !== '>' && html[i] !== '/') {
      i += 1;
    }
    const attrName = html.slice(attrStart, i).toLowerCase();
    while (i < limit && isSpace(html[i]!)) {
      i += 1;
    }
    let value = '';
    if (html[i] === '=') {
      i += 1;
      while (i < limit && isSpace(html[i]!)) {
        i += 1;
      }
      const quote = html[i];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, i + 1);
        if (close < 0 || close >= limit) {
          return null;
        }
        value = html.slice(i + 1, close);
        i = close + 1;
      } else {
        const valueStart = i;
        while (i < limit && !isSpace(html[i]!) && html[i] !== '>') {
          i += 1;
        }
        value = html.slice(valueStart, i);
      }
    }
    if (attrName && !(attrName in attrs)) {
      attrs[attrName] = decodeHtmlEntities(value);
    }
  }
  return null;
}

/** Start tags with one of `names`, in document order, at most `limit` of them. */
export function scanTags(html: string, names: readonly string[], limit = 4_000): ScannedTag[] {
  const pattern = new RegExp(`<(?:${names.join('|')})(?=[\\s/>])`, 'gi');
  const tags: ScannedTag[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) && tags.length < limit) {
    const tag = parseTagAt(html, match.index);
    if (tag) {
      tags.push(tag);
      pattern.lastIndex = tag.end;
    }
  }
  return tags;
}

/** Text between a start tag and its closing tag (`</name`), or null when it is never closed. */
export function elementText(html: string, tag: ScannedTag, maxLength = 4 * 1024 * 1024): { text: string; end: number } | null {
  const closing = new RegExp(`</${tag.name}\\s*>`, 'gi');
  closing.lastIndex = tag.end;
  const match = closing.exec(html);
  if (!match || match.index - tag.end > maxLength) {
    return null;
  }
  return { text: html.slice(tag.end, match.index), end: match.index + match[0].length };
}

export type ScriptBlock = { attrs: Record<string, string>; text: string };

export function scriptBlocks(html: string, limit = 400): ScriptBlock[] {
  const blocks: ScriptBlock[] = [];
  for (const tag of scanTags(html, ['script'], limit)) {
    const body = elementText(html, tag);
    if (body && body.text.trim()) {
      blocks.push({ attrs: tag.attrs, text: body.text });
    }
  }
  return blocks;
}

/** JSON text as pages embed it (optionally wrapped in an HTML comment or CDATA); undefined when it is not JSON. */
export function parseEmbeddedJson(text: string): unknown {
  let body = text.trim();
  if (body.startsWith('<!--')) {
    body = body.slice(4).replace(/-->\s*$/, '').trim();
  }
  if (body.startsWith('<![CDATA[')) {
    body = body.slice(9).replace(/\]\]>\s*$/, '').trim();
  }
  if (!body || (body[0] !== '{' && body[0] !== '[')) {
    return undefined;
  }
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/** Index of the bracket that closes the JSON value opening at `start` (`{` or `[`), or -1 (string-aware, bounded). */
export function balancedJsonEnd(text: string, start: number, maxLength = 3 * 1024 * 1024): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  const limit = Math.min(text.length, start + maxLength);
  for (let i = start; i < limit; i += 1) {
    const c = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (c === '\\') {
        escaped = true;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
    } else if (c === '{' || c === '[') {
      depth += 1;
    } else if (c === '}' || c === ']') {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
      if (depth < 0) {
        return -1;
      }
    }
  }
  return -1;
}

/**
 * JSON objects a script assigns or passes as data (`window.__STATE__ = {"…"}`, `init({"…"})`): only values that parse
 * as strict JSON are kept — nothing is evaluated.
 */
export function jsonValuesInScript(text: string, maxValues = 8): unknown[] {
  const values: unknown[] = [];
  const opener = /(?:=|\(|,)\s*(\{\s*"|\[\s*\{\s*")/g;
  let match: RegExpExecArray | null;
  let attempts = 0;
  while ((match = opener.exec(text)) && values.length < maxValues && attempts < 40) {
    attempts += 1;
    const start = match.index + match[0].length - match[1]!.length;
    const end = balancedJsonEnd(text, start);
    if (end < 0) {
      continue;
    }
    try {
      values.push(JSON.parse(text.slice(start, end + 1)));
      opener.lastIndex = end + 1;
    } catch {
      // Not strict JSON (a JavaScript object literal): skip it.
    }
  }
  return values;
}
