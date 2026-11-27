/**
 * Files F8 · #804 Undo: the "{n} moved to Recycle bin · Undo" bar after a delete. Pure (the clock is passed in), so it
 * is tested without a phone.
 *
 * - One bar per batch: a delete of 12 files is one offer for 12.
 * - A second delete replaces the first: the older batch can no longer be undone.
 * - Undo works only while the bar is up (6 s, or longer when Android's "Time to take action" asks for it); after that
 *   it does nothing.
 */

/** At least this long; Android's accessibility timeout setting may make it longer. */
export const UNDO_VISIBLE_MS = 6_000;

export type UndoOffer = {
  batchId: number;
  /** Files moved to the bin (what Undo brings back). */
  trashedIds: readonly string[];
  /** Files deleted for good (the bin is off, or the file couldn't go to the bin). */
  deletedCount: number;
  /** Files that couldn't be deleted at all. */
  failedCount: number;
  shownAt: number;
  /** How long the bar stays up. */
  visibleMs: number;
};

export type UndoSnackbar = {
  get(): UndoOffer | null;
  subscribe(listener: () => void): () => void;
  /** Shows the bar for one delete batch, replacing any earlier one. */
  show(result: { trashed: readonly string[]; deleted: readonly string[] }, requested: number): UndoOffer;
  /** Lets the bar stay up longer (Android's accessibility timeout); never shorter than `UNDO_VISIBLE_MS`. */
  extend(batchId: number, visibleMs: number): void;
  /** Undo: the ids to bring back, once — or null when the batch was replaced, expired, or had nothing in the bin. */
  take(batchId: number): string[] | null;
  /** Hides the bar (only if it still shows that batch). */
  dismiss(batchId: number): void;
};

export function canUndo(offer: UndoOffer | null, now: number): boolean {
  return offer !== null && offer.trashedIds.length > 0 && now < offer.shownAt + offer.visibleMs;
}

export function createUndoSnackbar(now: () => number = Date.now): UndoSnackbar {
  let current: UndoOffer | null = null;
  let nextBatch = 1;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // A listener's error never stops the others.
      }
    }
  };
  return {
    get: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    show(result, requested) {
      const done = result.trashed.length + result.deleted.length;
      current = {
        batchId: nextBatch,
        trashedIds: [...result.trashed],
        deletedCount: result.deleted.length,
        failedCount: Math.max(0, requested - done),
        shownAt: now(),
        visibleMs: UNDO_VISIBLE_MS,
      };
      nextBatch += 1;
      emit();
      return current;
    },
    extend(batchId, visibleMs) {
      if (current?.batchId === batchId && visibleMs > current.visibleMs) {
        current = { ...current, visibleMs };
        emit();
      }
    },
    take(batchId) {
      if (current?.batchId !== batchId || !canUndo(current, now())) {
        return null;
      }
      const ids = [...current.trashedIds];
      current = null;
      emit();
      return ids;
    },
    dismiss(batchId) {
      if (current?.batchId === batchId) {
        current = null;
        emit();
      }
    },
  };
}
