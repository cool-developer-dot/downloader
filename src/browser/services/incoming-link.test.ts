import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isBrowserWebLink, urlFromSharedText } from './incoming-link';

describe('links arriving from outside VidoraX', () => {
  test('a plain link is taken as-is', () => {
    assert.equal(urlFromSharedText('https://example.test/watch/9'), 'https://example.test/watch/9');
  });

  test('the link is pulled out of a caption', () => {
    assert.equal(
      urlFromSharedText('Look at this https://example.test/watch/9 — amazing'),
      'https://example.test/watch/9',
    );
  });

  test('a bare host still opens', () => {
    assert.equal(urlFromSharedText('example.test/watch'), 'https://example.test/watch');
  });

  test('text with no link opens nothing', () => {
    assert.equal(urlFromSharedText('just some words'), null);
    assert.equal(urlFromSharedText(''), null);
    assert.equal(urlFromSharedText(null), null);
  });
});

describe('which system links belong to the in-app browser', () => {
  test('web pages are the browser\'s, never app routes', () => {
    assert.equal(isBrowserWebLink('https://example.test/watch/9'), true);
    assert.equal(isBrowserWebLink('http://fx.127.0.0.1.nip.io:8093/n/a.html'), true);
    assert.equal(isBrowserWebLink('  HTTPS://Example.test/ '), true);
    assert.equal(isBrowserWebLink('about:blank'), true);
  });

  test('the app\'s own links still go to the router', () => {
    assert.equal(isBrowserWebLink('vidorax://downloads'), false);
    assert.equal(isBrowserWebLink('vidorax:///library'), false);
    assert.equal(isBrowserWebLink('/downloads'), false);
    assert.equal(isBrowserWebLink(''), false);
    assert.equal(isBrowserWebLink(null), false);
  });
});
