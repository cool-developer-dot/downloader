/**
 * B21 #246 — what Esc closes in the browser's own window: the panels that are open right now (the address bar while
 * it is being edited, B7's find bar), newest last. Esc is taken from the keyboard only while one is open, and closes
 * the newest. Sheets and dialogs are windows of their own and close on Esc by themselves.
 */

type Listener = () => void;
type Panel = { id: string; close: () => void };

let panels: Panel[] = [];
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

export const escapePanels = {
  /** Registers an open panel; returns the function that unregisters it (call it when the panel closes). */
  open(id: string, close: () => void): () => void {
    panels = [...panels.filter((p) => p.id !== id), { id, close }];
    emit();
    return () => {
      const before = panels.length;
      panels = panels.filter((p) => !(p.id === id && p.close === close));
      if (panels.length !== before) emit();
    };
  },

  /** Closes the newest open panel; false when none is open. */
  closeNewest(): boolean {
    const panel = panels[panels.length - 1];
    if (!panel) return false;
    panels = panels.slice(0, -1);
    emit();
    try {
      panel.close();
    } catch {
      // ignore
    }
    return true;
  },

  isAnyOpen(): boolean {
    return panels.length > 0;
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /** Tests only. */
  reset(): void {
    panels = [];
    emit();
  },
};
