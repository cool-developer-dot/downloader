import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { DownloadErrorCode } from '@modules/vidorax-media/src/VidoraMedia.types';

import { mediaEn } from '../localization/catalogs/media.en.ts';
import { actionErrorMessageKey, describeDownloadFailure } from './error-messages.ts';

const ALL_CODES: DownloadErrorCode[] = [
  'NETWORK',
  'HTTP_403',
  'HTTP_404',
  'HTTP_ERROR',
  'SOURCE_EXPIRED',
  'DRM_PROTECTED',
  'LIVE_UNSUPPORTED',
  'UNSUPPORTED_FORMAT',
  'NOT_MEDIA',
  'PROCESSING_FAILED',
  'NO_SPACE',
  'STORAGE_ERROR',
  'UNKNOWN',
];

function englishFor(key: string): unknown {
  const [namespace, ...path] = key.split('.');
  assert.equal(namespace, 'media');
  return path.reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], mediaEn);
}

describe('describeDownloadFailure', () => {
  test('every error code has its own English message', () => {
    const keys = ALL_CODES.map((code) => describeDownloadFailure(code).messageKey);
    assert.equal(new Set(keys).size, ALL_CODES.length);
    for (const key of keys) {
      assert.equal(typeof englishFor(key), 'string', key);
    }
  });

  test('an expired source asks to reopen the page instead of retrying', () => {
    assert.deepEqual(describeDownloadFailure('SOURCE_EXPIRED'), {
      messageKey: 'media.failure.expired',
      retryable: false,
      reopenPage: true,
    });
  });

  test('permanent refusals are not retryable', () => {
    for (const code of ['DRM_PROTECTED', 'LIVE_UNSUPPORTED', 'UNSUPPORTED_FORMAT'] as const) {
      assert.equal(describeDownloadFailure(code).retryable, false, code);
    }
    assert.equal(describeDownloadFailure('NETWORK').retryable, true);
  });

  test('missing or unrecognised codes fall back to the generic message', () => {
    assert.equal(describeDownloadFailure(null).messageKey, 'media.failure.unknown');
    assert.equal(
      describeDownloadFailure('SOMETHING_NEW' as DownloadErrorCode).messageKey,
      'media.failure.unknown',
    );
  });
});

test('actionErrorMessageKey maps contract rejection codes', () => {
  assert.equal(actionErrorMessageKey('ERR_STORAGE_PERMISSION'), 'media.errors.storagePermission');
  assert.equal(actionErrorMessageKey('ERR_NOT_FOUND'), 'media.errors.notFound');
  assert.equal(actionErrorMessageKey('ERR_RUNNER_START'), 'media.errors.runnerStart');
  assert.equal(actionErrorMessageKey(null), 'media.errors.generic');
  for (const code of ['ERR_STORAGE_PERMISSION', 'ERR_NOT_FOUND', 'ERR_RUNNER_START', null]) {
    assert.equal(typeof englishFor(actionErrorMessageKey(code)), 'string');
  }
});
