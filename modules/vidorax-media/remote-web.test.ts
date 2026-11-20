import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import * as format from './android/src/main/assets/vidorax-remote/format.mjs';
import { STRINGS, translator } from './android/src/main/assets/vidorax-remote/strings.mjs';

const ASSETS = new URL('./android/src/main/assets/vidorax-remote/', import.meta.url);

describe('Remote control Web UI (P6)', () => {
  it('has the same keys and placeholders in English and Urdu', () => {
    const en = STRINGS.en as Record<string, string>;
    const ur = STRINGS.ur as Record<string, string>;
    assert.deepEqual(Object.keys(ur).sort(), Object.keys(en).sort());
    const holes = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    for (const key of Object.keys(en)) {
      assert.ok(ur[key]!.trim().length > 0, `empty Urdu ${key}`);
      assert.equal(holes(ur[key]!), holes(en[key]!), `placeholders of ${key}`);
    }
  });

  it('names every string the page and the script use', () => {
    const html = readFileSync(new URL('index.html', ASSETS), 'utf8');
    const script = readFileSync(new URL('app.mjs', ASSETS), 'utf8');
    const used = new Set<string>();
    for (const match of html.matchAll(/data-(?:t|placeholder)="(\w+)"/g)) used.add(match[1]!);
    for (const match of script.matchAll(/\bt\('(\w+)'/g)) used.add(match[1]!);
    for (const key of used) assert.ok(key in STRINGS.en, `missing string ${key}`);
    for (const state of ['queued', 'downloading', 'paused', 'completed', 'failed', 'waiting_conditions']) {
      assert.ok(format.stateKey(state) in STRINGS.en);
    }
    for (const outcome of ['added', 'duplicate', 'needs_review', 'refused']) {
      assert.ok(`outcome_${outcome}` in STRINGS.en);
    }
  });

  it('never writes phone data into the page as HTML', () => {
    const script = readFileSync(new URL('app.mjs', ASSETS), 'utf8');
    assert.doesNotMatch(script, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    const html = readFileSync(new URL('index.html', ASSETS), 'utf8');
    assert.doesNotMatch(html, /<script>|\sstyle="|\son[a-z]+="/, 'inline script, style or handlers break the CSP');
  });

  it('fills placeholders and falls back to English', () => {
    const ur = translator('ur');
    assert.equal(translator('en')('wrongPin', { count: 3 }), 'Wrong PIN. 3 tries left before a short wait.');
    assert.ok(ur('wrongPin', { count: 3 }).includes('3'));
    assert.equal(translator('xx')('pair'), 'Pair');
  });

  it('formats sizes, speeds and times', () => {
    assert.equal(format.formatBytes(0), '0 B');
    assert.equal(format.formatBytes(1536), '1.5 KB');
    assert.equal(format.formatBytes(1048576 * 250), '250 MB');
    assert.equal(format.formatBytes(null), '');
    assert.equal(format.formatSpeed(2 * 1048576), '2.0 MB/s');
    assert.equal(format.formatSpeed(0), '');
    assert.equal(format.formatEta(65), '1:05');
    assert.equal(format.formatEta(3723), '1:02:03');
    assert.equal(format.formatEta(null), '');
    assert.equal(format.percent(0.505), 50);
    assert.equal(format.percent(2), 100);
    assert.equal(format.percent(null), null);
  });

  it('reads the PIN a QR code carries', () => {
    assert.equal(format.pinFromHash('#pin=012345'), '012345');
    assert.equal(format.pinFromHash('#a=1&pin=987654'), '987654');
    assert.equal(format.pinFromHash('#pin=12345'), null);
    assert.equal(format.pinFromHash(''), null);
  });

  it('only makes http(s) links', () => {
    assert.equal(format.safeHttpUrl('https://example.com/a'), 'https://example.com/a');
    assert.equal(format.safeHttpUrl('javascript:alert(1)'), null);
    assert.equal(format.safeHttpUrl('data:text/html,hi'), null);
    assert.equal(format.linkFromInput(' example.com/video.mp4 '), 'https://example.com/video.mp4');
    assert.equal(format.linkFromInput('ftp://example.com/x'), null);
    assert.equal(format.linkFromInput('   '), null);
  });

  it('names the browser for the phone’s list', () => {
    assert.equal(
      format.deviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36'),
      'Chrome on macOS',
    );
    assert.equal(format.deviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0'), 'Firefox on Windows');
    assert.equal(format.deviceName('Mozilla/5.0 (Windows NT 10.0) Chrome/130 Safari/537.36 Edg/130'), 'Edge on Windows');
    assert.equal(format.deviceName(''), 'Browser');
  });
});
