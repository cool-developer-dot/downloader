import type { DownloadItem } from '@/store/downloads/types';
import {
  deriveManagedStorageBytes,
  deriveStorageUsageRatio,
  formatManagedStorageLabel,
  type HomeLocalFileMeta,
} from '@/screens/home/utils/home-derive';

import { readDeviceStorageSnapshot } from './device-storage.service';
import type { HomeStorageSummaryView } from '../types/storage.types';

export function buildHomeStorageSummary(options: {
  completed: readonly DownloadItem[];
  localById: Record<string, HomeLocalFileMeta | undefined>;
  freeBytes?: number | null;
}): HomeStorageSummaryView {
  const usedBytes = deriveManagedStorageBytes(options.completed, options.localById);
  const freeBytes = options.freeBytes ?? readDeviceStorageSnapshot().freeBytes;

  const usedLabel = formatManagedStorageLabel(usedBytes);
  const freeLabel =
    freeBytes != null ? formatManagedStorageLabel(BigInt(freeBytes)) : null;
  const usageRatio = deriveStorageUsageRatio(usedBytes, freeBytes);
  const availabilityKnown = freeBytes != null || usedLabel != null;

  return {
    usedLabel,
    freeLabel,
    usageRatio,
    unavailable: availabilityKnown && usedLabel == null && freeLabel == null,
    usedBytes,
  };
}
