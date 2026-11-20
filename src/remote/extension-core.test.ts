import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { PhoneError, pair, sendAndWait } from '../../extensions/vidorax-bridge/lib/api.mjs';
import {
  browserName,
  normalizePhoneAddress,
  originPattern,
  outcomeKey,
  pinFromAddress,
  urlToSend,
  videoLinksFrom,
} from '../../extensions/vidorax-bridge/lib/core.mjs';
import { STRINGS, languageOf, translator } from '../../extensions/vidorax-bridge/lib/strings.mjs';

const EXT = new URL('../../extensions/vidorax-bridge/', import.meta.url);

describe('VidoraX Bridge extension (P6 #500)', () => {
  it('turns what the user typed into the phone origin', () => {
    assert.equal(normalizePhoneAddress('192.168.1.20:41234'), 'http://192.168.1.20:41234');
    assert.equal(normalizePhoneAddress(' http://192.168.1.20:41234/#pin=123456 '), 'http://192.168.1.20:41234');
    assert.equal(normalizePhoneAddress('http://192.168.1.20'), null, 'the phone always uses its own port');
    assert.equal(normalizePhoneAddress('https://192.168.1.20:41234'), null);
    assert.equal(normalizePhoneAddress('http://user:pw@192.168.1.20:41234'), null);
    assert.equal(normalizePhoneAddress(''), null);
    assert.equal(originPattern('http://192.168.1.20:41234'), 'http://192.168.1.20:41234/*');
  });

  it('reads a PIN pasted with the QR address', () => {
    assert.equal(pinFromAddress('http://192.168.1.20:41234/#pin=012345'), '012345');
    assert.equal(pinFromAddress('http://192.168.1.20:41234/'), null);
  });

  it('sends the page for a blob: player and the file for a real address', () => {
    assert.equal(urlToSend({ menuItemId: 'send-link', linkUrl: 'https://a.example/v.mp4' }), 'https://a.example/v.mp4');
    assert.equal(
      urlToSend({ menuItemId: 'send-video', srcUrl: 'blob:https://a.example/123', pageUrl: 'https://a.example/watch' }),
      'https://a.example/watch',
    );
    assert.equal(urlToSend({ menuItemId: 'send-video', srcUrl: 'https://cdn.example/v.mp4', pageUrl: 'https://a.example/w' }), 'https://cdn.example/v.mp4');
    assert.equal(urlToSend({ menuItemId: 'send-link', linkUrl: 'javascript:alert(1)' }), null);
    assert.equal(urlToSend({ menuItemId: 'send-page', pageUrl: 'chrome://extensions' }), null);
  });

  it('lists the page’s video links once, http(s) only', () => {
    const links = videoLinksFrom({
      media: [
        { url: 'https://cdn.example/a.mp4', label: 'Clip' },
        { url: 'blob:https://x/1', label: 'MSE' },
        { url: 'https://cdn.example/a.mp4', label: 'Again' },
      ],
      links: [
        { url: 'https://site.example/files/b.webm?x=1', label: 'Download WebM' },
        { url: 'https://site.example/about', label: 'About' },
        { url: 'https://site.example/stream.m3u8', label: '' },
      ],
    });
    assert.deepEqual(
      links.map((l: { url: string }) => l.url),
      ['https://cdn.example/a.mp4', 'https://site.example/files/b.webm?x=1', 'https://site.example/stream.m3u8'],
    );
    assert.equal(links[2].label, 'stream.m3u8');
    assert.equal(videoLinksFrom(null).length, 0);
  });

  it('has English and Urdu for every string', () => {
    assert.deepEqual(Object.keys(STRINGS.ur).sort(), Object.keys(STRINGS.en).sort());
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    for (const key of Object.keys(STRINGS.en)) {
      assert.equal(holes(STRINGS.ur[key]), holes(STRINGS.en[key]), key);
    }
    const popup = readFileSync(new URL('popup.html', EXT), 'utf8') + readFileSync(new URL('popup.mjs', EXT), 'utf8');
    const background = readFileSync(new URL('background.js', EXT), 'utf8');
    for (const match of (popup + background).matchAll(/(?:data-(?:t|placeholder)="|\bt\(')(\w+)/g)) {
      assert.ok(match[1]! in STRINGS.en, `missing ${match[1]}`);
    }
    for (const status of ['added', 'duplicate', 'needs_review', 'refused', 'checking', 'waiting_for_app']) {
      assert.ok(outcomeKey(status) in STRINGS.en);
    }
    assert.equal(languageOf('ur-PK'), 'ur');
    assert.equal(languageOf('en-GB'), 'en');
    assert.equal(translator('ur')('pairedWith', { address: 'http://x:1' }).includes('http://x:1'), true);
  });

  it('asks only for what it needs', () => {
    const manifest = JSON.parse(readFileSync(new URL('manifest.json', EXT), 'utf8'));
    assert.equal(manifest.manifest_version, 3);
    assert.deepEqual(manifest.permissions.sort(), ['activeTab', 'contextMenus', 'scripting', 'storage']);
    assert.deepEqual(manifest.optional_host_permissions, ['http://*/*']);
    assert.equal(manifest.host_permissions, undefined, 'no standing access to any site');
    assert.equal(manifest.background.service_worker, 'background.js');
    assert.deepEqual(manifest.background.scripts, ['background.js']);
    assert.ok(manifest.browser_specific_settings.gecko.id);
    assert.match(browserName('Mozilla/5.0 Firefox/130.0'), /Firefox/);
  });

  it('pairs and sends through the phone API', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const replies = [
      { status: 200, body: { token: 't'.repeat(43), clientId: 'c1' } },
      { status: 202, body: { requestId: 'r1', status: 'checking' } },
      { status: 200, body: { requestId: 'r1', status: 'checking' } },
      { status: 200, body: { requestId: 'r1', status: 'added', title: 'Clip' } },
    ];
    const fakeFetch = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const reply = replies.shift()!;
      return new Response(JSON.stringify(reply.body), { status: reply.status });
    };
    const pairing = await pair(fakeFetch, 'http://192.168.1.20:41234', '123456', 'Chrome/130');
    assert.equal(pairing.token, 't'.repeat(43));
    const result = await sendAndWait(fakeFetch, pairing, 'https://a.example/v.mp4', { sleep: async () => undefined });
    assert.equal(result.status, 'added');
    assert.equal(calls[0]!.url, 'http://192.168.1.20:41234/api/v1/pair');
    assert.equal(calls[1]!.url, 'http://192.168.1.20:41234/api/v1/downloads');
    assert.equal((calls[1]!.init.headers as Record<string, string>).Authorization, `Bearer ${'t'.repeat(43)}`);
    assert.deepEqual(JSON.parse(calls[1]!.init.body as string), { url: 'https://a.example/v.mp4', source: 'extension' });
    assert.equal(calls[3]!.url, 'http://192.168.1.20:41234/api/v1/links/r1');
    assert.equal(calls[1]!.init.credentials, 'omit');
  });

  it('reports an unreachable phone and a wrong PIN', async () => {
    await assert.rejects(
      pair(async () => {
        throw new TypeError('network');
      }, 'http://192.168.1.20:41234', '123456', ''),
      (error: InstanceType<typeof PhoneError>) => error.status === 0,
    );
    await assert.rejects(
      pair(async () => new Response(JSON.stringify({ error: 'wrong_pin', attemptsLeft: 4 }), { status: 401 }), 'http://h:1', '000000', ''),
      (error: InstanceType<typeof PhoneError>) => error.status === 401 && error.body.attemptsLeft === 4,
    );
  });
});
