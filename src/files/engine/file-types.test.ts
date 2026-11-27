import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { extensionOf, fileTypeOf, type FileType } from './file-types';

/** 40 rows: MIME (or none) and name → type. */
const TABLE: [string | null, string, FileType][] = [
  ['video/mp4', 'clip.mp4', 'video'],
  ['video/x-matroska', 'movie.mkv', 'video'],
  ['video/webm', 'a.webm', 'video'],
  ['video/MP2T', 'seg.ts', 'video'],
  ['application/x-mpegURL', 'live.m3u8', 'video'],
  ['application/dash+xml', 'manifest.mpd', 'video'],
  ['application/octet-stream', 'clip.mp4', 'video'],
  [null, 'clip.MOV', 'video'],
  ['', 'old.flv', 'video'],
  ['audio/mpeg', 'song.mp3', 'audio'],
  ['audio/mp4', 'voice.m4a', 'audio'],
  ['audio/ogg; codecs=opus', 'x.opus', 'audio'],
  [null, 'track.flac', 'audio'],
  ['application/octet-stream', 'rec.wav', 'audio'],
  ['image/jpeg', 'photo.jpg', 'image'],
  ['image/png', 'shot.png', 'image'],
  ['image/webp', 'w.webp', 'image'],
  [null, 'IMG_1.HEIC', 'image'],
  ['image/gif', 'fun.gif', 'image'],
  ['application/pdf', 'book.pdf', 'doc'],
  ['application/epub+zip', 'novel.epub', 'doc'],
  ['text/plain', 'readme.txt', 'doc'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'cv.docx', 'doc'],
  ['application/msword', 'old.doc', 'doc'],
  [null, 'subs.srt', 'doc'],
  ['application/octet-stream', 'sheet.xlsx', 'doc'],
  ['application/zip', 'pack.zip', 'archive'],
  ['application/x-7z-compressed', 'a.7z', 'archive'],
  ['application/vnd.rar', 'b.rar', 'archive'],
  [null, 'src.tar.gz', 'archive'],
  ['application/gzip', 'log.gz', 'archive'],
  ['application/vnd.android.package-archive', 'app.apk', 'apk'],
  ['application/octet-stream', 'game.apk', 'apk'],
  [null, 'bundle.xapk', 'apk'],
  ['application/octet-stream', 'mystery.bin', 'other'],
  [null, 'noextension', 'other'],
  [null, '.mp4', 'other'],
  ['application/x-something', 'thing.xyz', 'other'],
  ['VIDEO/MP4', 'UPPER.MP4', 'video'],
  ['  audio/aac  ', 'x', 'audio'],
];

describe('fileTypeOf', () => {
  test('has 40 rows', () => assert.equal(TABLE.length, 40));
  for (const [mime, name, expected] of TABLE) {
    test(`${String(mime)} + ${name} → ${expected}`, () => {
      assert.equal(fileTypeOf(mime, name), expected);
    });
  }

  test('a specific MIME wins over a misleading extension', () => {
    assert.equal(fileTypeOf('audio/mpeg', 'song.mp4'), 'audio');
  });
});

describe('extensionOf', () => {
  test('cases', () => {
    assert.equal(extensionOf('a.b.MP4'), 'mp4');
    assert.equal(extensionOf('noext'), '');
    assert.equal(extensionOf('.mp4'), '');
    assert.equal(extensionOf('trailing.'), '');
    assert.equal(extensionOf('  spaced.mkv  '), 'mkv');
  });
});
