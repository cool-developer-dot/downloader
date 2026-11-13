/**
 * B15 #161 / #172 — the page's reader answers (`reader-scripts.ts`), checked, and the article the reader shows. Pure.
 *
 * Any page can post on the `vidorax-reader` channel, so everything is checked here: bounded sizes, strings only, the
 * HTML sanitised (`reader-sanitize.ts`) before it becomes blocks. A forged answer can at most show the page's own text.
 */
import { blockText, readerBlocks, sanitizeReaderHtml, type ReaderBlock } from './reader-sanitize';
import { READER_CHANNEL } from './reader-scripts';

/** Largest raw message taken (the page caps the HTML at 2,000,000 characters; this leaves room for the rest). */
export const READER_MESSAGE_MAX = 2_200_000;

export type ReaderMessage =
  | { type: 'state'; requestId: number; readerable: boolean; url: string }
  | {
      type: 'article';
      requestId: number;
      ok: true;
      url: string;
      title: string;
      byline: string;
      siteName: string;
      lang: string;
      dir: string;
      html: string;
      truncated: boolean;
    }
  | { type: 'article'; requestId: number; ok: false; url: string };

/** Cheap test before parsing: the reader scripts' messages start with exactly this. */
export const READER_MESSAGE_PREFIX = `{"channel":"${READER_CHANNEL}"`;

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function webUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 8192) return null;
  const lower = value.toLowerCase();
  return lower.startsWith('https://') || lower.startsWith('http://') ? value : null;
}

export function parseReaderMessage(raw: string | null | undefined): ReaderMessage | null {
  if (typeof raw !== 'string' || raw.length > READER_MESSAGE_MAX || !raw.startsWith(READER_MESSAGE_PREFIX)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const envelope = parsed as { channel?: unknown; payload?: unknown };
  if (envelope.channel !== READER_CHANNEL || !envelope.payload || typeof envelope.payload !== 'object') return null;
  const p = envelope.payload as Record<string, unknown>;
  const requestId = p.requestId;
  if (typeof requestId !== 'number' || !Number.isInteger(requestId) || requestId < 0) return null;
  const url = webUrl(p.url);
  if (!url) return null;
  if (p.type === 'state') {
    if (typeof p.readerable !== 'boolean') return null;
    return { type: 'state', requestId, readerable: p.readerable, url };
  }
  if (p.type !== 'article') return null;
  if (p.ok !== true || typeof p.html !== 'string') return { type: 'article', requestId, ok: false, url };
  return {
    type: 'article',
    requestId,
    ok: true,
    url,
    title: text(p.title, 500),
    byline: text(p.byline, 300),
    siteName: text(p.siteName, 200),
    lang: text(p.lang, 35),
    dir: p.dir === 'rtl' ? 'rtl' : p.dir === 'ltr' ? 'ltr' : '',
    html: p.html,
    truncated: p.truncated === true,
  };
}

export type ReaderArticle = {
  url: string;
  title: string;
  byline: string;
  siteName: string;
  /** Minutes to read (at least 1). */
  minutes: number;
  rtl: boolean;
  /** Urdu text: shown in Nastaliq, read aloud with an Urdu voice. */
  urdu: boolean;
  /** BCP-47 language for read aloud ('' = the phone's default). */
  language: string;
  blocks: ReaderBlock[];
  truncated: boolean;
};

// Arabic script (Arabic, Supplement, Extended-A, Presentation Forms A/B).
const ARABIC_SCRIPT = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/g;
// Letters Urdu uses and Arabic / Persian text almost never does: ٹ ڈ ڑ ں ھ ہ ے ۓ.
const URDU_LETTERS = /[\u0679\u0688\u0691\u06ba\u06be\u06c1\u06d2\u06d3]/g;
const LETTER = /\p{L}/gu;

/** Other languages written in Arabic script: never shown in Nastaliq. */
const OTHER_ARABIC_SCRIPT_LANGUAGES = new Set(['ar', 'fa', 'ps', 'sd', 'ug', 'ku', 'ckb']);

/**
 * Whether text is Urdu: a page that says `ur` is; one that says Arabic, Persian, Pashto… isn't; otherwise (no language,
 * or a wrong one such as the `en` many Urdu sites leave in their template) it is when Arabic script fills it and Urdu's
 * own letters show up.
 */
export function isUrduText(sample: string, lang: string): boolean {
  const primary = lang.toLowerCase().split(/[-_]/)[0] ?? '';
  if (primary === 'ur') return true;
  if (OTHER_ARABIC_SCRIPT_LANGUAGES.has(primary)) return false;
  const letters = sample.match(LETTER)?.length ?? 0;
  if (letters < 20) return false;
  const arabic = sample.match(ARABIC_SCRIPT)?.length ?? 0;
  if (arabic / letters < 0.5) return false;
  const urdu = sample.match(URDU_LETTERS)?.length ?? 0;
  return urdu / arabic >= 0.02;
}

const WORDS_PER_MINUTE = 220;
// Scripts written without spaces between words: counted by characters instead.
const NO_SPACE_SCRIPTS = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\u0e00-\u0e7f]/g;

export function readingMinutes(text: string): number {
  const cjk = text.match(NO_SPACE_SCRIPTS)?.length ?? 0;
  const words = text.replace(NO_SPACE_SCRIPTS, ' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round((words + cjk / 2) / WORDS_PER_MINUTE));
}

/** The article to show, or null when nothing readable is left after sanitising. */
export function buildReaderArticle(message: Extract<ReaderMessage, { ok: true }>): ReaderArticle | null {
  const blocks = readerBlocks(sanitizeReaderHtml(message.html, message.url));
  const allText = blocks.map(blockText).join('\n');
  if (!allText.trim()) return null;
  const sample = `${message.title}\n${allText.slice(0, 4000)}`;
  const urdu = isUrduText(sample, message.lang);
  const arabicShare = (sample.match(ARABIC_SCRIPT)?.length ?? 0) / Math.max(1, sample.match(LETTER)?.length ?? 0);
  const rtl = message.dir ? message.dir === 'rtl' : arabicShare > 0.5 || /[\u0590-\u05ff]/.test(sample.slice(0, 400));
  let language = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(message.lang) ? message.lang : '';
  if (urdu) language = 'ur-PK';
  return {
    url: message.url,
    title: message.title,
    byline: message.byline,
    siteName: message.siteName,
    minutes: readingMinutes(allText),
    rtl,
    urdu,
    language,
    blocks,
    truncated: message.truncated,
  };
}
