import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { SAVE_DATA_HEADERS, webViewSourceFor } from './source-headers.ts';

describe('B18 Save-Data header merged with Do Not Track (WebView source)', () => {
  const uri = 'https://example.com/page';

  test('neither: exactly today\'s source, with no headers key', () => {
    const source = webViewSourceFor(uri, { doNotTrack: false, saveData: false });
    assert.deepEqual(source, { uri });
    assert.ok(!('headers' in source));
  });

  test('Do Not Track only: the B12 headers, unchanged', () => {
    assert.deepEqual(webViewSourceFor(uri, { doNotTrack: true, saveData: false }), {
      uri,
      headers: { DNT: '1', 'Sec-GPC': '1' },
    });
  });

  test('Save-Data only', () => {
    assert.deepEqual(webViewSourceFor(uri, { doNotTrack: false, saveData: true }), {
      uri,
      headers: { 'Save-Data': 'on' },
    });
  });

  test('both: merged into one headers object', () => {
    assert.deepEqual(webViewSourceFor(uri, { doNotTrack: true, saveData: true }), {
      uri,
      headers: { DNT: '1', 'Sec-GPC': '1', 'Save-Data': 'on' },
    });
  });

  test('the shared header constants are never modified', () => {
    const source = webViewSourceFor(uri, { doNotTrack: true, saveData: true });
    source.headers!.DNT = '0';
    assert.deepEqual(SAVE_DATA_HEADERS, { 'Save-Data': 'on' });
    assert.deepEqual(webViewSourceFor(uri, { doNotTrack: true, saveData: false }).headers, { DNT: '1', 'Sec-GPC': '1' });
  });
});
