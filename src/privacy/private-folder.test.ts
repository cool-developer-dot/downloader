import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { VaultExportResult } from '../private-vault/vault-export.ts';
import { moveToPrivate, type MoveToPrivateDeps } from '../private-vault/move-to-private.ts';
import type { VaultItem } from '../private-vault/vault-index.ts';

import {
  canMoveMediaToPrivate,
  isPrivateFolderItemId,
  isPrivatePlaybackUri,
  moveOutOfPrivate,
  privateFolderItemActions,
  type MoveOutDeps,
  type PrivateMoveCandidate,
} from './private-folder.ts';

/**
 * P11 #686 Private Folder: the service's rules over H21's vault, with a fake native vault — what can move in, moving
 * back out (the Gallery copy first, the private copy deleted only after), and the refusals.
 */

const VAULT_ID = '0f8c2a4e-1b2c-4d3e-8f90-123456789abc';
const OTHER_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

function vaultItem(id: string, patch: Partial<VaultItem> = {}): VaultItem {
  return {
    id,
    title: 'Holiday',
    mimeType: 'video/mp4',
    durationMs: 60_000,
    sizeBytes: 1000,
    width: 1920,
    height: 1080,
    createdAt: 1,
    addedAt: 2,
    hasThumbnail: false,
    unreadable: false,
    ...patch,
  };
}

/** A fake native vault: its items, the Gallery, and what was called in which order. */
function fakeVault(items: VaultItem[], gallery: VaultExportResult = { ok: true }, deleteFails = false) {
  const calls: string[] = [];
  const state = { items: [...items], galleryCopies: [] as string[] };
  const deps: MoveOutDeps = {
    findItem: async (id) => state.items.find((item) => item.id === id) ?? null,
    exportToGallery: async (id) => {
      calls.push(`export:${id}`);
      if (gallery.ok) {
        state.galleryCopies.push(id);
      }
      return gallery;
    },
    deleteFromVault: async (id) => {
      calls.push(`delete:${id}`);
      if (deleteFails) {
        throw new Error('io');
      }
      state.items = state.items.filter((item) => item.id !== id);
    },
  };
  return { calls, state, deps };
}

const candidate = (patch: Partial<PrivateMoveCandidate> = {}): PrivateMoveCandidate => ({
  mediaId: 'download-1',
  isLibraryVideo: true,
  isDeviceVideo: false,
  isExternalFile: false,
  isStream: false,
  vaultAvailable: true,
  ...patch,
});

describe('P11 Private Folder: what can move in', () => {
  test('a library video on a build with the vault', () => {
    assert.equal(canMoveMediaToPrivate(candidate()), true);
  });

  test('never a video on this device, a file from another app, a stream, or without the vault', () => {
    assert.equal(canMoveMediaToPrivate(candidate({ mediaId: 'device:42', isDeviceVideo: true })), false);
    assert.equal(canMoveMediaToPrivate(candidate({ isExternalFile: true })), false);
    assert.equal(canMoveMediaToPrivate(candidate({ isStream: true })), false);
    assert.equal(canMoveMediaToPrivate(candidate({ isLibraryVideo: false })), false);
    assert.equal(canMoveMediaToPrivate(candidate({ vaultAvailable: false })), false);
    assert.equal(canMoveMediaToPrivate(candidate({ mediaId: null })), false);
    assert.equal(canMoveMediaToPrivate(candidate({ mediaId: '  ' })), false);
  });

  test('the move itself is H21’s: refused without App Lock, the original kept when the encryption fails', async () => {
    const deps = (patch: Partial<MoveToPrivateDeps>): MoveToPrivateDeps => ({
      appLockEnabled: () => true,
      getItem: async (id) => ({ id, title: 'Holiday', sizeBytes: 1000, galleryUri: null }),
      isBusy: () => false,
      encrypt: async () => ({ ...vaultItem(VAULT_ID) }),
      deleteOriginal: async () => ({ ok: true }),
      removeFromVault: async () => undefined,
      forgetHistory: () => undefined,
      ...patch,
    });
    assert.deepEqual(await moveToPrivate('download-1', deps({ appLockEnabled: () => false })), {
      ok: false,
      reason: 'app-lock-off',
    });
    const forgotten: string[] = [];
    const failed = await moveToPrivate(
      'download-1',
      deps({ encrypt: async () => Promise.reject(new Error('no space')), forgetHistory: (id) => forgotten.push(id) }),
    );
    assert.deepEqual(failed, { ok: false, reason: 'encrypt-failed' });
    assert.equal(forgotten.length, 0, 'nothing is hidden when nothing moved');
    const moved = await moveToPrivate('download-1', deps({ forgetHistory: (id) => forgotten.push(id) }));
    assert.equal(moved.ok, true);
    assert.deepEqual(forgotten, ['download-1'], 'the traces are removed only after a move that worked');
  });
});

describe('P11 Private Folder: moving back out', () => {
  test('the Gallery copy first, then the private copy goes', async () => {
    const vault = fakeVault([vaultItem(VAULT_ID), vaultItem(OTHER_ID)]);
    assert.deepEqual(await moveOutOfPrivate(VAULT_ID, vault.deps), { ok: true });
    assert.deepEqual(vault.calls, [`export:${VAULT_ID}`, `delete:${VAULT_ID}`]);
    assert.deepEqual(vault.state.galleryCopies, [VAULT_ID]);
    assert.deepEqual(
      vault.state.items.map((item) => item.id),
      [OTHER_ID],
      'only that item left Private',
    );
  });

  test('a cancelled, refused or failed Gallery copy leaves the private copy exactly where it was', async () => {
    for (const reason of ['cancelled', 'permission', 'corrupt', 'failed'] as const) {
      const vault = fakeVault([vaultItem(VAULT_ID)], { ok: false, reason });
      assert.deepEqual(await moveOutOfPrivate(VAULT_ID, vault.deps), { ok: false, reason });
      assert.deepEqual(vault.calls, [`export:${VAULT_ID}`], reason);
      assert.equal(vault.state.items.length, 1, reason);
    }
  });

  test('an export that throws counts as failed; the private copy stays', async () => {
    const vault = fakeVault([vaultItem(VAULT_ID)]);
    const result = await moveOutOfPrivate(VAULT_ID, {
      ...vault.deps,
      exportToGallery: async () => Promise.reject(new Error('io')),
    });
    assert.deepEqual(result, { ok: false, reason: 'failed' });
    assert.equal(vault.state.items.length, 1);
  });

  test('copied but not deleted: it says the video is in both places', async () => {
    const vault = fakeVault([vaultItem(VAULT_ID)], { ok: true }, true);
    assert.deepEqual(await moveOutOfPrivate(VAULT_ID, vault.deps), { ok: false, reason: 'still-in-private' });
    assert.deepEqual(vault.state.galleryCopies, [VAULT_ID]);
  });

  test('refused: an item that can’t be opened, one that is gone, a bad id, a second tap while it runs', async () => {
    const unreadable = fakeVault([vaultItem(VAULT_ID, { unreadable: true })]);
    assert.deepEqual(await moveOutOfPrivate(VAULT_ID, unreadable.deps), { ok: false, reason: 'unreadable' });
    assert.deepEqual(unreadable.calls, []);

    const gone = fakeVault([]);
    assert.deepEqual(await moveOutOfPrivate(VAULT_ID, gone.deps), { ok: false, reason: 'not-found' });
    assert.deepEqual(await moveOutOfPrivate('download-1', gone.deps), { ok: false, reason: 'not-found' });

    let release: () => void = () => undefined;
    const slow = fakeVault([vaultItem(VAULT_ID)]);
    const first = moveOutOfPrivate(VAULT_ID, {
      ...slow.deps,
      exportToGallery: () =>
        new Promise<VaultExportResult>((resolve) => {
          release = () => resolve({ ok: true });
        }),
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(await moveOutOfPrivate(VAULT_ID, slow.deps), { ok: false, reason: 'busy' });
    release();
    assert.deepEqual(await first, { ok: true });
  });
});

describe('P11 Private Folder: actions and “is private”', () => {
  test('Move out sits before Delete for an item that opens; an unreadable one can only be deleted', () => {
    assert.deepEqual(privateFolderItemActions({ unreadable: false }), [
      'play',
      'export-gallery',
      'export-folder',
      'move-out',
      'delete',
    ]);
    assert.deepEqual(privateFolderItemActions({ unreadable: true }), ['delete']);
  });

  test('private: a vault item id or a vault playback file; never a library id or another file', () => {
    assert.equal(isPrivateFolderItemId(VAULT_ID), true);
    assert.equal(isPrivateFolderItemId('download-1'), false);
    assert.equal(isPrivatePlaybackUri(`file:///data/user/0/app/cache/vault-play/${VAULT_ID}.mp4`), true);
    assert.equal(isPrivatePlaybackUri('file:///data/user/0/app/files/library/web/clip.mp4'), false);
    assert.equal(isPrivatePlaybackUri(null), false);
  });
});
