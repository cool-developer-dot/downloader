import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { clipboardOffer, extractLinks, MAX_BATCH_LINKS } from './link-intake';

describe('link intake (audit)', () => {
  test('a very large paste stays bounded', () => {
    const text = Array.from({ length: 20_000 }, (_, i) => `see https://site.example/v/${i} and more`).join('\n');
    const started = Date.now();
    const links = extractLinks(text);
    assert.equal(links.length, MAX_BATCH_LINKS);
    assert.ok(Date.now() - started < 2_000);
  });

  test('the clipboard only looks at its first 4 KiB', () => {
    assert.equal(clipboardOffer(`${'x '.repeat(5_000)} https://site.example/v/1`, null), null);
  });

  test('links with credentials in them are still validated by host', () => {
    assert.deepEqual(extractLinks('https://user:pw@192.168.0.1/x'), ['https://user:pw@192.168.0.1/x']);
    assert.equal(clipboardOffer('https://user:pw@192.168.0.1/x', null), null);
  });
});
