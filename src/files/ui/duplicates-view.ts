/**
 * Files F9 · design 59 Duplicates: F14's groups of identical files, shown with one copy kept and the others selected
 * for the Recycle bin. Pure. Whatever the user taps, at least one copy of every group stays: "Delete selected" never
 * takes every copy.
 */

import type { FileEntry } from '@/files/api';

export type DuplicateGroup = { hash: string; items: readonly Pick<FileEntry, 'id' | 'downloadedAt'>[] };

export type KeepRule = 'newest' | 'oldest';

function time(item: Pick<FileEntry, 'downloadedAt'>): number {
  const at = item.downloadedAt ? Date.parse(item.downloadedAt) : Number.NaN;
  return Number.isNaN(at) ? -Infinity : at;
}

/** The copy a group keeps: the newest (or oldest) download; ties keep the first listed. */
export function keptCopy(group: DuplicateGroup, keep: KeepRule = 'newest'): string | null {
  let best: Pick<FileEntry, 'id' | 'downloadedAt'> | null = null;
  for (const item of group.items) {
    if (!best || (keep === 'newest' ? time(item) > time(best) : time(item) < time(best))) best = item;
  }
  return best?.id ?? null;
}

/** The first selection: every copy but the kept one, in every group of two or more. */
export function initialDuplicateSelection(groups: readonly DuplicateGroup[], keep: KeepRule = 'newest'): Set<string> {
  const selected = new Set<string>();
  for (const group of groups) {
    if (group.items.length < 2) continue;
    const kept = keptCopy(group, keep);
    for (const item of group.items) {
      if (item.id !== kept) selected.add(item.id);
    }
  }
  return selected;
}

/** A tap on a copy: selects or unselects it — except selecting the last unselected copy of its group, which does nothing. */
export function toggleDuplicate(selected: ReadonlySet<string>, group: DuplicateGroup, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) {
    next.delete(id);
    return next;
  }
  const unselected = group.items.filter((item) => !next.has(item.id));
  if (unselected.length <= 1) {
    return next;
  }
  next.add(id);
  return next;
}

/**
 * What "Delete selected" sends: the selected copies, never every copy of a group (a safety net over the above: if a
 * whole group is selected, its kept copy stays).
 */
export function duplicatesToDelete(groups: readonly DuplicateGroup[], selected: ReadonlySet<string>, keep: KeepRule = 'newest'): string[] {
  const ids: string[] = [];
  for (const group of groups) {
    const chosen = group.items.filter((item) => selected.has(item.id)).map((item) => item.id);
    if (chosen.length === group.items.length) {
      const kept = keptCopy(group, keep);
      ids.push(...chosen.filter((id) => id !== kept));
    } else {
      ids.push(...chosen);
    }
  }
  return ids;
}
