import type { DownloadItem } from '@/api/types';
import {
  downloadCatalogRepository,
  downloadItemToCatalogInput,
} from '@/storage/repositories/download-catalog.repository';

let favoriteMediaIdCache = new Set<string>();

export function getCachedFavoriteMediaIds(): Set<string> {
  return favoriteMediaIdCache;
}

export async function refreshFavoriteMediaIdCache(): Promise<void> {
  try {
    const ids = await downloadCatalogRepository.listFavoriteMediaIds();
    favoriteMediaIdCache = new Set(ids);
  } catch {
    // keep previous cache
  }
}

export function persistDownloadCatalogItem(
  item: DownloadItem,
  extras?: { favorite?: boolean },
): void {
  void downloadCatalogRepository
    .upsert(downloadItemToCatalogInput(item, extras))
    .then(async (entry) => {
      if (entry.favorite) {
        favoriteMediaIdCache.add(entry.id);
      } else {
        favoriteMediaIdCache.delete(entry.id);
      }
    })
    .catch(() => {
      // Local FS/DB failures are surfaced elsewhere; sync must not break transfer.
    });
}

export function persistDownloadCatalogPatch(
  id: string,
  patch: Partial<DownloadItem> & { favorite?: boolean },
): void {
  void downloadCatalogRepository
    .upsert({
      id,
      title: patch.title,
      sourceUrl: patch.sourceUrl,
      platform: patch.platform,
      thumbnailUrl: patch.thumbnailUrl,
      fileName: patch.fileName,
      folderId: patch.folderId,
      fileSize: patch.fileSize,
      status: patch.status,
      progress: patch.progress,
      quality: patch.quality,
      resolution: patch.resolution,
      bitrate: patch.bitrate,
      retryCount: patch.retryCount,
      workerState: patch.workerState,
      errorCode: patch.errorCode,
      errorMessage: patch.errorMessage,
      downloadedAt: patch.downloadedAt,
      updatedAt: patch.updatedAt,
      favorite: patch.favorite,
      mimeType: patch.mimeType,
    })
    .then((entry) => {
      if (patch.favorite !== undefined) {
        if (entry.favorite) {
          favoriteMediaIdCache.add(entry.id);
        } else {
          favoriteMediaIdCache.delete(entry.id);
        }
      }
    })
    .catch(() => {
      // ignore
    });
}

export function removeDownloadCatalogItem(id: string): void {
  favoriteMediaIdCache.delete(id);
  void downloadCatalogRepository.delete(id).catch(() => {
    // ignore
  });
}
