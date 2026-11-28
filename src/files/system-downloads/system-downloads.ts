/**
 * Files: reads, opens, shares and deletes the files VidoraX's browser handed to Android's DownloadManager (see
 * `system-downloads-model.ts` and the native `SystemDownloads`). Older builds without the native calls list none.
 */
import { Directory, File, Paths } from 'expo-file-system';

import { getVidoraMedia, isVidoraMediaAvailable } from '@modules/vidorax-media';
import type { SystemDownload } from '@modules/vidorax-media/src/VidoraMedia.types';

import type { MediaLibraryItem } from '@/library/types';
import { createStore } from '@/store/shared/create-store';
import { deviceMediaId, rememberDeviceVideos } from '@/player/device-media';

import { downloadIdOf, systemDownloadItems } from './system-downloads-model';

export { isSystemDownloadId } from './system-downloads-model';

type Port = {
  listSystemDownloads(): Promise<SystemDownload[]>;
  removeSystemDownloads(ids: string[]): Promise<number>;
  openSystemDownloadWith(id: string, mimeType: string | null, title: string | null): Promise<void>;
  shareSystemDownload(id: string, mimeType: string | null, title: string | null): Promise<void>;
  copySystemDownloadTo(id: string, targetPath: string): Promise<void>;
};

function port(): Port | null {
  if (!isVidoraMediaAvailable()) {
    return null;
  }
  const media = getVidoraMedia() as unknown as Partial<Port>;
  return typeof media.listSystemDownloads === 'function' ? (media as Port) : null;
}

/** Bumped after a delete here, so the Files lists (subscribed through `subscribeFiles`) reload. */
export const useSystemDownloadsRevision = createStore<{ revision: number }>()(() => ({ revision: 0 }));

let lastRows: SystemDownload[] = [];

/** The downloads as Files items (none when the native call is missing or fails). */
export async function loadSystemDownloadItems(): Promise<MediaLibraryItem[]> {
  const native = port();
  if (!native) {
    return [];
  }
  try {
    lastRows = await native.listSystemDownloads();
  } catch {
    lastRows = [];
  }
  return systemDownloadItems(lastRows);
}

function rowOf(id: string): SystemDownload | null {
  const downloadId = downloadIdOf(id);
  return downloadId ? (lastRows.find((row) => row.id === downloadId) ?? null) : null;
}

export async function deleteSystemDownloads(ids: readonly string[]): Promise<string[]> {
  const native = port();
  const downloadIds = ids.map(downloadIdOf).filter((id): id is string => Boolean(id));
  if (!native || downloadIds.length === 0) {
    return [];
  }
  await native.removeSystemDownloads(downloadIds);
  lastRows = lastRows.filter((row) => !downloadIds.includes(row.id));
  useSystemDownloadsRevision.setState((state) => ({ revision: state.revision + 1 }));
  return ids.filter((id) => downloadIdOf(id) != null);
}

export async function openSystemDownloadWith(item: Pick<MediaLibraryItem, 'id' | 'mimeType' | 'fileName'>): Promise<void> {
  const native = port();
  const downloadId = downloadIdOf(item.id);
  if (!native || !downloadId) throw new Error('unavailable');
  await native.openSystemDownloadWith(downloadId, item.mimeType, item.fileName);
}

export async function shareSystemDownload(item: Pick<MediaLibraryItem, 'id' | 'mimeType' | 'fileName'>): Promise<void> {
  const native = port();
  const downloadId = downloadIdOf(item.id);
  if (!native || !downloadId) throw new Error('unavailable');
  await native.shareSystemDownload(downloadId, item.mimeType, item.fileName);
}

/** A copy in the PDF viewer's cache folder (`PdfFiles.DIR`); its path, for `/pdf-viewer`. */
export async function systemDownloadPdfCopy(item: Pick<MediaLibraryItem, 'id'>): Promise<string> {
  const native = port();
  const downloadId = downloadIdOf(item.id);
  if (!native || !downloadId) throw new Error('unavailable');
  const dir = new Directory(Paths.cache, 'pdf');
  dir.create({ idempotent: true, intermediates: true });
  const copy = new File(dir, `sysdl-${downloadId}.pdf`);
  if (copy.exists) copy.delete();
  await native.copySystemDownloadTo(downloadId, copy.uri);
  return decodeURIComponent(copy.uri.replace(/^file:\/\//, ''));
}

/** Audio or video Android downloaded plays in VidoraX's player straight from Android's link (nothing copied). */
export function systemDownloadMediaId(item: Pick<MediaLibraryItem, 'id' | 'fileName' | 'mimeType' | 'fileSize' | 'downloadedAt'>): string | null {
  const row = rowOf(item.id);
  if (!row) return null;
  const video = {
    id: `sysdl-${row.id}`,
    uri: row.uri,
    title: item.fileName,
    durationMs: null,
    sizeBytes: Number(item.fileSize) || 0,
    width: null,
    height: null,
    addedAt: row.modifiedAt,
    mimeType: item.mimeType,
  };
  rememberDeviceVideos([video]);
  return deviceMediaId(video);
}
