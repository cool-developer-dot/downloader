/**
 * Files F7 · #977 Color tags: each tag can have one of the 8 swatches; rows show a coloured dot and search (F6) can
 * filter by colour. Pure. Tags are matched ignoring case (as the tag store does); an unknown colour is dropped.
 */

import { isSwatchId, type SwatchId } from './swatches';

export type TagColors = Readonly<Record<string, SwatchId>>;

function key(tag: string): string {
  return tag.trim().toLocaleLowerCase();
}

/** Stored colours, checked: known tags with a known colour only. */
export function normalizeTagColors(value: unknown): Record<string, SwatchId> {
  const out: Record<string, SwatchId> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [tag, color] of Object.entries(value as Record<string, unknown>)) {
    if (key(tag) && isSwatchId(color)) {
      out[key(tag)] = color;
    }
  }
  return out;
}

/** Sets a tag's colour; an unknown colour changes nothing. */
export function setTagColor(colors: TagColors, tag: string, color: unknown): Record<string, SwatchId> {
  if (!key(tag) || !isSwatchId(color)) return { ...colors };
  return { ...colors, [key(tag)]: color };
}

export function clearTagColor(colors: TagColors, tag: string): Record<string, SwatchId> {
  const next = { ...colors };
  delete next[key(tag)];
  return next;
}

/** A renamed tag keeps its colour under the new name. */
export function renameTagColor(colors: TagColors, from: string, to: string): Record<string, SwatchId> {
  const color = colors[key(from)];
  if (!color || !key(to)) return { ...colors };
  const next = clearTagColor(colors, from);
  next[key(to)] = color;
  return next;
}

export function tagColorOf(colors: TagColors, tag: string): SwatchId | null {
  return colors[key(tag)] ?? null;
}

/** The colours of a file's tags (for the row's dots and F6's colour filter), without repeats. */
export function colorsOfTags(colors: TagColors, tags: readonly string[]): SwatchId[] {
  const out: SwatchId[] = [];
  for (const tag of tags) {
    const color = tagColorOf(colors, tag);
    if (color && !out.includes(color)) out.push(color);
  }
  return out;
}
