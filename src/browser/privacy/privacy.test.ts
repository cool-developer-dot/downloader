import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import vm from 'node:vm';

import { formatStorageSize } from './format-bytes';
import {
  decideHttpNavigation,
  httpPolicyFor,
  httpsUpgradeFor,
  isSecurityFailure,
  isUpgradeExemptHost,
  MAX_UPGRADES_IN_A_ROW,
  type PendingUpgrade,
} from './https-upgrade';
import { DO_NOT_TRACK_HEADERS, DO_NOT_TRACK_PAGE_SCRIPT } from './privacy-page-script';
import {
  DEFAULT_COOKIE_POLICY,
  isJavaScriptAllowed,
  MAX_JAVASCRIPT_EXCEPTIONS,
  normalizeCookiePolicy,
  parseJavaScriptExceptions,
  serializeJavaScriptExceptions,
  siteKey,
  withJavaScriptForSite,
} from './privacy-settings';

describe('cookie policy (#112, #113)', () => {
  test('defaults to blocking third-party cookies; unknown values fall back', () => {
    assert.equal(DEFAULT_COOKIE_POLICY, 'block-third-party');
    assert.equal(normalizeCookiePolicy('block-all'), 'block-all');
    assert.equal(normalizeCookiePolicy('allow-all'), 'allow-all');
    assert.equal(normalizeCookiePolicy('everything'), 'block-third-party');
    assert.equal(normalizeCookiePolicy(undefined), 'block-third-party');
  });
});

describe('JavaScript per site (#135)', () => {
  test('site keys: host without www, web pages only', () => {
    assert.equal(siteKey('https://www.Example.com/a?b'), 'example.com');
    assert.equal(siteKey('http://news.example.co.uk/'), 'news.example.co.uk');
    assert.equal(siteKey('vidorax://home'), null);
    assert.equal(siteKey('javascript:alert(1)'), null);
    assert.equal(siteKey('not a url'), null);
  });

  test('exceptions flip the default', () => {
    const exceptions = ['example.com'];
    assert.equal(isJavaScriptAllowed('https://example.com/x', true, exceptions), false);
    assert.equal(isJavaScriptAllowed('https://other.com/', true, exceptions), true);
    assert.equal(isJavaScriptAllowed('https://example.com/x', false, exceptions), true);
    assert.equal(isJavaScriptAllowed('https://other.com/', false, exceptions), false);
    assert.equal(isJavaScriptAllowed('vidorax://home', false, exceptions), false);
  });

  test('setting a site adds or removes it, relative to the default', () => {
    assert.deepEqual(withJavaScriptForSite([], 'a.com', false, true), ['a.com']);
    assert.deepEqual(withJavaScriptForSite(['a.com'], 'a.com', true, true), []);
    assert.deepEqual(withJavaScriptForSite(['a.com'], 'b.com', true, false), ['a.com', 'b.com']);
    assert.deepEqual(withJavaScriptForSite(['a.com'], 'a.com', false, false), []);
  });

  test('the stored list is parsed defensively', () => {
    assert.deepEqual(
      parseJavaScriptExceptions(JSON.stringify(['Example.com', 'www.a.com', 'a.com', 'bad host', 3, 'x'.repeat(300)])),
      ['example.com', 'a.com'],
    );
    assert.deepEqual(parseJavaScriptExceptions('{broken'), []);
    assert.deepEqual(parseJavaScriptExceptions('{"a":1}'), []);
    const many = JSON.stringify(Array.from({ length: MAX_JAVASCRIPT_EXCEPTIONS + 5 }, (_, i) => `s${i}.com`));
    assert.equal(parseJavaScriptExceptions(many).length, MAX_JAVASCRIPT_EXCEPTIONS);
    assert.equal(serializeJavaScriptExceptions(['A.com', 'a.com']), '["a.com"]');
  });
});

describe('HTTPS-only mode (#124)', () => {
  test('http pages go over https, port 80 dropped', () => {
    assert.equal(httpsUpgradeFor('http://example.com/a?b=1#c', new Set()), 'https://example.com/a?b=1#c');
    assert.equal(httpsUpgradeFor('http://example.com:80/', new Set()), 'https://example.com/');
    assert.equal(httpsUpgradeFor('http://example.com:8080/', new Set()), 'https://example.com:8080/');
  });

  test('left alone: https, allowed hosts, local and intranet addresses, junk', () => {
    assert.equal(httpsUpgradeFor('https://example.com/', new Set()), null);
    assert.equal(httpsUpgradeFor('http://example.com/', new Set(['example.com'])), null);
    for (const url of ['http://localhost:8081/', 'http://192.168.1.1/', 'http://router/', 'http://printer.local/', 'http://[::1]/', 'http://fx.localhost/']) {
      assert.equal(httpsUpgradeFor(url, new Set()), null, url);
    }
    assert.equal(httpsUpgradeFor('not a url', new Set()), null);
    assert.equal(isUpgradeExemptHost('example.com'), false);
  });

  test('a build without cleartext is always secure-only; otherwise the switch decides', () => {
    assert.equal(httpPolicyFor(false, false), 'secure-only');
    assert.equal(httpPolicyFor(true, false), 'secure-only');
    assert.equal(httpPolicyFor(true, true), 'upgrade');
    assert.equal(httpPolicyFor(false, true), 'off');
  });

  test('secure-only upgrades every http page, local ones and let-through hosts too; off upgrades nothing', () => {
    const allowed = new Set(['example.com']);
    assert.equal(httpsUpgradeFor('http://example.com/', allowed, 'secure-only'), 'https://example.com/');
    assert.equal(httpsUpgradeFor('http://192.168.1.1/', new Set(), 'secure-only'), 'https://192.168.1.1/');
    assert.equal(httpsUpgradeFor('http://fx.localhost:8765/a', new Set(), 'secure-only'), 'https://fx.localhost:8765/a');
    assert.equal(httpsUpgradeFor('http://example.com/', new Set(), 'off'), null);
    assert.equal(httpsUpgradeFor('https://example.com/', new Set(), 'secure-only'), null);
  });

  test('page navigations: a secure page that sends the browser back to http, or round and round, has no secure version', () => {
    const none = new Set<string>();
    const nothing = new Map<string, PendingUpgrade>();
    const fromA = new Map<string, PendingUpgrade>([['example.com', { from: 'http://example.com/a', count: 1 }]]);
    assert.deepEqual(decideHttpNavigation('http://Example.com/a', 'upgrade', none, nothing), {
      kind: 'upgrade',
      url: 'https://example.com/a',
    });
    // Straight back to where it was upgraded from (the hash doesn't matter).
    assert.deepEqual(decideHttpNavigation('http://example.com/a#top', 'upgrade', none, fromA), { kind: 'no-secure-version' });
    // An http link to another page of the host is just upgraded…
    assert.deepEqual(decideHttpNavigation('http://example.com/b', 'secure-only', none, fromA), {
      kind: 'upgrade',
      url: 'https://example.com/b',
    });
    // …until the same host has been upgraded MAX_UPGRADES_IN_A_ROW times without a page loading.
    const loop = new Map([['example.com', { from: 'http://example.com/b', count: MAX_UPGRADES_IN_A_ROW }]]);
    assert.deepEqual(decideHttpNavigation('http://example.com/c', 'secure-only', none, loop), { kind: 'no-secure-version' });
    assert.deepEqual(decideHttpNavigation('http://other.com/', 'secure-only', none, fromA), {
      kind: 'upgrade',
      url: 'https://other.com/',
    });
    assert.deepEqual(decideHttpNavigation('http://example.com/a', 'off', none, fromA), { kind: 'allow' });
    assert.deepEqual(decideHttpNavigation('http://example.com/a', 'upgrade', new Set(['example.com']), fromA), { kind: 'allow' });
    assert.deepEqual(decideHttpNavigation('https://example.com/a', 'secure-only', none, fromA), { kind: 'allow' });
  });

  test('security failures are the certificate and no-secure-version pages only', () => {
    for (const code of ['ssl_error', 'https_unavailable', 'https_required']) assert.equal(isSecurityFailure(code), true, code);
    for (const code of ['dns_failure', 'timeout', 'unknown', null, undefined]) assert.equal(isSecurityFailure(code), false, String(code));
  });
});

describe('Do Not Track (#115)', () => {
  test('the page sees navigator.doNotTrack and globalPrivacyControl; the script gives it nothing else', () => {
    class Navigator {}
    const context = vm.createContext({ Navigator, Object });
    vm.runInContext(DO_NOT_TRACK_PAGE_SCRIPT, context);
    const nav = new (context.Navigator as typeof Navigator)() as unknown as Record<string, unknown>;
    assert.equal(nav.doNotTrack, '1');
    assert.equal(nav.globalPrivacyControl, true);
    assert.ok(!/ReactNativeWebView|postMessage|fetch\(|XMLHttpRequest/.test(DO_NOT_TRACK_PAGE_SCRIPT));
    assert.deepEqual(DO_NOT_TRACK_HEADERS, { DNT: '1', 'Sec-GPC': '1' });
  });

  test('a page without Navigator does not break', () => {
    const context = vm.createContext({ Object });
    assert.doesNotThrow(() => vm.runInContext(DO_NOT_TRACK_PAGE_SCRIPT, context));
  });
});

describe('site data sizes (#130)', () => {
  test('KB under a megabyte, MB with one decimal', () => {
    assert.deepEqual(formatStorageSize(0), { unit: 'kb', size: '0' });
    assert.deepEqual(formatStorageSize(100), { unit: 'kb', size: '1' });
    assert.deepEqual(formatStorageSize(52_000), { unit: 'kb', size: '51' });
    assert.deepEqual(formatStorageSize(3 * 1024 * 1024), { unit: 'mb', size: '3' });
    assert.deepEqual(formatStorageSize(1.25 * 1024 * 1024), { unit: 'mb', size: '1.3' });
    assert.deepEqual(formatStorageSize(Number.NaN), { unit: 'kb', size: '0' });
  });
});
