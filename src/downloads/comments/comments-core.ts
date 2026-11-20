/**
 * #380 Comments download — the pure part: the public comments a video's page shares in a form that can be read
 * without signing in. Two sources: schema.org JSON-LD (`Comment`, with replies) that many sites put in the page for
 * search engines, and Reddit's public `.json` view of a post. Nothing is guessed from the page's look.
 */

export type SavedComment = {
  author: string | null;
  text: string;
  /** ISO date when the source gives one. */
  date: string | null;
  likes: number | null;
  /** 0 for a top-level comment, 1 for a reply… */
  depth: number;
};

export type SavedComments = {
  sourceUrl: string;
  savedAt: string;
  comments: SavedComment[];
};

export const MAX_SAVED_COMMENTS = 500;
const MAX_TEXT = 4_000;
const MAX_DEPTH = 8;

function clean(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const value = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim();
  return value ? value.slice(0, MAX_TEXT) : null;
}

function isoDate(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return new Date(value < 1e12 ? value * 1000 : value).toISOString();
  }
  if (typeof value === 'string') {
    const time = Date.parse(value);
    return Number.isNaN(time) ? null : new Date(time).toISOString();
  }
  return null;
}

/** Reddit's public JSON view of a post page (`/r/<sub>/comments/<id>/…`), or null for any other page. */
export function redditCommentsJsonUrl(pageUrl: string): string | null {
  try {
    const url = new URL(pageUrl);
    if (!/(^|\.)reddit\.com$/i.test(url.hostname)) return null;
    const match = /^(\/r\/[^/]+\/comments\/[a-z0-9]+)(?:\/[^/]*)?\/?$/i.exec(url.pathname);
    return match ? `https://www.reddit.com${match[1]}.json?limit=${MAX_SAVED_COMMENTS}&raw_json=1` : null;
  } catch {
    return null;
  }
}

/** The comments of Reddit's post JSON (`[post, comments]`), replies in order under their parent. */
export function parseRedditComments(json: unknown): SavedComment[] {
  const out: SavedComment[] = [];
  const walk = (listing: unknown, depth: number) => {
    const children = (listing as { data?: { children?: unknown[] } } | null)?.data?.children;
    if (!Array.isArray(children)) return;
    for (const child of children) {
      if (out.length >= MAX_SAVED_COMMENTS) return;
      const c = child as { kind?: string; data?: Record<string, unknown> };
      if (c.kind !== 't1' || !c.data) continue;
      const text = clean(c.data.body);
      if (text && text !== '[deleted]' && text !== '[removed]') {
        out.push({
          author: typeof c.data.author === 'string' && c.data.author !== '[deleted]' ? c.data.author : null,
          text,
          date: isoDate(c.data.created_utc),
          likes: typeof c.data.score === 'number' ? c.data.score : null,
          depth,
        });
      }
      if (depth < MAX_DEPTH) walk(c.data.replies, depth + 1);
    }
  };
  if (Array.isArray(json)) walk(json[1], 0);
  return out;
}

function types(node: Record<string, unknown>): string[] {
  const type = node['@type'];
  return (Array.isArray(type) ? type : [type]).filter((t): t is string => typeof t === 'string');
}

function authorName(value: unknown): string | null {
  const one = Array.isArray(value) ? value[0] : value;
  if (typeof one === 'string') return one.trim() || null;
  if (one && typeof one === 'object') {
    const name = (one as Record<string, unknown>).name ?? (one as Record<string, unknown>).alternateName;
    return typeof name === 'string' ? name.trim() || null : null;
  }
  return null;
}

function likesOf(node: Record<string, unknown>): number | null {
  if (typeof node.upvoteCount === 'number') return node.upvoteCount;
  const stats = Array.isArray(node.interactionStatistic) ? node.interactionStatistic : [node.interactionStatistic];
  for (const stat of stats) {
    const s = stat as Record<string, unknown> | undefined;
    const kind = JSON.stringify(s?.interactionType ?? '');
    if (s && /Like|Vote/i.test(kind) && typeof s.userInteractionCount === 'number') return s.userInteractionCount;
  }
  return null;
}

/** The schema.org comments in a page's JSON-LD blocks (comments of the page's video or post and their replies). */
export function parseJsonLdComments(html: string): SavedComment[] {
  const out: SavedComment[] = [];
  const seen = new Set<string>();
  const visitComment = (node: Record<string, unknown>, depth: number) => {
    const text = clean(node.text ?? node.commentText ?? node.articleBody);
    if (text) {
      const author = authorName(node.author ?? node.creator);
      const key = `${author}\u0000${text}`;
      if (!seen.has(key) && out.length < MAX_SAVED_COMMENTS) {
        seen.add(key);
        out.push({ author, text, date: isoDate(node.dateCreated ?? node.datePublished), likes: likesOf(node), depth });
      }
    }
    if (depth < MAX_DEPTH) visitComments(node.comment, depth + 1);
  };
  const visitComments = (value: unknown, depth: number) => {
    for (const item of Array.isArray(value) ? value : value ? [value] : []) {
      if (item && typeof item === 'object' && types(item as Record<string, unknown>).some((t) => /Comment$/i.test(t))) {
        visitComment(item as Record<string, unknown>, depth);
      }
    }
  };
  const walk = (value: unknown, budget: { left: number }) => {
    if (budget.left-- <= 0 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, budget);
      return;
    }
    const node = value as Record<string, unknown>;
    if (types(node).some((t) => /Comment$/i.test(t))) {
      visitComment(node, 0);
      return;
    }
    if (node.comment) visitComments(node.comment, 0);
    for (const [key, child] of Object.entries(node)) {
      if (key !== 'comment' && child && typeof child === 'object') walk(child, budget);
    }
  };
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      walk(JSON.parse(match[1]!.trim()), { left: 20_000 });
    } catch {
      // A malformed block is skipped; the others still count.
    }
    if (out.length >= MAX_SAVED_COMMENTS) break;
  }
  return out;
}
