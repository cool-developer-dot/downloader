import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isFinalFailure, resolveDownloadRuntimeActions } from './runtime-actions';

describe('Retry is offered only when retrying can change the outcome', () => {
  test('a transient or expired failure keeps Retry', () => {
    for (const errorCode of ['NETWORK', 'HTTP_ERROR', 'HTTP_403', 'SOURCE_EXPIRED', 'HTTP_404', 'NOT_MEDIA', null]) {
      assert.equal(resolveDownloadRuntimeActions({ status: 'FAILED', errorCode }).canRetry, true, String(errorCode));
    }
  });

  test('a protected or unsupported source has no Retry', () => {
    for (const errorCode of ['DRM_PROTECTED', 'LIVE_UNSUPPORTED', 'UNSUPPORTED_FORMAT', 'hls_encrypted']) {
      assert.equal(resolveDownloadRuntimeActions({ status: 'FAILED', errorCode }).canRetry, false, errorCode);
      assert.equal(isFinalFailure(errorCode), true);
    }
  });

  test('a duplicate has no Retry: the video is already saved', () => {
    assert.equal(resolveDownloadRuntimeActions({ status: 'FAILED', errorCode: 'DUPLICATE' }).canRetry, false);
    assert.equal(isFinalFailure('DUPLICATE'), true);
  });

  test('the error code never changes a row that has not failed', () => {
    const paused = resolveDownloadRuntimeActions({ status: 'PAUSED', errorCode: 'DRM_PROTECTED' });
    assert.equal(paused.canResume, true);
  });
});
