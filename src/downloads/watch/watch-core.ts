/**
 * #362 Link Polling, #504 Update Detection, #363 RSS Download — the app's view of the watched links that the native
 * side (modules/vidorax-media watch/) checks by itself every few hours. Pure: parsing what native returns.
 */

export type WatchKind = 'file' | 'page' | 'feed';

export type WatchFeedItem = {
  id: string;
  title: string | null;
  mediaUrl: string;
  publishedAt: number | null;
};

export type WatchedLink = {
  id: string;
  url: string;
  kind: WatchKind;
  title: string | null;
  intervalHours: number;
  autoDownload: boolean;
  lastCheckedAt: number | null;
  lastChangedAt: number | null;
  /** How the last check went. */
  lastStatus: 'ok' | 'not_found' | 'error' | null;
  createdAt: number;
  /** A feed's newest video items. */
  items: WatchFeedItem[];
};

/** How often a link can be checked: hourly, every 6 hours, daily, weekly. */
export const WATCH_INTERVAL_HOURS = [1, 6, 24, 168] as const;
export const DEFAULT_WATCH_INTERVAL_HOURS = 24;
export const MAX_WATCHED_LINKS = 100;

const KINDS: readonly WatchKind[] = ['file', 'page', 'feed'];
const STATUSES = ['ok', 'not_found', 'error'] as const;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function time(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function parseItem(raw: unknown): WatchFeedItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = text(o.id);
  const mediaUrl = text(o.mediaUrl);
  if (!id || !mediaUrl || !/^https?:\/\//i.test(mediaUrl)) return null;
  return { id, title: text(o.title), mediaUrl, publishedAt: time(o.publishedAt) };
}

/** One watched link from native JSON; null when it is not one. */
export function parseWatchedLink(raw: unknown): WatchedLink | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = text(o.id);
  const url = text(o.url);
  const kind = KINDS.find((k) => k === o.kind);
  if (!id || !url || !kind) return null;
  const status = STATUSES.find((s) => s === o.lastStatus) ?? null;
  const items = Array.isArray(o.items) ? o.items.map(parseItem).filter((i): i is WatchFeedItem => i !== null) : [];
  return {
    id,
    url,
    kind,
    title: text(o.title),
    intervalHours: typeof o.intervalHours === 'number' && o.intervalHours >= 1 ? Math.round(o.intervalHours) : DEFAULT_WATCH_INTERVAL_HOURS,
    autoDownload: o.autoDownload === true,
    lastCheckedAt: time(o.lastCheckedAt),
    lastChangedAt: time(o.lastChangedAt),
    lastStatus: status,
    createdAt: time(o.createdAt) ?? 0,
    items,
  };
}

/** The list native returns (a JSON array); malformed entries are dropped, newest first. */
export function parseWatchedLinks(json: string | null | undefined): WatchedLink[] {
  if (!json) return [];
  try {
    const value: unknown = JSON.parse(json);
    if (!Array.isArray(value)) return [];
    return value
      .map(parseWatchedLink)
      .filter((l): l is WatchedLink => l !== null)
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

export type WatchAddResult = { ok: true; link: WatchedLink } | { ok: false; reason: 'full' | 'unreachable' | 'invalid' | 'unavailable' };

/** What `watchAdd` answered. */
export function parseWatchAdd(answer: string | null | undefined): WatchAddResult {
  if (answer === 'full' || answer === 'unreachable') return { ok: false, reason: answer };
  try {
    const link = parseWatchedLink(answer ? JSON.parse(answer) : null);
    return link ? { ok: true, link } : { ok: false, reason: 'unreachable' };
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}

/** A link worth watching: http(s) with a host. */
export function normalizeWatchUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!/^https?:\/\/[^\s/?#]+/i.test(trimmed) || /\s/.test(trimmed)) return null;
  return trimmed;
}

/** The nearest offered interval. */
export function normalizeWatchInterval(hours: unknown): number {
  const value = typeof hours === 'number' && Number.isFinite(hours) ? hours : DEFAULT_WATCH_INTERVAL_HOURS;
  return WATCH_INTERVAL_HOURS.reduce((best, h) => (Math.abs(h - value) < Math.abs(best - value) ? h : best), DEFAULT_WATCH_INTERVAL_HOURS);
}
