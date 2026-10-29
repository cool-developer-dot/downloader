import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  isPunycodeHost,
  punycodeEncode,
  registrableDomain,
  splitForDomainHighlight,
  toAsciiHost,
} from './domain.ts';

describe('registrable domain (eTLD+1)', () => {
  test('common and multi-part suffixes', () => {
    assert.equal(registrableDomain('en.wikipedia.org'), 'wikipedia.org');
    assert.equal(registrableDomain('www.bbc.co.uk'), 'bbc.co.uk');
    assert.equal(registrableDomain('shop.daraz.com.pk'), 'daraz.com.pk');
    assert.equal(registrableDomain('WWW.Example.COM.'), 'example.com');
  });

  test('private suffixes count (hosted sites)', () => {
    assert.equal(registrableDomain('user.github.io'), 'user.github.io');
  });

  test('IDN in punycode', () => {
    assert.equal(registrableDomain('www.xn--mnchen-3ya.de'), 'xn--mnchen-3ya.de');
  });

  test('IP addresses, localhost and bare suffixes have none', () => {
    assert.equal(registrableDomain('192.168.1.1'), null);
    assert.equal(registrableDomain('localhost'), null);
    assert.equal(registrableDomain('co.uk'), null);
    assert.equal(registrableDomain(''), null);
  });
});

describe('punycode for IDN hosts', () => {
  test('RFC 3492 sample strings', () => {
    assert.equal(punycodeEncode('münchen'), 'mnchen-3ya');
    assert.equal(punycodeEncode('bücher'), 'bcher-kva');
    assert.equal(punycodeEncode('пример'), 'e1afmkfd');
    assert.equal(punycodeEncode('پاکستان'), 'mgbai9azgqp6j');
  });

  test('hosts convert label by label', () => {
    assert.equal(toAsciiHost('www.münchen.de'), 'www.xn--mnchen-3ya.de');
    assert.equal(toAsciiHost('example.com'), 'example.com');
    assert.equal(isPunycodeHost('xn--e1afmkfd.xn--p1ai'), true);
    assert.equal(isPunycodeHost('example.com'), false);
  });
});

describe('Domain highlight (#37)', () => {
  test('domain in full colour, the rest dimmed', () => {
    assert.deepEqual(splitForDomainHighlight('en.wikipedia.org/wiki/Lahore'), {
      before: 'en.',
      domain: 'wikipedia.org',
      after: '/wiki/Lahore',
      idnWarning: false,
    });
    assert.deepEqual(splitForDomainHighlight('https://www.bbc.co.uk/urdu?x=1'), {
      before: 'https://www.',
      domain: 'bbc.co.uk',
      after: '/urdu?x=1',
      idnWarning: false,
    });
  });

  test('IDN hosts show their xn-- form with a warning', () => {
    const parts = splitForDomainHighlight('пример.рф/путь')!;
    assert.equal(parts.domain, 'xn--e1afmkfd.xn--p1ai');
    assert.equal(parts.idnWarning, true);
    assert.equal(splitForDomainHighlight('xn--mnchen-3ya.de/')!.idnWarning, true);
  });

  test('no registrable domain: the whole host is highlighted', () => {
    assert.deepEqual(splitForDomainHighlight('192.168.0.1:8080/admin'), {
      before: '',
      domain: '192.168.0.1',
      after: ':8080/admin',
      idnWarning: false,
    });
  });
});
