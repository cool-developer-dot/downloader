import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { DEFAULT_NETWORK_OPTIONS } from './network-options';
import {
  ensureNetworkHeadersHydrated,
  getNetworkOptionsInput,
  setNetworkHeadersStorageForTests,
  subscribeNetworkOptions,
  useNetworkOptionsStore,
  type HeadersStorage,
} from './network-options-store';

function fakeStorage(initial: string | null = null) {
  let value = initial;
  const log: string[] = [];
  let pendingRead: Promise<void> | null = null;
  const storage: HeadersStorage & { log: string[]; value: () => string | null; holdReads: () => () => void } = {
    log,
    value: () => value,
    holdReads: () => {
      let release: () => void = () => {};
      pendingRead = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    read: async () => {
      if (pendingRead) {
        await pendingRead;
      }
      log.push('read');
      return value;
    },
    write: async (next) => {
      log.push('write');
      value = next;
    },
    remove: async () => {
      log.push('remove');
      value = null;
    },
  };
  return storage;
}

beforeEach(() => {
  useNetworkOptionsStore.setState({ ...DEFAULT_NETWORK_OPTIONS, headersHydrated: false });
});

afterEach(() => {
  setNetworkHeadersStorageForTests(null);
});

describe('headers in the secure store', () => {
  test('headers are read once and re-validated', async () => {
    const storage = fakeStorage(JSON.stringify([{ name: 'X-A', value: '1' }, { name: 'Cookie', value: 'x' }]));
    setNetworkHeadersStorageForTests(storage);
    await ensureNetworkHeadersHydrated();
    await ensureNetworkHeadersHydrated();
    assert.deepEqual(useNetworkOptionsStore.getState().headers, [{ name: 'X-A', value: '1' }]);
    assert.equal(storage.log.filter((entry) => entry === 'read').length, 1);
  });

  test('adding writes the list; clearing removes the secure entry', async () => {
    const storage = fakeStorage();
    setNetworkHeadersStorageForTests(storage);
    useNetworkOptionsStore.getState().setHeaders([{ name: 'X-A', value: '1' }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(JSON.parse(storage.value()!), [{ name: 'X-A', value: '1' }]);
    useNetworkOptionsStore.getState().setHeaders([]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(storage.value(), null);
    assert.deepEqual(storage.log, ['write', 'remove']);
  });

  test('a change made while the stored headers are being read wins', async () => {
    const storage = fakeStorage(JSON.stringify([{ name: 'X-Old', value: '1' }]));
    setNetworkHeadersStorageForTests(storage);
    const release = storage.holdReads();
    const hydrating = ensureNetworkHeadersHydrated();
    useNetworkOptionsStore.getState().setHeaders([{ name: 'X-New', value: '2' }]);
    release();
    await hydrating;
    assert.deepEqual(useNetworkOptionsStore.getState().headers, [{ name: 'X-New', value: '2' }]);
  });

  test('Reset returns every option to today\'s behaviour and removes the headers', async () => {
    const storage = fakeStorage(JSON.stringify([{ name: 'X-A', value: '1' }]));
    setNetworkHeadersStorageForTests(storage);
    const store = useNetworkOptionsStore.getState();
    store.setUserAgentMode('custom');
    store.setCustomUserAgent('A/1');
    store.setTimeoutChoice('60');
    store.reset();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const input = getNetworkOptionsInput();
    assert.deepEqual(input, DEFAULT_NETWORK_OPTIONS);
    assert.equal(storage.value(), null);
  });
});

describe('push subscription', () => {
  test('fires on a network change only, and a second subscription replaces the first (Fast Refresh)', async () => {
    setNetworkHeadersStorageForTests(fakeStorage());
    let first = 0;
    let second = 0;
    subscribeNetworkOptions(() => {
      first += 1;
    });
    const detach = subscribeNetworkOptions(() => {
      second += 1;
    });
    useNetworkOptionsStore.getState().setTimeoutChoice('30');
    useNetworkOptionsStore.setState({ headersHydrated: true });
    assert.equal(first, 0);
    assert.equal(second, 1);
    detach();
    useNetworkOptionsStore.getState().setTimeoutChoice('60');
    assert.equal(second, 1);
  });
});
