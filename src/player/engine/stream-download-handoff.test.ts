import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  hasStreamDownloadRequest,
  requestStreamDownload,
  subscribeStreamDownloadRequests,
  takeStreamDownloadRequest,
} from './stream-download-handoff.ts';

describe('P14 #672 stream download handoff', () => {
  it('keeps one request, runs it once, and tells listeners', () => {
    let heard = 0;
    const unsubscribe = subscribeStreamDownloadRequests(() => {
      heard += 1;
    });
    requestStreamDownload({ url: ' https://a.com/1.mp4 ', referer: ' ' });
    requestStreamDownload({ url: 'https://a.com/2.m3u8', referer: 'https://page.example/' });
    assert.equal(heard, 2);
    assert.equal(hasStreamDownloadRequest(), true);
    assert.deepEqual(takeStreamDownloadRequest(), { url: 'https://a.com/2.m3u8', referer: 'https://page.example/' });
    assert.equal(takeStreamDownloadRequest(), null);
    unsubscribe();
    requestStreamDownload({ url: 'https://a.com/3.mp4', referer: null });
    assert.equal(heard, 2);
    assert.deepEqual(takeStreamDownloadRequest(), { url: 'https://a.com/3.mp4', referer: null });
  });

  it('ignores an empty link', () => {
    requestStreamDownload({ url: '  ', referer: null });
    assert.equal(hasStreamDownloadRequest(), false);
  });
});
