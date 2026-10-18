import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createAfterDownloadController, STALE_MS, type AfterDownloadAction } from './after-download';

function harness(action: AfterDownloadAction) {
  const calls: string[] = [];
  let clock = 1_000;
  let due: (() => void) | null = null;
  const controller = createAfterDownloadController({
    getAction: () => action,
    isForeground: () => true,
    autoSaveToGallery: () => false,
    openDetails: (id) => calls.push(`details:${id}`),
    play: (id) => calls.push(`play:${id}`),
    saveToGallery: (id) => void calls.push(`gallery:${id}`),
    schedule: (run) => {
      due = run;
      return 1;
    },
    cancel: () => {
      due = null;
    },
    now: () => clock,
  });
  return {
    controller,
    calls,
    advance: (ms: number) => {
      clock += ms;
    },
    fire: () => {
      const run = due;
      due = null;
      run?.();
    },
  };
}

describe('after download (audit)', () => {
  test('a batch acted on late (app was in the background) never opens or plays', () => {
    for (const action of ['details', 'play'] as const) {
      const h = harness(action);
      h.controller.onCompleted({ id: 'a', completedAt: 1 });
      h.advance(STALE_MS + 1);
      h.fire();
      assert.deepEqual(h.calls, [], action);
    }
  });

  test('on time it still opens', () => {
    const h = harness('details');
    h.controller.onCompleted({ id: 'a', completedAt: 1 });
    h.advance(1_500);
    h.fire();
    assert.deepEqual(h.calls, ['details:a']);
  });

  test('a late batch still saves to the gallery', async () => {
    const h = harness('gallery');
    h.controller.onCompleted({ id: 'a', completedAt: 1 });
    h.advance(60_000);
    h.fire();
    await Promise.resolve();
    assert.deepEqual(h.calls, ['gallery:a']);
  });
});
