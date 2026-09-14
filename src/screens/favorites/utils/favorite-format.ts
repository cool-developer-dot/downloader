import { formatPlatform } from '@/screens/downloads/utils/download-format';
import type { FavoriteItem } from '@/store/favorites';

export function formatFavoriteDate(isoDate: string, now = new Date()): string {
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

export function buildFavoriteMetaLine(item: FavoriteItem): string {
  const parts: string[] = [];
  const platform = formatPlatform(item.platform);
  const dateLabel = formatFavoriteDate(item.createdAt);

  if (platform) {
    parts.push(platform);
  }
  if (dateLabel) {
    parts.push(dateLabel);
  }

  return parts.join(' · ');
}

export function formatFavoriteHost(sourceUrl: string): string {
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./i, '');
  } catch {
    return sourceUrl;
  }
}
