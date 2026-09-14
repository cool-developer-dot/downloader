export const SUGGESTION_DEBOUNCE_MS = 120;
export const SUGGESTION_LIMIT = 12;
export const SUGGESTION_CACHE_TTL_MS = 8_000;
export const SUGGESTION_INDEX_TTL_MS = 30_000;
export const SUGGESTION_HISTORY_PAGE_SIZE = 200;
export const SUGGESTION_BOOKMARK_PAGE_SIZE = 200;
export const SUGGESTION_FREQUENT_LIMIT = 40;
export const SUGGESTION_RECENT_SEARCH_LIMIT = 20;

/** Base scores — higher wins. Keep gaps for match bonuses. */
export const SUGGESTION_BASE_SCORES = {
  exact_url: 10_000,
  bookmark_exact: 9_000,
  history_exact: 8_500,
  frequent: 7_000,
  bookmark_partial: 6_000,
  history_partial: 5_000,
  domain: 4_000,
  recent_search: 3_000,
  search: 1_000,
  remote_suggest: 2_500,
} as const;

export const SUGGESTION_MATCH_BONUS = {
  exactTitle: 800,
  titleStartsWith: 400,
  hostnameStartsWith: 350,
  urlStartsWith: 300,
  titleIncludes: 150,
  hostnameIncludes: 120,
  urlIncludes: 80,
  visitCountUnit: 5,
  visitCountCap: 200,
} as const;
