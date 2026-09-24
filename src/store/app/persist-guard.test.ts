import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { hydrationGuardedStorage } from './persist-guard';

type Slice = { onboardingComplete: boolean };

function baseStorage() {
  const writes: string[] = [];
  let stored: unknown = { state: { onboardingComplete: true }, version: 0 };
  return {
    writes,
    storage: {
      getItem: () => stored as never,
      setItem: (name: string, value: unknown) => {
        writes.push(name);
        stored = value;
      },
      removeItem: () => {
        stored = null;
      },
    },
    read: () => stored,
  };
}

describe('app store persistence', () => {
  test('nothing is written before the persisted state has been read', () => {
    const base = baseStorage();
    const guarded = hydrationGuardedStorage<Slice>(base.storage as never);

    guarded.storage.setItem('vidorax.app', { state: { onboardingComplete: false }, version: 0 } as never);

    assert.deepEqual(base.writes, [], 'a pre-hydration write would erase the real value');
    assert.deepEqual(base.read(), { state: { onboardingComplete: true }, version: 0 });
  });

  test('writes go through once hydration has happened', () => {
    const base = baseStorage();
    const guarded = hydrationGuardedStorage<Slice>(base.storage as never);
    guarded.onHydrated();

    guarded.storage.setItem('vidorax.app', { state: { onboardingComplete: false }, version: 0 } as never);

    assert.deepEqual(base.writes, ['vidorax.app']);
    assert.deepEqual(base.read(), { state: { onboardingComplete: false }, version: 0 });
  });
});
