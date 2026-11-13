import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isMovingToPrivate, moveToPrivate, type MoveSource, type MoveToPrivateDeps } from './move-to-private';

const VAULT_ID = '0b2c4e6a-1111-4a2b-8c3d-000000000001';
const SOURCE: MoveSource = { id: 'dl_1', title: 'Clip', sizeBytes: 10, galleryUri: null };

function vaultItem() {
  return {
    id: VAULT_ID,
    title: 'Clip',
    mimeType: 'video/mp4',
    durationMs: 1000,
    sizeBytes: 10,
    width: null,
    height: null,
    createdAt: 1,
    addedAt: 2,
    hasThumbnail: false,
  };
}

function harness(overrides: Partial<MoveToPrivateDeps> & { originalAfterDelete?: 'gone' | 'there' | 'unknown' } = {}) {
  const calls: string[] = [];
  let deleted = false;
  const deps: MoveToPrivateDeps = {
    appLockEnabled: () => true,
    getItem: async (id) => {
      calls.push(`get:${id}`);
      if (!deleted) {
        return SOURCE;
      }
      if (overrides.originalAfterDelete === 'unknown') {
        throw new Error('library unavailable');
      }
      return overrides.originalAfterDelete === 'there' ? SOURCE : null;
    },
    isBusy: () => false,
    encrypt: async (id) => {
      calls.push(`encrypt:${id}`);
      return vaultItem();
    },
    deleteOriginal: async (id) => {
      calls.push(`delete:${id}`);
      deleted = true;
      return { ok: true };
    },
    removeFromVault: async (vaultId) => {
      calls.push(`remove-vault:${vaultId}`);
    },
    forgetHistory: (id) => {
      calls.push(`forget:${id}`);
    },
    ...overrides,
  };
  return { deps, calls };
}

describe('move to Private', () => {
  test('encrypts and verifies first, removes the original only then, and forgets its history last', async () => {
    const h = harness();
    const result = await moveToPrivate('dl_1', h.deps);
    assert.equal(result.ok, true);
    assert.deepEqual(h.calls, ['get:dl_1', 'encrypt:dl_1', 'delete:dl_1', 'forget:dl_1']);
    if (result.ok) {
      assert.equal(result.item.id, VAULT_ID);
    }
  });

  test('if encryption fails the original is untouched', async () => {
    const h = harness({
      encrypt: async () => {
        throw Object.assign(new Error('disk full'), { code: 'ERR_STORAGE' });
      },
    });
    assert.deepEqual(await moveToPrivate('dl_1', h.deps), { ok: false, reason: 'encrypt-failed' });
    assert.equal(h.calls.some((call) => call.startsWith('delete:')), false);
    assert.equal(h.calls.some((call) => call.startsWith('forget:')), false);
  });

  test('a malformed native answer counts as a failed encryption', async () => {
    const h = harness({ encrypt: async () => ({ id: 'not-a-vault-id' }) });
    assert.deepEqual(await moveToPrivate('dl_1', h.deps), { ok: false, reason: 'encrypt-failed' });
    assert.equal(h.calls.some((call) => call.startsWith('delete:')), false);
  });

  test('nothing private without App Lock', async () => {
    const h = harness({ appLockEnabled: () => false });
    assert.deepEqual(await moveToPrivate('dl_1', h.deps), { ok: false, reason: 'app-lock-off' });
    assert.deepEqual(h.calls, []);
  });

  test('App Lock turned off while encrypting: the copy is taken out and the original kept', async () => {
    let checks = 0;
    const h = harness({ appLockEnabled: () => (checks += 1) === 1 });
    assert.deepEqual(await moveToPrivate('dl_1', h.deps), { ok: false, reason: 'app-lock-off' });
    assert.deepEqual(h.calls, ['get:dl_1', 'encrypt:dl_1', `remove-vault:${VAULT_ID}`]);
  });

  test('re-checked right before acting: a deleted or busy item is not moved', async () => {
    const gone = harness({ getItem: async () => null });
    assert.deepEqual(await moveToPrivate('dl_1', gone.deps), { ok: false, reason: 'not-found' });
    const busy = harness({ isBusy: () => true });
    assert.deepEqual(await moveToPrivate('dl_1', busy.deps), { ok: false, reason: 'busy' });
    assert.equal(busy.calls.length, 0);
  });

  test('a second tap while moving is refused', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = harness({
      encrypt: async () => {
        await gate;
        return vaultItem();
      },
    });
    const first = moveToPrivate('dl_1', h.deps);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(isMovingToPrivate('dl_1'), true);
    assert.deepEqual(await moveToPrivate('dl_1', h.deps), { ok: false, reason: 'busy' });
    release();
    assert.equal((await first).ok, true);
    assert.equal(isMovingToPrivate('dl_1'), false);
  });

  test('the delete fails and the original is still there: the vault copy is taken back out', async () => {
    const h = harness({
      deleteOriginal: async () => ({ ok: false }),
      originalAfterDelete: 'there',
    });
    assert.deepEqual(await moveToPrivate('dl_1', h.deps), { ok: false, reason: 'original-not-removed' });
    assert.equal(h.calls.includes(`remove-vault:${VAULT_ID}`), true);
    assert.equal(h.calls.some((call) => call.startsWith('forget:')), false);
  });

  test('the delete reports a failure but the original is gone: the move is done, never lost', async () => {
    const h = harness({
      deleteOriginal: async () => {
        h.calls.push('delete:dl_1');
        throw new Error('notification dismiss failed');
      },
      getItem: async () => (h.calls.includes('delete:dl_1') ? null : SOURCE),
    });
    const result = await moveToPrivate('dl_1', h.deps);
    assert.equal(result.ok, true);
    assert.equal(h.calls.some((call) => call.startsWith('remove-vault:')), false);
    assert.equal(h.calls.includes('forget:dl_1'), true);
  });

  test('when it cannot be told whether the original is gone, the vault copy is kept', async () => {
    let deleted = false;
    const h = harness({
      deleteOriginal: async () => {
        deleted = true;
        return { ok: false };
      },
      getItem: async () => {
        if (deleted) {
          throw new Error('library unavailable');
        }
        return SOURCE;
      },
    });
    assert.deepEqual(await moveToPrivate('dl_1', h.deps), {
      ok: false,
      reason: 'original-not-removed',
      keptInVault: true,
    });
    assert.equal(h.calls.some((call) => call.startsWith('remove-vault:')), false);
  });
});
