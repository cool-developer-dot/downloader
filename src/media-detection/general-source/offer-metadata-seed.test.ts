import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DetectedMedia } from '../types';
import { offerMetadataSeed } from './offer-metadata-seed';

const media = (url: string, extra: Partial<DetectedMedia> = {}) =>
  ({ id: url, url, finalUrl: url, title: null, thumbnailUrl: null, duration: null, contentId: null, isDrm: false, ...extra }) as DetectedMedia;

const PAGE = 'https://vimeo.com/1244254462?autoplay=1';
const PLAYED = media('https://vod.vimeocdn.com/a/playlist.m3u8?x=1', { title: 'Gatorville | Vimeo' });
const CONFIG = media('https://vod.vimeocdn.com/a/playlist.m3u8?x=2', {
  title: 'Gatorville',
  thumbnailUrl: 'https://i.vimeocdn.com/video/2223-d_640',
  duration: 1124,
  contentId: '1244254462',
});
const REEL = media('https://vod.vimeocdn.com/b/playlist.m3u8', {
  title: 'Documentary Reel 2024',
  thumbnailUrl: 'https://i.vimeocdn.com/video/1817-d_640',
  contentId: '924399625',
});

describe('offer metadata seed', () => {
  it('takes the source the ownership pass chose, not the first one reported', () => {
    const range = media('https://vod.vimeocdn.com/range/prot/x.mp4');
    assert.equal(offerMetadataSeed([range, CONFIG], CONFIG.url, 'https://example.org/watch').url, CONFIG.url);
  });

  it('the stream the player fetched itself gets the title, thumbnail and length its page player data named', () => {
    const seed = offerMetadataSeed([REEL, PLAYED, CONFIG], PLAYED.url, PAGE);
    assert.equal(seed.url, PLAYED.url, 'the offered stream itself is kept');
    assert.equal(seed.title, 'Gatorville');
    assert.equal(seed.thumbnailUrl, 'https://i.vimeocdn.com/video/2223-d_640');
    assert.equal(seed.duration, 1124);
  });

  it('player data naming another item (a background reel) is never borrowed', () => {
    const seed = offerMetadataSeed([REEL, PLAYED], PLAYED.url, PAGE);
    assert.equal(seed.title, 'Gatorville | Vimeo');
    assert.equal(seed.thumbnailUrl, null);
  });

  it('nothing named on a page whose URL has no id: the chosen source as it is', () => {
    assert.equal(offerMetadataSeed([PLAYED, CONFIG], PLAYED.url, 'https://vimeo.com/watch'), PLAYED);
  });
});
