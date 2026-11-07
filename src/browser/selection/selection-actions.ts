import { prepareSelectionSearch } from './selection-search.ts';

/**
 * B8 — what an app item of the text-selection menu does with the selected text. The ports are the store, the search
 * engine and the notices, so the rules are testable without React Native.
 */

export type SelectionActionEventLike = { viewTag: number; itemId: string; text: string };

export type SelectionActionPorts = {
  /** The active search engine's results URL (`getSearchEngine().buildSearchUrl`). */
  buildSearchUrl: (query: string) => string;
  /**
   * Opens `url` in a new tab right after the tab in front and shows it. False when the tab limit refused it (the
   * caller's limit notice has been shown).
   */
  openTabAfterCurrent: (url: string, title: string) => boolean;
  /** Tells the user the search used only the first 300 characters. */
  notifyTruncated: () => void;
};

export type SelectionActionOutcome = 'searched' | 'searchedTruncated' | 'limit' | 'ignored';

export function handleSelectionAction(
  event: SelectionActionEventLike,
  ports: SelectionActionPorts,
): SelectionActionOutcome {
  if (!event || typeof event.text !== 'string' || typeof event.itemId !== 'string') return 'ignored';
  switch (event.itemId) {
    case 'search': {
      const search = prepareSelectionSearch(event.text);
      if (!search) return 'ignored';
      const opened = ports.openTabAfterCurrent(ports.buildSearchUrl(search.query), search.query);
      if (!opened) return 'limit';
      if (search.truncated) {
        ports.notifyTruncated();
        return 'searchedTruncated';
      }
      return 'searched';
    }
    default:
      // An item a newer native build or another package added without a handler here: do nothing.
      return 'ignored';
  }
}
