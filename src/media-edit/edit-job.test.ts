import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { EditRequest, LibraryItem } from '@modules/vidorax-media/src/VidoraMedia.types';

import { createEditJob, editFailure, type EditJobState } from './edit-job';

const REQUEST: EditRequest = {
  sourceId: 'lib1',
  kind: 'mp4',
  video: 'copy',
  audio: 'aac',
  title: 'Clip (MP4)',
};

function coded(code: string): Error {
  return Object.assign(new Error(code), { code });
}

function harness(startEdit?: (request: EditRequest) => Promise<LibraryItem>) {
  const states: EditJobState[] = [];
  const timers: (() => void)[] = [];
  let progress: number | null = null;
  let cancels = 0;
  let resolveEdit: (item: LibraryItem) => void = () => {};
  let rejectEdit: (error: unknown) => void = () => {};
  const job = createEditJob({
    startEdit:
      startEdit ??
      (() =>
        new Promise<LibraryItem>((resolve, reject) => {
          resolveEdit = resolve;
          rejectEdit = reject;
        })),
    getProgress: () => progress,
    cancelEdit: async () => {
      cancels += 1;
      // The native side cancels and deletes the partial output; the running promise then rejects.
      rejectEdit(coded('ERR_CANCELLED'));
    },
    onChange: (state) => states.push(state),
    schedule: (run) => {
      timers.push(run);
      return timers.length;
    },
    clear: () => {
      timers.length = 0;
    },
  });
  return {
    job,
    states,
    tick: () => timers.splice(0).forEach((run) => run()),
    setProgress: (value: number | null) => {
      progress = value;
    },
    cancels: () => cancels,
    resolve: (id: string) => resolveEdit({ id } as LibraryItem),
    reject: (error: unknown) => rejectEdit(error),
  };
}

describe('edit job', () => {
  test('reports progress while it runs and the new item when done', async () => {
    const h = harness();
    const running = h.job.start(REQUEST);
    h.setProgress(0.4);
    h.tick();
    assert.deepEqual(h.job.state(), { phase: 'running', sourceId: 'lib1', kind: 'mp4', progress: 0.4 });
    h.setProgress(7);
    h.tick();
    const clamped = h.job.state();
    assert.equal(clamped.phase === 'running' ? clamped.progress : null, 1);
    h.resolve('new1');
    assert.deepEqual(await running, { phase: 'done', sourceId: 'lib1', kind: 'mp4', itemId: 'new1' });
  });

  test('one edit at a time: a second start is refused while the first runs', async () => {
    const h = harness();
    const first = h.job.start(REQUEST);
    const second = await h.job.start({ ...REQUEST, sourceId: 'lib2' });
    assert.deepEqual(second, { phase: 'failed', sourceId: 'lib2', kind: 'mp4', reason: 'busy' });
    assert.equal(h.job.state().phase, 'running');
    h.resolve('new1');
    await first;
  });

  test('cancel asks the native side once, stops polling, and ends as cancelled (nothing saved)', async () => {
    const h = harness();
    const running = h.job.start(REQUEST);
    h.job.cancel();
    h.job.cancel();
    assert.equal(h.cancels(), 1);
    assert.equal(h.job.state().phase, 'cancelling');
    assert.deepEqual(await running, { phase: 'cancelled', sourceId: 'lib1', kind: 'mp4' });
    // No late progress after a cancel.
    h.setProgress(0.9);
    h.tick();
    assert.equal(h.job.state().phase, 'cancelled');
  });

  test('cancel does nothing when no edit runs', () => {
    const h = harness();
    h.job.cancel();
    assert.equal(h.cancels(), 0);
    assert.deepEqual(h.job.state(), { phase: 'idle' });
  });

  test('a failure says why: no space, refused, busy, missing or failed', async () => {
    for (const [code, reason] of [
      ['ERR_NO_SPACE', 'no-space'],
      ['ERR_EDIT_REFUSED', 'refused'],
      ['ERR_INVALID_STATE', 'busy'],
      ['ERR_NOT_FOUND', 'missing'],
      ['ERR_STORAGE', 'failed'],
    ] as const) {
      const h = harness(async () => {
        throw coded(code);
      });
      assert.deepEqual(await h.job.start(REQUEST), { phase: 'failed', sourceId: 'lib1', kind: 'mp4', reason });
    }
    assert.equal(editFailure(new Error('plain')), 'failed');
  });

  test('after a finished job a new one may start; reset never interrupts a running one', async () => {
    const h = harness();
    const first = h.job.start(REQUEST);
    h.job.reset();
    assert.equal(h.job.state().phase, 'running');
    h.resolve('new1');
    await first;
    h.job.reset();
    assert.deepEqual(h.job.state(), { phase: 'idle' });
    const second = h.job.start(REQUEST);
    assert.equal(h.job.state().phase, 'running');
    h.resolve('new2');
    assert.equal((await second).phase, 'done');
  });
});
