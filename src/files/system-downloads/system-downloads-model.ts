/**
 * Files: the files VidoraX's browser handed to Android's DownloadManager (pictures, documents, archives, apps, audio
 * the engine does not keep), in the library item shape the Files lists use. Pure.
 *
 * Their ids start with `sysdl:` so every action can tell them from library items: they open, share and delete through
 * DownloadManager, and the library-only actions (rename, move, Private, the bin, checksum) are not offered.
 */
import type { SystemDownload } from '@modules/vidorax-media/src/VidoraMedia.types';

import type { MediaLibraryItem } from '@/library/types';

const PREFIX = 'sysdl:';

export function systemDownloadId(downloadId: string): string {
  return `${PREFIX}${downloadId}`;
}

export function isSystemDownloadId(id: string | null | undefined): id is string {
  return typeof id === 'string' && id.startsWith(PREFIX) && /^\d+$/.test(id.slice(PREFIX.length));
}

/** DownloadManager's id of a `sysdl:` item, or null for any other id. */
export function downloadIdOf(id: string): string | null {
  return isSystemDownloadId(id) ? id.slice(PREFIX.length) : null;
}

function withoutExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

function isPicture(download: SystemDownload): boolean {
  return (download.mimeType ?? '').startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp|heic|heif|avif)$/i.test(download.title);
}

export function systemDownloadToItem(download: SystemDownload): MediaLibraryItem {
  const name = download.title.trim() || 'Download';
  const at = Number.isFinite(download.modifiedAt) && download.modifiedAt > 0 ? new Date(download.modifiedAt).toISOString() : null;
  return {
    id: systemDownloadId(download.id),
    downloadId: systemDownloadId(download.id),
    displayName: withoutExtension(name),
    fileName: name,
    mimeType: download.mimeType,
    fileSize: String(Math.max(0, Math.round(download.sizeBytes || 0))),
    quality: null,
    resolution: null,
    bitrate: null,
    duration: null,
    downloadedAt: at,
    favorite: false,
    folderId: null,
    folderName: null,
    localAvailability: 'available',
    // A picture is its own thumbnail; Android's link is readable by VidoraX.
    thumbnailUri: isPicture(download) ? download.uri : null,
    lastPlayedAt: null,
    progressPercent: null,
    positionSeconds: null,
    completed: true,
  };
}

/** Valid rows only (an id, a link), each id once. */
export function systemDownloadItems(rows: unknown): MediaLibraryItem[] {
  if (!Array.isArray(rows)) {
    return [];
  }
  const seen = new Set<string>();
  const items: MediaLibraryItem[] = [];
  for (const row of rows as Partial<SystemDownload>[]) {
    if (!row || typeof row.id !== 'string' || !/^\d+$/.test(row.id) || typeof row.uri !== 'string' || seen.has(row.id)) {
      continue;
    }
    seen.add(row.id);
    items.push(
      systemDownloadToItem({
        id: row.id,
        title: typeof row.title === 'string' ? row.title : '',
        mimeType: typeof row.mimeType === 'string' && row.mimeType.includes('/') ? row.mimeType : null,
        sizeBytes: typeof row.sizeBytes === 'number' ? row.sizeBytes : 0,
        modifiedAt: typeof row.modifiedAt === 'number' ? row.modifiedAt : 0,
        uri: row.uri,
      }),
    );
  }
  return items;
}
