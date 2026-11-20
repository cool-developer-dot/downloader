/**
 * #485 Pattern Download: one link with numbered or lettered parts stands for many — `clip[001-100].mp4`,
 * `part[1-20:2].mp4` (every 2nd), `[a-e].mp4`, or alternatives `{low,high}.mp4`. Several ranges multiply. Pure.
 */

export const MAX_PATTERN_LINKS = 500;

export type PatternExpansion = {
  /** The links the pattern stands for, in order, at most [MAX_PATTERN_LINKS]. */
  urls: string[];
  /** How many links the pattern stands for in all (may be more than `urls`). */
  total: number;
  truncated: boolean;
};

type Part = { kind: 'text'; value: string } | { kind: 'choices'; values: string[] };

const RANGE = /^(\d+)-(\d+)(?::(\d+))?$/;
const LETTERS = /^([a-zA-Z])-([a-zA-Z])$/;

function rangeValues(spec: string): string[] | null {
  const numbers = RANGE.exec(spec);
  if (numbers) {
    const [, fromText, toText, stepText] = numbers;
    const from = Number(fromText);
    const to = Number(toText);
    const step = stepText ? Number(stepText) : 1;
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || step < 1) return null;
    // A leading zero on the first bound sets the width: [001-100] → 001, 002 … 100.
    const width = fromText!.length > 1 && fromText!.startsWith('0') ? fromText!.length : 0;
    const values: string[] = [];
    const up = to >= from;
    for (let n = from; up ? n <= to : n >= to; n += up ? step : -step) {
      values.push(width ? String(n).padStart(width, '0') : String(n));
      if (values.length > MAX_PATTERN_LINKS) break;
    }
    return values;
  }
  const letters = LETTERS.exec(spec);
  if (letters) {
    const from = letters[1]!.charCodeAt(0);
    const to = letters[2]!.charCodeAt(0);
    const sameCase = (letters[1]! >= 'a') === (letters[2]! >= 'a');
    if (!sameCase) return null;
    const values: string[] = [];
    for (let c = from; from <= to ? c <= to : c >= to; c += from <= to ? 1 : -1) values.push(String.fromCharCode(c));
    return values;
  }
  return null;
}

function parse(pattern: string): Part[] | null {
  const parts: Part[] = [];
  let text = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i]!;
    if (ch === '[' || ch === '{') {
      const close = pattern.indexOf(ch === '[' ? ']' : '}', i + 1);
      if (close < 0) return null;
      const spec = pattern.slice(i + 1, close);
      const values = ch === '[' ? rangeValues(spec) : spec.split(',').map((s) => s.trim()).filter(Boolean);
      // A bracket that is not a range (an IPv6 host, a literal) stays text.
      if (!values || values.length === 0) {
        text += pattern.slice(i, close + 1);
      } else {
        if (text) parts.push({ kind: 'text', value: text });
        text = '';
        parts.push({ kind: 'choices', values });
      }
      i = close + 1;
      continue;
    }
    text += ch;
    i += 1;
  }
  if (text) parts.push({ kind: 'text', value: text });
  return parts;
}

/** Whether `text` holds a range or alternatives that [expandUrlPattern] would expand. */
export function isUrlPattern(text: string): boolean {
  const parts = parse(text.trim());
  return Boolean(parts?.some((part) => part.kind === 'choices'));
}

export function expandUrlPattern(pattern: string, max = MAX_PATTERN_LINKS): PatternExpansion {
  const parts = parse(pattern.trim());
  if (!parts || !/^(?:https?|ftp):\/\//i.test(pattern.trim())) {
    return { urls: [], total: 0, truncated: false };
  }
  const total = parts.reduce((count, part) => (part.kind === 'choices' ? count * part.values.length : count), 1);
  const urls: string[] = [];
  const walk = (index: number, prefix: string) => {
    if (urls.length >= max) return;
    if (index === parts.length) {
      urls.push(prefix);
      return;
    }
    const part = parts[index]!;
    if (part.kind === 'text') {
      walk(index + 1, prefix + part.value);
      return;
    }
    for (const value of part.values) {
      walk(index + 1, prefix + value);
      if (urls.length >= max) return;
    }
  };
  walk(0, '');
  return { urls, total, truncated: total > urls.length };
}
