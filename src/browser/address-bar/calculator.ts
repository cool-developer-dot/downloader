/**
 * B4 #268 Address bar calculator. An expression typed in the address bar (`12*(3+4)/2`, `15% of 2000`, `2^10`,
 * `۱۲+۳`) shows its result as the first suggestion. Own recursive-descent parser — the text is never evaluated as
 * code. Pure.
 *
 * Grammar (precedence low → high):
 *   expr    := term (('+' | '-') term)*
 *   term    := power (('*' | '/' | implicit-of) power)*          `a% of b` = a/100 × b
 *   power   := unary ('^' power)?                                 right-associative
 *   unary   := ('+' | '-') unary | percent
 *   percent := primary '%'?                                       `50%` = 0.5
 *   primary := number | '(' expr ')'
 * Accepted symbols: × ÷ − for * / -, `**` for ^, Eastern Arabic and Extended Arabic-Indic digits, `٫` / `,` decimal.
 */

import { toAsciiDigits } from '@/utils/search-text';

export type CalculatorResult = { expression: string; value: number; display: string };

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'op'; value: '+' | '-' | '*' | '/' | '^' | '%' | '(' | ')' | 'of' };

const MAX_INPUT = 120;

function tokenize(input: string): Token[] | null {
  const text = toAsciiDigits(input)
    .replace(/[×xX]/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–]/g, '-')
    .replace(/\*\*/g, '^')
    .replace(/٫/g, '.')
    .toLowerCase();
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < text.length && /[0-9.,]/.test(text[j]!)) j += 1;
      const raw = text.slice(i, j);
      // `1,000` style thousands separators; a lone comma is a decimal point (`2,5`).
      const normalized = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(raw) ? raw.replace(/,/g, '') : raw.replace(',', '.');
      if (!/^(\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
      tokens.push({ kind: 'num', value: Number(normalized) });
      i = j;
      continue;
    }
    if ('+-*/^%()'.includes(ch)) {
      tokens.push({ kind: 'op', value: ch as Token['value'] & string } as Token);
      i += 1;
      continue;
    }
    if (text.startsWith('of', i)) {
      tokens.push({ kind: 'op', value: 'of' });
      i += 2;
      continue;
    }
    return null;
  }
  return tokens;
}

class Parser {
  private index = 0;
  private readonly tokens: Token[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): number | null {
    const value = this.expr();
    if (value == null || this.index !== this.tokens.length) return null;
    return value;
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private isOp(value: string): boolean {
    const token = this.peek();
    return token?.kind === 'op' && token.value === value;
  }

  private expr(): number | null {
    let left = this.term();
    while (left != null && (this.isOp('+') || this.isOp('-'))) {
      const op = (this.tokens[this.index++] as { value: string }).value;
      const right = this.term();
      if (right == null) return null;
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  private term(): number | null {
    let left = this.power();
    while (left != null && (this.isOp('*') || this.isOp('/') || this.isOp('of'))) {
      const op = (this.tokens[this.index++] as { value: string }).value;
      const right = this.power();
      if (right == null) return null;
      if (op === '/') {
        if (right === 0) return null;
        left = left / right;
      } else {
        left = left * right;
      }
    }
    return left;
  }

  private power(): number | null {
    const base = this.unary();
    if (base == null) return null;
    if (this.isOp('^')) {
      this.index += 1;
      const exponent = this.power();
      if (exponent == null) return null;
      return base ** exponent;
    }
    return base;
  }

  private unary(): number | null {
    if (this.isOp('-')) {
      this.index += 1;
      const value = this.unary();
      return value == null ? null : -value;
    }
    if (this.isOp('+')) {
      this.index += 1;
      return this.unary();
    }
    return this.percent();
  }

  private percent(): number | null {
    const value = this.primary();
    if (value == null) return null;
    if (this.isOp('%')) {
      this.index += 1;
      return value / 100;
    }
    return value;
  }

  private primary(): number | null {
    const token = this.peek();
    if (!token) return null;
    if (token.kind === 'num') {
      this.index += 1;
      return token.value;
    }
    if (token.value === '(') {
      this.index += 1;
      const value = this.expr();
      if (value == null || !this.isOp(')')) return null;
      this.index += 1;
      return value;
    }
    return null;
  }
}

/** Up to 12 significant digits, no trailing zeros, no exponent for ordinary magnitudes. */
export function formatCalculatorValue(value: number): string {
  if (Object.is(value, -0)) return '0';
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 1e15 || abs < 1e-9)) {
    return value.toExponential(6).replace(/\.?0+e/, 'e');
  }
  const fixed = Number(value.toPrecision(12));
  return String(fixed);
}

/**
 * The result of `input` when it is a calculation, else null: a plain number, text, an unfinished expression
 * (`12*`, `(3+4`), a division by zero or a non-finite result give no suggestion.
 */
export function evaluateCalculation(input: string): CalculatorResult | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > MAX_INPUT) return null;
  const tokens = tokenize(trimmed);
  if (!tokens || tokens.length < 2) return null;
  // At least one real operation: a lone `-5` or `5%` is not a calculation worth showing.
  const ops = tokens.filter((t) => t.kind === 'op' && t.value !== '(' && t.value !== ')');
  const nums = tokens.filter((t) => t.kind === 'num');
  if (nums.length < 2 || ops.length < 1) return null;
  const value = new Parser(tokens).parse();
  if (value == null || !Number.isFinite(value)) return null;
  return { expression: trimmed, value, display: formatCalculatorValue(value) };
}
