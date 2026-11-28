import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { computeTypeCounts } from '@/files/engine/files-query';

import { countByKind, isAudioItem, itemsOfKind, playerQueueFor } from './library-kind';

const item = (mimeType: string | null, fileName: string) => ({ mimeType, fileName });

/** A library with one of everything the Files tab sorts into tiles, as the engine reads items. */
const MIXED = [
  ['v1', 'video/mp4', 'Trip.mp4'],
  ['a1', 'audio/mpeg', 'Song.mp3'],
  ['i1', 'image/jpeg', 'Photo.jpg'],
  ['v2', null, 'Clip.webm'],
  ['d1', 'application/pdf', 'Ticket.pdf'],
  ['z1', 'application/zip', 'Pack.zip'],
  ['k1', 'application/vnd.android.package-archive', 'App.apk'],
  ['a2', null, 'Talk.m4a'],
  ['o1', null, 'noextension'],
  ['i2', 'application/octet-stream', 'Scan.PNG'],
  ['v3', 'application/x-mpegurl', 'live.m3u8'],
].map(([id, mimeType, fileName]) => ({
  id: id!,
  mimeType,
  fileName: fileName!,
  displayName: fileName!,
  fileSize: '1',
  downloadedAt: null,
  folderId: null,
}));

describe('Player tab: Videos and Audio (design 18)', () => {
  test('audio by its MIME type, or by its extension when the type is missing', () => {
    assert.equal(isAudioItem(item('audio/mp4', 'song.m4a')), true);
    assert.equal(isAudioItem(item(null, 'Talk.MP3')), true);
    assert.equal(isAudioItem(item('application/octet-stream', 'x.flac')), true);
  });

  test('a video, or anything unknown, is not audio', () => {
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

describe('Player tab: only real videos are videos (Faran, 2026-11-28)', () => {
  test('the video count equals the Files Videos tile, and audio equals the Audio tile', () => {
    const tiles = computeTypeCounts(MIXED);
    assert.deepEqual(countByKind(MIXED), { videos: tiles.video.count, audio: tiles.audio.count });
    assert.deepEqual(countByKind(MIXED), { videos: 3, audio: 2 });
  });

  test('the Videos list is the counted videos: never a JPG, PNG, PDF, ZIP, APK or unknown file', () => {
    const videos = itemsOfKind(MIXED, 'video').map((entry) => entry.id);
    assert.deepEqual(videos, ['v1', 'v2', 'v3']);
    assert.equal(videos.length, countByKind(MIXED).videos);
    for (const id of ['i1', 'i2', 'd1', 'z1', 'k1', 'o1']) {
      assert.ok(!videos.includes(id), id);
    }
  });

  test('audio stays separate: the Audio list is the counted audio', () => {
    const audio = itemsOfKind(MIXED, 'audio').map((entry) => entry.id);
    assert.deepEqual(audio, ['a1', 'a2']);
    assert.equal(audio.length, countByKind(MIXED).audio);
  });

  test('Previous / Next in the Player step through the tapped item’s own list, never a picture or document', () => {
    assert.deepEqual(playerQueueFor('v2', MIXED), ['v1', 'v2', 'v3']);
    assert.deepEqual(playerQueueFor('a2', MIXED), ['a1', 'a2']);
    // An item that isn't in the list (Continue watching): every video and audio file shown, nothing else.
    assert.deepEqual(playerQueueFor('elsewhere', MIXED), ['v1', 'a1', 'v2', 'a2', 'v3']);
  });
});
