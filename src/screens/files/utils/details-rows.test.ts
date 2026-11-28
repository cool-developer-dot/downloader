import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { exactBytes, formatLine, NO_TAGS, pathLine, pictureSize, tagsOf, wholeBytes } from './details-rows';

describe('Files F3 · design 56: the details rows', () => {
  test('the "MP4 · 640×356" line', () => {
    assert.equal(formatLine({ mimeType: 'video/mp4', fileName: 'clip.mp4', resolution: '640x356', audioOnly: false }), 'MP4 · 640×356');
    assert.equal(formatLine({ mimeType: 'video/quicktime', fileName: 'clip.mp4', resolution: '1920X1080', audioOnly: false }), 'MOV · 1920×1080');
    // No type recorded: the name's extension.
    assert.equal(formatLine({ mimeType: null, fileName: 'movie.mkv', resolution: '1280x720', audioOnly: false }), 'MKV · 1280×720');
  });

  test('an unknown resolution shows the container alone', () => {
    assert.equal(formatLine({ mimeType: 'video/mp4', fileName: 'clip.mp4', resolution: null, audioOnly: false }), 'MP4');
    assert.equal(formatLine({ mimeType: 'video/mp4', fileName: 'clip.mp4', resolution: '720p', audioOnly: false }), 'MP4');
    assert.equal(pictureSize('0x0'), null);
    assert.equal(formatLine({ mimeType: null, fileName: 'noext', resolution: null, audioOnly: false }), null);
  });

  test('an audio-only file never shows a picture size', () => {
    assert.equal(formatLine({ mimeType: 'audio/mpeg', fileName: 'song.mp3', resolution: '640x356', audioOnly: true }), 'MP3');
    assert.equal(formatLine({ mimeType: 'audio/mp4', fileName: 'talk.m4a', resolution: null, audioOnly: true }), 'M4A');
  });

  test('the exact bytes and the folder path', () => {
    assert.equal(exactBytes(1234567, 'en-US'), '1,234,567');
    assert.equal(exactBytes(-5, 'en-US'), '0');
    // The count for "1 byte" / "{bytes} bytes" is the same whole number that exactBytes shows.
    assert.equal(wholeBytes(1), 1);
    assert.equal(wholeBytes(1.9), 1);
    assert.equal(wholeBytes(Number.NaN), 0);
    assert.equal(exactBytes(1.9, 'en-US'), '1');
    assert.equal(pathLine('Files', ['Movies', '2026']), 'Files › Movies › 2026');
    assert.equal(pathLine('Files', []), 'Files');
  });

  test('an untagged file always reads the same empty list (a store selector must not make a new one)', () => {
    const tagsById = { a: ['work', 'trip'] };
    assert.deepEqual(tagsOf(tagsById, 'a'), ['work', 'trip']);
    assert.equal(tagsOf(tagsById, 'b'), NO_TAGS);
    assert.equal(tagsOf(tagsById, 'c'), tagsOf({}, 'd'));
    assert.equal(tagsOf(tagsById, null), NO_TAGS);
  });
});
