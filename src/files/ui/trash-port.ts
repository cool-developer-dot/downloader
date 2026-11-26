// Stand-in for Faran's F13 `src/files/trash/trash-api.ts`: replaced by `export * from '@/files/trash/trash-api';` once F13 merges.
/**
 * Files F8: the only door the screens use to the recycle bin, with F13's exact signatures. Until the bin lands it is
 * off (`filesCapabilities.recycleBin` is false and `getBinSettings().enabled` is false): `deleteItems` falls back to
 * the delete each place uses today (Files, the Player tab and batch: the library file delete; Downloads: the
 * downloads store's remove) and reports everything as `deleted`; the bin is empty and its settings don't change.
 *
 * Only these seven functions are exported, so the swap is one line; the screens derive their types from them.
 */

import type { FileType } from '@/files/api';

export async function deleteItems(
  ids: string[],
  opts: { source: 'files' | 'player' | 'downloads' | 'batch' },
): Promise<{ trashed: string[]; deleted: string[] }> {
  const deleted: string[] = [];
  if (opts.source === 'downloads') {
    const { useDownloadsStore } = await import('@/store/downloads');
    for (const id of ids) {
      if (await useDownloadsStore.getState().remove(id).catch(() => false)) deleted.push(id);
    }
  } else {
    const { deleteCompletedFileFromVidoraX } = await import('@/downloads/completed-file/delete/delete-service');
    for (const id of ids) {
      const result = await deleteCompletedFileFromVidoraX(id).catch(() => ({ ok: false as const }));
      if (result.ok) deleted.push(id);
    }
  }
  return { trashed: [], deleted };
}

export async function listBin(): Promise<
  { id: string; title: string; fileType: FileType; sizeBytes: number; trashedAt: number; purgeAt: number | null }[]
> {
  return [];
}

export async function restoreFromBin(ids: string[]): Promise<void> {
  void ids;
}

export async function emptyBin(ids?: string[]): Promise<void> {
  void ids;
}

export function getBinSettings(): { enabled: boolean; keepDays: 7 | 14 | 30 | 60 | null } {
  return { enabled: false, keepDays: 30 };
}

export function setBinSettings(patch: Partial<{ enabled: boolean; keepDays: 7 | 14 | 30 | 60 | null }>): void {
  void patch;
}

export function onBinChanged(listener: () => void): () => void {
  void listener;
  return () => undefined;
}
