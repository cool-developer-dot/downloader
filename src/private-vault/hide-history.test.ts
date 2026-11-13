import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { PLAYBACK_LOCAL_NAMESPACE, PLAYBACK_STORAGE_KEY_PREFIX } from '@/playback/constants';

import { hideHistoryPlan, playbackKeysFor } from './hide-history';
import { normalizeVaultItem } from './vault-index';

describe('hide-history filters', () => {
  test('the move forgets the stored position (Watch History, Continue Watching, resume) and refreshes the lists', () => {
    assert.deepEqual(hideHistoryPlan('dl_1', [PLAYBACK_LOCAL_NAMESPACE]), {
      playback: [{ namespace: PLAYBACK_LOCAL_NAMESPACE, mediaId: 'dl_1' }],
      refreshPlaybackLists: true,
    });
    assert.deepEqual(hideHistoryPlan('', [PLAYBACK_LOCAL_NAMESPACE]), { playback: [], refreshPlaybackLists: false });
    assert.equal(hideHistoryPlan('dl_1', ['local', 'local', '']).playback.length, 1);
  });

  test('only the stored keys of that exact video are picked, in any namespace', () => {
    const keys = [
      `${PLAYBACK_STORAGE_KEY_PREFIX}:local:dl_1`,
      `${PLAYBACK_STORAGE_KEY_PREFIX}:legacy-user:dl_1`,
      `${PLAYBACK_STORAGE_KEY_PREFIX}:local:dl_10`,
      `${PLAYBACK_STORAGE_KEY_PREFIX}:local:xdl_1`,
      `other.prefix:local:dl_1`,
      `${PLAYBACK_STORAGE_KEY_PREFIX}:dl_1`,
    ];
    assert.deepEqual(playbackKeysFor(keys, 'dl_1', PLAYBACK_STORAGE_KEY_PREFIX), [
      { namespace: 'local', mediaId: 'dl_1' },
      { namespace: 'legacy-user', mediaId: 'dl_1' },
    ]);
  });

  test('a vault item keeps nothing that links it back to the library, a page or a site', () => {
    const item = normalizeVaultItem({
      id: '0b2c4e6a-1111-4a2b-8c3d-000000000001',
      title: 'Clip',
      mimeType: 'video/mp4',
      durationMs: 1,
      sizeBytes: 2,
      width: null,
      height: null,
      createdAt: 3,
      addedAt: 4,
      hasThumbnail: false,
      libraryId: 'dl_1',
      pageUrl: 'https://example.com/watch?v=1',
      site: 'instagram',
      galleryUri: 'content://media/external/video/9',
    });
    assert.ok(item);
    for (const key of ['libraryId', 'pageUrl', 'site', 'galleryUri']) {
      assert.equal(key in item, false, key);
    }
  });
});
