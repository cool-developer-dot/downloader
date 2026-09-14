import type {
  DownloadStatus,
  DownloadWorkerState,
  FavoritePlatform,
} from '@/api/types';

/** Durable local download/media catalog row (filesystem holds the blob). */
export type DownloadCatalogEntry = {
  id: string;
  title: string;
  sourceUrl: string;
  platform: string;
  thumbnailUrl: string;
  fileName: string;
  folderId: string | null;
  fileSize: string;
  status: DownloadStatus;
  progress: number;
  quality: string | null;
  resolution: string | null;
  bitrate: number | null;
  retryCount: number;
  workerState: DownloadWorkerState | null;
  errorCode: string | null;
  errorMessage: string | null;
  favorite: boolean;
  mimeType: string | null;
  duration: number | null;
  downloadedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UpsertDownloadCatalogInput = {
  id: string;
  title?: string;
  sourceUrl?: string;
  platform?: string;
  thumbnailUrl?: string;
  fileName?: string;
  folderId?: string | null;
  fileSize?: string;
  status?: DownloadStatus;
  progress?: number;
  quality?: string | null;
  resolution?: string | null;
  bitrate?: number | null;
  retryCount?: number;
  workerState?: DownloadWorkerState | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  favorite?: boolean;
  mimeType?: string | null;
  duration?: number | null;
  downloadedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type ListDownloadCatalogOptions = {
  page?: number;
  limit?: number;
  search?: string;
  status?: DownloadStatus;
  sort?: 'newest' | 'oldest' | 'alphabetical';
};

export type MediaFolderEntry = {
  id: string;
  name: string;
  normalizedName: string;
  createdAt: string;
  updatedAt: string;
};

export type UrlFavoriteEntry = {
  id: string;
  title: string;
  platform: FavoritePlatform;
  sourceUrl: string;
  thumbnailUrl: string;
  createdAt: string;
};

export type CreateUrlFavoriteInput = {
  id?: string;
  title: string;
  platform: FavoritePlatform;
  sourceUrl: string;
  thumbnailUrl: string;
  createdAt?: string;
};
