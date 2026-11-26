import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildFilesIndex, typeCountsOf } from '@/files/ui/files-index';
import { countByKind } from '@/screens/library/utils/library-kind';

import { buildTypeTiles, tileA11y, videoTileCount, videoTileFiles } from './type-tiles';

/** A mixed library: videos, audio by MIME type and by extension only, and files that are neither. */
const MIXED = [
  { id: 'v1', fileName: 'clip.mp4', mimeType: 'video/mp4' },
  { id: 'v2', fileName: 'talk.mkv', mimeType: null },
  { id: 'v3', fileName: 'live.mp3', mimeType: 'video/mp4' },
  { id: 'a1', fileName: 'song.mp3', mimeType: 'audio/mpeg' },
  { id: 'a2', fileName: 'voice.m4a', mimeType: null },
  { id: 'a3', fileName: 'track.OPUS', mimeType: 'application/octet-stream' },
  { id: 'i1', fileName: 'photo.jpg', mimeType: 'image/jpeg' },
  { id: 'd1', fileName: 'guide.pdf', mimeType: 'application/pdf' },
  { id: 'z1', fileName: 'photos.zip', mimeType: 'application/zip' },
  { id: 'p1', fileName: 'app.apk', mimeType: 'application/vnd.android.package-archive' },
  { id: 'o1', fileName: 'data', mimeType: null },
].map((item) => ({
  ...item,
  displayName: `Title ${item.id}`,
  fileSize: '1000',
  downloadedAt: null,
  folderId: null,
  thumbnailUri: null,
}));

/** One file of each FileType: video, audio, image, doc, archive, apk, other. */
const SEVEN_FILES = [
  { id: '1', fileName: 'clip.mp4', mimeType: 'video/mp4' },
  { id: '2', fileName: 'song.mp3', mimeType: 'audio/mpeg' },
  { id: '3', fileName: 'photo.jpg', mimeType: 'image/jpeg' },
  { id: '4', fileName: 'guide.pdf', mimeType: 'application/pdf' },
  { id: '5', fileName: 'photos.zip', mimeType: 'application/zip' },
  { id: '6', fileName: 'app.apk', mimeType: 'application/vnd.android.package-archive' },
  { id: '7', fileName: 'data.bin', mimeType: 'application/octet-stream' },
].map((item) => ({
  ...item,
  displayName: item.fileName,
  fileSize: '1000',
  downloadedAt: null,
  folderId: null,
  thumbnailUri: null,
}));

describe('Files F1 #753: the type tiles', () => {
  test('the Videos tile equals the Player tab video count on a mixed library, and lists the same files', () => {
    // The Player tab counts the library's items with countByKind; Files counts its own entries of the same items.
    const playerVideos = countByKind(MIXED).videos;
    const files = buildFilesIndex(MIXED, []).files;
    const videosTile = buildTypeTiles(typeCountsOf(files), videoTileCount(files)).find((tile) => tile.type === 'video');
    assert.equal(playerVideos, 8);
    assert.equal(videosTile?.count, playerVideos);
    assert.deepEqual(
      videoTileFiles(files).map((file) => file.id),
      ['v1', 'v2', 'v3', 'i1', 'd1', 'z1', 'p1', 'o1'],
    );
  });

  test('counts from 7 files, one of each type: every tile shows 1, and the unknown file has no tile', () => {
    const counts = typeCountsOf(buildFilesIndex(SEVEN_FILES, []).files);
    const tiles = buildTypeTiles(counts);
    assert.deepEqual(
      tiles.map((tile) => [tile.type, tile.count]),
      [
        ['video', 1],
        ['audio', 1],
        ['image', 1],
        ['doc', 1],
        ['archive', 1],
        ['apk', 1],
      ],
    );
    assert.equal(counts.other.count, 1);
    assert.equal(counts.video.bytes, 1000);
    // TalkBack: "Videos, 1 file".
    assert.deepEqual(tileA11y(tiles[0]!, 'Videos'), { key: 'fileManager.tileA11yOne', params: { label: 'Videos', count: 1 } });
  });

  test('zero counts: six tiles at 0, read as "Videos, 0 files"', () => {
    for (const counts of [typeCountsOf([]), null, undefined]) {
      const tiles = buildTypeTiles(counts);
      assert.equal(tiles.length, 6);
      assert.ok(tiles.every((tile) => tile.count === 0));
    }
    const tiles = buildTypeTiles(typeCountsOf([]));
    assert.deepEqual(tileA11y(tiles[0]!, 'Videos'), { key: 'fileManager.tileA11yOther', params: { label: 'Videos', count: 0 } });
  });
});
