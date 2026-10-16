/**
 * Metadata Tagging (#375). Pure. The existing muxers (Media3's MP4 muxer behind Transformer and the module's own
 * Remuxer) have no supported way to write title/artist tags that players read, and the original file is never
 * rewritten for tags — so tags are app-level: the title is the library title (the existing rename), the artist is
 * kept by VidoraX per library item (MMKV) and shown in Download Details and the Player.
 */

/** Longest artist kept, in code points. */
export const MAX_ARTIST_LENGTH = 120;
/** Items with an artist kept at most (oldest dropped first). */
export const MAX_TAGGED_ITEMS = 2000;

const CONTROL = /[\x00-\x1f\x7f]/g;

/** An artist as it is kept: one line, trimmed, capped; empty means "no artist". */
export function normalizeArtist(raw: unknown): string {
  if (typeof raw !== 'string') {
    return '';
  }
  const clean = raw.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  const points = Array.from(clean);
  return points.length > MAX_ARTIST_LENGTH ? points.slice(0, MAX_ARTIST_LENGTH).join('').trimEnd() : clean;
}

export type ArtistTags = Record<string, string>;

/** Pure: the tags with `id`'s artist set (or removed when empty), capped by dropping the oldest entries. */
export function withArtist(tags: ArtistTags, id: string, artist: string): ArtistTags {
  if (!id) {
    return tags;
  }
  const value = normalizeArtist(artist);
  if (!value) {
    if (!(id in tags)) {
      return tags;
    }
    const next = { ...tags };
    delete next[id];
    return next;
  }
  if (tags[id] === value) {
    return tags;
  }
  const next: ArtistTags = { ...tags };
  delete next[id];
  next[id] = value;
  const ids = Object.keys(next);
  for (const drop of ids.slice(0, Math.max(0, ids.length - MAX_TAGGED_ITEMS))) {
    delete next[drop];
  }
  return next;
}

/** Pure: the tags without `ids` (items deleted from VidoraX). The same object when none was tagged. */
export function withoutArtists(tags: ArtistTags, ids: readonly string[]): ArtistTags {
  if (!ids.some((id) => Object.prototype.hasOwnProperty.call(tags, id))) {
    return tags;
  }
  const next = { ...tags };
  for (const id of ids) {
    delete next[id];
  }
  return next;
}

/** Whatever was stored, as tags: only non-empty strings survive. */
export function normalizeArtistTags(raw: unknown): ArtistTags {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const out: ArtistTags = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const artist = normalizeArtist(value);
    if (id && artist) {
      out[id] = artist;
    }
  }
  return out;
}
