import type { OmniboxSuggestion } from './types';
import { SUGGESTION_CACHE_TTL_MS } from './constants';

interface CacheEntry {
  suggestions: OmniboxSuggestion[];
  expiresAt: number;
}

/**
 * Short-lived suggestion result cache keyed by normalized query.
 */
export class SuggestionCache {
  private readonly store = new Map<string, CacheEntry>();

  get(normalizedQuery: string): OmniboxSuggestion[] | null {
    const entry = this.store.get(normalizedQuery);
    if (!entry) {
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.store.delete(normalizedQuery);
      return null;
    }

    return entry.suggestions;
  }

  set(normalizedQuery: string, suggestions: OmniboxSuggestion[]): void {
    this.store.set(normalizedQuery, {
      suggestions,
      expiresAt: Date.now() + SUGGESTION_CACHE_TTL_MS,
    });
  }

  invalidate(): void {
    this.store.clear();
  }
}

export const suggestionCache = new SuggestionCache();
