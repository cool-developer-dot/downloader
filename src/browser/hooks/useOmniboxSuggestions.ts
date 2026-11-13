import { useCallback, useEffect, useRef, useState } from 'react';

import {
  SUGGESTION_DEBOUNCE_MS,
  suggestionService,
  type OmniboxSuggestion,
} from '@/browser/suggestions';
import { useBookmarksStore } from '@/store/bookmarks';
import { useSettingsStore } from '@/store/settings';
import { useHistoryStore } from '@/store/history';
import { useRecentSearchesStore } from '@/store/recent-searches';

export type UseOmniboxSuggestionsOptions = {
  enabled: boolean;
  query: string;
  debounceMs?: number;
};

export function useOmniboxSuggestions({
  enabled,
  query,
  debounceMs = SUGGESTION_DEBOUNCE_MS,
}: UseOmniboxSuggestionsOptions) {
  const [suggestions, setSuggestions] = useState<OmniboxSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);

  const historySig = useHistoryStore(
    (state) =>
      `${state.total}:${state.items[0]?.id ?? ''}:${state.items[0]?.visitedAt ?? ''}`,
  );
  const bookmarkSig = useBookmarksStore(
    (state) =>
      `${state.total}:${state.items[0]?.id ?? ''}:${state.items[0]?.updatedAt ?? ''}`,
  );
  const recentSig = useRecentSearchesStore(
    (state) =>
      `${state.total}:${state.items[0]?.id ?? ''}:${state.items[0]?.searchedAt ?? ''}`,
  );

  // B5 #61: "Address bar suggestions" off → no history, bookmark or recent-search rows (the typed row stays).
  const localSuggestions = useSettingsStore((state) => state.searchSuggestions !== false);
  // A search-engine change re-labels the search row.
  const searchEngine = useSettingsStore((state) => state.searchEngine);

  const sourceEpoch = `${historySig}|${bookmarkSig}|${recentSig}|${localSuggestions ? 1 : 0}|${searchEngine}`;

  useEffect(() => {
    suggestionService.invalidate();
  }, [sourceEpoch]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    void suggestionService.warmIndex();
  }, [enabled, sourceEpoch]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const requestId = ++requestIdRef.current;
    const timer = setTimeout(() => {
      setLoading(true);

      void suggestionService
        .getSuggestions(query, {
          include: { history: localSuggestions, bookmarks: localSuggestions, recentSearches: localSuggestions },
        })
        .then((results) => {
          if (requestId !== requestIdRef.current) {
            return;
          }
          setSuggestions(results);
          setLoading(false);
        })
        .catch(() => {
          if (requestId !== requestIdRef.current) {
            return;
          }
          setSuggestions([]);
          setLoading(false);
        });
    }, debounceMs);

    return () => {
      clearTimeout(timer);
    };
  }, [debounceMs, enabled, localSuggestions, query, sourceEpoch]);

  const clearSuggestions = useCallback(() => {
    requestIdRef.current += 1;
    setSuggestions([]);
    setLoading(false);
  }, []);

  return {
    suggestions: enabled ? suggestions : [],
    loading: enabled ? loading : false,
    clearSuggestions,
  };
}
