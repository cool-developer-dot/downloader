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
  /** B22 #252: saves the selected text to notes from the tab with this view (never from an incognito tab). */
  saveNote?: (text: string, viewTag: number) => void;
  /** B23 #261: highlights the selected text on the tab with this view (never from an incognito tab). */
  highlight?: (text: string, viewTag: number) => void;
};

export type SelectionActionOutcome = 'searched' | 'searchedTruncated' | 'limit' | 'savedNote' | 'highlight' | 'ignored';

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
    case 'save_note': {
      const text = event.text.trim();
      if (!text || !ports.saveNote) return 'ignored';
      ports.saveNote(text, event.viewTag);
      return 'savedNote';
    }
    case 'highlight': {
      if (!event.text.trim() || !ports.highlight) return 'ignored';
      ports.highlight(event.text, event.viewTag);
      return 'highlight';
    }
    default:
      // An item a newer native build or another package added without a handler here: do nothing.
      return 'ignored';
  }
}
