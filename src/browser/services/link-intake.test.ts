import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { batchOutcomeFor, classifyIntakeLink, clipboardOffer, extractLinks, linkHash, MAX_BATCH_LINKS } from './link-intake';

describe('extractLinks', () => {
  test('finds http(s) links in prose, in order, without trailing punctuation', () => {
    assert.deepEqual(
      extractLinks('Look: https://a.com/v/1, and (https://b.com/x?y=1). Also http://c.org/p!'),
      ['https://a.com/v/1', 'https://b.com/x?y=1', 'http://c.org/p'],
    );
  });

  test('dedupes ignoring a trailing slash, the fragment and case', () => {
    assert.deepEqual(extractLinks('https://a.com/v/1 https://A.com/v/1/ https://a.com/v/1#t=3 https://a.com/v/2'), [
      'https://a.com/v/1',
      'https://a.com/v/2',
    ]);
  });

  test('keeps a balanced closing parenthesis', () => {
    assert.deepEqual(extractLinks('see https://en.wikipedia.org/wiki/Heat_(film)'), ['https://en.wikipedia.org/wiki/Heat_(film)']);
  });

  test('ignores other schemes and caps the count', () => {
    assert.deepEqual(extractLinks('ftp://a.com javascript:alert(1) file:///x'), []);
    const many = Array.from({ length: 80 }, (_, i) => `https://a.com/${i}`).join('\n');
    assert.equal(extractLinks(many).length, MAX_BATCH_LINKS);
  });
});

describe('classifyIntakeLink', () => {
  test('keeps the app refusals', () => {
    assert.equal(classifyIntakeLink('https://www.instagram.com/reel/abc/'), 'ok');
    assert.equal(classifyIntakeLink('https://www.youtube.com/watch?v=1'), 'youtube');
    assert.equal(classifyIntakeLink('https://youtu.be/1'), 'youtube');
    assert.equal(classifyIntakeLink('http://192.168.0.5/v.mp4'), 'private');
    assert.equal(classifyIntakeLink('http://localhost/x'), 'private');
    assert.equal(classifyIntakeLink('http://[::1]/x'), 'private');
    assert.equal(classifyIntakeLink('not a url'), 'invalid');
    assert.equal(classifyIntakeLink('ftp://a.com/x'), 'invalid');
  });
});

describe('clipboardOffer', () => {
  test('offers a new allowed link, remembering only its hash', () => {
    const offer = clipboardOffer('copied: https://www.tiktok.com/@a/video/123 ', null);
    assert.ok(offer);
    assert.equal(offer.url, 'https://www.tiktok.com/@a/video/123');
    assert.equal(offer.hash, linkHash(offer.url));
    assert.ok(!offer.hash.includes('tiktok'));
  });

  test('never offers the same link twice, nor refused links or plain text', () => {
    const url = 'https://example.com/v/1';
    assert.equal(clipboardOffer(url, linkHash(url)), null);
    assert.equal(clipboardOffer('https://youtu.be/xyz', null), null);
    assert.equal(clipboardOffer('http://10.0.0.1/a', null), null);
    assert.equal(clipboardOffer('hello world', null), null);
    assert.equal(clipboardOffer('', null), null);
    assert.equal(clipboardOffer(null, null), null);
  });

  test('the hash is stable and differs between links', () => {
    assert.equal(linkHash('https://a.com/1'), linkHash('https://a.com/1'));
    assert.notEqual(linkHash('https://a.com/1'), linkHash('https://a.com/2'));
  });
});

describe('batchOutcomeFor', () => {
  test('only one verified video accepted by the handoff is added', () => {
    assert.equal(batchOutcomeFor({ verdict: 'ok', analysisStatus: 'SUPPORTED', enqueue: { ok: true } }), 'added');
    assert.equal(
      batchOutcomeFor({ verdict: 'ok', analysisStatus: 'SUPPORTED', enqueue: { ok: true, duplicate: 'ALREADY_DOWNLOADED' } }),
      'duplicate',
    );
    assert.equal(batchOutcomeFor({ verdict: 'ok', analysisStatus: 'SUPPORTED', enqueue: { ok: true, deduped: true } }), 'duplicate');
  });

  test('anything else needs review; refused links never reach the network', () => {
    for (const analysisStatus of ['UNRESOLVED', 'PROTECTED', 'LIVE_UNSUPPORTED', 'UNSUPPORTED', 'TRANSIENT_FAILURE', 'INVALID_MEDIA', null]) {
      assert.equal(batchOutcomeFor({ verdict: 'ok', analysisStatus }), 'needs-review', String(analysisStatus));
    }
    assert.equal(batchOutcomeFor({ verdict: 'ok', analysisStatus: 'SUPPORTED', enqueue: { ok: false } }), 'needs-review');
    assert.equal(batchOutcomeFor({ verdict: 'youtube' }), 'refused');
    assert.equal(batchOutcomeFor({ verdict: 'private' }), 'refused');
    assert.equal(batchOutcomeFor({ verdict: 'invalid' }), 'refused');
  });
});
