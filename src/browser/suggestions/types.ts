/**
 * Omnibox suggestion contracts.
 * Future providers (Google Suggest, AI) plug in as additional SuggestionSource values.
 */

export type SuggestionKind =
  | 'exact_url'
  | 'bookmark'
  | 'history'
  | 'frequent'
  | 'domain'
  | 'recent_search'
  | 'search'
  /** Extension point — not used until a remote provider is wired. */
  | 'remote_suggest';

export type SuggestionSource =
  | 'navigation'
  | 'bookmarks'
  | 'history'
  | 'frequent'
  | 'domain'
  | 'recent_searches'
  | 'search'
  | 'remote';

export interface OmniboxSuggestion {
  id: string;
  kind: SuggestionKind;
  source: SuggestionSource;
  title: string;
  subtitle: string;
  url: string;
  hostname: string;
  faviconUrl: string | null;
  /** Deterministic rank score — higher is better. */
  score: number;
  visitCount?: number;
  visitedAt?: string | null;
  bookmarked?: boolean;
  /** Query text used to produce this suggestion (for highlight). */
  query: string;
}

export interface SuggestionQueryContext {
  query: string;
  normalizedQuery: string;
  limit?: number;
}

export interface RankableCandidate {
  id: string;
  kind: SuggestionKind;
  source: SuggestionSource;
  title: string;
  subtitle: string;
  url: string;
  hostname: string;
  faviconUrl: string | null;
  visitCount?: number;
  visitedAt?: string | null;
  bookmarked?: boolean;
  /** Match strength hints for the ranking engine. */
  exactUrl?: boolean;
  exactTitle?: boolean;
  urlStartsWith?: boolean;
  titleStartsWith?: boolean;
  hostnameStartsWith?: boolean;
  hostnameIncludes?: boolean;
  titleIncludes?: boolean;
  urlIncludes?: boolean;
}

export interface SuggestionProvider {
  readonly id: SuggestionSource;
  collect(context: SuggestionQueryContext): Promise<RankableCandidate[]> | RankableCandidate[];
}
