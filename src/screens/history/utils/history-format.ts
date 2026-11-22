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

export type HistoryDaySection = {
  /** `today`, `yesterday`, or the local day as `YYYY-MM-DD`. */
  key: string;
  kind: 'today' | 'yesterday' | 'date';
  /** The local day's start. */
  date: Date;
  data: BrowserHistoryEntry[];
};

function localDayKey(day: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

/**
 * Design 36: one section per local day (TODAY, YESTERDAY, then each date), in the order the entries come (newest
 * first). An entry with an unreadable time joins the last section.
 */
export function groupHistoryByDate(items: BrowserHistoryEntry[], now = new Date()): HistoryDaySection[] {
  const today = startOfDay(now);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const sections: HistoryDaySection[] = [];
  const byKey = new Map<string, HistoryDaySection>();
  for (const item of items) {
    const visited = new Date(item.visitedAt);
    const day = Number.isNaN(visited.getTime()) ? null : startOfDay(visited);
    let section: HistoryDaySection | undefined;
    if (day == null) {
      section = sections[sections.length - 1];
      if (!section) continue;
    } else {
      const time = day.getTime();
      const key = time === today.getTime() ? 'today' : time === yesterday.getTime() ? 'yesterday' : localDayKey(day);
      section = byKey.get(key);
      if (!section) {
        section = { key, kind: key === 'today' ? 'today' : key === 'yesterday' ? 'yesterday' : 'date', date: day, data: [] };
        byKey.set(key, section);
        sections.push(section);
      }
    }
    section.data.push(item);
  }
  return sections;
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

  return `https://${host}/favicon.ico`;
}
