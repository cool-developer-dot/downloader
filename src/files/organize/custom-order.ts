/**
 * Files F7 · #954 Drag reorder: a folder's own order (the Custom sort of folder screens). Pure.
 *
 * The saved order is a list of ids. Files the order doesn't know yet go to the end (a new download lands last), ids
 * that left the folder are dropped, and a drag moves one id up or down.
 */

/** The folder's ids in the saved order: known ones first (as saved), then new ones in the order given. */
export function applyCustomOrder(saved: readonly string[], current: readonly string[]): string[] {
  const present = new Set(current);
  const ordered = saved.filter((id) => present.has(id));
  const known = new Set(ordered);
  for (const id of current) {
    if (!known.has(id)) {
      ordered.push(id);
      known.add(id);
    }
  }
  return ordered;
}

/** `ids` with `id` moved to position `to` (clamped); unchanged when `id` isn't there. */
export function moveInOrder(ids: readonly string[], id: string, to: number): string[] {
  const from = ids.indexOf(id);
  if (from < 0) return [...ids];
  const next = [...ids];
  next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, Math.trunc(to))), 0, id);
  return next;
}

/** One step up (-1) or down (+1): TalkBack's Move up / Move down. */
export function moveByStep(ids: readonly string[], id: string, step: -1 | 1): string[] {
  const from = ids.indexOf(id);
  return from < 0 ? [...ids] : moveInOrder(ids, id, from + step);
}

/** The saved order without ids that are gone (kept small). */
export function dropGoneIds(saved: readonly string[], current: readonly string[]): string[] {
  const present = new Set(current);
  return saved.filter((id) => present.has(id));
}
