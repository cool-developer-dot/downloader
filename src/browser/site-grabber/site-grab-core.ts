/**
 * #486 Site grabber — the pure part: robots.txt, which links of a page belong to the same site and are pages, and
 * which name videos. The crawl itself (src/browser/site-grabber/site-grabber.service.ts) reads at most
 * [MAX_SITE_PAGES] pages, [MAX_SITE_DEPTH] links deep from the start, one page a second, and skips what robots.txt
 * disallows.
 */

export const MAX_SITE_PAGES = 50;
export const MAX_SITE_DEPTH = 2;
export const SITE_REQUEST_INTERVAL_MS = 1_000;
const MAX_LINKS_PER_PAGE = 300;
const MAX_VIDEOS = 200;

export type RobotsRule = { allow: boolean; path: string };
export type RobotsRules = { rules: RobotsRule[] };

/** Allows everything: no robots.txt, or one that could not be read as text. */
export const ALLOW_ALL: RobotsRules = { rules: [] };

/**
 * The rules for VidoraX in a robots.txt: the group naming `vidorax`, else the `*` group. Unknown lines are ignored.
 */
export function parseRobots(text: string): RobotsRules {
  type Group = { agents: string[]; rules: RobotsRule[] };
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1]!.toLowerCase();
    const value = match[2]!.trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === 'disallow' && value !== '') current.rules.push({ allow: false, path: value });
    if (key === 'allow' && value !== '') current.rules.push({ allow: true, path: value });
  }
  const mine = groups.find((g) => g.agents.some((a) => a !== '*' && 'vidorax'.includes(a)));
  const any = groups.filter((g) => g.agents.includes('*'));
  return { rules: mine ? mine.rules : any.flatMap((g) => g.rules) };
}

function patternMatches(pattern: string, path: string): number {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source = body
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${source}${anchored ? '$' : ''}`).test(path) ? body.length : -1;
}

/** Whether robots.txt lets VidoraX read [url]: the longest matching rule wins, Allow on a tie. */
export function robotsAllow(robots: RobotsRules, url: string): boolean {
  let path: string;
  try {
    const parsed = new URL(url);
    path = parsed.pathname + parsed.search;
  } catch {
    return false;
  }
  let best = -1;
  let allowed = true;
  for (const rule of robots.rules) {
    const length = patternMatches(rule.path, path);
    if (length > best || (length === best && rule.allow)) {
      if (length >= 0) {
        best = length;
        allowed = rule.allow;
      }
    }
  }
  return allowed;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Same site: the same host, with or without `www.`. */
export function sameSite(a: string, b: string): boolean {
  const ha = hostOf(a);
  return ha !== null && ha === hostOf(b);
}

const NOT_A_PAGE =
  /\.(?:jpe?g|png|gif|webp|avif|svg|ico|bmp|css|js|mjs|json|xml|rss|atom|txt|pdf|zip|rar|7z|gz|tar|apk|exe|dmg|msi|iso|mp3|m4a|aac|ogg|wav|flac|mp4|m4v|mov|webm|mkv|flv|ts|m3u8|mpd|avi|wmv|3gp|woff2?|ttf|otf|eot)$/i;
/** Links that change state or lead to accounts, never worth saving. */
const SKIP_PATH = /\/(?:log-?in|log-?out|sign-?in|sign-?out|sign-?up|register|account|cart|checkout|wp-admin|admin)(?:\/|$)/i;

function decodeEntities(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
}

function resolve(raw: string, base: string): URL | null {
  try {
    const url = new URL(decodeEntities(raw), base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** A page's links to other pages of the same site: no fragments, files, account or cart pages. */
export function sitePageLinks(html: string, pageUrl: string): string[] {
  const found = new Set<string>();
  const base = /<base\b[^>]*href\s*=\s*["']([^"']+)["']/i.exec(html)?.[1];
  const baseUrl = (base && resolve(base, pageUrl)?.toString()) || pageUrl;
  for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
    const tag = match[0];
    const href = /\bhref\s*=\s*(["'])(.*?)\1/i.exec(tag)?.[2];
    if (!href) continue;
    // rel="nofollow", or a `download` attribute (a file, not a page) — never a class or text that says "download".
    const attributes = tag.replace(/\s[\w-]+\s*=\s*(["']).*?\1/g, ' ');
    if (/\brel\s*=\s*["'][^"']*nofollow/i.test(tag) || /\sdownload(?:\s|>|\/)/i.test(attributes)) continue;
    const url = resolve(href, baseUrl);
    if (!url || !sameSite(url.toString(), pageUrl)) continue;
    url.hash = '';
    if (NOT_A_PAGE.test(url.pathname) || SKIP_PATH.test(url.pathname)) continue;
    found.add(url.toString());
    if (found.size >= MAX_LINKS_PER_PAGE) break;
  }
  found.delete(new URL(pageUrl).toString().replace(/#.*$/, ''));
  return [...found];
}

export type SiteVideo = { url: string; pageUrl: string; title: string | null };

const VIDEO_FILE = /\.(?:mp4|m4v|mov|webm|mkv|flv|ts|m3u8|mpd)(?:$|[?#])/i;

/** The videos a page names in its HTML: `<video>`/`<source>`, Open Graph video and links to video files. */
export function pageVideoLinks(html: string, pageUrl: string): SiteVideo[] {
  const title = pageTitle(html);
  const out = new Map<string, SiteVideo>();
  const add = (raw: string) => {
    const url = resolve(raw, pageUrl);
    if (!url || !VIDEO_FILE.test(url.pathname + (url.search ? '?' : ''))) return;
    const key = `${url.origin}${url.pathname}`;
    if (!out.has(key)) out.set(key, { url: url.toString(), pageUrl, title });
  };
  for (const match of html.matchAll(/<(?:video|source)\b[^>]*?\b(?:src|data-src)\s*=\s*(["'])(.*?)\1/gi)) add(match[2]!);
  for (const match of html.matchAll(/<meta\b[^>]*property\s*=\s*["']og:video(?::url|:secure_url)?["'][^>]*>/gi)) {
    const content = /\bcontent\s*=\s*(["'])(.*?)\1/i.exec(match[0])?.[2];
    if (content) add(content);
  }
  for (const match of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1/gi)) add(match[2]!);
  return [...out.values()].slice(0, MAX_VIDEOS);
}

export function pageTitle(html: string): string | null {
  const raw = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const title = raw ? decodeEntities(raw.replace(/\s+/g, ' ')) : '';
  return title ? title.slice(0, 200) : null;
}

export type CrawlEntry = { url: string; depth: number };

/**
 * The crawl's queue: breadth first from the start page, each page once, never deeper than [MAX_SITE_DEPTH], never
 * more than [MAX_SITE_PAGES] pages.
 */
export class SiteCrawlQueue {
  private readonly seen = new Set<string>();
  private readonly queue: CrawlEntry[] = [];
  private taken = 0;
  private readonly maxPages: number;
  private readonly maxDepth: number;

  constructor(start: string, maxPages = MAX_SITE_PAGES, maxDepth = MAX_SITE_DEPTH) {
    this.maxPages = maxPages;
    this.maxDepth = maxDepth;
    this.offer(start, 0);
  }

  private key(url: string): string {
    return url.replace(/#.*$/, '').replace(/\/$/, '');
  }

  offer(url: string, depth: number): void {
    const key = this.key(url);
    if (depth > this.maxDepth || this.seen.has(key)) return;
    this.seen.add(key);
    this.queue.push({ url, depth });
  }

  next(): CrawlEntry | null {
    if (this.taken >= this.maxPages) return null;
    const entry = this.queue.shift() ?? null;
    if (entry) this.taken += 1;
    return entry;
  }

  get remaining(): number {
    return Math.min(this.queue.length, this.maxPages - this.taken);
  }

  get done(): number {
    return this.taken;
  }
}
