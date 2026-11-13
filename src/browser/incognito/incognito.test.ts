import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { toV2RequestContext } from '../../downloads/v2/enqueue-request.ts';
import { shouldSaveVisit } from '../history/history-policy.ts';
import { orphanWebProfileNames, ownedWebProfileNames } from '../profiles/web-profile-sweep.ts';
import { savedActiveTabId } from '../tabs/saved-active-tab.ts';
import { shouldPersistForTab } from '../tabs/tab-privacy.ts';
import {
  DEFAULT_INCOGNITO_SEARCH_ENGINE,
  INCOGNITO_SEARCH_ENGINES,
  normalizeIncognitoSearchEngine,
  searchEngineFor,
} from './incognito-settings.ts';
import {
  incognitoCookieProfile,
  isIncognitoProfileName,
  isIncognitoTabId,
  newIncognitoProfileName,
  setIncognitoInFront,
  setLiveIncognitoProfile,
} from './incognito-state.ts';

describe('B11 incognito session profile', () => {
  test('every session gets a new, valid name — never one used before', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i += 1) {
      const name = newIncognitoProfileName(1_800_000_000_000 + Math.floor(i / 10));
      assert.ok(isIncognitoProfileName(name), name);
      assert.ok(name.length - 'vidorax-'.length <= 32, 'B20 name rule: at most 32 characters after vidorax-');
      assert.ok(/^vidorax-[a-z0-9]{1,32}$/.test(name));
      assert.ok(!seen.has(name), `repeated: ${name}`);
      seen.add(name);
    }
    // Same time, different randomness: still different.
    let r = 0;
    const a = newIncognitoProfileName(5, () => ((r += 0.1) % 1));
    const b = newIncognitoProfileName(5, () => 0.99);
    assert.notEqual(a, b);
    assert.ok(!isIncognitoProfileName('vidorax-abc123'), 'a browser profile is not an incognito session');
    assert.ok(!isIncognitoProfileName('Default'));
  });

  test('the sweep never deletes the live session, and still deletes an old one', () => {
    const live = 'vidorax-incoglive1';
    const owned = ownedWebProfileNames(['vidorax-p1'], 'Default', live);
    const names = ['Default', 'vidorax-p1', live, 'vidorax-incogold9', 'vidorax-gone', 'other'];
    assert.deepEqual(orphanWebProfileNames(names, owned), ['vidorax-incogold9', 'vidorax-gone']);
    // Without a live session, every incognito leftover goes.
    assert.deepEqual(orphanWebProfileNames(names, ownedWebProfileNames(['vidorax-p1'], 'Default', null)), [
      live,
      'vidorax-incogold9',
      'vidorax-gone',
    ]);
  });
});

describe('B11 nothing is kept for an incognito tab', () => {
  test('shouldPersistForTab: false only for incognito tabs (history, closed tabs, previews, notes… ask it)', () => {
    assert.equal(shouldPersistForTab({ id: 'incog-3f1c' }), false);
    assert.equal(shouldPersistForTab({ id: '3f1c-normal' }), true);
    assert.equal(shouldPersistForTab(null), true);
    assert.equal(isIncognitoTabId('incog-x'), true);
    assert.equal(isIncognitoTabId(undefined), false);
    // History (B10's gate) follows it even with "Save history" on.
    assert.equal(shouldSaveVisit(true, { id: 'incog-1' }), false);
    assert.equal(shouldSaveVisit(true, { id: 'tab-1' }), true);
  });

  test('the saved tab in front is never the incognito one', () => {
    const kept = [
      { id: 'a', lastActiveAt: 10 },
      { id: 'b', lastActiveAt: 30 },
      { id: 'c', lastActiveAt: 20 },
    ];
    assert.equal(savedActiveTabId('incog-1', kept), 'b', 'the most recently used saved tab');
    assert.equal(savedActiveTabId('c', kept), 'c');
    assert.equal(savedActiveTabId('incog-1', []), 'incog-1', 'nothing saved: unchanged (restore falls back)');
  });
});

describe('B11 downloads from an incognito tab use its cookie jar', () => {
  const ctx = { cookiesRequired: true, headers: { 'User-Agent': 'UA/1' } } as never;

  test('only while an incognito tab is in front and its session is live; otherwise unchanged', () => {
    setLiveIncognitoProfile(null);
    setIncognitoInFront(false);
    const normal = toV2RequestContext(ctx, 'https://example.com/v');
    assert.ok(!('cookieProfile' in normal), 'a normal tab: exactly as before');

    setLiveIncognitoProfile('vidorax-incogabc1');
    assert.ok(!('cookieProfile' in toV2RequestContext(ctx, 'https://example.com/v')), 'normal tab in front');

    setIncognitoInFront(true);
    assert.equal(incognitoCookieProfile(), 'vidorax-incogabc1');
    const incognito = toV2RequestContext(ctx, 'https://example.com/v');
    assert.equal(incognito.cookieProfile, 'vidorax-incogabc1');
    assert.deepEqual({ ...incognito, cookieProfile: undefined }, { ...normal, cookieProfile: undefined });

    setLiveIncognitoProfile(null);
    assert.ok(!('cookieProfile' in toV2RequestContext(ctx, 'https://example.com/v')), 'the session ended');
    setIncognitoInFront(false);
  });
});

describe('B11 #111 incognito search engine', () => {
  test("'same' by default (today's engine); its own engine only in an incognito tab", () => {
    assert.equal(DEFAULT_INCOGNITO_SEARCH_ENGINE, 'same');
    assert.ok(INCOGNITO_SEARCH_ENGINES.includes('duckduckgo'));
    assert.equal(normalizeIncognitoSearchEngine('nope'), 'same');
    assert.equal(searchEngineFor('google', 'same', true), 'google');
    assert.equal(searchEngineFor('google', 'duckduckgo', true), 'duckduckgo');
    assert.equal(searchEngineFor('google', 'duckduckgo', false), 'google');
  });
});
