import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isExternalUiOpen } from './external-ui';
import { exportVaultItem, type VaultExportDeps } from './vault-export';
import {
  appLockEvent,
  backgroundPolicy,
  LOCKED_SESSION,
  reduceVaultSession,
  type AppLockSnapshot,
  type VaultSession,
} from './vault-gate';
import { reduceVaultPlayback, type VaultPlayback } from './vault-playback';

const UNLOCKED_APP: AppLockSnapshot = { isEnabled: true, status: 'UNLOCKED' };
const LOCKED_APP: AppLockSnapshot = { isEnabled: true, status: 'LOCKED' };

/**
 * What Android does when a system screen opened from Private takes the foreground: the app is reported as in the
 * background, and the existing App Lock locks the whole app at that moment. This replays both against the section.
 */
function systemScreenOpens(session: VaultSession): { session: VaultSession; clearPlayback: boolean } {
  const externalUi = isExternalUiOpen();
  const policy = backgroundPolicy(externalUi);
  let next = reduceVaultSession(session, { type: 'app-background', externalUi });
  const lockEvent = appLockEvent(UNLOCKED_APP, LOCKED_APP, externalUi);
  if (lockEvent) {
    next = reduceVaultSession(next, lockEvent);
  }
  return { session: next, clearPlayback: policy.clearPlayback };
}

function deps(overrides: Partial<VaultExportDeps> = {}): VaultExportDeps & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    requestGalleryPermission: async () => {
      log.push('permission');
      return 'granted';
    },
    pickFolder: async () => {
      log.push('pick');
      return 'content://com.android.externalstorage.documents/tree/primary%3AMovies';
    },
    exportToGallery: async (vaultId) => {
      log.push(`gallery:${vaultId}`);
      return 'content://media/external/video/1';
    },
    exportToFolder: async (vaultId, treeUri) => {
      log.push(`folder:${vaultId}:${treeUri}`);
      return 'content://doc';
    },
    ...overrides,
  };
}

describe('the export folder picker never relocks Private', () => {
  test('while the picker is in front: the section stays unlocked and the playback file stays', async () => {
    const unlocked = reduceVaultSession(LOCKED_SESSION, { type: 'pin-verified' });
    const seen: { duringPick: { session: VaultSession; clearPlayback: boolean } | null } = { duringPick: null };
    const result = await exportVaultItem(
      'folder',
      'v1',
      deps({
        pickFolder: async () => {
          seen.duringPick = systemScreenOpens(unlocked);
          return 'content://com.android.externalstorage.documents/tree/primary%3AMovies';
        },
      }),
    );
    assert.deepEqual(result, { ok: true });
    assert.ok(seen.duringPick);
    assert.equal(seen.duringPick.session, unlocked);
    assert.equal(seen.duringPick.clearPlayback, false);
  });

  test('the Android 9 permission prompt for a Gallery export is treated the same way', async () => {
    const unlocked = reduceVaultSession(LOCKED_SESSION, { type: 'pin-verified' });
    const seen: { duringPrompt: { session: VaultSession; clearPlayback: boolean } | null } = { duringPrompt: null };
    await exportVaultItem(
      'gallery',
      'v1',
      deps({
        requestGalleryPermission: async () => {
          seen.duringPrompt = systemScreenOpens(unlocked);
          return 'granted';
        },
      }),
    );
    assert.ok(seen.duringPrompt);
    assert.equal(seen.duringPrompt.session, unlocked);
    assert.equal(seen.duringPrompt.clearPlayback, false);
  });

  test('outside a picker, the same events lock the section and delete the playback file', () => {
    const unlocked = reduceVaultSession(LOCKED_SESSION, { type: 'pin-verified' });
    const result = systemScreenOpens(unlocked);
    assert.equal(result.session.unlocked, false);
    assert.equal(result.clearPlayback, true);
    const playing: VaultPlayback = {
      phase: 'playing',
      token: 1,
      itemId: 'v',
      uri: 'file:///data/user/0/x/cache/vault-play/3f2a9c1e-0b7d-4c55-9a10-2b3c4d5e6f70.mp4',
    };
    assert.equal(reduceVaultPlayback(playing, { type: 'app-background' }).clearTemp, true);
  });

  test('back from the picker, App Lock\'s own lock screen changing its state does not relock the section', () => {
    const unlocked = reduceVaultSession(LOCKED_SESSION, { type: 'pin-verified' });
    // An unlock attempt, a throttle update, the unlock itself: none is a change into locked.
    assert.equal(appLockEvent(LOCKED_APP, { ...LOCKED_APP }, false), null);
    assert.equal(appLockEvent(LOCKED_APP, UNLOCKED_APP, false), null);
    assert.equal(reduceVaultSession(unlocked, { type: 'pin-verified' }), unlocked);
  });

  test('a real lock — not caused by a picker — still locks; turning App Lock off always does', () => {
    const unlocked = reduceVaultSession(LOCKED_SESSION, { type: 'pin-verified' });
    const lock = appLockEvent(UNLOCKED_APP, LOCKED_APP, false);
    assert.deepEqual(lock, { type: 'app-lock-changed', enabled: true, appLocked: true, externalUi: false });
    assert.equal(reduceVaultSession(unlocked, lock!).unlocked, false);
    const off = appLockEvent(UNLOCKED_APP, { isEnabled: false, status: 'DISABLED' }, true);
    assert.equal(reduceVaultSession(unlocked, off!).unlocked, false);
  });

  test('the picker window is closed once the folder is chosen, before the export runs', async () => {
    const seen: { openWhileExporting: boolean | null } = { openWhileExporting: null };
    await exportVaultItem(
      'folder',
      'v1',
      deps({
        exportToFolder: async () => {
          seen.openWhileExporting = isExternalUiOpen();
          return 'content://doc';
        },
      }),
    );
    assert.equal(seen.openWhileExporting, false);
    assert.equal(isExternalUiOpen(), false);
  });
});

describe('an export in progress is never aborted', () => {
  test('it completes even if the section locks while it runs', async () => {
    let session = reduceVaultSession(LOCKED_SESSION, { type: 'pin-verified' });
    const progress = { finished: false };
    const result = await exportVaultItem(
      'folder',
      'v1',
      deps({
        exportToFolder: async () => {
          // The user really leaves the app mid-export: the section locks.
          session = reduceVaultSession(session, { type: 'app-background', externalUi: false });
          await new Promise((resolve) => setTimeout(resolve, 5));
          progress.finished = true;
          return 'content://doc';
        },
      }),
    );
    assert.equal(session.unlocked, false);
    assert.equal(progress.finished, true);
    assert.deepEqual(result, { ok: true });
  });

  test('backing out of the picker exports nothing; a denied permission exports nothing', async () => {
    const cancelled = deps({ pickFolder: async () => null });
    assert.deepEqual(await exportVaultItem('folder', 'v1', cancelled), { ok: false, reason: 'cancelled' });
    assert.equal(cancelled.log.some((entry) => entry.startsWith('folder:')), false);
    const denied = deps({ requestGalleryPermission: async () => 'denied' });
    assert.deepEqual(await exportVaultItem('gallery', 'v1', denied), { ok: false, reason: 'permission' });
    assert.equal(denied.log.some((entry) => entry.startsWith('gallery:')), false);
  });

  test('failures are reported by kind, and the picker window always closes', async () => {
    const fail = (code: string) =>
      deps({
        exportToFolder: async () => {
          throw Object.assign(new Error(code), { code });
        },
      });
    assert.deepEqual(await exportVaultItem('folder', 'v1', fail('ERR_VAULT_CORRUPT')), { ok: false, reason: 'corrupt' });
    assert.deepEqual(await exportVaultItem('folder', 'v1', fail('ERR_FOLDER_ACCESS')), { ok: false, reason: 'folder-access' });
    assert.deepEqual(await exportVaultItem('folder', 'v1', fail('ERR_STORAGE')), { ok: false, reason: 'failed' });
    const pickerThrows = deps({
      pickFolder: async () => {
        throw new Error('no picker');
      },
    });
    assert.deepEqual(await exportVaultItem('folder', 'v1', pickerThrows), { ok: false, reason: 'failed' });
    assert.equal(isExternalUiOpen(), false);
  });
});
