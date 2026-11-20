import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  assessSource,
  decodePunycode,
  displayHost,
  isIpHost,
  isMixedScript,
  LONG_REDIRECT_CHAIN,
  parseLink,
} from './source-check';

const signals = (result: ReturnType<typeof assessSource>) => result.reasons.map((reason) => reason.signal);

describe('P8 #514 Source check', () => {
  test('an HTTPS link with nothing odd is Secure', () => {
    const result = assessSource({ urls: ['https://www.example.com/watch', 'https://cdn.example.com/v.mp4'] });
    assert.equal(result.level, 'secure');
    assert.deepEqual(signals(result), ['https']);
  });

  test('plain HTTP is Not secure', () => {
    const result = assessSource({ urls: ['http://videos.example.com/clip.mp4'] });
    assert.equal(result.level, 'not-secure');
    assert.deepEqual(result.reasons, [{ signal: 'http', host: 'videos.example.com' }]);
  });

  test('a link that leaves HTTPS for HTTP (a downgrade) is Not secure', () => {
    const result = assessSource({ urls: ['https://site.example/page', 'http://cdn.example.net/v.mp4'] });
    assert.equal(result.level, 'not-secure');
    assert.deepEqual(signals(result), ['downgrade']);
  });

  test('a numeric IP host needs a check (IPv4, IPv6, number forms)', () => {
    for (const url of ['https://203.0.113.7/v.mp4', 'https://[2001:db8::1]/v.mp4', 'https://3405803783/v.mp4', 'https://0x7f.1/v.mp4']) {
      const result = assessSource({ urls: [url] });
      assert.equal(result.level, 'check', url);
      assert.deepEqual(signals(result), ['ip-host'], url);
    }
    assert.equal(isIpHost('365.com'), false);
    assert.equal(isIpHost('cdn1.example.com'), false);
  });

  test('a punycode host needs a check and is shown decoded', () => {
    const result = assessSource({ urls: ['https://xn--mnchen-3ya.de/v.mp4'] });
    assert.equal(result.level, 'check');
    assert.deepEqual(result.reasons, [{ signal: 'punycode', host: 'münchen.de' }]);
  });

  test('a mixed-script look-alike host (Cyrillic а in paypal) is flagged as such', () => {
    // "pаypal" with U+0430, as a browser sends it: xn--pypal-4ve.com
    assert.equal(decodePunycode('pypal-4ve'), 'pаypal');
    const result = assessSource({ urls: ['https://xn--pypal-4ve.com/v.mp4'] });
    assert.equal(result.level, 'check');
    assert.deepEqual(signals(result), ['mixed-script']);
    assert.equal(isMixedScript('pаypal'), true);
    assert.equal(isMixedScript('café'), false);
    assert.equal(isMixedScript('cdn-01'), false);
  });

  test('a raw Unicode host is checked the same way', () => {
    assert.deepEqual(signals(assessSource({ urls: ['https://pаypal.com/v.mp4'] })), ['mixed-script']);
    assert.deepEqual(signals(assessSource({ urls: ['https://яндекс.рф/v.mp4'] })), ['punycode']);
  });

  test('known link shorteners need a check', () => {
    for (const url of ['https://bit.ly/3abc', 'https://www.tinyurl.com/x', 'https://t.co/abc']) {
      assert.deepEqual(signals(assessSource({ urls: [url] })), ['shortener'], url);
    }
    // Only the exact domain or its subdomains.
    assert.equal(assessSource({ urls: ['https://notbit.ly/x'] }).level, 'secure');
  });

  test('free file-locker hosts need a check', () => {
    const result = assessSource({ urls: ['https://www.mediafire.com/file/abc/movie.mp4'] });
    assert.equal(result.level, 'check');
    assert.deepEqual(result.reasons, [{ signal: 'file-locker', host: 'www.mediafire.com' }]);
    assert.deepEqual(signals(assessSource({ urls: ['https://dl3.pixeldrain.com/api/file/x'] })), ['file-locker']);
  });

  test('a long redirect chain from the probe needs a check; one or two hops do not', () => {
    assert.equal(assessSource({ urls: ['https://cdn.example.com/v.mp4'], redirects: 2 }).level, 'secure');
    const result = assessSource({ urls: ['https://cdn.example.com/v.mp4'], redirects: LONG_REDIRECT_CHAIN });
    assert.equal(result.level, 'check');
    assert.deepEqual(result.reasons, [{ signal: 'redirects', count: 3 }]);
  });

  test('several signals: the most serious first, Not secure wins', () => {
    const result = assessSource({ urls: ['http://bit.ly/x', 'http://203.0.113.9/v.mp4'], redirects: 5 });
    assert.equal(result.level, 'not-secure');
    assert.deepEqual(signals(result), ['http', 'http', 'ip-host', 'shortener', 'redirects']);
  });

  test('no usable link gives no badge reasons (the badge hides)', () => {
    assert.deepEqual(assessSource({ urls: ['', null, 'blob:https://x/1', 'not a link'] }), { level: 'check', reasons: [] });
  });

  test('links are read without URL(): user info, ports and case', () => {
    assert.deepEqual(parseLink('HTTPS://user:pw@CDN.Example.COM:8443/v.mp4'), { scheme: 'https', host: 'cdn.example.com' });
    assert.equal(parseLink('ftp://example.com/x'), null);
    assert.equal(displayHost('xn--mnchen-3ya.xn--mnchen-3ya.de'), 'münchen.münchen.de');
    assert.equal(decodePunycode('!!'), null);
  });
});
