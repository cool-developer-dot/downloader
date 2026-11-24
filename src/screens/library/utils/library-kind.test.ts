import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { countByKind, isAudioItem, itemsOfKind } from './library-kind';

const item = (mimeType: string | null, fileName: string) => ({ mimeType, fileName });

describe('Player tab: Videos and Audio (design 18)', () => {
  test('audio by its MIME type, or by its extension when the type is missing', () => {
    assert.equal(isAudioItem(item('audio/mp4', 'song.m4a')), true);
    assert.equal(isAudioItem(item(null, 'Talk.MP3')), true);
    assert.equal(isAudioItem(item('application/octet-stream', 'x.flac')), true);
  });

  test('a video, or anything unknown, stays a video', () => {
    assert.equal(isAudioItem(item('video/mp4', 'clip.m4a')), false);
    assert.equal(isAudioItem(item(null, 'clip.mp4')), false);
    assert.equal(isAudioItem(item(null, 'noextension')), false);
  });

  test('the chips split the list, and the header counts both', () => {
    const all = [item('video/mp4', 'a.mp4'), item('audio/mpeg', 'b.mp3'), item(null, 'c.webm')];
    assert.deepEqual(itemsOfKind(all, 'video').map((i) => i.fileName), ['a.mp4', 'c.webm']);
    assert.deepEqual(itemsOfKind(all, 'audio').map((i) => i.fileName), ['b.mp3']);
    assert.deepEqual(countByKind(all), { videos: 2, audio: 1 });
  });
});
