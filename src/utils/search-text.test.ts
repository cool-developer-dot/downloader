import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { foldSearchText, matchesSearch, toAsciiDigits } from './search-text.ts';

describe('search text folding (English + Urdu)', () => {
  test('case-insensitive English', () => {
    assert.equal(matchesSearch('WIKI', ['Wikipedia, the free encyclopedia']), true);
    assert.equal(matchesSearch('wiki', ['BBC News', 'https://bbc.com']), false);
  });

  test('every word must match, in any field', () => {
    assert.equal(matchesSearch('bbc urdu', ['BBC News', 'https://www.bbc.com/urdu']), true);
    assert.equal(matchesSearch('bbc sport', ['BBC News', 'https://www.bbc.com/urdu']), false);
  });

  test('Urdu matches regardless of Arabic vs Urdu letter forms', () => {
    // Title typed with Urdu ک and ی; query with Arabic ك and ي.
    assert.equal(matchesSearch('پاكستان', ['پاکستان - ویکیپیڈیا']), true);
    assert.equal(matchesSearch('ويكيپيڈيا', ['پاکستان - ویکیپیڈیا']), true);
    assert.equal(matchesSearch('لاہور', ['لاهور']), true);
  });

  test('diacritics and tatweel are ignored', () => {
    assert.equal(matchesSearch('خبر', ['خَبَر']), true);
    assert.equal(matchesSearch('خبر', ['خـبـر']), true);
  });

  test('Eastern digits match ASCII digits', () => {
    assert.equal(toAsciiDigits('۱۲۳ and ٤٥'), '123 and 45');
    assert.equal(matchesSearch('۲۰۲۶', ['Events of 2026']), true);
  });

  test('empty query matches, whitespace collapses', () => {
    assert.equal(matchesSearch('   ', ['anything']), true);
    assert.equal(foldSearchText('  A   b  '), 'a b');
  });
});
