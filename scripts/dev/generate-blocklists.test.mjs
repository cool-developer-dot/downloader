import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractRules } from './generate-blocklists.mjs';

// B14 — what the list generator keeps from an Adblock Plus list (node --test scripts/dev/generate-blocklists.test.mjs).
const SAMPLE = [
  '[Adblock Plus 2.0]',
  '! Version: 202611081815',
  '! a comment',
  '||ads.example^',
  '||tracker.example^$third-party',
  '||typed.example^$script,image,third-party',
  '||popup.example^$popup',
  '||sitebound.example^$domain=news.example',
  '||doc.example^$document',
  '||sub.ads.example^',
  '||cdn.example/ads/banner',
  '||cdn.example/promo/',
  '||wild.example/*/ad.js',
  '||ads.example/path/',
  '||allowed.example^',
  '@@||allowed.example^',
  '##.ad-banner',
  'example.com##.sponsored',
  '/banner/*/img^',
  '||123.45.67.89^',
  '||imasdk.googleapis.com^$third-party',
  '||p.jwpcdn.com/player/plugins/vast/',
  '||flowplayer.com/releases/ads/',
].join('\n');

test('keeps whole-host and plain path-prefix rules only', () => {
  const { version, lines } = extractRules(SAMPLE);
  assert.equal(version, '202611081815');
  assert.deepEqual(lines, [
    'ads.example',
    'cdn.example/ads/banner',
    'cdn.example/promo/',
    'tracker.example',
    'typed.example',
  ]);
});

test('drops what would over-block or never apply to a request', () => {
  const { lines } = extractRules(SAMPLE);
  for (const dropped of ['popup.example', 'sitebound.example', 'doc.example', 'wild.example', 'allowed.example', '123.45.67.89']) {
    assert.ok(!lines.some((line) => line.startsWith(dropped)), dropped);
  }
  assert.ok(!lines.includes('sub.ads.example'), 'covered by its parent');
  assert.ok(!lines.includes('ads.example/path/'), 'the host is already listed whole');
});

test('never keeps rules on the code video players load (IMA SDK, player plugins)', () => {
  const { lines } = extractRules(SAMPLE);
  for (const host of ['imasdk.googleapis.com', 'p.jwpcdn.com', 'flowplayer.com']) {
    assert.ok(!lines.some((line) => line === host || line.startsWith(`${host}/`)), host);
  }
});
