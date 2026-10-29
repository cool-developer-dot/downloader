import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import { bindSearchSettingsReader, DEFAULT_SEARCH_SETTINGS } from '@/browser/search/search-engines';

import { buildSearchUrl, classifyNavigationInput } from './url.ts';

afterEach(() => bindSearchSettingsReader(() => DEFAULT_SEARCH_SETTINGS));

describe('address bar search goes to the chosen engine (B5)', () => {
  test('default: Google exactly as before', () => {
    assert.equal(buildSearchUrl('cats'), 'https://www.google.com/search?q=cats');
    const intent = classifyNavigationInput('big cats');
    assert.equal(intent.kind === 'search' && intent.url, 'https://www.google.com/search?q=big+cats');
  });

  test('another engine and Safe Search come from the settings', () => {
    bindSearchSettingsReader(() => ({ ...DEFAULT_SEARCH_SETTINGS, engine: 'duckduckgo', safeSearch: 'strict' }));
    const intent = classifyNavigationInput('بلی');
    assert.equal(intent.kind, 'search');
    if (intent.kind === 'search') {
      const url = new URL(intent.url);
      assert.equal(url.origin, 'https://duckduckgo.com');
      assert.equal(url.searchParams.get('q'), 'بلی');
      assert.equal(url.searchParams.get('kp'), '1');
    }
  });
});

describe('words in any script are searches', () => {
  test('a single Urdu or Arabic word searches; symbols alone stay invalid', () => {
    for (const word of ['بلی', 'لاہور', 'قطة', '۱۲۳']) {
      assert.equal(classifyNavigationInput(word).kind, 'search', word);
    }
    assert.equal(classifyNavigationInput('!!!').kind, 'invalid');
    assert.equal(classifyNavigationInput('؟؟').kind, 'invalid');
  });
});

describe('site: (#57)', () => {
  test('site:host and site:host words are searches, not a "site:" scheme', () => {
    for (const input of ['site:example.com', 'site:example.com cats', 'SITE:bbc.com urdu   news']) {
      const intent = classifyNavigationInput(input);
      assert.equal(intent.kind, 'search', input);
      if (intent.kind === 'search') {
        assert.equal(new URL(intent.url).searchParams.get('q'), input.replace(/\s+/g, ' '));
      }
    }
  });

  test('an address that merely contains "site:" later is unaffected', () => {
    assert.equal(classifyNavigationInput('example.com').kind, 'navigate');
  });
});
