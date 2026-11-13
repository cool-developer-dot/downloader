import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import { bindSearchSettingsReader, DEFAULT_SEARCH_SETTINGS } from './search-engines.ts';
import {
  DEFAULT_SEARCH_SHORTCUTS,
  DEFAULT_SEARCH_SHORTCUTS_JSON,
  isValidShortcutTemplate,
  matchSearchShortcut,
  parseSearchShortcuts,
  serializeSearchShortcuts,
  validateShortcut,
} from './search-shortcuts.ts';

afterEach(() => bindSearchSettingsReader(() => DEFAULT_SEARCH_SETTINGS));

describe('search shortcuts (#33)', () => {
  test('w Lahore → Wikipedia search', () => {
    const match = matchSearchShortcut('w Lahore', DEFAULT_SEARCH_SHORTCUTS)!;
    assert.equal(match.shortcut.name, 'Wikipedia');
    assert.equal(match.url, 'https://en.wikipedia.org/w/index.php?search=Lahore');
  });

  test('engine shortcuts use the user’s Safe Search and language', () => {
    bindSearchSettingsReader(() => ({ ...DEFAULT_SEARCH_SETTINGS, safeSearch: 'strict', language: 'ur' }));
    const match = matchSearchShortcut('b  big   cats', DEFAULT_SEARCH_SHORTCUTS)!;
    assert.equal(match.url, 'https://www.bing.com/search?q=big+cats&adlt=strict&setlang=ur');
    assert.equal(matchSearchShortcut('G cats', DEFAULT_SEARCH_SHORTCUTS)!.shortcut.engine, 'google');
  });

  test('Urdu queries are encoded', () => {
    const match = matchSearchShortcut('w لاہور', DEFAULT_SEARCH_SHORTCUTS)!;
    assert.equal(new URL(match.url).searchParams.get('search'), 'لاہور');
  });

  test('not a shortcut: lone keyword, unknown keyword, an address', () => {
    for (const input of ['w', 'w ', 'x cats', 'www.example.com', 'wikipedia.org cats', '']) {
      assert.equal(matchSearchShortcut(input, DEFAULT_SEARCH_SHORTCUTS), null, input);
    }
  });

  test('user templates: %s required, http(s) only', () => {
    assert.equal(isValidShortcutTemplate('https://www.youtube.com/results?search_query=%s'), true);
    assert.equal(isValidShortcutTemplate('https://example.com/search'), false);
    assert.equal(isValidShortcutTemplate('javascript:alert(%s)'), false);
    assert.equal(isValidShortcutTemplate('file:///sdcard/%s'), false);
  });

  test('validating a new shortcut', () => {
    const others = DEFAULT_SEARCH_SHORTCUTS;
    assert.deepEqual(validateShortcut({ keyword: 'yt', name: 'YouTube', template: 'https://m.youtube.com/results?search_query=%s' }, others).ok, true);
    assert.deepEqual(validateShortcut({ keyword: 'W', name: 'Dup', template: 'https://a.example/?q=%s' }, others), { ok: false, reason: 'keyword-taken' });
    assert.deepEqual(validateShortcut({ keyword: 'two words', name: 'X', template: 'https://a.example/?q=%s' }, others), { ok: false, reason: 'keyword' });
    assert.deepEqual(validateShortcut({ keyword: 'ok', name: ' ', template: 'https://a.example/?q=%s' }, others), { ok: false, reason: 'name' });
    assert.deepEqual(validateShortcut({ keyword: 'ok', name: 'Ok', template: 'https://a.example/' }, others), { ok: false, reason: 'template' });
    assert.equal(validateShortcut({ keyword: 'اردو', name: 'Rekhta', template: 'https://www.rekhta.org/search?q=%s' }, others).ok, true);
  });

  test('stored list round-trips; broken entries and duplicates are dropped', () => {
    assert.deepEqual(parseSearchShortcuts(DEFAULT_SEARCH_SHORTCUTS_JSON), DEFAULT_SEARCH_SHORTCUTS);
    const list = [
      ...DEFAULT_SEARCH_SHORTCUTS,
      { keyword: 'yt', name: 'YouTube', template: 'https://m.youtube.com/results?search_query=%s' },
    ];
    assert.deepEqual(parseSearchShortcuts(serializeSearchShortcuts(list)), list);
    const messy = JSON.stringify([
      { keyword: 'g', name: 'Google', engine: 'google' },
      { keyword: 'G', name: 'Again', engine: 'bing' },
      { keyword: 'x', name: 'Bad', template: 'javascript:%s' },
      { keyword: 'e', name: 'Unknown engine', engine: 'altavista' },
      'garbage',
    ]);
    assert.deepEqual(parseSearchShortcuts(messy).map((s) => s.keyword), ['g']);
  });

  test('unreadable storage falls back to the defaults; an empty list stays empty', () => {
    assert.deepEqual(parseSearchShortcuts('{not json'), DEFAULT_SEARCH_SHORTCUTS);
    assert.deepEqual(parseSearchShortcuts(42), DEFAULT_SEARCH_SHORTCUTS);
    assert.deepEqual(parseSearchShortcuts('[]'), []);
  });
});
