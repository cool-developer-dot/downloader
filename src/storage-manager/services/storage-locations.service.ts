import { Paths } from 'expo-file-system';

import { DOWNLOAD_ENGINE } from '@/downloads/engine/constants';
import { getDownloadsRootDirectory } from '@/downloads/engine/file-paths';
import { HLS_TRANSFER } from '@/downloads/engine/hls/constants';
import { MULTI_RANGE } from '@/downloads/engine/multi-range/constants';

import type { AppStorageBreakdown, StorageLocation } from '../types/storage.types';
import { formatStoragePath } from '../utils/format-path';

export function buildStorageLocations(
  breakdown: AppStorageBreakdown | null,
): StorageLocation[] {
  const downloadsRoot = getDownloadsRootDirectory();
  const documents = Paths.document;
  const cache = Paths.cache;

  const downloadsPath = downloadsRoot.exists
    ? formatStoragePath(downloadsRoot.uri)
    : formatStoragePath(`${documents.uri}/${DOWNLOAD_ENGINE.rootFolderName}`);

  return [
    {
      id: 'downloads',
      label: 'downloadedVideos',
      path: downloadsPath,
      type: 'downloads',
      visibility: 'app-private',
      description: 'downloadedVideosDescription',
      sizeBytes: breakdown?.videosBytes ?? null,
      exists: downloadsRoot.exists,
    },
    {
      id: 'images',
      label: 'thumbnails',
      path: formatStoragePath(cache.uri),
      type: 'images',
      visibility: 'app-private',
      description: 'thumbnailsDescription',
      sizeBytes: null,
      exists: cache.exists,
    },
    {
      id: 'temp',
      label: 'temporaryFiles',
      path: `{${DOWNLOAD_ENGINE.rootFolderName}}/{id}/${HLS_TRANSFER.workspaceFolderName}/`,
      type: 'temp',
      visibility: 'app-private',
      description: 'temporaryFilesDescription',
      sizeBytes: breakdown?.tempBytes ?? null,
      exists: true,
    },
    {
      id: 'cache',
      label: 'appCache',
      path: formatStoragePath(cache.uri),
      type: 'cache',
      visibility: 'app-private',
      description: 'appCacheDescription',
      sizeBytes: breakdown?.cacheBytes ?? null,
      exists: cache.exists,
    },
    {
      id: 'documents',
      label: 'appDocuments',
      path: formatStoragePath(documents.uri),
      type: 'documents',
      visibility: 'app-private',
      description: 'appDocumentsDescription',
      sizeBytes: breakdown?.otherBytes ?? null,
      exists: documents.exists,
    },
    {
      id: 'temp-parts',
      label: 'temporaryDownloadParts',
      path: `{${DOWNLOAD_ENGINE.rootFolderName}}/{id}/${MULTI_RANGE.workspaceFolderName}/`,
      type: 'temp',
      visibility: 'app-private',
      description: 'temporaryDownloadPartsDescription',
      sizeBytes: breakdown?.tempBytes ?? null,
      exists: true,
    },
  ];
}
