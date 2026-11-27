/**
 * Files F7 · #911 Hide file: a hidden file leaves the Files lists, the Player tab, Downloads and search until F2's
 * "Show hidden files" is on. Pure selectors, one per kind of list, all with the same rule. It is not encryption: the
 * file stays where it is (Private is the place that locks a file).
 */

/** Items whose `id` is hidden are left out, unless hidden files are shown. */
export function withoutHiddenItems<T extends { id: string }>(items: readonly T[], hiddenIds: ReadonlySet<string>, showHidden: boolean): T[] {
  if (showHidden || hiddenIds.size === 0) {
    return [...items];
  }
  return items.filter((item) => !hiddenIds.has(item.id));
}

/** The same for a list of ids (the Downloads list keeps ids). */
export function withoutHiddenIds(ids: readonly string[], hiddenIds: ReadonlySet<string>, showHidden: boolean): string[] {
  if (showHidden || hiddenIds.size === 0) {
    return [...ids];
  }
  return ids.filter((id) => !hiddenIds.has(id));
}

/** Stored ids, checked: unique non-empty strings. */
export function normalizeHiddenIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))];
}
