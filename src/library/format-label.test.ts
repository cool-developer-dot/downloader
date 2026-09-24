import assert from 'node:assert/strict';
import { test } from 'node:test';

import { libraryFormatLabel } from './format-label.ts';

test('a library row names the container its file really is', () => {
  assert.equal(libraryFormatLabel('video/mp4'), 'MP4');
  assert.equal(libraryFormatLabel('video/webm'), 'WebM');
  assert.equal(libraryFormatLabel('video/mp2t'), 'TS');
  assert.equal(libraryFormatLabel('video/mp2ts'), 'TS');
});

test('a QuickTime file reads MOV, never MP4', () => {
  assert.equal(libraryFormatLabel('video/quicktime'), 'MOV');
});

test('the other downloadable containers have their own labels', () => {
  assert.equal(libraryFormatLabel('video/x-msvideo'), 'AVI');
  assert.equal(libraryFormatLabel('video/x-ms-wmv'), 'WMV');
  assert.equal(libraryFormatLabel('video/x-matroska'), 'MKV');
  assert.equal(libraryFormatLabel('video/3gpp'), '3GP');
  assert.equal(libraryFormatLabel('audio/mp4'), 'M4A');
});

test('parameters and case do not matter; unknown types get no label', () => {
  assert.equal(libraryFormatLabel('Video/WebM; codecs="vp9, opus"'), 'WebM');
  assert.equal(libraryFormatLabel('application/octet-stream'), null);
  assert.equal(libraryFormatLabel(null), null);
  assert.equal(libraryFormatLabel(''), null);
});
