import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  contentIdOfGeneralIdentity,
  extractMediaUrlContentId,
  sameContentIdShape,
} from './general-content-identity';

describe('the item a media URL names', () => {
  test('an id-like segment after a video route word', () => {
    assert.equal(extractMediaUrlContentId('https://www.dailymotion.com/cdn/manifest/video/xbdj9lm.m3u8?sec=a'), 'xbdj9lm');
    assert.equal(extractMediaUrlContentId('https://cdn.example.tv/videos/8812345/master.mpd'), '8812345');
    assert.equal(extractMediaUrlContentId('https://cdn.example.tv/embed/AbCdEf/playlist.m3u8'), 'AbCdEf');
  });

  test('plain words, CDN object paths, short tokens and bad input name nothing', () => {
    for (const url of [
      'https://cdn.example.tv/video/manifest.m3u8',
      'https://cdn.example.tv/video/master/index.m3u8',
      'https://scontent.xx.fbcdn.net/o1/v/t2/f2/m69/AQOE4PGtPuV.mp4?oh=1',
      'https://edge.example.net/o/9f3a1c',
      'not a url',
      null,
      '',
    ]) {
      assert.equal(extractMediaUrlContentId(url), null, String(url));
    }
  });

  test('only video:<id> identities carry a content id', () => {
    assert.equal(contentIdOfGeneralIdentity('video:xbdj9lm'), 'xbdj9lm');
    assert.equal(contentIdOfGeneralIdentity('element:video:0|/v/a.mp4'), null);
    assert.equal(contentIdOfGeneralIdentity(null), null);
  });

  test('ids of different kinds are never compared as rivals', () => {
    assert.equal(sameContentIdShape('xbdj9lm', 'xb3pcpa'), true);
    assert.equal(sameContentIdShape('4678791569058145', 'xb3pcpa'), false);
    assert.equal(sameContentIdShape('8812345', '8812399'), true);
  });
});
