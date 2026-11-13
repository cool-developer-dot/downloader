/**
 * B23 #289 — page change alerts: the pure rules (tested under Node). A watched page is fetched without cookies, its
 * visible text taken from the HTML (no JavaScript runs), and a hash of that text compared with the last one.
 */

export const MAX_WATCHES = 20;
export const DEFAULT_ALERT_HOURS = 6;
export const MIN_ALERT_HOURS = 1;
export const MAX_ALERT_HOURS = 168;
/** Below this much text the page is built by JavaScript: it can't be watched. */
export const MIN_WATCH_TEXT = 200;
export const PAGE_ALERT_TASK = 'vidorax-page-alerts';

export function clampAlertHours(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_ALERT_HOURS;
  return Math.min(MAX_ALERT_HOURS, Math.max(MIN_ALERT_HOURS, Math.round(n)));
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** The text a reader sees without JavaScript: no scripts, styles, templates, noscript, comments or tags; spaces collapsed. */
export function extractPageText(html: string): string {
  const body = /<body[\s>][\s\S]*$/i.exec(html)?.[0] ?? html;
  return decodeEntities(
    body
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractTitle(html: string): string {
  const raw = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '';
  return decodeEntities(raw).replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** Pages whose content needs JavaScript: too little text without it. */
export function needsJavaScript(text: string): boolean {
  return text.length < MIN_WATCH_TEXT;
}

/** FNV-1a (two 32-bit lanes) of the text: 16 hex characters. */
export function hashText(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x9747b28c;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x01000193) >>> 0;
    b = (b ^ (b >>> 15)) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

export type WatchCheck =
  | { status: 'changed'; hash: string; title: string }
  | { status: 'same' }
  | { status: 'cannotWatch' }
  | { status: 'failed' };

/** One fetched page against its last hash. */
export function checkFetchedPage(
  fetched: { ok: boolean; status: number; text: string; contentType: string },
  lastHash: string,
): WatchCheck {
  if (!fetched.ok || fetched.status < 200 || fetched.status >= 400) return { status: 'failed' };
  if (fetched.contentType && !/html|xml|text\/plain/i.test(fetched.contentType)) return { status: 'cannotWatch' };
  const text = extractPageText(fetched.text);
  if (needsJavaScript(text)) return { status: 'cannotWatch' };
  const hash = hashText(text);
  if (hash === lastHash) return { status: 'same' };
  return { status: 'changed', hash, title: extractTitle(fetched.text) };
}

/** Whether a check may run on this connection (Wi-Fi only by default; ethernet counts as Wi-Fi). */
export function connectionAllows(type: string | null | undefined, connected: boolean, wifiOnly: boolean): boolean {
  if (!connected) return false;
  if (!wifiOnly) return true;
  return type === 'wifi' || type === 'ethernet';
}
