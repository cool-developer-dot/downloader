/**
 * #505 Include/Exclude Rules: one filter for every bulk source (Batch Add, patterns, playlists, the page link
 * grabber, feeds and the site grabber). Rules about the link are decided before anything is fetched; the size rule
 * once a source's size is known. Empty rules let everything through. Pure.
 */

export type LinkRules = {
  /** Only these file extensions (lower case, no dot); empty = any. */
  includeExtensions: string[];
  /** Never these extensions. */
  excludeExtensions: string[];
  /** Only links containing one of these words (case-insensitive); empty = any. */
  includeKeywords: string[];
  /** Never links containing one of these words. */
  excludeKeywords: string[];
  /** Only links matching this regular expression (empty = any). */
  includePattern: string;
  /** Never links matching this regular expression. */
  excludePattern: string;
  /** Smallest and largest file, in MB (0 = no limit). */
  minSizeMb: number;
  maxSizeMb: number;
};

export const EMPTY_LINK_RULES: LinkRules = {
  includeExtensions: [],
  excludeExtensions: [],
  includeKeywords: [],
  excludeKeywords: [],
  includePattern: '',
  excludePattern: '',
  minSizeMb: 0,
  maxSizeMb: 0,
};

export type RuleSkip = 'extension' | 'keyword' | 'pattern' | 'size';

function extensionOf(url: string): string | null {
  try {
    const last = new URL(url).pathname.split('/').pop() ?? '';
    const dot = last.lastIndexOf('.');
    return dot > 0 && dot < last.length - 1 ? last.slice(dot + 1).toLowerCase() : null;
  } catch {
    return null;
  }
}

function safeRegex(source: string): RegExp | null {
  if (!source.trim()) return null;
  try {
    return new RegExp(source, 'i');
  } catch {
    return null;
  }
}

/** A user-entered list ("mp4, .mkv webm") → clean lower-case words without dots. */
export function parseRuleList(text: string): string[] {
  return Array.from(new Set(text.split(/[\s,;]+/).map((word) => word.trim().replace(/^\./, '').toLowerCase()).filter(Boolean)));
}

/** Whether a regular expression typed by the user compiles (an invalid one is ignored, never applied). */
export function isValidRulePattern(source: string): boolean {
  return !source.trim() || safeRegex(source) !== null;
}

/** Why [url] is skipped by [rules] before anything is fetched, or null when it may go on. */
export function linkRuleSkip(url: string, rules: LinkRules): RuleSkip | null {
  const lower = url.toLowerCase();
  const ext = extensionOf(url);
  if (rules.includeExtensions.length > 0 && (!ext || !rules.includeExtensions.includes(ext))) return 'extension';
  if (ext && rules.excludeExtensions.includes(ext)) return 'extension';
  if (rules.includeKeywords.length > 0 && !rules.includeKeywords.some((word) => lower.includes(word.toLowerCase()))) return 'keyword';
  if (rules.excludeKeywords.some((word) => lower.includes(word.toLowerCase()))) return 'keyword';
  const include = safeRegex(rules.includePattern);
  if (include && !include.test(url)) return 'pattern';
  const exclude = safeRegex(rules.excludePattern);
  if (exclude && exclude.test(url)) return 'pattern';
  return null;
}

/** Whether a source of [bytes] passes the size rule (an unknown size always does). */
export function sizeAllowed(bytes: number | null | undefined, rules: LinkRules): boolean {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return true;
  const mb = bytes / (1024 * 1024);
  if (rules.minSizeMb > 0 && mb < rules.minSizeMb) return false;
  if (rules.maxSizeMb > 0 && mb > rules.maxSizeMb) return false;
  return true;
}

export function hasLinkRules(rules: LinkRules): boolean {
  return (
    rules.includeExtensions.length > 0 ||
    rules.excludeExtensions.length > 0 ||
    rules.includeKeywords.length > 0 ||
    rules.excludeKeywords.length > 0 ||
    Boolean(rules.includePattern.trim()) ||
    Boolean(rules.excludePattern.trim()) ||
    rules.minSizeMb > 0 ||
    rules.maxSizeMb > 0
  );
}

/** A stored value → valid rules (anything unreadable is "no rules"). */
export function normalizeLinkRules(value: unknown): LinkRules {
  if (!value || typeof value !== 'object') return { ...EMPTY_LINK_RULES };
  const raw = value as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? parseRuleList(v.filter((x) => typeof x === 'string').join(' ')) : []);
  const text = (v: unknown) => (typeof v === 'string' ? v.slice(0, 300) : '');
  const size = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
  return {
    includeExtensions: list(raw.includeExtensions),
    excludeExtensions: list(raw.excludeExtensions),
    includeKeywords: list(raw.includeKeywords),
    excludeKeywords: list(raw.excludeKeywords),
    includePattern: text(raw.includePattern),
    excludePattern: text(raw.excludePattern),
    minSizeMb: size(raw.minSizeMb),
    maxSizeMb: size(raw.maxSizeMb),
  };
}
