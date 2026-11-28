/**
 * F13 (#801 Recycle bin): the API Hamza's F8 screen and Undo call. Contract (agreed 2026-11-26): deleteItems,
 * listBin, restoreFromBin, emptyBin, getBinSettings, setBinSettings, onBinChanged.
 *
 * A trashed item stays on disk with its row, thumbnail, tags, notes, folder, favorite and play position; it is only
 * hidden (library + Downloads lists) until it is restored or purged. Purging is the normal "Delete from VidoraX"
 * (`deleteCompletedFileFromVidoraX`), so the bin never deletes a file any other way.
 */
import { deleteCompletedFileFromVidoraX } from '@/downloads/completed-file/delete/delete-service';
import { getV2Engine, isEngineOwned } from '@/downloads/v2';
import { projectV2LibraryItem } from '@/downloads/v2/projection';
import { getMediaById } from '@/library';
import { useDownloadsStore } from '@/store/downloads';

import { deleteSystemDownloads, isSystemDownloadId, loadSystemDownloadItems } from '../system-downloads/system-downloads';

import { fileTypeOf, type FileType } from '../engine/file-types';
import { bytesOf } from '../engine/files-query';
import {
  expiredEntries,
  normalizeBinSettings,
  purgeAtOf,
  sortedBin,
  type BinEntry,
  type BinSettings,
  type KeepDays,
} from './bin-model';
import { useBinStore } from './bin-store';

export type DeleteSource = 'files' | 'player' | 'downloads' | 'batch';

export type BinListEntry = {
  id: string;
  title: string;
  fileType: FileType;
  sizeBytes: number;
  trashedAt: number;
  purgeAt: number | null;
};

async function permanentlyDelete(id: string): Promise<boolean> {
  // A file the browser handed to Android's DownloadManager: DownloadManager deletes it.
  if (isSystemDownloadId(id)) {
    return (await deleteSystemDownloads([id]).catch(() => [] as string[])).includes(id);
  }
  const result = await deleteCompletedFileFromVidoraX(id);
  return result.ok;
}

async function entryFor(id: string, now: number): Promise<BinEntry | null> {
  if (isSystemDownloadId(id)) {
    const item = (await loadSystemDownloadItems()).find((candidate) => candidate.id === id);
    return item
      ? {
          id,
          title: item.displayName || item.fileName,
          fileName: item.fileName,
          fileType: fileTypeOf(item.mimeType, item.fileName),
          sizeBytes: bytesOf(item.fileSize),
          trashedAt: now,
          folderId: null,
          engineOwned: false,
        }
      : null;
  }
  const store = useDownloadsStore.getState();
  const media = await getMediaById(id).catch(() => null);
  const download = store.itemsById[id];
  if (!media && !download) {
    return null;
  }
  const fileName = media?.fileName ?? download?.fileName ?? '';
  return {
    id,
    title: media?.displayName ?? download?.title ?? (fileName || id),
    fileName,
    fileType: fileTypeOf(media?.mimeType ?? download?.mimeType ?? null, fileName),
    sizeBytes: bytesOf(media?.fileSize ?? download?.fileSize ?? null),
    trashedAt: now,
    folderId: media?.folderId ?? download?.folderId ?? null,
    engineOwned: isEngineOwned(store, id),
  };
}

/**
 * Deletes library items: into the bin while it is on, permanently otherwise. `trashed` and `deleted` list what
 * happened to each id; an id in neither failed (unknown item, or the delete was refused) and is left as it was.
 */
export async function deleteItems(
  ids: string[],
  opts: { source: DeleteSource },
): Promise<{ trashed: string[]; deleted: string[] }> {
  void opts.source; // kept for logs and the snackbar; every source is treated alike
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  const trashed: string[] = [];
  const deleted: string[] = [];
  if (!useBinStore.getState().settings.enabled) {
    for (const id of unique) {
      if (await permanentlyDelete(id)) {
        deleted.push(id);
      }
    }
    return { trashed, deleted };
  }
  const now = Date.now();
  const added: Record<string, BinEntry> = {};
  for (const id of unique) {
    if (useBinStore.getState().entries[id]) {
      continue; // already in the bin
    }
    const entry = await entryFor(id, now);
    if (entry) {
      added[id] = entry;
      trashed.push(id);
    }
  }
  if (trashed.length > 0) {
    useBinStore.setState((state) => ({ entries: { ...state.entries, ...added } }));
  }
  return { trashed, deleted };
}

export async function listBin(): Promise<BinListEntry[]> {
  const { entries, settings } = useBinStore.getState();
  return sortedBin(entries).map((entry) => ({
    id: entry.id,
    title: entry.title,
    fileType: entry.fileType,
    sizeBytes: entry.sizeBytes,
    trashedAt: entry.trashedAt,
    purgeAt: purgeAtOf(entry, settings.keepDays),
  }));
}

/** Puts items back where they were (the same folder, with everything they had). Also Undo. */
export async function restoreFromBin(ids: string[]): Promise<void> {
  const { entries } = useBinStore.getState();
  const restoring = ids.filter((id) => entries[id]);
  if (restoring.length === 0) {
    return;
  }
  useBinStore.setState((state) => {
    const next = { ...state.entries };
    for (const id of restoring) {
      delete next[id];
    }
    return { entries: next };
  });
  // The Downloads list dropped them from its order: bring them back.
  const engine = getV2Engine();
  const engineItems = engine
    ? (
        await Promise.all(
          restoring
            .filter((id) => entries[id]!.engineOwned)
            .map((id) => engine.getLibraryItem(id).catch(() => null)),
        )
      ).filter((item): item is NonNullable<typeof item> => Boolean(item))
    : [];
  if (engineItems.length > 0) {
    useDownloadsStore.getState().applyEngineEntries(engineItems.map(projectV2LibraryItem));
  }
  if (restoring.some((id) => !entries[id]!.engineOwned && !isSystemDownloadId(id))) {
    await useDownloadsStore.getState().refresh().catch(() => undefined);
  }
}

/**
 * Deletes bin items for good (`ids` omitted = all). An item whose delete fails stays in the bin so it can be retried;
 * one that is already gone from the library leaves the bin too.
 */
export async function emptyBin(ids?: string[]): Promise<void> {
  const { entries } = useBinStore.getState();
  const targets = (ids ?? Object.keys(entries)).filter((id) => entries[id]);
  const done: string[] = [];
  for (const id of targets) {
    if (await permanentlyDelete(id)) {
      done.push(id);
    }
  }
  if (done.length > 0) {
    useBinStore.setState((state) => {
      const next = { ...state.entries };
      for (const id of done) {
        delete next[id];
      }
      return { entries: next };
    });
  }
}

export function getBinSettings(): BinSettings {
  return useBinStore.getState().settings;
}

export function setBinSettings(patch: Partial<{ enabled: boolean; keepDays: KeepDays }>): void {
  useBinStore.setState((state) => ({ settings: normalizeBinSettings({ ...state.settings, ...patch }) }));
}

export function onBinChanged(listener: () => void): () => void {
  return useBinStore.subscribe(listener);
}

/** Purges the items whose keep time is up. Returns their ids. */
export async function purgeExpiredBin(now = Date.now()): Promise<string[]> {
  const { entries, settings } = useBinStore.getState();
  const expired = expiredEntries(entries, settings.keepDays, now).map((entry) => entry.id);
  if (expired.length > 0) {
    await emptyBin(expired);
  }
  return expired.filter((id) => !useBinStore.getState().entries[id]);
}
