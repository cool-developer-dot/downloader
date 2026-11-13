import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decideClipboardPaste, linkFromClipboardText } from './clipboard-link.ts';

describe('linkFromClipboardText', () => {
  it('takes a link copied alone', () => {
    assert.equal(
      linkFromClipboardText('https://www.tiktok.com/@scout2015/video/6718335390845095173'),
      'https://www.tiktok.com/@scout2015/video/6718335390845095173',
    );
    assert.equal(linkFromClipboardText('http://example.com/a?b=1&c=2#top'), 'http://example.com/a?b=1&c=2#top');
  });

  it('finds the link inside other text', () => {
    assert.equal(
      linkFromClipboardText('Look at this reel 😂 https://www.instagram.com/reel/DSxdvp9lcDa/?igsh=abc so funny'),
      'https://www.instagram.com/reel/DSxdvp9lcDa/?igsh=abc',
    );
    assert.equal(linkFromClipboardText('ویڈیو دیکھیں: https://example.com/v/1'), 'https://example.com/v/1');
  });

  it('takes the first of several links', () => {
    assert.equal(
      linkFromClipboardText('first https://a.example/1 then https://b.example/2'),
      'https://a.example/1',
    );
  });

  it('returns null when there is no http(s) link', () => {
    for (const text of ['', '   ', 'cats', 'v1.2', 'file.txt', 'example.com/watch', 'ftp://files.example/x', 'mailto:a@b.c', 'javascript:alert(1)', 'https://', 'https:///nohost']) {
      assert.equal(linkFromClipboardText(text), null, JSON.stringify(text));
    }
    assert.equal(linkFromClipboardText(null), null);
    assert.equal(linkFromClipboardText(undefined), null);
  });

  it('does not take an intent:// link or a link nested inside one', () => {
    assert.equal(linkFromClipboardText('intent://www.example.com/v/1#Intent;scheme=https;package=com.example;end'), null);
    assert.equal(
      linkFromClipboardText('intent://x#Intent;S.browser_fallback_url=https://example.com/v;end'),
      null,
    );
  });

  it('ignores spaces and newlines around the link', () => {
    assert.equal(linkFromClipboardText('\n\n   https://example.com/v/2   \n\t'), 'https://example.com/v/2');
    assert.equal(linkFromClipboardText('Title\nhttps://example.com/v/3\nshared via app'), 'https://example.com/v/3');
  });

  it('drops sentence punctuation and unmatched brackets after the link', () => {
    assert.equal(linkFromClipboardText('Watch https://example.com/v/4.'), 'https://example.com/v/4');
    assert.equal(linkFromClipboardText('(see https://example.com/v/5)'), 'https://example.com/v/5');
    assert.equal(linkFromClipboardText('"https://example.com/v/6",'), 'https://example.com/v/6');
    assert.equal(linkFromClipboardText('Wow!! https://example.com/v/7?!'), 'https://example.com/v/7');
    assert.equal(
      linkFromClipboardText('https://en.wikipedia.org/wiki/Mercury_(planet)'),
      'https://en.wikipedia.org/wiki/Mercury_(planet)',
    );
  });

  it('accepts an upper-case scheme', () => {
    assert.equal(linkFromClipboardText('HTTPS://EXAMPLE.COM/V/8'), 'HTTPS://EXAMPLE.COM/V/8');
  });
});

describe('decideClipboardPaste', () => {
  it('opens a normal link', () => {
    assert.deepEqual(decideClipboardPaste('https://m.facebook.com/watch/?v=1'), {
      kind: 'open',
      url: 'https://m.facebook.com/watch/?v=1',
    });
  });

  it('refuses YouTube links, alone or in text', () => {
    for (const text of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ?si=x',
      'check https://m.youtube.com/shorts/abc123 lol',
    ]) {
      assert.equal(decideClipboardPaste(text).kind, 'youtube', text);
    }
  });

  it('focuses the address bar when nothing can be opened', () => {
    assert.deepEqual(decideClipboardPaste('just some text'), { kind: 'focus' });
    assert.deepEqual(decideClipboardPaste(''), { kind: 'focus' });
  });
});
