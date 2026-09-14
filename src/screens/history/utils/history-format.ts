import type { BrowserHistoryEntry } from '@/storage/types';

export type HistorySectionKey = 'today' | 'yesterday' | 'earlier';

export type HistoryListSection = {
  key: HistorySectionKey;
  title: string;
  data: BrowserHistoryEntry[];
};

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function getHistorySectionKey(
  visitedAt: string,
  now = new Date(),
): HistorySectionKey {
  const visited = new Date(visitedAt);

  if (Number.isNaN(visited.getTime())) {
    return 'earlier';
  }

  const today = startOfDay(now);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const visitDay = startOfDay(visited);

  if (visitDay.getTime() === today.getTime()) {
    return 'today';
  }

  if (visitDay.getTime() === yesterday.getTime()) {
    return 'yesterday';
  }

  return 'earlier';
}

const SECTION_TITLES: Record<HistorySectionKey, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  earlier: 'Earlier',
};

const SECTION_ORDER: HistorySectionKey[] = ['today', 'yesterday', 'earlier'];

export function groupHistoryByDay(
  items: BrowserHistoryEntry[],
  now = new Date(),
): HistoryListSection[] {
  const buckets: Record<HistorySectionKey, BrowserHistoryEntry[]> = {
    today: [],
    yesterday: [],
    earlier: [],
  };

  for (const item of items) {
    buckets[getHistorySectionKey(item.visitedAt, now)].push(item);
  }

  return SECTION_ORDER.filter((key) => buckets[key].length > 0).map((key) => ({
    key,
    title: SECTION_TITLES[key],
    data: buckets[key],
  }));
}

/**
 * Relative timestamp for history rows.
 * Keeps copy short and scannable for dense lists.
 */
export function formatHistoryRelativeTime(
  isoDate: string,
  now = new Date(),
): string {
  const date = new Date(isoDate);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const diffMs = Math.max(0, now.getTime() - date.getTime());
  const diffMinutes = Math.floor(diffMs / 60_000);

  if (diffMinutes < 1) {
    return 'Just now';
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);

  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.floor(diffHours / 24);

  if (diffDays === 1) {
    return 'Yesterday';
  }

  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function formatHistoryClockTime(isoDate: string): string {
  const date = new Date(isoDate);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function buildFaviconUrl(hostname: string): string | null {
  const host = hostname.trim().toLowerCase();

  if (!host) {
    return null;
  }

  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
}
