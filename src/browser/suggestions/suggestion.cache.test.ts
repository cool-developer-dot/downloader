import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { SuggestionCache } from './suggestion.cache';
import type { OmniboxSuggestion } from './types';

function suggestions(query: string): OmniboxSuggestion[] {
  return [
    {
      id: `s-${query}`,
      kind: 'history',
      title: `Result for ${query}`,
      url: `https://example.org/${query}`,
      score: 1,
    } as OmniboxSuggestion,
  ];
}

describe('suggestion cache stays bounded across a long session', () => {
  test('typing many prefixes never grows the cache past its budget', () => {
    const cache = new SuggestionCache();
    for (let i = 0; i < 500; i += 1) {
      cache.set(`query-${i}`, suggestions(`query-${i}`));
    }
    assert.ok(cache.size <= 32, `retained ${cache.size} entries`);
  });

  test('the most recent queries survive eviction', () => {
    const cache = new SuggestionCache();
    for (let i = 0; i < 200; i += 1) {
      cache.set(`q${i}`, suggestions(`q${i}`));
    }
    assert.ok(cache.get('q199'), 'newest query is still cached');
    assert.equal(cache.get('q0'), null, 'oldest query was evicted');
  });

  test('a re-read entry is kept as recent', () => {
    const cache = new SuggestionCache();
    cache.set('keep', suggestions('keep'));
    for (let i = 0; i < 31; i += 1) {
      cache.set(`filler-${i}`, suggestions(`filler-${i}`));
      cache.get('keep');
    }
    assert.ok(cache.get('keep'), 'a repeatedly used query is not evicted first');
  });

  test('invalidate clears everything', () => {
    const cache = new SuggestionCache();
    cache.set('a', suggestions('a'));
    cache.invalidate();
    assert.equal(cache.size, 0);
    assert.equal(cache.get('a'), null);
  });
});
