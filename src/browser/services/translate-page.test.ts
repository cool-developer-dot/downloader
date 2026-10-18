import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildTranslatePageUrl, isGoogleTranslatePage } from './translate-page.ts';

function params(url: string | null): URLSearchParams {
  assert.ok(url, 'expected a translate URL');
  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, 'https://translate.google.com/translate');
  return parsed.searchParams;
}

describe('buildTranslatePageUrl', () => {
  it('asks Google to detect the source language and translate into the app language', () => {
    const en = params(buildTranslatePageUrl('https://elpais.com/', 'en'));
    assert.equal(en.get('sl'), 'auto');
    assert.equal(en.get('tl'), 'en');
    assert.equal(en.get('u'), 'https://elpais.com/');

    assert.equal(params(buildTranslatePageUrl('https://elpais.com/', 'ur')).get('tl'), 'ur');
  });

  it('encodes ?, # and & so the whole page address stays one parameter', () => {
    const page = 'https://news.example/a?b=1&c=two words#part-2';
    const url = buildTranslatePageUrl(page, 'en');
    assert.ok(url);
    assert.ok(url.endsWith(`&u=${encodeURIComponent(page)}`));
    assert.ok(!url.slice(url.indexOf('&u=') + 3).match(/[?&#]/), 'no raw ?, & or # in u=');
    assert.equal(params(url).get('u'), page);
  });

  it('keeps non-Latin page addresses intact (raw or already percent-encoded)', () => {
    for (const page of [
      'https://ur.wikipedia.org/wiki/پاکستان',
      'https://ur.wikipedia.org/wiki/%D9%BE%D8%A7%DA%A9%D8%B3%D8%AA%D8%A7%D9%86',
      'https://例え.jp/ページ?q=日本',
    ]) {
      assert.equal(params(buildTranslatePageUrl(page, 'en')).get('u'), page, page);
    }
  });

  it('is unavailable without a web page', () => {
    for (const page of ['', '   ', 'vidorax://home', 'about:blank', 'file:///sdcard/a.html', 'not a url']) {
      assert.equal(buildTranslatePageUrl(page, 'en'), null, page);
    }
  });

  it('is unavailable on a page that is already Google Translate', () => {
    for (const page of [
      'https://translate.google.com/translate?sl=auto&tl=en&u=https%3A%2F%2Felpais.com%2F',
      'https://translate.google.com/?sl=es&tl=en',
      'https://elpais-com.translate.goog/?_x_tr_sl=auto&_x_tr_tl=en',
    ]) {
      assert.equal(isGoogleTranslatePage(page), true, page);
      assert.equal(buildTranslatePageUrl(page, 'en'), null, page);
    }
    assert.equal(isGoogleTranslatePage('https://www.google.com/search?q=translate'), false);
  });
});
