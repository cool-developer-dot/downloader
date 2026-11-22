import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveDisplayTitle } from './format';
import type { AnalyzedMediaSelection } from './types';

function selection(finalUrl: string, title = ''): AnalyzedMediaSelection {
  return { title, finalUrl } as unknown as AnalyzedMediaSelection;
}

test('a stream manifest never names the video', () => {
  assert.equal(resolveDisplayTitle(selection('https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8')), 'x36xhzz');
  assert.equal(resolveDisplayTitle(selection('https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd')), 'bbb_30fps');
  assert.equal(resolveDisplayTitle(selection('https://cdn.example.com/clip.mp4')), 'clip.mp4');
  assert.equal(resolveDisplayTitle(selection('https://cdn.example.com/a.m3u8', 'My video')), 'My video');
  assert.equal(resolveDisplayTitle(selection('not a url')), 'Media');
});
