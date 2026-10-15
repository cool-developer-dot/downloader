import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import { setV2EngineForTests, type V2EnginePort } from '@/downloads/v2/engine-port';

import { debugLog } from './debug-log';
import { isDebugLogRunning, startDebugLog, stopDebugLog } from './debug-log-sources';

function fakeEngine() {
  const active = new Set<number>();
  let next = 0;
  const port = {
    addListener: () => {
      const key = (next += 1);
      active.add(key);
      return { remove: () => void active.delete(key) };
    },
  } as unknown as V2EnginePort;
  return { port, active };
}

afterEach(() => {
  stopDebugLog();
  setV2EngineForTests(null);
});

describe('debug log sources (audit)', () => {
  test('starting twice subscribes once; stopping removes everything and empties the buffer', () => {
    const { port, active } = fakeEngine();
    setV2EngineForTests(port);
    startDebugLog();
    startDebugLog();
    assert.equal(isDebugLogRunning(), true);
    assert.equal(active.size, 1);
    assert.ok(debugLog.entries().length > 0);
    stopDebugLog();
    assert.equal(isDebugLogRunning(), false);
    assert.equal(active.size, 0);
    assert.equal(debugLog.entries().length, 0);
  });

  test('the buffer is shared through globalThis (Fast Refresh keeps it)', () => {
    const key = '__vidoraxDebugLogBuffer';
    assert.equal((globalThis as unknown as Record<string, unknown>)[key], debugLog);
  });
});
