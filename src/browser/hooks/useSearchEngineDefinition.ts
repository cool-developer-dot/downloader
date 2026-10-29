import {
  normalizeSearchEngineId,
  SEARCH_ENGINES,
  type SearchEngineDefinition,
} from '@/browser/search/search-engines';
import { useSettingsStore } from '@/store/settings';

/**
 * The chosen search engine for rendering (badge, name). Components read it here, not through `getSearchEngine()`:
 * that reads a module-level reader, and the React Compiler keeps a render-time call with no inputs for the life of
 * the component, so the badge stayed on the old engine after a change in Browser settings.
 */
export function useSearchEngineDefinition(): SearchEngineDefinition {
  const engineId = useSettingsStore((state) => state.searchEngine);
  return SEARCH_ENGINES[normalizeSearchEngineId(engineId)];
}
