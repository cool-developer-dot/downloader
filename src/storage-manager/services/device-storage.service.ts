import { Paths } from 'expo-file-system';

import { readAvailableDiskBytes } from '@/screens/home/utils/home-local-index';

import type { DeviceStorageSnapshot } from '../types/storage.types';

function readTotalDiskBytes(): number | null {
  try {
    const total = Paths.totalDiskSpace;
    if (typeof total === 'number' && Number.isFinite(total) && total >= 0) {
      return Math.trunc(total);
    }
    return null;
  } catch {
    return null;
  }
}

export function readDeviceStorageSnapshot(): DeviceStorageSnapshot {
  const freeBytes = readAvailableDiskBytes();
  const totalBytes = readTotalDiskBytes();

  let usedBytes: number | null = null;
  if (totalBytes != null && freeBytes != null) {
    usedBytes = Math.max(0, totalBytes - freeBytes);
  }

  let usageRatio: number | null = null;
  if (totalBytes != null && usedBytes != null && totalBytes > 0) {
    usageRatio = Math.max(0, Math.min(1, usedBytes / totalBytes));
  }

  return {
    totalBytes,
    usedBytes,
    freeBytes,
    usageRatio,
    available: freeBytes != null || totalBytes != null,
  };
}
