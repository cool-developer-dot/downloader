/**
 * Phase 1A — one-time seed of local download catalog from engine records + store.
 * Never regenerates downloadIds. Never walks the filesystem unbounded.
 */

import type { DownloadItem, DownloadStatus } from '@/api/types';
import { listLocalRecords } from '@/downloads/engine/persistence';
import type { LocalDownloadRecord } from '@/downloads/engine/types';
import { mmkvKeys } from '@/storage/constants';
import { getBooleanFlag, setBooleanFlag } from '@/storage/mmkv/flags';
import {
  downloadCatalogRepository,
  mediaFolderRepository,
  normalizeFolderName,
} from '@/storage/repositories';
import { nowIso } from '@/storage/utils';

function statusFromLocalRecord(record: LocalDownloadRecord): DownloadStatus {
  switch (record.localState) {
    case 'complete':
      return 'COMPLETED';
    case 'paused':
      return 'PAUSED';
    case 'transferring':
      return 'DOWNLOADING';
    case 'failed':
    case 'corrupt':
      return 'FAILED';
    case 'deleted':
    case 'missing':
      return record.remoteStatus === 'CANCELLED' ? 'CANCELLED' : 'FAILED';
    case 'not_started':
    default:
      return record.remoteStatus ?? 'QUEUED';
  }
}

function progressFromRecord(record: LocalDownloadRecord): number {
  if (record.localState === 'complete') {
    return 100;
  }
  if (
    record.totalBytes != null &&
    record.totalBytes > 0 &&
    record.bytesWritten >= 0
  ) {
    return Math.max(
      0,
      Math.min(100, Math.trunc((record.bytesWritten / record.totalBytes) * 100)),
    );
  }
  return 0;
}

function titleFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').trim();
  return base || fileName || 'Download';
}

export type CatalogSeedResult = {
  seeded: boolean;
  skipped: boolean;
  created: number;
  enriched: number;
  foldersSeeded: number;
};

/**
 * Idempotent seed. Safe to call on every launch — after the flag is set,
 * only inserts engine/store ids missing from catalog (id-preserving).
 */
export async function ensureDownloadCatalogSeeded(options?: {
  storeItems?: DownloadItem[];
  folderSnapshots?: Array<{
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
  }>;
  force?: boolean;
}): Promise<CatalogSeedResult> {
  const already = getBooleanFlag(mmkvKeys.catalogSeededV1, false);
  let created = 0;
  let enriched = 0;
  let foldersSeeded = 0;

  try {
    if (options?.folderSnapshots?.length) {
      for (const folder of options.folderSnapshots) {
        if (!folder.id?.trim() || !folder.name?.trim()) {
          continue;
        }
        const inserted = await mediaFolderRepository.insertIfAbsent({
          id: folder.id.trim(),
          name: folder.name.trim(),
          normalizedName: normalizeFolderName(folder.name),
          createdAt: folder.createdAt || nowIso(),
          updatedAt: folder.updatedAt || nowIso(),
        });
        if (inserted) {
          foldersSeeded += 1;
        }
      }
    }

    const records = await listLocalRecords();
    const recordsById = new Map<string, LocalDownloadRecord>();
    for (const record of records) {
      recordsById.set(record.downloadId, record);
    }

    const storeById = new Map<string, DownloadItem>();
    for (const item of options?.storeItems ?? []) {
      if (item?.id) {
        storeById.set(item.id, item);
      }
    }

    const candidateIds = new Set<string>();
    for (const id of recordsById.keys()) {
      candidateIds.add(id);
    }
    for (const id of storeById.keys()) {
      candidateIds.add(id);
    }

    // Fast path after first seed: only insert ids missing from catalog.
    if (already && !options?.force) {
      const existingIds = new Set(await downloadCatalogRepository.listAllIds());
      for (const id of candidateIds) {
        if (existingIds.has(id)) {
          continue;
        }
        const storeItem = storeById.get(id) ?? null;
        const record = recordsById.get(id) ?? null;
        if (storeItem) {
          await downloadCatalogRepository.insertIfAbsent({
            id: storeItem.id,
            title: storeItem.title || titleFromFileName(storeItem.fileName),
            sourceUrl: storeItem.sourceUrl,
            platform: storeItem.platform,
            thumbnailUrl: storeItem.thumbnailUrl,
            fileName: storeItem.fileName,
            folderId: storeItem.folderId,
            fileSize: storeItem.fileSize,
            status: storeItem.status,
            progress: storeItem.progress,
            quality: storeItem.quality,
            resolution: storeItem.resolution,
            bitrate: storeItem.bitrate,
            retryCount: storeItem.retryCount,
            workerState: storeItem.workerState,
            errorCode: storeItem.errorCode,
            errorMessage: storeItem.errorMessage,
            downloadedAt: storeItem.downloadedAt,
            createdAt: storeItem.createdAt,
            updatedAt: storeItem.updatedAt,
            favorite: false,
          });
          created += 1;
          continue;
        }
        if (record) {
          const status = statusFromLocalRecord(record);
          await downloadCatalogRepository.insertIfAbsent({
            id: record.downloadId,
            title: titleFromFileName(record.fileName),
            sourceUrl: record.sourceUrl,
            platform: '',
            thumbnailUrl: '',
            fileName: record.fileName,
            folderId: null,
            fileSize: record.expectedFileSize || String(record.totalBytes ?? 0),
            status,
            progress: progressFromRecord(record),
            quality: null,
            resolution: null,
            bitrate: null,
            retryCount: record.retryCount,
            workerState: null,
            errorCode: record.errorCode,
            errorMessage: record.errorMessage,
            downloadedAt:
              record.localState === 'complete' ? record.updatedAt : null,
            createdAt: record.updatedAt || nowIso(),
            updatedAt: record.updatedAt || nowIso(),
            favorite: false,
          });
          created += 1;
        }
      }

      return {
        seeded: true,
        skipped: created === 0 && foldersSeeded === 0,
        created,
        enriched: 0,
        foldersSeeded,
      };
    }

    for (const id of candidateIds) {
      const record = recordsById.get(id) ?? null;
      const storeItem = storeById.get(id) ?? null;
      const existing = await downloadCatalogRepository.getById(id);

      if (existing) {
        if (
          storeItem &&
          (!existing.title ||
            !existing.sourceUrl ||
            existing.thumbnailUrl === '' ||
            !existing.quality)
        ) {
          await downloadCatalogRepository.upsert({
            id,
            title: existing.title || storeItem.title,
            sourceUrl: existing.sourceUrl || storeItem.sourceUrl,
            platform: existing.platform || storeItem.platform,
            thumbnailUrl: existing.thumbnailUrl || storeItem.thumbnailUrl,
            fileName: existing.fileName || storeItem.fileName,
            folderId: existing.folderId ?? storeItem.folderId,
            fileSize:
              existing.fileSize !== '0' ? existing.fileSize : storeItem.fileSize,
            quality: existing.quality ?? storeItem.quality,
            resolution: existing.resolution ?? storeItem.resolution,
            bitrate: existing.bitrate ?? storeItem.bitrate,
            status: existing.status,
          });
          enriched += 1;
        }
        continue;
      }

      if (storeItem) {
        await downloadCatalogRepository.insertIfAbsent({
          id: storeItem.id,
          title: storeItem.title || titleFromFileName(storeItem.fileName),
          sourceUrl: storeItem.sourceUrl,
          platform: storeItem.platform,
          thumbnailUrl: storeItem.thumbnailUrl,
          fileName: storeItem.fileName,
          folderId: storeItem.folderId,
          fileSize: storeItem.fileSize,
          status: storeItem.status,
          progress: storeItem.progress,
          quality: storeItem.quality,
          resolution: storeItem.resolution,
          bitrate: storeItem.bitrate,
          retryCount: storeItem.retryCount,
          workerState: storeItem.workerState,
          errorCode: storeItem.errorCode,
          errorMessage: storeItem.errorMessage,
          downloadedAt: storeItem.downloadedAt,
          createdAt: storeItem.createdAt,
          updatedAt: storeItem.updatedAt,
          favorite: false,
        });
        created += 1;
        continue;
      }

      if (record) {
        const status = statusFromLocalRecord(record);
        await downloadCatalogRepository.insertIfAbsent({
          id: record.downloadId,
          title: titleFromFileName(record.fileName),
          sourceUrl: record.sourceUrl,
          platform: '',
          thumbnailUrl: '',
          fileName: record.fileName,
          folderId: null,
          fileSize: record.expectedFileSize || String(record.totalBytes ?? 0),
          status,
          progress: progressFromRecord(record),
          quality: null,
          resolution: null,
          bitrate: null,
          retryCount: record.retryCount,
          workerState: null,
          errorCode: record.errorCode,
          errorMessage: record.errorMessage,
          downloadedAt:
            record.localState === 'complete' ? record.updatedAt : null,
          createdAt: record.updatedAt || nowIso(),
          updatedAt: record.updatedAt || nowIso(),
          favorite: false,
        });
        created += 1;
      }
    }

    if (!already || options?.force) {
      setBooleanFlag(mmkvKeys.catalogSeededV1, true);
    }

    return {
      seeded: true,
      skipped: already && created === 0 && enriched === 0,
      created,
      enriched,
      foldersSeeded,
    };
  } catch (error) {
    if (__DEV__) {
      console.warn('[catalog-seed] failed', error);
    }
    return {
      seeded: false,
      skipped: false,
      created,
      enriched,
      foldersSeeded,
    };
  }
}
