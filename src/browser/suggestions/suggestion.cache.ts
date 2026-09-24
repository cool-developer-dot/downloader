import type { OmniboxSuggestion } from './types';
import { SUGGESTION_CACHE_TTL_MS } from './constants';

interface CacheEntry {
  suggestions: OmniboxSuggestion[];
  expiresAt: number;
}

/**
 * Short-lived suggestion result cache keyed by normalized query.
 *
 * Every keystroke produces a new prefix key, each holding up to SUGGESTION_LIMIT
 * suggestions with their titles and full URLs. Entries only expired when the
 * exact same query was typed again, so a long session grew this map without
 * limit. It is now an LRU that also drops expired entries as it goes.
 */
const SUGGESTION_CACHE_MAX_ENTRIES = 32;

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

    // Refresh recency so the active prefix chain survives eviction.
    this.store.delete(normalizedQuery);
    this.store.set(normalizedQuery, entry);
    return entry.suggestions;
  }

  set(normalizedQuery: string, suggestions: OmniboxSuggestion[]): void {
    this.store.delete(normalizedQuery);
    this.store.set(normalizedQuery, {
      suggestions,
      expiresAt: Date.now() + SUGGESTION_CACHE_TTL_MS,
    });
    this.evict();
  }

  invalidate(): void {
    this.store.clear();
  }

  /** Test/diagnostic view of retained entries. */
  get size(): number {
    return this.store.size;
  }

  private evict(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (this.store.size <= SUGGESTION_CACHE_MAX_ENTRIES) {
        break;
      }
      if (now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
    // Still over budget after dropping expired entries: oldest first.
    while (this.store.size > SUGGESTION_CACHE_MAX_ENTRIES) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.store.delete(oldest);
    }
  }
}

export const suggestionCache = new SuggestionCache();
