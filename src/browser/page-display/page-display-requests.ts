/** B16 — opens and closes the browser's Page display (Aa) panel (from the menu). */

let open = false;
const listeners = new Set<() => void>();

function set(next: boolean): void {
  if (open === next) return;
  open = next;
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // ignore
    }
  }
}

export const pageDisplayRequests = {
  open(): void {
    set(true);
  },
  close(): void {
    set(false);
  },
  isOpen(): boolean {
    return open;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
