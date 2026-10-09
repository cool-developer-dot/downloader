import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { contentTokensOf, isContentIdLike, ownershipOf, valueNamesToken } from './content-tokens';

describe('content ids a pasted link names', () => {
  test('path ids, shortcodes and query ids; never route words, authors or tracking', () => {
    assert.deepEqual([...contentTokensOf(['https://www.instagram.com/reel/DdiUOZezpFs/?igsh=abc123XYZ'])], ['DdiUOZezpFs']);
    assert.deepEqual([...contentTokensOf(['https://www.tiktok.com/@scout2015/video/6718335390845095173'])], ['6718335390845095173']);
    assert.deepEqual([...contentTokensOf(['https://m.facebook.com/watch/?v=2289516264908285&utm_source=x1y2z3'])], ['2289516264908285']);
    assert.deepEqual([...contentTokensOf(['https://www.dailymotion.com/video/xb346be'])], ['xb346be']);
    assert.deepEqual([...contentTokensOf(['https://news.example/2024/some-story-title-8812345'])], ['8812345']);
    assert.deepEqual([...contentTokensOf(['https://www.w3schools.com/html/html5_video.asp'])], []);
  });

  test('ids look like ids', () => {
    assert.equal(isContentIdLike('DdiUOZezpFs'), true);
    assert.equal(isContentIdLike('xb346be'), true);
    assert.equal(isContentIdLike('videos'), false);
    assert.equal(isContentIdLike('2024'), false);
    assert.equal(isContentIdLike('lowercaseword'), false);
  });

  test('a field names a token as a whole word only', () => {
    const tokens = new Set(['2289516264908285']);
    assert.equal(valueNamesToken('2289516264908285', tokens), true);
    assert.equal(valueNamesToken('https://site.example/reel/2289516264908285/', tokens), true);
    assert.equal(valueNamesToken('{"video_id":"2289516264908285"}', tokens), true);
    assert.equal(valueNamesToken('122895162649082851', tokens), false);
  });

  test('explicit id fields decide ownership before incidental references', () => {
    const tokens = new Set(['2289516264908285']);
    assert.equal(ownershipOf([['video_id', '2289516264908285']], tokens), 'match');
    assert.equal(ownershipOf([['video_id', '1376350954687257'], ['origin_uri', 'https://m.site.example/watch/?v=2289516264908285']], tokens), 'foreign');
    assert.equal(ownershipOf([['permalink', 'https://site.example/v/2289516264908285']], tokens), 'match');
    assert.equal(ownershipOf([['pk', 'DdiUOZezpFsXX']], tokens), 'none', 'an id of another shape says nothing');
  });
});
