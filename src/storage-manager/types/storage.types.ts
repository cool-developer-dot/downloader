export type StorageVisibility = 'user-visible' | 'app-private';

export type StorageLocationType =
  | 'downloads'
  | 'images'
  | 'cache'
  | 'documents'
  | 'temp';

export type DeviceStorageSnapshot = {
  totalBytes: number | null;
  usedBytes: number | null;
  freeBytes: number | null;
  usageRatio: number | null;
  available: boolean;
};

export type AppStorageCategory = 'videos' | 'images' | 'cache' | 'temp' | 'other';

export type AppStorageBreakdown = {
  totalBytes: number;
  videosBytes: number;
  imagesBytes: number;
  cacheBytes: number;
  tempBytes: number;
  otherBytes: number;
  estimated: boolean;
  scanError: string | null;
};

export type StorageLocation = {
  id: string;
  label: string;
  path: string;
  type: StorageLocationType;
  visibility: StorageVisibility;
  description: string;
  sizeBytes?: number | null;
  exists: boolean;
};

export type HomeStorageSummaryView = {
  usedLabel: string | null;
  freeLabel: string | null;
  usageRatio: number | null;
  unavailable: boolean;
  usedBytes: bigint;
};

export type StorageManagerSnapshot = {
  device: DeviceStorageSnapshot;
  app: AppStorageBreakdown;
  locations: StorageLocation[];
};
