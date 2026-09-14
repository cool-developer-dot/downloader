import { formatFileSize } from '@/media-detection/utils/format';

export { formatFileSize };

/** Format bigint byte counts for storage UI. */
export function formatBytesLabel(bytes: number | bigint | null | undefined): string | null {
  if (bytes == null) {
    return null;
  }

  const value = typeof bytes === 'bigint' ? bytes : BigInt(Math.trunc(bytes));

  if (value < 0n) {
    return null;
  }

  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    const gib = Number(value / 1_073_741_824n);
    return `${gib.toFixed(gib >= 10 ? 0 : 1)} GB`;
  }

  return formatFileSize(Number(value));
}

export function formatUsagePercent(ratio: number | null | undefined): string | null {
  if (ratio == null || !Number.isFinite(ratio)) {
    return null;
  }
  return `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
}
