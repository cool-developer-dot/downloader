import type { SiteId } from '@modules/vidorax-media/src/VidoraMedia.types';

export const SITE_IDS: readonly SiteId[] = [
  'instagram',
  'facebook',
  'tiktok',
  'twitter',
  'reddit',
  'vimeo',
  'dailymotion',
  'twitch',
  'pinterest',
  'snapchat',
  'linkedin',
  'web',
];

const SITE_NAMES = new Map<SiteId, string>([
  ['instagram', 'Instagram'],
  ['facebook', 'Facebook'],
  ['tiktok', 'TikTok'],
  ['twitter', 'X'],
  ['reddit', 'Reddit'],
  ['vimeo', 'Vimeo'],
  ['dailymotion', 'Dailymotion'],
  ['twitch', 'Twitch'],
  ['pinterest', 'Pinterest'],
  ['snapchat', 'Snapchat'],
  ['linkedin', 'LinkedIn'],
]);

export function isSiteId(value: unknown): value is SiteId {
  return typeof value === 'string' && (SITE_IDS as readonly string[]).includes(value);
}

/** Brand names are not translated; generic websites use the localized `webLabel`. */
export function siteName(site: SiteId, webLabel: string): string {
  return SITE_NAMES.get(site) ?? webLabel;
}
