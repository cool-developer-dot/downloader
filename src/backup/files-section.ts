/**
 * F17 (#930 Backup, #932 Restore, #936 Settings backup): the File Manager's part of `vidorax.appBackup` (format v2,
 * section `files`). Pure: the shape, the checks and how a backup meets the phone (Merge / Replace).
 *
 * In it: the folder tree (names and nesting), which folder each item is in, item tags and notes, the recycle bin and
 * low space settings, and `extra` — the File Manager screens' own MMKV keys registered by their packages (F2 view
 * settings, F7 hidden files / colors / custom order, F10 locked folders; never a PIN).
 * Never in it: media files, the Private vault, the bin's items, folders picked in Android's folder picker (their
 * grants can't move to another phone).
 *
 * Items are named by their library id. A restore applies item data only to items that are on the phone (the same
 * install, or after Reset); the rest is skipped quietly.
 */

export const FILES_BACKUP_LIMITS = { folders: 5000, items: 100_000, tagsPerItem: 20, tagLength: 40, noteLength: 2000, extraKeys: 32 } as const;

export type BackupFolder = { id: string; name: string; parentId: string | null; createdAt: string; updatedAt: string };

export type BackupFiles = {
  folders: BackupFolder[];
  /** mediaId → folderId (null = no folder). */
  folderOf: Record<string, string | null>;
  tags: Record<string, string[]>;
  notes: Record<string, string>;
  bin?: { enabled: boolean; keepDays: number | null };
  lowSpace?: { enabled: boolean; thresholdBytes: number };
  /** Registered MMKV keys of the File Manager screens, as stored (JSON). */
  extra: Record<string, unknown>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim() && value.length <= max ? value : null;

/** Parents before children, loops and unknown parents cut to the root. */
export function orderFolders(folders: readonly BackupFolder[]): BackupFolder[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const out: BackupFolder[] = [];
  const placed = new Set<string>();
  const visiting = new Set<string>();
  const place = (folder: BackupFolder): void => {
    if (placed.has(folder.id)) {
      return;
    }
    if (visiting.has(folder.id)) {
      return; // a loop: the caller cuts it
    }
    visiting.add(folder.id);
    const parent = folder.parentId != null ? byId.get(folder.parentId) : undefined;
    let parentId: string | null = null;
    if (parent && !visiting.has(parent.id)) {
      place(parent);
      parentId = placed.has(parent.id) ? parent.id : null;
    }
    visiting.delete(folder.id);
    placed.add(folder.id);
    out.push({ ...folder, parentId });
  };
  for (const folder of folders) {
    place(folder);
  }
  return out;
}

/** Reads a backup's `files` section; anything malformed is dropped, never half-applied. */
export function readBackupFiles(raw: unknown): BackupFiles {
  const value = isRecord(raw) ? raw : {};
  const folders: BackupFolder[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(value.folders) ? value.folders.slice(0, FILES_BACKUP_LIMITS.folders) : []) {
    if (!isRecord(item)) continue;
    const id = str(item.id, 128);
    const name = str(item.name, 200);
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    folders.push({
      id,
      name: name.trim(),
      parentId: str(item.parentId, 128),
      createdAt: str(item.createdAt, 64) ?? new Date(0).toISOString(),
      updatedAt: str(item.updatedAt, 64) ?? new Date(0).toISOString(),
    });
  }
  const folderOf: Record<string, string | null> = {};
  if (isRecord(value.folderOf)) {
    for (const [mediaId, folderId] of Object.entries(value.folderOf).slice(0, FILES_BACKUP_LIMITS.items)) {
      if (mediaId && mediaId.length <= 512 && (folderId === null || (typeof folderId === 'string' && seen.has(folderId)))) {
        folderOf[mediaId] = folderId as string | null;
      }
    }
  }
  const tags: Record<string, string[]> = {};
  if (isRecord(value.tags)) {
    for (const [mediaId, list] of Object.entries(value.tags).slice(0, FILES_BACKUP_LIMITS.items)) {
      if (!Array.isArray(list)) continue;
      const clean = [...new Set(list.map((tag) => str(tag, FILES_BACKUP_LIMITS.tagLength)?.trim()).filter((tag): tag is string => Boolean(tag)))];
      if (clean.length > 0) tags[mediaId] = clean.slice(0, FILES_BACKUP_LIMITS.tagsPerItem);
    }
  }
  const notes: Record<string, string> = {};
  if (isRecord(value.notes)) {
    for (const [mediaId, note] of Object.entries(value.notes).slice(0, FILES_BACKUP_LIMITS.items)) {
      const clean = str(note, FILES_BACKUP_LIMITS.noteLength);
      if (clean) notes[mediaId] = clean;
    }
  }
  const out: BackupFiles = { folders: orderFolders(folders), folderOf, tags, notes, extra: {} };
  if (isRecord(value.bin) && typeof value.bin.enabled === 'boolean') {
    const keepDays = value.bin.keepDays;
    out.bin = { enabled: value.bin.enabled, keepDays: typeof keepDays === 'number' || keepDays === null ? keepDays : 30 };
  }
  if (isRecord(value.lowSpace) && typeof value.lowSpace.enabled === 'boolean' && typeof value.lowSpace.thresholdBytes === 'number') {
    out.lowSpace = { enabled: value.lowSpace.enabled, thresholdBytes: value.lowSpace.thresholdBytes };
  }
  if (isRecord(value.extra)) {
    for (const [key, data] of Object.entries(value.extra).slice(0, FILES_BACKUP_LIMITS.extraKeys)) {
      if (/^vidorax\.files\.[A-Za-z0-9.]+$/.test(key) && data !== undefined) {
        out.extra[key] = data;
      }
    }
  }
  return out;
}

/**
 * Merge: the backup's folders that the phone lacks are added, the backup's item data joins the phone's (a tag list is
 * the union, the backup's note wins where the phone has none). Replace: the backup's item data takes the place of
 * the phone's for the items it names. Settings: the backup's in both modes. Pure; `phone` is what the phone has now.
 */
export function mergeItemData(
  phone: { tags: Record<string, string[]>; notes: Record<string, string> },
  backup: BackupFiles,
  existingIds: ReadonlySet<string>,
  mode: 'merge' | 'replace',
): { tags: Record<string, string[]>; notes: Record<string, string>; folderOf: Record<string, string | null> } {
  const tags = { ...phone.tags };
  const notes = { ...phone.notes };
  const folderOf: Record<string, string | null> = {};
  for (const [id, list] of Object.entries(backup.tags)) {
    if (!existingIds.has(id)) continue;
    tags[id] = mode === 'replace' ? [...list] : [...new Set([...(phone.tags[id] ?? []), ...list])].slice(0, FILES_BACKUP_LIMITS.tagsPerItem);
  }
  for (const [id, note] of Object.entries(backup.notes)) {
    if (!existingIds.has(id)) continue;
    if (mode === 'replace' || !phone.notes[id]) notes[id] = note;
  }
  for (const [id, folderId] of Object.entries(backup.folderOf)) {
    if (existingIds.has(id)) folderOf[id] = folderId;
  }
  return { tags, notes, folderOf };
}

/** For the restore preview: how much the section holds. */
export function filesBackupCounts(files: BackupFiles): { folders: number; items: number } {
  const items = new Set([...Object.keys(files.folderOf), ...Object.keys(files.tags), ...Object.keys(files.notes)]);
  return { folders: files.folders.length, items: items.size };
}
