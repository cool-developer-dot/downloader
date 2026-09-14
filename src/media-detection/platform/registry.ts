import { instagramPlatformAdapter } from './instagram.adapter';
import { tiktokPlatformAdapter } from './tiktok.adapter';
import { genericPlatformAdapter } from './generic.adapter';
import type { PlatformPageAdapter, PlatformPageInfo } from './types';

const ADAPTERS: PlatformPageAdapter[] = [
  instagramPlatformAdapter,
  tiktokPlatformAdapter,
  genericPlatformAdapter,
];

export function resolvePlatformAdapter(url: string): PlatformPageAdapter {
  return ADAPTERS.find((adapter) => adapter.matchesPageUrl(url)) ?? genericPlatformAdapter;
}

export function describePlatformPage(url: string): PlatformPageInfo {
  return resolvePlatformAdapter(url).describePage(url);
}

export function normalizePlatformPageUrl(url: string): string | null {
  return resolvePlatformAdapter(url).normalizePageUrl(url);
}

export {
  genericPlatformAdapter,
  instagramPlatformAdapter,
  tiktokPlatformAdapter,
};
