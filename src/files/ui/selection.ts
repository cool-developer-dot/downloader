/**
 * Files F4 · #788 Multi-select, #789 Select all, #790 Invert selection, #791 Drag select: the selection of a Files list.
 * Pure. Ids are files and folders alike; `orderedIds` is the list as shown.
 *
 * A drag starts at its anchor row and covers every row between the anchor and the finger. It selects when the anchor
 * was not selected, and unselects when it was. Rows outside the covered range keep what they had when the drag
 * began, so dragging back toward the anchor gives them back.
 */

export type DragMode = 'select' | 'unselect';

export const EMPTY_SELECTION: ReadonlySet<string> = new Set<string>();

/**
 * The selected rows in the order they were picked (a tap adds to the end; a drag adds its range; Select all and Invert
 * follow the list), so a batch — "Number them" in F5 — goes in selection order, not list order. Rows no longer shown
 * are skipped.
 */
export function inSelectionOrder<T extends { key: string }>(rows: readonly T[], selected: ReadonlySet<string>): T[] {
  const byKey = new Map(rows.map((row) => [row.key, row] as const));
  const ordered: T[] = [];
  for (const key of selected) {
    const row = byKey.get(key);
    if (row) ordered.push(row);
  }
  return ordered;
}

/** Selects `id` if it isn't, unselects it if it is. */
export function toggleSelection(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

/** What a drag from `anchorId` does: select, unless the anchor row was already selected. */
export function dragModeFor(base: ReadonlySet<string>, anchorId: string): DragMode {
  return base.has(anchorId) ? 'unselect' : 'select';
}

/**
 * The selection while a drag covers the rows from `anchorId` to `toId` (either direction): `base` (the selection when
 * the drag began) with that range selected or unselected.
 */
export function rangeSelection(
  base: ReadonlySet<string>,
  orderedIds: readonly string[],
  anchorId: string,
  toId: string,
  mode: DragMode,
): Set<string> {
  const next = new Set(base);
  const from = orderedIds.indexOf(anchorId);
  const to = orderedIds.indexOf(toId);
  if (from < 0 || to < 0) {
    return next;
  }
  const [start, end] = from <= to ? [from, to] : [to, from];
  for (let index = start; index <= end; index += 1) {
    const id = orderedIds[index]!;
    if (mode === 'select') {
      next.add(id);
    } else {
      next.delete(id);
    }
  }
  return next;
}

export function selectAll(orderedIds: readonly string[]): Set<string> {
  return new Set(orderedIds);
}

/** Everything shown that isn't selected, and nothing that is. */
export function invertSelection(selected: ReadonlySet<string>, orderedIds: readonly string[]): Set<string> {
  const next = new Set<string>();
  for (const id of orderedIds) {
    if (!selected.has(id)) {
      next.add(id);
    }
  }
  return next;
}

/** The selection without ids that left the list (a file deleted elsewhere drops out of the count). */
export function withoutRemovedIds(selected: ReadonlySet<string>, orderedIds: readonly string[]): ReadonlySet<string> {
  const shown = new Set(orderedIds);
  let changed = false;
  for (const id of selected) {
    if (!shown.has(id)) {
      changed = true;
      break;
    }
  }
  return changed ? new Set([...selected].filter((id) => shown.has(id))) : selected;
}
