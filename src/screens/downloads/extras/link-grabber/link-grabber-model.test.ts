import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  applyRules,
  expandPattern,
  linkFileName,
  linkHost,
  linkKind,
  matchesFilter,
  mergeLinks,
  pageHostPath,
} from './link-grabber-model';

describe('link grabber model (design 43)', () => {
  test('a link reads as its file name and host, and sorts into the design chips', () => {
    assert.equal(linkFileName('https://www.example.com/files/clip%2001.mp4?sig=1'), 'clip 01.mp4');
    assert.equal(linkHost('https://www.example.com/files/clip_01.mp4'), 'example.com');
    assert.equal(linkFileName('https://example.com/'), 'example.com');
    assert.equal(linkKind('https://example.com/a.MP4'), 'video');
    assert.equal(linkKind('https://example.com/a.m3u8?x=1'), 'video');
    assert.equal(linkKind('https://example.com/a.mp3'), 'audio');
    assert.equal(linkKind('https://example.com/a.pdf'), 'docs');
    assert.equal(linkKind('https://example.com/cover.jpg'), 'images');
    assert.equal(linkKind('https://example.com/page'), 'other');
    assert.ok(matchesFilter('https://example.com/page', 'all'));
    assert.ok(!matchesFilter('https://example.com/page', 'video'));
  });

  test('the page card title is the host and path without www. or a trailing slash', () => {
    assert.equal(pageHostPath('https://www.example.com/files/'), 'example.com/files');
    assert.equal(pageHostPath('https://example.com'), 'example.com');
    assert.equal(pageHostPath('not a url'), '');
    assert.equal(pageHostPath(null), '');
  });

  test('a pattern expands its range, zero-padded as written, and only to web links', () => {
    const links = expandPattern('https://example.com/file[01-03].jpg');
    assert.deepEqual(links, [
      'https://example.com/file01.jpg',
      'https://example.com/file02.jpg',
      'https://example.com/file03.jpg',
    ]);
    assert.deepEqual(expandPattern('https://example.com/f[9-11].jpg'), [
      'https://example.com/f9.jpg',
      'https://example.com/f10.jpg',
      'https://example.com/f11.jpg',
    ]);
    assert.deepEqual(expandPattern('https://example.com/one.jpg'), ['https://example.com/one.jpg']);
    assert.deepEqual(expandPattern('file[01-20].jpg'), []);
    assert.deepEqual(expandPattern('https://example.com/f[3-1].jpg'), [
      'https://example.com/f3.jpg',
      'https://example.com/f2.jpg',
      'https://example.com/f1.jpg',
    ]);
    assert.deepEqual(expandPattern('https://example.com/[a-c].mp4'), [
      'https://example.com/a.mp4',
      'https://example.com/b.mp4',
      'https://example.com/c.mp4',
    ]);
    assert.equal(expandPattern('https://example.com/f[1-999].jpg', 10).length, 10);
  });

  test('include / exclude rules filter case-insensitively, and merged links never repeat', () => {
    const links = ['https://a.com/Clip_01.mp4', 'https://a.com/clip_02.mp4', 'https://a.com/cover.jpg'];
    assert.deepEqual(applyRules(links, { include: 'clip', exclude: '' }), links.slice(0, 2));
    assert.deepEqual(applyRules(links, { include: '', exclude: '02' }), [links[0], links[2]]);
    assert.deepEqual(applyRules(links, { include: ' ', exclude: ' ' }), links);
    assert.deepEqual(mergeLinks(links, [links[1]!, 'https://a.com/new.mp4']), [...links, 'https://a.com/new.mp4']);
  });
});
