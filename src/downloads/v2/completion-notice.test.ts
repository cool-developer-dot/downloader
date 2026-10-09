import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { COMPLETION_NOTICE_COALESCE_MS, createCompletionNotifier } from './completion-notice';

describe('"Video downloaded" notice', () => {
  test('shows for a completion while the app is in front', () => {
    const notifier = createCompletionNotifier();
    assert.equal(notifier.claim({ downloadId: 'a', appState: 'active', playable: true, now: 0 }), true);
  });

  test('never repeats for the same download', () => {
    const notifier = createCompletionNotifier();
    assert.equal(notifier.claim({ downloadId: 'a', appState: 'active', playable: true, now: 0 }), true);
    assert.equal(notifier.claim({ downloadId: 'a', appState: 'active', playable: true, now: 60_000 }), false);
  });

  test('a completion in the background is left to the system notification, also after returning', () => {
    const notifier = createCompletionNotifier();
    assert.equal(notifier.claim({ downloadId: 'a', appState: 'background', playable: true, now: 0 }), false);
    assert.equal(notifier.claim({ downloadId: 'a', appState: 'active', playable: true, now: 10_000 }), false);
  });

  test('a burst of completions shows one notice', () => {
    const notifier = createCompletionNotifier();
    assert.equal(notifier.claim({ downloadId: 'a', appState: 'active', playable: true, now: 0 }), true);
    assert.equal(notifier.claim({ downloadId: 'b', appState: 'active', playable: true, now: 800 }), false);
    assert.equal(
      notifier.claim({ downloadId: 'c', appState: 'active', playable: true, now: COMPLETION_NOTICE_COALESCE_MS + 1 }),
      true,
    );
  });

  test('nothing is announced for a completion without a verified file', () => {
    const notifier = createCompletionNotifier();
    assert.equal(notifier.claim({ downloadId: 'a', appState: 'active', playable: false, now: 0 }), false);
    // Once its file exists the same id may still be announced.
    assert.equal(notifier.claim({ downloadId: 'a', appState: 'active', playable: true, now: 1 }), true);
  });

  test('remembers a bounded number of ids', () => {
    const notifier = createCompletionNotifier();
    for (let i = 0; i < 500; i += 1) {
      notifier.claim({ downloadId: `id-${i}`, appState: 'background', playable: true, now: i });
    }
    // The oldest ids were forgotten; the newest are still known.
    assert.equal(notifier.claim({ downloadId: 'id-499', appState: 'active', playable: true, now: 10_000 }), false);
    assert.equal(notifier.claim({ downloadId: 'id-0', appState: 'active', playable: true, now: 20_000 }), true);
  });
});
