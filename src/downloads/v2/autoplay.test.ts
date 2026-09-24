import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import {
  claimAutoPlay,
  forgetAutoPlayTarget,
  markDownloadStarted,
  shouldAutoPlay,
} from './autoplay';

beforeEach(() => {
  forgetAutoPlayTarget();
});

describe('auto-play after a download finishes', () => {
  test('the download the user just started plays when the app is in front', () => {
    markDownloadStarted('dl-1');
    assert.equal(claimAutoPlay({ downloadId: 'dl-1', appState: 'active', playable: true }), 'dl-1');
  });

  test('a completion in the background never steals the screen', () => {
    markDownloadStarted('dl-1');
    assert.equal(claimAutoPlay({ downloadId: 'dl-1', appState: 'background', playable: true }), null);
  });

  test('an older download finishing does not interrupt anything', () => {
    markDownloadStarted('dl-2');
    assert.equal(claimAutoPlay({ downloadId: 'dl-1', appState: 'active', playable: true }), null);
  });

  test('one start plays once, however often the engine repeats the completion', () => {
    markDownloadStarted('dl-1');
    assert.equal(claimAutoPlay({ downloadId: 'dl-1', appState: 'active', playable: true }), 'dl-1');
    assert.equal(claimAutoPlay({ downloadId: 'dl-1', appState: 'active', playable: true }), null);
  });

  test('a completion with no playable file is not opened', () => {
    markDownloadStarted('dl-1');
    assert.equal(claimAutoPlay({ downloadId: 'dl-1', appState: 'active', playable: false }), null);
  });

  test('the decision itself is pure', () => {
    assert.equal(
      shouldAutoPlay({ downloadId: 'a', startedId: 'a', alreadyPlayed: false, appState: 'active', playable: true }),
      true,
    );
    assert.equal(
      shouldAutoPlay({ downloadId: 'a', startedId: null, alreadyPlayed: false, appState: 'active', playable: true }),
      false,
    );
  });
});
