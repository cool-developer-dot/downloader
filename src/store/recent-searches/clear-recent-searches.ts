export type ClearRecentSearchesPorts = {
  /** Deletes every stored recent search; resolves with how many were removed. */
  clearStored: () => Promise<number>;
  /** Drops the omnibox's cached index so the next suggestion read no longer offers the cleared searches. */
  invalidateSuggestions: () => void;
};

/**
 * Clears the searches typed in the address bar — only those: browsing history, bookmarks and recently visited URLs
 * live in other tables and are untouched.
 */
export async function clearRecentSearches(ports: ClearRecentSearchesPorts): Promise<number> {
  const removed = await ports.clearStored();
  ports.invalidateSuggestions();
  return removed;
}
