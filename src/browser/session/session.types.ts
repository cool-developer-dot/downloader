/**
 * Durable browser continuity snapshot.
 * Only successful http(s) pages are restored — never blanks, errors, or invalid URLs.
 */
export type PersistedBrowserSession = {
  /** Last committed browsing URL (may be home). */
  url: string;
  /** Document title for the last successful page. */
  title: string;
  /** Last successfully loaded http(s) page — preferred restore target after failures. */
  lastSuccessfulUrl: string | null;
  /** Title paired with lastSuccessfulUrl. */
  lastSuccessfulTitle: string;
  /** Scroll offset (px) for lastSuccessfulUrl (legacy / fast path). */
  scrollY: number;
  /** Compact per-URL scroll LRU for history / bookmark revisits. */
  scrollPositions: Record<string, number>;
  /** Epoch ms of last persistence write. */
  updatedAt: number;
};

export type BrowserSessionSnapshotInput = {
  url: string;
  title?: string;
  scrollY?: number;
  successful?: boolean;
};
