/**
 * Files F9 · design 59: the storage bar in three parts — VidoraX, other apps and free — from `storageSpace()`. Pure.
 *
 * The parts always add up to 100%. A part that is there but tiny still gets a minimum width so it can be seen (taken
 * from the biggest part); a part that is zero stays zero. Zero free space, or an unknown total, are handled.
 */

export type StoragePart = 'vidorax' | 'other' | 'free';

export type StorageBarPart = { part: StoragePart; bytes: number; percent: number };

/** The smallest width, in percent, of a part that isn't empty. */
export const MIN_PART_PERCENT = 2;

export function storageBarParts(
  space: { totalBytes: number; freeBytes: number; vidoraxBytes: number },
  minPercent = MIN_PART_PERCENT,
): StorageBarPart[] {
  const total = Math.max(0, space.totalBytes);
  const free = Math.min(total, Math.max(0, space.freeBytes));
  const vidorax = Math.min(total - free, Math.max(0, space.vidoraxBytes));
  const other = Math.max(0, total - free - vidorax);
  const bytes: Record<StoragePart, number> = { vidorax, other, free };
  const order: StoragePart[] = ['vidorax', 'other', 'free'];
  if (total === 0) {
    return order.map((part) => ({ part, bytes: 0, percent: part === 'free' ? 100 : 0 }));
  }
  const percent: Record<StoragePart, number> = { vidorax: 0, other: 0, free: 0 };
  for (const part of order) {
    percent[part] = (bytes[part] / total) * 100;
  }
  // Lift the tiny parts to the minimum, paying for it from the biggest part.
  let lifted = 0;
  for (const part of order) {
    if (bytes[part] > 0 && percent[part] < minPercent) {
      lifted += minPercent - percent[part];
      percent[part] = minPercent;
    }
  }
  if (lifted > 0) {
    const biggest = order.reduce((best, part) => (percent[part] > percent[best] ? part : best), order[0]!);
    percent[biggest] = Math.max(0, percent[biggest] - lifted);
  }
  // Round to two decimals and give the rounding's remainder to the biggest part, so the sum is exactly 100.
  const rounded = order.map((part) => ({ part, bytes: bytes[part], percent: Math.round(percent[part] * 100) / 100 }));
  const sum = rounded.reduce((total100, entry) => total100 + entry.percent, 0);
  const biggest = rounded.reduce((best, entry) => (entry.percent > best.percent ? entry : best), rounded[0]!);
  biggest.percent = Math.round((biggest.percent + (100 - sum)) * 100) / 100;
  return rounded;
}
