import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  cancelAllEngineDownloads,
  pauseAllEngineDownloads,
  resumeAllEngineDownloads,
  summarizeBulkActions,
  type BulkRow,
} from './bulk-actions';
import type { V2EnginePort } from './engine-port';

function engine(options: { withAll?: boolean; failCancel?: string[] } = {}): V2EnginePort & { calls: string[] } {
  const calls: string[] = [];
  const port: Record<string, unknown> = {
    calls,
    pause: async (id: string) => void calls.push(`pause:${id}`),
    resume: async (id: string) => void calls.push(`resume:${id}`),
    cancel: async (id: string) => {
      calls.push(`cancel:${id}`);
      if (options.failCancel?.includes(id)) {
        throw new Error('ERR_INVALID_STATE');
      }
    },
  };
  if (options.withAll) {
    port.pauseAll = async () => void calls.push('pauseAll');
    port.resumeAll = async () => void calls.push('resumeAll');
  }
  return port as unknown as V2EnginePort & { calls: string[] };
}

const ROWS: BulkRow[] = [
  { id: 'q', status: 'QUEUED', workerState: 'WAITING' },
  { id: 'd', status: 'DOWNLOADING', workerState: 'TRANSFERRING' },
  { id: 'proc', status: 'DOWNLOADING', workerState: 'VERIFYING' },
  { id: 'p', status: 'PAUSED', workerState: 'PAUSED' },
  { id: 'c', status: 'COMPLETED', workerState: 'COMPLETED' },
  { id: 'f', status: 'FAILED', workerState: 'FAILED' },
  { id: 'x', status: 'CANCELLED', workerState: 'CANCELLED' },
];

describe('summarizeBulkActions', () => {
  test('mirrors the engine: queued/downloading pause, paused resumes, non-terminal cancels', () => {
    const summary = summarizeBulkActions(ROWS);
    assert.deepEqual(summary.pausableIds, ['q', 'd']);
    assert.deepEqual(summary.resumableIds, ['p']);
    assert.deepEqual(summary.cancellableIds, ['q', 'd', 'proc', 'p']);
    assert.equal(summary.pauseRestartCount, 0);
  });

  test('nothing applies on an empty or finished-only list', () => {
    for (const rows of [[], ROWS.filter((r) => ['c', 'f', 'x'].includes(r.id))]) {
      const summary = summarizeBulkActions(rows);
      assert.deepEqual(summary, { pausableIds: [], resumableIds: [], cancellableIds: [], pauseRestartCount: 0 });
    }
  });

  test('counts only pausable rows that would restart', () => {
    const summary = summarizeBulkActions([
      { id: 'a', status: 'DOWNLOADING', pauseRestarts: true },
      { id: 'b', status: 'DOWNLOADING', pauseRestarts: false },
      { id: 'c', status: 'PAUSED', pauseRestarts: true },
      { id: 'd', status: 'DOWNLOADING', workerState: 'VERIFYING', pauseRestarts: true },
    ]);
    assert.equal(summary.pauseRestartCount, 1);
  });

  test('a duplicated or empty id is counted once', () => {
    const summary = summarizeBulkActions([
      { id: 'a', status: 'PAUSED' },
      { id: 'a', status: 'PAUSED' },
      { id: '', status: 'PAUSED' },
    ]);
    assert.deepEqual(summary.resumableIds, ['a']);
    assert.deepEqual(summary.cancellableIds, ['a']);
  });
});

describe('bulk engine calls', () => {
  test('pause/resume all use the engine’s own functions when present', async () => {
    const port = engine({ withAll: true });
    await pauseAllEngineDownloads(port, ['a', 'b']);
    await resumeAllEngineDownloads(port, ['c']);
    assert.deepEqual(port.calls, ['pauseAll', 'resumeAll']);
  });

  test('an older native build falls back to per-item pause/resume', async () => {
    const port = engine();
    await pauseAllEngineDownloads(port, ['a', 'b']);
    await resumeAllEngineDownloads(port, ['c']);
    assert.deepEqual(port.calls, ['pause:a', 'pause:b', 'resume:c']);
  });

  test('cancel all cancels each id in order and keeps going after a refusal', async () => {
    const port = engine({ failCancel: ['b'] });
    const outcome = await cancelAllEngineDownloads(port, ['a', 'b', 'c']);
    assert.deepEqual(port.calls, ['cancel:a', 'cancel:b', 'cancel:c']);
    assert.deepEqual(outcome, { done: ['a', 'c'], failed: ['b'] });
  });

  test('no engine is an error, never a silent no-op', async () => {
    await assert.rejects(pauseAllEngineDownloads(null, ['a']));
    await assert.rejects(resumeAllEngineDownloads(null, ['a']));
    await assert.rejects(cancelAllEngineDownloads(null, ['a']));
  });
});
