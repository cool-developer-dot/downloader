import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isWebPageAnalysis } from './format';

describe('A pasted link that answers with a web page goes to the page (browser) route', () => {
  test('an HTML answer is a page, whatever the site', () => {
    for (const mimeType of ['text/html', 'application/xhtml+xml']) {
      assert.equal(isWebPageAnalysis({ downloadable: false, unsupportedReason: 'NO_MEDIA', mimeType }), true, mimeType);
    }
  });

  test('media, other documents and other failures are not', () => {
    assert.equal(isWebPageAnalysis({ downloadable: true, unsupportedReason: null, mimeType: 'video/mp4' }), false);
    assert.equal(isWebPageAnalysis({ downloadable: false, unsupportedReason: 'NO_MEDIA', mimeType: 'application/json' }), false);
    assert.equal(isWebPageAnalysis({ downloadable: false, unsupportedReason: 'NO_MEDIA', mimeType: null }), false);
    assert.equal(isWebPageAnalysis({ downloadable: false, unsupportedReason: 'UNSUPPORTED_FORMAT', mimeType: 'text/html' }), false);
  });
});
