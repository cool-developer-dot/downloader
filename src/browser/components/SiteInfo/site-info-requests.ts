/** B12: the lock icon asks the site information sheet (mounted once in BrowserScreen) to open. */
type Listener = () => void;

const listeners = new Set<Listener>();

export const siteInfoRequests = {
  open(): void {
    for (const listener of [...listeners]) listener();
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
