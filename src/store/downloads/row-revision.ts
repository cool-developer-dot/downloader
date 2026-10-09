/**
 * A number that changes only when the identity of a set of rows changes: a row appears, goes away, or one of the
 * fields its `partOf` covers changes. Screens use it as a memo key instead of joining every row into one string.
 *
 * The downloads store updates several times a second while a transfer runs, and selectors run on every update. Rows
 * are compared by reference first (a part is computed once per row object), so a progress tick — one new row object
 * whose covered fields did not change — costs one part and no allocation, however large the library is.
 */
export type RowVisitor<T> = (visit: (id: string, row: T) => void) => void;

export type RowRevision<T extends object> = (forEachRow: RowVisitor<T>) => number;

export function createRowRevision<T extends object>(partOf: (id: string, row: T) => string): RowRevision<T> {
  const partByRow = new WeakMap<T, string>();
  let partById = new Map<string, string>();
  let revision = 0;

  const partFor = (id: string, row: T): string => {
    let part = partByRow.get(row);
    if (part === undefined) {
      part = partOf(id, row);
      partByRow.set(row, part);
    }
    return part;
  };

  return (forEachRow) => {
    let seen = 0;
    let changed = false;
    forEachRow((id, row) => {
      seen += 1;
      if (!changed && partById.get(id) !== partFor(id, row)) {
        changed = true;
      }
    });
    if (!changed && seen === partById.size) {
      return revision;
    }
    const next = new Map<string, string>();
    forEachRow((id, row) => {
      next.set(id, partFor(id, row));
    });
    partById = next;
    revision += 1;
    return revision;
  };
}
