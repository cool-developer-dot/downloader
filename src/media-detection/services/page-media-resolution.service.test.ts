import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DetectedMedia } from '../types';
import { pagePlayerNamesItsItem } from './page-media-resolution.service';

const PAGE = 'https://vimeo.com/1222284165';
const media = (contentId: string | null) => ({ url: 'https://vod.vimeocdn.com/x/playlist.m3u8', contentId }) as DetectedMedia;

test('a pasted page whose player data names its own video is left to the verified offer (every quality)', () => {
  assert.equal(pagePlayerNamesItsItem([media(null), media('1222284165')], PAGE), true);
  assert.equal(pagePlayerNamesItsItem([media('1222284165')], 'https://vimeo.com/channels/staffpicks/1222284165'), true);
});

test('no named item, or another item named (a background reel): the paste pick runs as before', () => {
  assert.equal(pagePlayerNamesItsItem([media(null)], PAGE), false);
  assert.equal(pagePlayerNamesItsItem([media('924399625')], PAGE), false);
  assert.equal(pagePlayerNamesItsItem([media('1222284165')], 'https://example.org/watch'), false);
});
