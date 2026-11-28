import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pageFileName } from './page-file';

test('a page that is itself a file names it; a web page does not', () => {
  assert.equal(pageFileName('https://download.samplelib.com/wav/sample-3s.wav'), 'sample-3s.wav');
  assert.equal(pageFileName('https://x.org/a/clip.ogv?t=1#x'), 'clip.ogv');
  assert.equal(pageFileName('https://x.org/My%20Song.flac'), 'My Song.flac');
  assert.equal(pageFileName('https://x.org/index.html'), null);
  assert.equal(pageFileName('https://x.org/watch'), null);
  assert.equal(pageFileName('https://x.org/'), null);
  assert.equal(pageFileName('file:///sdcard/a.wav'), null);
  assert.equal(pageFileName(null), null);
});
