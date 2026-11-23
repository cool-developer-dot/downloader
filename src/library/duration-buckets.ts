/**
 * P9 #711 Duration Filter: short and long videos apart. Pure.
 *
 * Buckets are half-open and include their lower end, on whole seconds (the length is floored, as the Player's time
 * shows it: 4:59.7 is "4:59"):
 * - under 5 min: 0:00 … 4:59
 * - 5 to 20 min: 5:00 … 19:59
 * - 20 to 60 min: 20:00 … 59:59
 * - 60 min or more: 60:00 and longer
 *
 * A video whose length isn't known shows only under Any.
 */

export const DURATION_BUCKETS = ['any', 'under5', 'from5to20', 'from20to60', 'over60'] as const;

export type DurationBucket = (typeof DURATION_BUCKETS)[number];

export const DEFAULT_DURATION_BUCKET: DurationBucket = 'any';

const FIVE_MIN = 5 * 60;
const TWENTY_MIN = 20 * 60;
const SIXTY_MIN = 60 * 60;

export function isDurationBucket(value: unknown): value is DurationBucket {
  return typeof value === 'string' && (DURATION_BUCKETS as readonly string[]).includes(value);
}

/** A usable length in seconds, or null (missing, not a number, zero or negative). */
export function knownDurationSeconds(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** The bucket a length falls in; null when the length is unknown. */
export function durationBucketOf(seconds: number | null | undefined): Exclude<DurationBucket, 'any'> | null {
  const known = knownDurationSeconds(seconds);
  if (known == null) {
    return null;
  }
  const whole = Math.floor(known);
  if (whole < FIVE_MIN) return 'under5';
  if (whole < TWENTY_MIN) return 'from5to20';
  if (whole < SIXTY_MIN) return 'from20to60';
  return 'over60';
}

export function matchesDurationBucket(seconds: number | null | undefined, bucket: DurationBucket): boolean {
  return bucket === 'any' || durationBucketOf(seconds) === bucket;
}

/**
 * The length of each item: its own `duration`, else what is known from elsewhere (`lengthById`: the video's file as
 * the native library measured it, or its playback record).
 */
export function itemDurationSeconds(
  item: { id: string; duration: number | null },
  lengthById?: Readonly<Record<string, number>> | null,
): number | null {
  return knownDurationSeconds(item.duration) ?? knownDurationSeconds(lengthById?.[item.id]);
}

/** Keeps the items in the bucket (all of them for Any). */
export function filterByDurationBucket<T extends { id: string; duration: number | null }>(
  items: readonly T[],
  bucket: DurationBucket | null | undefined,
  lengthById?: Readonly<Record<string, number>> | null,
): T[] {
  if (!bucket || bucket === 'any') {
    return [...items];
  }
  return items.filter((item) => matchesDurationBucket(itemDurationSeconds(item, lengthById), bucket));
}
