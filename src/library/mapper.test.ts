import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { normalizeThumbnailUri } from './mapper';

describe('library thumbnails', () => {
  test("VidoraX's own generated thumbnail is shown", () => {
    const uri = 'file:///data/user/0/com.anonymous.vidorax/files/thumbs/8ac3-91f2.webp';
    assert.equal(normalizeThumbnailUri(uri), uri);
  });

  test('a remote thumbnail is still shown', () => {
    assert.equal(
      normalizeThumbnailUri('https://cdn.example.test/thumb.jpg'),
      'https://cdn.example.test/thumb.jpg',
    );
  });

  test('any other local file is refused', () => {
    assert.equal(normalizeThumbnailUri('file:///data/user/0/com.anonymous.vidorax/files/library/web/clip.mp4'), null);
    assert.equal(normalizeThumbnailUri('file:///sdcard/Download/evil.webp'), null);
    assert.equal(normalizeThumbnailUri('http://host/data/thumb.jpg'), null);
    assert.equal(normalizeThumbnailUri(''), null);
    assert.equal(normalizeThumbnailUri(null), null);
  });
});
