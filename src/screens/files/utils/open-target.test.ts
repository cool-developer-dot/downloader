import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { FileType } from '@/files/ui/file-types';

import { openTargetOf, playableQueue } from './open-target';

const target = (fileType: FileType, fileName: string, mimeType: string | null = null) => openTargetOf({ fileType, fileName, mimeType });

describe('Files F1: tapping a file', () => {
  test('video and audio open the Player; a PDF the viewer; an APK its details (never an install)', () => {
    assert.equal(target('video', 'clip.mp4'), 'player');
    assert.equal(target('audio', 'song.mp3'), 'player');
    assert.equal(target('doc', 'guide.pdf'), 'pdf');
    assert.equal(target('doc', 'guide', 'application/pdf'), 'pdf');
    assert.equal(target('apk', 'app.apk'), 'apk-details');
  });

  test('images, other documents and anything unknown go to Android’s Open with; so does a ZIP for now', () => {
    assert.equal(target('image', 'photo.jpg'), 'open-with');
    assert.equal(target('doc', 'notes.docx'), 'open-with');
    assert.equal(target('other', 'data.bin'), 'open-with');
    // The archive import takes only a token for a file another app opened (no library id yet): see open-target.ts.
    assert.equal(target('archive', 'photos.zip'), 'open-with');
    assert.equal(target('archive', 'photos.rar'), 'open-with');
  });

  test('the Player’s queue is the list’s videos and audio, in the order shown', () => {
    assert.deepEqual(
      playableQueue([
        { id: 'a', fileType: 'video' },
        { id: 'b', fileType: 'doc' },
        { id: 'c', fileType: 'audio' },
      ]),
      ['a', 'c'],
    );
  });
});
