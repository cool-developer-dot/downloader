/** B20 #207: the browser menu asks the switcher (mounted once in BrowserScreen) to open. */
type Listener = () => void;

const listeners = new Set<Listener>();

export const profileSwitcherRequests = {
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
