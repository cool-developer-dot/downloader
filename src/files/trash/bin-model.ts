/**
 * F13 (#801 Recycle bin), pure. A deleted library item goes to the bin: it stays on disk, untouched, and is only
 * hidden from every list until it is restored or purged. Purging uses the normal "Delete from VidoraX".
 */
import type { FileType } from '../engine/file-types';

export const KEEP_DAYS_OPTIONS = [7, 14, 30, 60] as const;
export type KeepDays = (typeof KEEP_DAYS_OPTIONS)[number] | null;

export type BinSettings = { enabled: boolean; keepDays: KeepDays };
export const DEFAULT_BIN_SETTINGS: BinSettings = { enabled: true, keepDays: 30 };

export type BinEntry = {
  id: string;
  title: string;
  fileName: string;
  fileType: FileType;
  sizeBytes: number;
  /** ms since epoch. */
  trashedAt: number;
  /** The folder it was in, so Undo and Restore put it back there. */
  folderId: string | null;
  /** True when the native engine owns the file (purge goes through it). */
  engineOwned: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizeBinSettings(raw: unknown): BinSettings {
  const value = (raw ?? {}) as Partial<Record<keyof BinSettings, unknown>>;
  const enabled = typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_BIN_SETTINGS.enabled;
  const keepDays =
    value.keepDays === null
      ? null
      : (KEEP_DAYS_OPTIONS as readonly number[]).includes(value.keepDays as number)
        ? (value.keepDays as KeepDays)
        : DEFAULT_BIN_SETTINGS.keepDays;
  return { enabled, keepDays };
}

export function normalizeBinEntries(raw: unknown): Record<string, BinEntry> {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const out: Record<string, BinEntry> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const entry = value as Partial<BinEntry> | null;
    if (!entry || typeof entry !== 'object' || typeof entry.trashedAt !== 'number' || !id) {
      continue;
    }
    out[id] = {
      id,
      title: typeof entry.title === 'string' ? entry.title : id,
      fileName: typeof entry.fileName === 'string' ? entry.fileName : '',
      fileType: (entry.fileType ?? 'other') as FileType,
      sizeBytes: typeof entry.sizeBytes === 'number' && entry.sizeBytes > 0 ? entry.sizeBytes : 0,
      trashedAt: entry.trashedAt,
      folderId: typeof entry.folderId === 'string' ? entry.folderId : null,
      engineOwned: entry.engineOwned === true,
    };
  }
  return out;
}

/** When the entry is purged (ms), or null when the bin keeps items until it is emptied. */
export function purgeAtOf(entry: Pick<BinEntry, 'trashedAt'>, keepDays: KeepDays): number | null {
  return keepDays == null ? null : entry.trashedAt + keepDays * DAY_MS;
}

/** Entries whose time is up at `now`, oldest first. */
export function expiredEntries(entries: Record<string, BinEntry>, keepDays: KeepDays, now: number): BinEntry[] {
  return Object.values(entries)
    .filter((entry) => {
      const at = purgeAtOf(entry, keepDays);
      return at != null && at <= now;
    })
    .sort((a, b) => a.trashedAt - b.trashedAt);
}

/** Newest first, as the bin screen lists them. */
export function sortedBin(entries: Record<string, BinEntry>): BinEntry[] {
  return Object.values(entries).sort((a, b) => b.trashedAt - a.trashedAt || (a.id < b.id ? -1 : 1));
}

export function binTotalBytes(entries: Record<string, BinEntry>): number {
  return Object.values(entries).reduce((sum, entry) => sum + entry.sizeBytes, 0);
}

/** Drops trashed ids from an id list; returns the same array when nothing is trashed (no needless re-render). */
export function withoutTrashed(ids: readonly string[], trashed: Readonly<Record<string, unknown>>): readonly string[] {
  if (!ids.some((id) => Object.prototype.hasOwnProperty.call(trashed, id))) {
    return ids;
  }
  return ids.filter((id) => !Object.prototype.hasOwnProperty.call(trashed, id));
}
