import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import {
  bindSearchSettingsReader,
  buildEngineSearchUrl,
  DEFAULT_SEARCH_SETTINGS,
  getSearchEngine,
  normalizeSafeSearch,
  normalizeSearchEngineId,
  normalizeSearchLanguage,
  normalizeSearchRegion,
  resolveSearchLanguage,
  SAFE_SEARCH_LEVELS,
  SEARCH_ENGINE_IDS,
  SEARCH_LANGUAGES,
  SEARCH_REGIONS,
  searchQueryFromUrl,
  type SearchSettings,
} from './search-engines.ts';

afterEach(() => bindSearchSettingsReader(() => DEFAULT_SEARCH_SETTINGS));

const settings = (patch: Partial<SearchSettings>): SearchSettings => ({ ...DEFAULT_SEARCH_SETTINGS, ...patch });
const params = (url: string) => Object.fromEntries(new URL(url).searchParams.entries());

describe('default search is exactly today’s Google URL', () => {
  test('Google, Moderate, engine language, automatic region → only q', () => {
    assert.equal(buildEngineSearchUrl('cats', DEFAULT_SEARCH_SETTINGS), 'https://www.google.com/search?q=cats');
    assert.equal(
      buildEngineSearchUrl('  big   cats ', DEFAULT_SEARCH_SETTINGS),
      'https://www.google.com/search?q=big+cats',
    );
  });

  test('Urdu queries are encoded, never altered', () => {
    const url = buildEngineSearchUrl('بلی', DEFAULT_SEARCH_SETTINGS);
    assert.equal(new URL(url).searchParams.get('q'), 'بلی');
  });
});

/** The documented parameter of every engine for each choice (checked on the device: see the work log). */
const EXPECTED = {
  google: { base: 'https://www.google.com/search', q: 'q', safe: { off: { safe: 'off' }, moderate: {}, strict: { safe: 'active' } }, lang: (l: string) => ({ hl: l }), region: (r: string) => ({ gl: r.toUpperCase() }) },
  bing: { base: 'https://www.bing.com/search', q: 'q', safe: { off: { adlt: 'off' }, moderate: { adlt: 'moderate' }, strict: { adlt: 'strict' } }, lang: (l: string) => ({ setlang: l }), region: (r: string) => ({ cc: r.toUpperCase() }) },
  duckduckgo: { base: 'https://duckduckgo.com/', q: 'q', safe: { off: { kp: '-2' }, moderate: { kp: '-1' }, strict: { kp: '1' } }, lang: null, region: null },
  yahoo: { base: null, q: 'p', safe: { off: { vm: 'p' }, moderate: { vm: 'i' }, strict: { vm: 'r' } }, lang: (l: string) => ({ vl: `lang_${l}`, fl: '1' }), region: () => ({}) },
  ecosia: { base: 'https://www.ecosia.org/search', q: 'q', safe: { off: {}, moderate: {}, strict: {} }, lang: () => ({}), region: () => ({}) },
  brave: { base: 'https://search.brave.com/search', q: 'q', safe: { off: { safesearch: 'off' }, moderate: { safesearch: 'moderate' }, strict: { safesearch: 'strict' } }, lang: (l: string) => ({ ui_lang: l }), region: (r: string) => ({ country: r }) },
} as const;

describe('every engine × Safe Search × language × region (table)', () => {
  for (const engine of SEARCH_ENGINE_IDS) {
    test(`${engine}: all ${SAFE_SEARCH_LEVELS.length * SEARCH_LANGUAGES.length * SEARCH_REGIONS.length} combinations`, () => {
      const spec = EXPECTED[engine];
      for (const safeSearch of SAFE_SEARCH_LEVELS) {
        for (const language of SEARCH_LANGUAGES) {
          for (const region of SEARCH_REGIONS) {
            const where = `${engine} / ${safeSearch} / ${language} / ${region}`;
            const url = buildEngineSearchUrl('cats', settings({ engine, safeSearch, language, region, appLanguage: 'ur' }));
            const got = params(url);
            const code = resolveSearchLanguage(language, 'ur');
            const expected: Record<string, string> = { [spec.q]: 'cats', ...spec.safe[safeSearch] };
            if (code && spec.lang) Object.assign(expected, spec.lang(code));
            if (region !== 'auto' && spec.region) Object.assign(expected, spec.region(region));
            if (engine === 'duckduckgo') {
              if (code) assert.match(got.kad!, /^[a-z]{2}_[A-Z]{2}$/, `${where}: kad is a locale`);
              if (region !== 'auto') assert.match(got.kl!, /^[a-z]{2}-[a-z]{2}$/, `${where}: kl is country-language`);
              delete got.kad;
              delete got.kl;
            }
            assert.deepEqual(got, expected, where);
            if (spec.base) {
              assert.equal(url.split('?')[0], spec.base, where);
            }
          }
        }
      }
    });
  }
});

describe('engine specifics', () => {
  test('DuckDuckGo regions are country-language pairs; Urdu falls back to English', () => {
    const url = buildEngineSearchUrl('x', settings({ engine: 'duckduckgo', region: 'pk', language: 'ur' }));
    assert.equal(params(url).kl, 'pk-en');
    assert.equal(params(url).kad, 'en_US');
  });

  test('Yahoo uses its country site where one exists, else the global site', () => {
    assert.ok(buildEngineSearchUrl('x', settings({ engine: 'yahoo', region: 'gb' })).startsWith('https://uk.search.yahoo.com/search?'));
    assert.ok(buildEngineSearchUrl('x', settings({ engine: 'yahoo', region: 'pk' })).startsWith('https://search.yahoo.com/search?'));
  });

  test('App language follows the app (English / Urdu)', () => {
    assert.equal(params(buildEngineSearchUrl('x', settings({ language: 'app', appLanguage: 'ur' }))).hl, 'ur');
    assert.equal(params(buildEngineSearchUrl('x', settings({ language: 'app', appLanguage: 'en-US' }))).hl, 'en');
  });
});

describe('site: search (#57)', () => {
  test('the operator is passed through to every engine', () => {
    for (const engine of SEARCH_ENGINE_IDS) {
      const url = buildEngineSearchUrl('site:example.com cats', settings({ engine }));
      const spec = EXPECTED[engine];
      assert.equal(new URL(url).searchParams.get(spec.q), 'site:example.com cats', engine);
    }
  });
});

describe('getSearchEngine()', () => {
  test('reads the bound settings at call time', () => {
    let engine: SearchSettings['engine'] = 'bing';
    bindSearchSettingsReader(() => settings({ engine, safeSearch: 'strict' }));
    assert.equal(getSearchEngine().name, 'Bing');
    assert.equal(getSearchEngine().buildSearchUrl('cats'), 'https://www.bing.com/search?q=cats&adlt=strict');
    engine = 'duckduckgo';
    assert.equal(getSearchEngine().id, 'duckduckgo');
  });

  test('an override (e.g. a private tab’s own engine) wins', () => {
    assert.equal(getSearchEngine({ engine: 'brave' }).buildSearchUrl('a').startsWith('https://search.brave.com/'), true);
  });
});

describe('normalizing stored values', () => {
  test('unknown values fall back to the defaults', () => {
    assert.equal(normalizeSearchEngineId('altavista'), 'google');
    assert.equal(normalizeSafeSearch(3), 'moderate');
    assert.equal(normalizeSearchLanguage('xx'), 'default');
    assert.equal(normalizeSearchRegion('zz'), 'auto');
    assert.equal(normalizeSearchEngineId('bing'), 'bing');
  });
});

describe('recognizing results pages', () => {
  test('the query of each engine’s results page', () => {
    for (const engine of SEARCH_ENGINE_IDS) {
      const url = buildEngineSearchUrl('red fox', settings({ engine, region: 'gb' }));
      assert.equal(searchQueryFromUrl(url), 'red fox', engine);
    }
    assert.equal(searchQueryFromUrl('https://example.com/search?q=x'), null);
    assert.equal(searchQueryFromUrl('not a url'), null);
  });
});
