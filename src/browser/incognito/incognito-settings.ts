import { SEARCH_ENGINE_IDS, type SearchEngineId } from '../search/search-engines';

/**
 * B11 #111 — the search engine for searches typed in incognito tabs: 'same' (default: the normal tabs' engine, as
 * before) or an engine of its own. Pure (settings store, backup, tests).
 */
export type IncognitoSearchEngine = 'same' | SearchEngineId;

export const INCOGNITO_SEARCH_ENGINES: readonly IncognitoSearchEngine[] = ['same', ...SEARCH_ENGINE_IDS];
export const DEFAULT_INCOGNITO_SEARCH_ENGINE: IncognitoSearchEngine = 'same';

export function normalizeIncognitoSearchEngine(value: unknown): IncognitoSearchEngine {
  return (INCOGNITO_SEARCH_ENGINES as readonly unknown[]).includes(value)
    ? (value as IncognitoSearchEngine)
    : DEFAULT_INCOGNITO_SEARCH_ENGINE;
}

/** The engine a search uses: the incognito choice while an incognito tab is in front, else the normal one. */
export function searchEngineFor(
  normal: SearchEngineId,
  incognito: IncognitoSearchEngine,
  incognitoInFront: boolean,
): SearchEngineId {
  return incognitoInFront && incognito !== 'same' ? incognito : normal;
}
