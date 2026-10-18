import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import { setV2EngineForTests, type V2EnginePort } from './engine-port';
import {
  detachProgressStatsForTests,
  ensureV2ProgressStats,
  getProgressStats,
  MAX_TRACKED,
  recordProgressEvent,
  resetProgressStatsForTests,
} from './progress-stats-store';

function fakeEngine() {
  const active = new Set<string>();
  let next = 0;
  const port = {
    addListener: (name: string) => {
      const key = `${name}#${(next += 1)}`;
      active.add(key);
      return { remove: () => void active.delete(key) };
    },
  } as unknown as V2EnginePort;
  return { port, active };
}

afterEach(() => {
  resetProgressStatsForTests();
  setV2EngineForTests(null);
  detachProgressStatsForTests();
});

describe('progress stats store (audit)', () => {
  test('listeners are added once, and a Fast Refresh replaces them instead of adding more', () => {
    const { port, active } = fakeEngine();
    setV2EngineForTests(port);
    ensureV2ProgressStats();
    ensureV2ProgressStats();
    assert.equal(active.size, 2);
    detachProgressStatsForTests(); // what re-running the module does to `attached`
    ensureV2ProgressStats();
    assert.equal(active.size, 2);
  });

  test('without the native module nothing is attached', () => {
    ensureV2ProgressStats();
    assert.equal(getProgressStats('x'), null);
  });

  test('the stats map is bounded; the oldest download goes first', () => {
    for (let i = 0; i < MAX_TRACKED + 10; i += 1) {
      recordProgressEvent({ id: `d${i}`, phase: 'download', bytesDone: 1, speedBps: 1 }, 1000);
    }
    assert.equal(getProgressStats('d0'), null);
    assert.ok(getProgressStats(`d${MAX_TRACKED + 9}`));
  });
});
