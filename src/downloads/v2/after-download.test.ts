import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  createAfterDownloadController,
  mostRecentCompletion,
  normalizeAfterDownloadAction,
  planAfterDownload,
  SETTLE_MS,
  type AfterDownloadAction,
} from './after-download';

function harness(options: { action?: AfterDownloadAction; foreground?: boolean; autoSave?: boolean } = {}) {
  const calls: string[] = [];
  let timers: { run: () => void; ms: number }[] = [];
  const state = {
    action: options.action ?? 'details',
    foreground: options.foreground ?? true,
    autoSave: options.autoSave ?? false,
  };
  const controller = createAfterDownloadController({
    getAction: () => state.action,
    isForeground: () => state.foreground,
    autoSaveToGallery: () => state.autoSave,
    openDetails: (id) => calls.push(`details:${id}`),
    play: (id) => calls.push(`play:${id}`),
    saveToGallery: async (id) => void calls.push(`gallery:${id}`),
    schedule: (run, ms) => {
      const timer = { run, ms };
      timers.push(timer);
      return timer;
    },
    cancel: (handle) => {
      timers = timers.filter((t) => t !== handle);
    },
  });
  const fire = async () => {
    const due = timers;
    timers = [];
    for (const timer of due) {
      timer.run();
    }
    await Promise.resolve();
  };
  return { controller, calls, state, fire, pendingTimers: () => timers.length };
}

describe('planAfterDownload', () => {
  const two = [{ id: 'a', completedAt: 10 }, { id: 'b', completedAt: 20 }];

  test('none does nothing', () => {
    assert.deepEqual(planAfterDownload({ action: 'none', completions: two, foreground: true, autoSaveToGallery: false }), []);
  });

  test('open and play act on the most recent only, and only in the foreground', () => {
    assert.deepEqual(planAfterDownload({ action: 'details', completions: two, foreground: true, autoSaveToGallery: false }), [
      { kind: 'details', id: 'b' },
    ]);
    assert.deepEqual(planAfterDownload({ action: 'play', completions: two, foreground: true, autoSaveToGallery: false }), [
      { kind: 'play', id: 'b' },
    ]);
    assert.deepEqual(planAfterDownload({ action: 'play', completions: two, foreground: false, autoSaveToGallery: false }), []);
    assert.deepEqual(planAfterDownload({ action: 'details', completions: two, foreground: false, autoSaveToGallery: false }), []);
  });

  test('gallery exports each one, never when Save to Gallery already does', () => {
    assert.deepEqual(planAfterDownload({ action: 'gallery', completions: two, foreground: false, autoSaveToGallery: false }), [
      { kind: 'gallery', id: 'a' },
      { kind: 'gallery', id: 'b' },
    ]);
    assert.deepEqual(planAfterDownload({ action: 'gallery', completions: two, foreground: true, autoSaveToGallery: true }), []);
  });
});

describe('helpers', () => {
  test('mostRecentCompletion picks the latest, the last reported on a tie', () => {
    assert.equal(mostRecentCompletion([]), null);
    assert.equal(mostRecentCompletion([{ id: 'x', completedAt: 5 }, { id: 'y', completedAt: 5 }])?.id, 'y');
    assert.equal(mostRecentCompletion([{ id: 'x', completedAt: 9 }, { id: 'y', completedAt: 5 }])?.id, 'x');
  });

  test('unknown stored values fall back to "none"', () => {
    assert.equal(normalizeAfterDownloadAction('play'), 'play');
    assert.equal(normalizeAfterDownloadAction('explode'), 'none');
    assert.equal(normalizeAfterDownloadAction(undefined), 'none');
  });
});

describe('createAfterDownloadController', () => {
  test('the default holds no timer and does nothing', async () => {
    const h = harness({ action: 'none' });
    h.controller.onCompleted({ id: 'a', completedAt: 1 });
    assert.equal(h.pendingTimers(), 0);
    await h.fire();
    assert.deepEqual(h.calls, []);
  });

  test('completions settle together; only the newest is opened', async () => {
    const h = harness({ action: 'details' });
    h.controller.onCompleted({ id: 'a', completedAt: 1 });
    h.controller.onCompleted({ id: 'b', completedAt: 2 });
    assert.equal(h.pendingTimers(), 1);
    await h.fire();
    assert.deepEqual(h.calls, ['details:b']);
  });

  test('the settle window is the documented one', () => {
    const h = harness();
    let scheduledMs = -1;
    const controller = createAfterDownloadController({
      getAction: () => 'play',
      isForeground: () => true,
      autoSaveToGallery: () => false,
      openDetails: () => {},
      play: () => {},
      saveToGallery: () => {},
      schedule: (_run, ms) => {
        scheduledMs = ms;
        return 1;
      },
      cancel: () => {},
    });
    controller.onCompleted({ id: 'a', completedAt: 1 });
    assert.equal(scheduledMs, SETTLE_MS);
    h.controller.dispose();
  });

  test('a repeated completed event never acts twice', async () => {
    const h = harness({ action: 'play' });
    h.controller.onCompleted({ id: 'a', completedAt: 1 });
    await h.fire();
    h.controller.onCompleted({ id: 'a', completedAt: 1 });
    await h.fire();
    assert.deepEqual(h.calls, ['play:a']);
  });

  test('backgrounded when the batch settles: nothing opens', async () => {
    const h = harness({ action: 'play' });
    h.controller.onCompleted({ id: 'a', completedAt: 1 });
    h.state.foreground = false;
    await h.fire();
    assert.deepEqual(h.calls, []);
  });

  test('gallery runs in the background too, and is skipped when auto-save is on', async () => {
    const h = harness({ action: 'gallery', foreground: false });
    h.controller.onCompleted({ id: 'a', completedAt: 1 });
    await h.fire();
    assert.deepEqual(h.calls, ['gallery:a']);

    const auto = harness({ action: 'gallery', autoSave: true });
    auto.controller.onCompleted({ id: 'b', completedAt: 1 });
    await auto.fire();
    assert.deepEqual(auto.calls, []);
  });

  test('a failing action or export never throws', async () => {
    const controller = createAfterDownloadController({
      getAction: () => 'gallery',
      isForeground: () => true,
      autoSaveToGallery: () => false,
      openDetails: () => {},
      play: () => {},
      saveToGallery: async () => {
        throw new Error('ERR_STORAGE_PERMISSION');
      },
      schedule: (run) => {
        run();
        return 1;
      },
      cancel: () => {},
    });
    assert.doesNotThrow(() => controller.onCompleted({ id: 'a', completedAt: 1 }));
    await Promise.resolve();
  });

  test('dispose drops a pending batch', async () => {
    const h = harness({ action: 'details' });
    h.controller.onCompleted({ id: 'a', completedAt: 1 });
    h.controller.dispose();
    await h.fire();
    assert.deepEqual(h.calls, []);
  });
});
