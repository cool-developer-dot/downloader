import { getSearchEngine } from '@/browser/search/search-engines';
import { classifyNavigationInput, buildSearchUrl } from '@/browser/utils';
import { translate } from '@/localization/translate';
import type { BookmarkEntry, BrowserHistoryEntry } from '@/storage/types';

import {
  SUGGESTION_BOOKMARK_PAGE_SIZE,
  SUGGESTION_FREQUENT_LIMIT,
  SUGGESTION_HISTORY_PAGE_SIZE,
  SUGGESTION_INDEX_TTL_MS,
  SUGGESTION_LIMIT,
  SUGGESTION_RECENT_SEARCH_LIMIT,
} from './constants';
import { rankSuggestions } from './ranking.engine';
import { suggestionCache } from './suggestion.cache';
import type {
  OmniboxSuggestion,
  RankableCandidate,
  SuggestionQueryContext,
} from './types';

function buildFaviconUrl(hostname: string): string | null {
  const host = hostname.trim().toLowerCase();
  if (!host) {
    return null;
  }
  return `https://${host}/favicon.ico`;
}

function normalizeQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

function includesInsensitive(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle);
}

function startsWithInsensitive(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().startsWith(needle);
}

function applyMatchFlags(
  candidate: Omit<RankableCandidate, 'exactTitle' | 'titleStartsWith' | 'hostnameStartsWith' | 'urlStartsWith' | 'titleIncludes' | 'hostnameIncludes' | 'urlIncludes'>,
  query: string,
): RankableCandidate {
  const q = query.toLowerCase();
  return {
    ...candidate,
    exactTitle: candidate.title.trim().toLowerCase() === q,
    titleStartsWith: startsWithInsensitive(candidate.title, q),
    hostnameStartsWith: startsWithInsensitive(candidate.hostname, q),
    urlStartsWith: startsWithInsensitive(candidate.url, q),
    titleIncludes: includesInsensitive(candidate.title, q),
    hostnameIncludes: includesInsensitive(candidate.hostname, q),
    urlIncludes: includesInsensitive(candidate.url, q),
  };
}

type RecentSearchSnapshot = { id: string; query: string; searchedAt: string };

/**
 * Where the local suggestion index reads from. The app wires the storage services in (`./storage-sources`); tests
 * pass in-memory sources, since the storage layer needs expo-sqlite.
 */
export type SuggestionSources = {
  listHistory(limit: number): Promise<BrowserHistoryEntry[]>;
  listBookmarks(limit: number): Promise<BookmarkEntry[]>;
  listFrequentlyVisited(limit: number): Promise<(BrowserHistoryEntry & { visitCount: number })[]>;
  listRecentSearches(limit: number): Promise<RecentSearchSnapshot[]>;
};

/** Which local sources the address bar may suggest from (B5 #61 turns all off; B10 #101 turns history off). */
export type SuggestionInclude = { history: boolean; bookmarks: boolean; recentSearches: boolean };

const ALL_LOCAL_SUGGESTIONS: SuggestionInclude = { history: true, bookmarks: true, recentSearches: true };

function includeKey(include: SuggestionInclude): string {
  return `${include.history ? 'h' : '-'}${include.bookmarks ? 'b' : '-'}${include.recentSearches ? 'r' : '-'}`;
}

interface SuggestionIndex {
  history: BrowserHistoryEntry[];
  bookmarks: BookmarkEntry[];
  frequent: (BrowserHistoryEntry & { visitCount: number })[];
  recentSearches: RecentSearchSnapshot[];
  expiresAt: number;
}

/**
 * Browser intelligence layer — gathers local sources and ranks suggestions.
 * Remote providers (Google Suggest / AI) register via `registerProvider` later.
 */
export class SuggestionService {
  private readonly sources: SuggestionSources;
  private index: SuggestionIndex | null = null;
  private warmInFlight: Promise<SuggestionIndex> | null = null;
  private readonly remoteProviders: {
    id: string;
    collect: (context: SuggestionQueryContext) => Promise<RankableCandidate[]>;
  }[] = [];

  constructor(sources: SuggestionSources) {
    this.sources = sources;
  }

  /**
   * Extension point for future remote suggestion providers.
   * Providers must return RankableCandidate[]; ranking stays centralized.
   */
  registerProvider(provider: {
    id: string;
    collect: (context: SuggestionQueryContext) => Promise<RankableCandidate[]>;
  }): void {
    this.remoteProviders.push(provider);
  }

  invalidate(): void {
    this.index = null;
    suggestionCache.invalidate();
  }

  async warmIndex(force = false): Promise<void> {
    if (!force && this.index && Date.now() < this.index.expiresAt) {
      return;
    }

    await this.loadIndex(force);
  }

  private async loadIndex(force = false): Promise<SuggestionIndex> {
    if (!force && this.index && Date.now() < this.index.expiresAt) {
      return this.index;
    }

    if (this.warmInFlight) {
      return this.warmInFlight;
    }

    this.warmInFlight = (async () => {
      const [history, bookmarks, frequent, recentSearches] = await Promise.all([
        this.sources.listHistory(SUGGESTION_HISTORY_PAGE_SIZE),
        this.sources.listBookmarks(SUGGESTION_BOOKMARK_PAGE_SIZE),
        this.sources.listFrequentlyVisited(SUGGESTION_FREQUENT_LIMIT),
        this.sources.listRecentSearches(SUGGESTION_RECENT_SEARCH_LIMIT),
      ]);

      const next: SuggestionIndex = {
        history,
        bookmarks,
        frequent,
        recentSearches,
        expiresAt: Date.now() + SUGGESTION_INDEX_TTL_MS,
      };

      this.index = next;
      suggestionCache.invalidate();
      return next;
    })().finally(() => {
      this.warmInFlight = null;
    });

    return this.warmInFlight;
  }

  async getSuggestions(
    rawQuery: string,
    options?: { limit?: number; include?: Partial<SuggestionInclude> },
  ): Promise<OmniboxSuggestion[]> {
    const query = rawQuery.trim();
    const normalizedQuery = normalizeQuery(query);
    const limit = options?.limit ?? SUGGESTION_LIMIT;
    const include: SuggestionInclude = { ...ALL_LOCAL_SUGGESTIONS, ...options?.include };
    // The cache is per query and per set of sources (B5 #61, B10 #101), and per search engine (B5 #56).
    const cacheKey = `${includeKey(include)}|${getSearchEngine().id}|${normalizedQuery}`;

    if (!normalizedQuery) {
      return this.getEmptyQuerySuggestions(limit, include);
    }

    const cached = suggestionCache.get(cacheKey);
    if (cached) {
      return cached.slice(0, limit);
    }

    const index = await this.loadIndex();
    const context: SuggestionQueryContext = {
      query,
      normalizedQuery,
      limit,
    };

    const candidates: RankableCandidate[] = [
      ...this.collectExactUrl(context),
      ...(include.bookmarks ? this.collectBookmarks(index.bookmarks, context) : []),
      ...(include.history ? this.collectHistory(index.history, context) : []),
      ...(include.history ? this.collectFrequent(index.frequent, context) : []),
      ...(include.history || include.bookmarks ? this.collectDomains(index, context, include) : []),
      ...(include.recentSearches ? this.collectRecentSearches(index.recentSearches, context) : []),
      ...this.collectSearchPlaceholder(context),
    ];

    // Future remote providers (Google / AI) — architecture only until enabled.
    for (const provider of this.remoteProviders) {
      try {
        const remote = await provider.collect(context);
        candidates.push(...remote);
      } catch {
        // Remote failures must never break local omnibox.
      }
    }

    const ranked = rankSuggestions(candidates, query, limit);
    suggestionCache.set(cacheKey, ranked);
    return ranked;
  }

  private async getEmptyQuerySuggestions(limit: number, include: SuggestionInclude): Promise<OmniboxSuggestion[]> {
    const index = await this.loadIndex();
    const candidates: RankableCandidate[] = [];

    for (const entry of include.history ? index.frequent.slice(0, 6) : []) {
      candidates.push(
        applyMatchFlags(
          {
            id: `frequent-empty-${entry.id}`,
            kind: 'frequent',
            source: 'frequent',
            title: entry.title || entry.hostname,
            subtitle: `${entry.visitCount} visits · ${entry.hostname}`,
            url: entry.url,
            hostname: entry.hostname,
            faviconUrl: buildFaviconUrl(entry.hostname),
            visitCount: entry.visitCount,
            visitedAt: entry.visitedAt,
          },
          '',
        ),
      );
    }

    for (const entry of include.bookmarks ? index.bookmarks.slice(0, 4) : []) {
      candidates.push(
        applyMatchFlags(
          {
            id: `bookmark-empty-${entry.id}`,
            kind: 'bookmark',
            source: 'bookmarks',
            title: entry.title || entry.hostname,
            subtitle: entry.hostname || entry.url,
            url: entry.url,
            hostname: entry.hostname,
            faviconUrl: entry.faviconUrl || buildFaviconUrl(entry.hostname),
            bookmarked: true,
            visitedAt: entry.updatedAt,
          },
          '',
        ),
      );
    }

    return rankSuggestions(candidates, '', limit);
  }

  private collectExactUrl(context: SuggestionQueryContext): RankableCandidate[] {
    const intent = classifyNavigationInput(context.query);

    if (intent.kind !== 'navigate') {
      return [];
    }

    let hostname = '';
    try {
      hostname = new URL(intent.url).hostname;
    } catch {
      hostname = '';
    }

    return [
      applyMatchFlags(
        {
          id: `exact-url-${intent.url}`,
          kind: 'exact_url',
          source: 'navigation',
          title: intent.url,
          subtitle: 'Go to website',
          url: intent.url,
          hostname,
          faviconUrl: buildFaviconUrl(hostname),
          exactUrl: true,
        },
        context.normalizedQuery,
      ),
    ];
  }

  private collectBookmarks(
    bookmarks: BookmarkEntry[],
    context: SuggestionQueryContext,
  ): RankableCandidate[] {
    const q = context.normalizedQuery;
    const results: RankableCandidate[] = [];

    for (const entry of bookmarks) {
      const matches =
        includesInsensitive(entry.title, q) ||
        includesInsensitive(entry.url, q) ||
        includesInsensitive(entry.hostname, q);

      if (!matches) {
        continue;
      }

      const exactUrl = entry.url.toLowerCase() === context.query.trim().toLowerCase();

      results.push(
        applyMatchFlags(
          {
            id: `bookmark-${entry.id}`,
            kind: 'bookmark',
            source: 'bookmarks',
            title: entry.title || entry.hostname,
            subtitle: entry.hostname || entry.url,
            url: entry.url,
            hostname: entry.hostname,
            faviconUrl: entry.faviconUrl || buildFaviconUrl(entry.hostname),
            bookmarked: true,
            exactUrl,
            visitedAt: entry.updatedAt,
          },
          q,
        ),
      );
    }

    return results;
  }

  private collectHistory(
    history: BrowserHistoryEntry[],
    context: SuggestionQueryContext,
  ): RankableCandidate[] {
    const q = context.normalizedQuery;
    const results: RankableCandidate[] = [];

    for (const entry of history) {
      const matches =
        includesInsensitive(entry.title, q) ||
        includesInsensitive(entry.url, q) ||
        includesInsensitive(entry.hostname, q);

      if (!matches) {
        continue;
      }

      const exactUrl = entry.url.toLowerCase() === context.query.trim().toLowerCase();

      results.push(
        applyMatchFlags(
          {
            id: `history-${entry.id}`,
            kind: 'history',
            source: 'history',
            title: entry.title || entry.hostname,
            subtitle: entry.hostname || entry.url,
            url: entry.url,
            hostname: entry.hostname,
            faviconUrl: buildFaviconUrl(entry.hostname),
            exactUrl,
            visitedAt: entry.visitedAt,
          },
          q,
        ),
      );
    }

    return results;
  }

  private collectFrequent(
    frequent: (BrowserHistoryEntry & { visitCount: number })[],
    context: SuggestionQueryContext,
  ): RankableCandidate[] {
    const q = context.normalizedQuery;
    const results: RankableCandidate[] = [];

    for (const entry of frequent) {
      const matches =
        includesInsensitive(entry.title, q) ||
        includesInsensitive(entry.url, q) ||
        includesInsensitive(entry.hostname, q);

      if (!matches) {
        continue;
      }

      results.push(
        applyMatchFlags(
          {
            id: `frequent-${entry.id}`,
            kind: 'frequent',
            source: 'frequent',
            title: entry.title || entry.hostname,
            subtitle: `${entry.visitCount} visits · ${entry.hostname}`,
            url: entry.url,
            hostname: entry.hostname,
            faviconUrl: buildFaviconUrl(entry.hostname),
            visitCount: entry.visitCount,
            visitedAt: entry.visitedAt,
          },
          q,
        ),
      );
    }

    return results;
  }

  private collectDomains(
    index: SuggestionIndex,
    context: SuggestionQueryContext,
    include: SuggestionInclude,
  ): RankableCandidate[] {
    const q = context.normalizedQuery;
    if (!q || q.includes(' ') || q.includes('://')) {
      return [];
    }

    const domains = new Map<string, { hostname: string; url: string; title: string }>();

    const consider = (hostname: string, url: string, title: string) => {
      if (!hostname || !startsWithInsensitive(hostname, q)) {
        return;
      }
      if (!domains.has(hostname)) {
        domains.set(hostname, {
          hostname,
          url: `https://${hostname}`,
          title: title || hostname,
        });
      }
    };

    for (const entry of include.bookmarks ? index.bookmarks : []) {
      consider(entry.hostname, entry.url, entry.title);
    }
    for (const entry of include.history ? index.history : []) {
      consider(entry.hostname, entry.url, entry.title);
    }
    for (const entry of include.history ? index.frequent : []) {
      consider(entry.hostname, entry.url, entry.title);
    }

    return Array.from(domains.values()).map((domain) =>
      applyMatchFlags(
        {
          id: `domain-${domain.hostname}`,
          kind: 'domain',
          source: 'domain',
          title: domain.hostname,
          subtitle: 'Suggested site',
          url: domain.url,
          hostname: domain.hostname,
          faviconUrl: buildFaviconUrl(domain.hostname),
        },
        q,
      ),
    );
  }

  private collectRecentSearches(
    recentSearches: RecentSearchSnapshot[],
    context: SuggestionQueryContext,
  ): RankableCandidate[] {
    const q = context.normalizedQuery;
    const results: RankableCandidate[] = [];

    for (const entry of recentSearches) {
      if (!includesInsensitive(entry.query, q)) {
        continue;
      }

      const url = buildSearchUrl(entry.query);
      const engineHost = new URL(url).hostname;
      results.push(
        applyMatchFlags(
          {
            id: `recent-search-${entry.id}`,
            kind: 'recent_search',
            source: 'recent_searches',
            title: entry.query,
            subtitle: translate('browserSettings.search.recentSearch'),
            url,
            hostname: engineHost,
            faviconUrl: null,
            visitedAt: entry.searchedAt,
          },
          q,
        ),
      );
    }

    return results;
  }

  private collectSearchPlaceholder(
    context: SuggestionQueryContext,
  ): RankableCandidate[] {
    const intent = classifyNavigationInput(context.query);

    // Only offer Google search when input is not an exact navigable URL.
    if (intent.kind === 'navigate' || intent.kind === 'home' || intent.kind === 'blocked') {
      return [];
    }

    if (intent.kind === 'invalid' && !context.query.trim()) {
      return [];
    }

    const searchUrl =
      intent.kind === 'search' ? intent.url : buildSearchUrl(context.query);
    const engine = getSearchEngine();
    const engineHost = new URL(searchUrl).hostname;

    return [
      applyMatchFlags(
        {
          id: `search-${context.normalizedQuery}`,
          kind: 'search',
          source: 'search',
          title: translate('browserSettings.search.searchWithEngine', {
            engine: engine.name,
            query: context.query.trim(),
          }),
          subtitle: engineHost,
          url: searchUrl,
          hostname: engineHost,
          faviconUrl: null,
        },
        context.normalizedQuery,
      ),
    ];
  }
}
