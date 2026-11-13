/**
 * B1 — the "Tab closed · Undo" bar's state: the last close (one tab, or a group from Close all / Close other tabs),
 * offered for at least 6 seconds. The bar is drawn by `TabUndoSnackbar` (in the browser screen, or inside the tab
 * switcher while it is open). Undo restores the whole group through the store's `undoCloseTabs`.
 */

/** At least this long; Android's accessibility timeout setting may make it longer. */
export const TAB_UNDO_VISIBLE_MS = 6_000;

export type TabUndoOffer = {
  batchId: string;
  count: number;
  shownAt: number;
};

type Listener = () => void;

let current: TabUndoOffer | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // ignore
    }
  }
}

export const tabUndo = {
  get(): TabUndoOffer | null {
    return current;
  },
  offer(batchId: string, count: number): void {
    if (count <= 0) return;
    current = { batchId, count, shownAt: Date.now() };
    emit();
  },
  /** Hides the bar; `batchId` limits it to that offer (a newer close keeps its own bar). */
  dismiss(batchId?: string): void {
    if (!current || (batchId && current.batchId !== batchId)) return;
    current = null;
    emit();
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
