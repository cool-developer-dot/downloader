import assert from 'node:assert/strict';
import { test } from 'node:test';

import { tabSiteKey } from './tab-display.ts';

test('Sort by Site groups on the registrable domain (B4 #37 helper)', () => {
  assert.equal(tabSiteKey('https://en.wikipedia.org/wiki/Lahore'), 'wikipedia.org');
  assert.equal(tabSiteKey('https://ur.m.wikipedia.org/wiki/x'), 'wikipedia.org');
  assert.equal(tabSiteKey('https://www.bbc.co.uk/news'), 'bbc.co.uk');
  assert.equal(tabSiteKey('https://user.github.io/page'), 'user.github.io');
  assert.equal(tabSiteKey('http://127.0.0.1:8080/'), '127.0.0.1');
  assert.equal(tabSiteKey('vidorax://home/'), '');
});
