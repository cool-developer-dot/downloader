/**
 * Files F10 · design 29: the vault's chips — All, Videos, Photos, Audio — by each item's MIME type. Pure. An item that
 * can't be opened (its key was lost) has no known type: it shows only under All, so its space can always be freed.
 */

import type { VaultItem } from '@/private-vault/vault-index';

export const PRIVATE_FILTERS = ['all', 'videos', 'photos', 'audio'] as const;
export type PrivateFilter = (typeof PRIVATE_FILTERS)[number];

export type PrivateKind = 'video' | 'photo' | 'audio' | 'other';

export function privateKindOf(item: Pick<VaultItem, 'mimeType' | 'unreadable'>): PrivateKind {
  if (item.unreadable) {
    return 'other';
  }
  const mime = (item.mimeType ?? '').toLowerCase();
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('image/')) return 'photo';
  if (mime.startsWith('audio/')) return 'audio';
  return 'other';
}

const KIND_OF_FILTER: Record<Exclude<PrivateFilter, 'all'>, PrivateKind> = {
  videos: 'video',
  photos: 'photo',
  audio: 'audio',
};

export function filterVaultItems<T extends Pick<VaultItem, 'mimeType' | 'unreadable'>>(items: readonly T[], filter: PrivateFilter): T[] {
  if (filter === 'all') {
    return [...items];
  }
  const kind = KIND_OF_FILTER[filter];
  return items.filter((item) => privateKindOf(item) === kind);
}
