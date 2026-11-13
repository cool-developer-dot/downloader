/**
 * B6 #42 Hard reload: asks a tab's WebView to reload its page without the HTTP cache (the same `LOAD_NO_CACHE` path
 * the desktop-mode switch uses; the WebView puts its cache mode back after that load). Long-press on Reload, or
 * Menu → Hard reload. The WebView of `tabId` (`BrowserWebView`) does the work.
 */

type Listener = (tabId: string) => void;

const listeners = new Set<Listener>();

export const hardReloadRequests = {
  request(tabId: string): void {
    for (const listener of listeners) {
      try {
        listener(tabId);
      } catch {
        // ignore
      }
    }
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
