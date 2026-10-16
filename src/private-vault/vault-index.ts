/**
 * The Private section's list (#459). Pure. The vault keeps each item's metadata — title, duration, size, dates and an
 * encrypted thumbnail — in its own sealed files, never in the library database; JavaScript only holds this list in
 * memory while the section is open, and forgets it when the section locks.
 */

export type VaultItem = {
  /** The vault's own random id: never the library or download id the video had before. */
  id: string;
  title: string;
  mimeType: string;
  durationMs: number | null;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  /** When it was downloaded (epoch ms). */
  createdAt: number;
  /** When it was moved to Private (epoch ms). */
  addedAt: number;
  hasThumbnail: boolean;
};

const VAULT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_TITLE_LENGTH = 300;

export function isVaultId(value: unknown): value is string {
  return typeof value === 'string' && VAULT_ID.test(value);
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** One item as the native side returned it, checked; null when it is not a vault item. */
export function normalizeVaultItem(raw: unknown): VaultItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const value = raw as Record<string, unknown>;
  if (!isVaultId(value.id)) {
    return null;
  }
  const sizeBytes = finiteOrNull(value.sizeBytes);
  const createdAt = finiteOrNull(value.createdAt);
  const addedAt = finiteOrNull(value.addedAt);
  if (sizeBytes === null || createdAt === null || addedAt === null) {
    return null;
  }
  const title = typeof value.title === 'string' ? value.title.trim().slice(0, MAX_TITLE_LENGTH) : '';
  return {
    id: value.id,
    title,
    mimeType: typeof value.mimeType === 'string' ? value.mimeType : 'video/mp4',
    durationMs: finiteOrNull(value.durationMs),
    sizeBytes,
    width: finiteOrNull(value.width),
    height: finiteOrNull(value.height),
    createdAt,
    addedAt,
    hasThumbnail: value.hasThumbnail === true,
  };
}

/** Newest-moved first; items with the same moment by title. */
export function sortVaultItems(items: readonly VaultItem[]): VaultItem[] {
  return [...items].sort((a, b) => b.addedAt - a.addedAt || a.title.localeCompare(b.title));
}

/** Pure: the list as the native side returned it — checked, de-duplicated, sorted. */
export function vaultIndexFrom(raw: unknown): VaultItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<string>();
  const items: VaultItem[] = [];
  for (const entry of raw) {
    const item = normalizeVaultItem(entry);
    if (item && !seen.has(item.id)) {
      seen.add(item.id);
      items.push(item);
    }
  }
  return sortVaultItems(items);
}

/** Pure: the list with a newly moved item (replacing one with the same id). */
export function withVaultItem(items: readonly VaultItem[], item: VaultItem): VaultItem[] {
  return sortVaultItems([...items.filter((existing) => existing.id !== item.id), item]);
}

/** Pure: the list without `id` (deleted). The same array when it was not there. */
export function withoutVaultItem(items: readonly VaultItem[], id: string): readonly VaultItem[] {
  return items.some((item) => item.id === id) ? items.filter((item) => item.id !== id) : items;
}

export function vaultTotalBytes(items: readonly VaultItem[]): number {
  return items.reduce((total, item) => total + item.sizeBytes, 0);
}

/** The item a tap refers to, read right before acting (it may have been deleted meanwhile). */
export function findVaultItem(items: readonly VaultItem[], id: string): VaultItem | null {
  return items.find((item) => item.id === id) ?? null;
}
