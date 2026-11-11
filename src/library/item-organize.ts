/**
 * H12: Tags (#387), Notes (#495) and the Size filter (#396) for saved videos. Pure.
 *
 * Tags and notes belong to a completed item (keyed by its id: a download's id is its library item's id) and are kept
 * on this device only. Nothing set changes nothing: every list shows what it showed before.
 */

export const MAX_TAG_LENGTH = 30;
export const MAX_TAGS_PER_ITEM = 20;
export const MAX_NOTE_LENGTH = 1000;

export type TagProblem = 'empty' | 'too-long' | 'duplicate' | 'too-many';

/** A tag as stored: trimmed, inner spaces collapsed. */
export function cleanTag(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/** Why [raw] cannot be added to [tags]; null when it can. Tags compare without case. */
export function tagProblem(tags: readonly string[], raw: string): TagProblem | null {
  const tag = cleanTag(raw);
  if (!tag) {
    return 'empty';
  }
  if (tag.length > MAX_TAG_LENGTH) {
    return 'too-long';
  }
  const lower = tag.toLocaleLowerCase();
  if (tags.some((existing) => existing.toLocaleLowerCase() === lower)) {
    return 'duplicate';
  }
  return tags.length >= MAX_TAGS_PER_ITEM ? 'too-many' : null;
}

/** Whatever was stored, as tags: only valid, unique ones, at most [MAX_TAGS_PER_ITEM]. */
export function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: string[] = [];
  for (const value of raw) {
    if (typeof value === 'string' && tagProblem(out, value) === null) {
      out.push(cleanTag(value));
    }
  }
  return out;
}

/** A note as stored: trimmed, at most [MAX_NOTE_LENGTH] characters; empty = no note. */
export function cleanNote(raw: string): string {
  return raw.trim().slice(0, MAX_NOTE_LENGTH);
}

/** Every tag in use, sorted for display, each once (the spelling of its first use), with how many items have it. */
export function allTags(tagsById: Readonly<Record<string, readonly string[]>>): { tag: string; count: number }[] {
  const byKey = new Map<string, { tag: string; count: number }>();
  for (const tags of Object.values(tagsById)) {
    for (const tag of tags) {
      const key = tag.toLocaleLowerCase();
      const entry = byKey.get(key);
      if (entry) {
        entry.count += 1;
      } else {
        byKey.set(key, { tag, count: 1 });
      }
    }
  }
  return [...byKey.values()].sort((a, b) => a.tag.localeCompare(b.tag));
}

export function hasTag(tags: readonly string[] | undefined, tag: string): boolean {
  const lower = tag.toLocaleLowerCase();
  return Boolean(tags?.some((value) => value.toLocaleLowerCase() === lower));
}

export type SizeBucket = 'all' | 'under50' | '50to500' | '500to2g' | 'over2g';

export const SIZE_BUCKETS: readonly SizeBucket[] = ['all', 'under50', '50to500', '500to2g', 'over2g'];

const MB = 1024 * 1024;
const GB = 1024 * MB;

/** The bucket of a size in bytes ("123" as the lists store it); null when the size is unknown. */
export function sizeBucketOf(size: string | number | null | undefined): Exclude<SizeBucket, 'all'> | null {
  const bytes = typeof size === 'string' ? Number(size) : size;
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) {
    return null;
  }
  if (bytes < 50 * MB) {
    return 'under50';
  }
  if (bytes < 500 * MB) {
    return '50to500';
  }
  return bytes < 2 * GB ? '500to2g' : 'over2g';
}

/** Whether a size belongs to [bucket]; an unknown size only belongs to "All". */
export function matchesSize(size: string | number | null | undefined, bucket: SizeBucket): boolean {
  return bucket === 'all' || sizeBucketOf(size) === bucket;
}

export function normalizeSizeBucket(raw: unknown): SizeBucket {
  return typeof raw === 'string' && (SIZE_BUCKETS as readonly string[]).includes(raw) ? (raw as SizeBucket) : 'all';
}
