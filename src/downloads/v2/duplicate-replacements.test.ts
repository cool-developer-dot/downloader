import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import type { DownloadStatus } from '@/api/types';

import {
  FORGET_AFTER_MS,
  MAX_DELETE_ATTEMPTS,
  settleReplacements,
  trackReplacement,
  useReplacementsStore,
  type ReplacementDeps,
} from './duplicate-replacements';

const NOW = 1_800_000_000_000;

function deps(overrides: Partial<ReplacementDeps> & { statuses?: Record<string, DownloadStatus> } = {}) {
  const deleted: string[] = [];
  const value: ReplacementDeps = {
    statusOf: (id) => overrides.statuses?.[id] ?? null,
    libraryHas: async () => false,
    oldExists: () => true,
    deleteOld: async (id) => {
      deleted.push(id);
      return true;
    },
    now: () => NOW,
    ...overrides,
  };
  return { value, deleted };
}

describe('H12 Replace: the old copy goes only after the new one completed', () => {
  beforeEach(() => useReplacementsStore.setState({ pending: {} }));

  test('the new copy completed: the old item is deleted once, then forgotten', async () => {
    trackReplacement('new', 'old', NOW);
    const { value, deleted } = deps({ statuses: { new: 'COMPLETED' } });
    await settleReplacements(value);
    await settleReplacements(value);
    assert.deepEqual(deleted, ['old']);
    assert.deepEqual(useReplacementsStore.getState().pending, {});
  });

  test('still downloading, queued or paused: nothing happens yet', async () => {
    trackReplacement('new', 'old', NOW);
    for (const status of ['QUEUED', 'DOWNLOADING', 'PAUSED'] as const) {
      const { value, deleted } = deps({ statuses: { new: status } });
      await settleReplacements(value);
      assert.deepEqual(deleted, [], status);
    }
    assert.ok(useReplacementsStore.getState().pending.new);
  });

  test('the new copy failed or was cancelled: the old item stays', async () => {
    trackReplacement('a', 'old-a', NOW);
    trackReplacement('b', 'old-b', NOW);
    const { value, deleted } = deps({ statuses: { a: 'FAILED', b: 'CANCELLED' } });
    await settleReplacements(value);
    assert.deepEqual(deleted, []);
    assert.deepEqual(useReplacementsStore.getState().pending, {});
  });

  test('finished while the app was closed (record pruned, library item there): the old item is deleted', async () => {
    trackReplacement('new', 'old', NOW);
    const { value, deleted } = deps({ libraryHas: async (id) => id === 'new' });
    await settleReplacements(value);
    assert.deepEqual(deleted, ['old']);
  });

  test('a new copy removed before it finished is forgotten after a while, the old item untouched', async () => {
    trackReplacement('new', 'old', NOW - FORGET_AFTER_MS - 1);
    trackReplacement('recent', 'old2', NOW);
    const { value, deleted } = deps();
    await settleReplacements(value);
    assert.deepEqual(deleted, []);
    assert.deepEqual(Object.keys(useReplacementsStore.getState().pending), ['recent']);
  });

  test('an old item the user already deleted is not deleted again', async () => {
    trackReplacement('new', 'old', NOW);
    const { value, deleted } = deps({ statuses: { new: 'COMPLETED' }, oldExists: () => false });
    await settleReplacements(value);
    assert.deepEqual(deleted, []);
    assert.deepEqual(useReplacementsStore.getState().pending, {});
  });

  test('a delete that fails is tried again a few times, then left alone', async () => {
    trackReplacement('new', 'old', NOW);
    let tries = 0;
    const { value } = deps({
      statuses: { new: 'COMPLETED' },
      deleteOld: async () => {
        tries += 1;
        return false;
      },
    });
    for (let i = 0; i < MAX_DELETE_ATTEMPTS + 2; i += 1) {
      await settleReplacements(value);
    }
    assert.equal(tries, MAX_DELETE_ATTEMPTS);
    assert.deepEqual(useReplacementsStore.getState().pending, {});
  });

  test('a replacement of itself, or without ids, is never tracked', () => {
    trackReplacement('same', 'same', NOW);
    trackReplacement('', 'old', NOW);
    trackReplacement('new', '', NOW);
    assert.deepEqual(useReplacementsStore.getState().pending, {});
  });
});
