import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  contentIdOfGeneralIdentity,
  extractMediaUrlContentId,
  pageUrlNamesContentId,
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

describe('a page URL naming the id its player data named', () => {
  test('a whole path segment counts, wherever it is', () => {
    assert.equal(pageUrlNamesContentId('https://vimeo.com/1222284165?fl=wc', '1222284165'), true);
    assert.equal(pageUrlNamesContentId('https://vimeo.com/channels/staffpicks/1222284165', '1222284165'), true);
    assert.equal(pageUrlNamesContentId('https://player.vimeo.com/video/1222284165', '1222284165'), true);
  });

  test('part of a segment, the query, another id or garbage does not', () => {
    assert.equal(pageUrlNamesContentId('https://vimeo.com/12222841650', '1222284165'), false);
    assert.equal(pageUrlNamesContentId('https://vimeo.com/watch?v=1222284165', '1222284165'), false);
    assert.equal(pageUrlNamesContentId('https://vimeo.com/1246752032', '1222284165'), false);
    assert.equal(pageUrlNamesContentId('https://vimeo.com/1222284165', 'a/b'), false);
    assert.equal(pageUrlNamesContentId('not a url', '1222284165'), false);
    assert.equal(pageUrlNamesContentId(null, '1222284165'), false);
  });
});
