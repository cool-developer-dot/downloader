/**
 * Files F11 (Faran, 2026-11-28): the app-wide Block screenshots setting is in backups, through F17's
 * registerFilesBackupKey like F2's, F7's and F10's settings, and a restore brings it back. App Lock's PIN and
 * recovery code are never in a backup.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { readBackupFiles } from '@/backup/files-section';
import { APP_LOCK_SECURE_STORE_KEY } from '@/security/app-lock/app-lock.constants';

import { SECURITY_SETTINGS_BACKUP_KEY, securitySettingsBackupValue, securitySettingsFromStorage } from './security-settings';

/** A backup's `files` section after writing it to a file and reading it back. */
function roundTrip(extra: Record<string, unknown>) {
  return readBackupFiles(JSON.parse(JSON.stringify({ folders: [], folderOf: {}, tags: {}, notes: {}, extra })));
}

describe('Files F11: Block screenshots in backups', () => {
  test('it is backed up with the File Manager’s settings, and only the setting itself', () => {
    assert.match(SECURITY_SETTINGS_BACKUP_KEY, /^vidorax\.files\.[A-Za-z0-9.]+$/);
    assert.deepEqual(securitySettingsBackupValue({ blockScreenshots: true }), { blockScreenshots: true });
    const restored = roundTrip({ [SECURITY_SETTINGS_BACKUP_KEY]: securitySettingsBackupValue({ blockScreenshots: true }) });
    assert.deepEqual(restored.extra, { [SECURITY_SETTINGS_BACKUP_KEY]: { blockScreenshots: true } });
  });

  test('a restore brings it back, on or off', () => {
    for (const on of [true, false]) {
      const restored = roundTrip({ [SECURITY_SETTINGS_BACKUP_KEY]: securitySettingsBackupValue({ blockScreenshots: on }) });
      const stored = restored.extra[SECURITY_SETTINGS_BACKUP_KEY];
      assert.deepEqual(securitySettingsFromStorage({ stored, legacyBlockScreenshots: !on }), { blockScreenshots: on });
    }
  });

  test('a phone that set it before backups carried it keeps it, and its next backup carries it', () => {
    assert.deepEqual(securitySettingsFromStorage({ stored: null, legacyBlockScreenshots: true }), { blockScreenshots: true });
    assert.deepEqual(securitySettingsFromStorage({ stored: null, legacyBlockScreenshots: undefined }), { blockScreenshots: false });
    assert.deepEqual(securitySettingsFromStorage({ stored: 'garbage', legacyBlockScreenshots: undefined }), { blockScreenshots: false });
  });

  test('the app registers it for backups when it starts', () => {
    const text = readFileSync('src/files/ui/files-backup-keys.ts', 'utf8');
    assert.match(text, /registerFilesBackupKey\(SECURITY_SETTINGS_BACKUP_KEY, reloadSecuritySettings\)/);
  });

  test('App Lock’s PIN and recovery code are never in a backup', () => {
    // App Lock keeps them in the secure store under its own key; a backup drops any key that isn't vidorax.files.*.
    const restored = roundTrip({
      [APP_LOCK_SECURE_STORE_KEY]: { pinHash: 'x', recoveryCodeHash: 'y' },
      'vidorax.appLockBiometric.v1': { enabled: true },
      [SECURITY_SETTINGS_BACKUP_KEY]: { blockScreenshots: true },
    });
    assert.deepEqual(Object.keys(restored.extra), [SECURITY_SETTINGS_BACKUP_KEY]);
    // What Block screenshots puts in a backup holds nothing of App Lock's.
    assert.deepEqual(Object.keys(securitySettingsBackupValue({ blockScreenshots: true })), ['blockScreenshots']);
    const registrations = readFileSync('src/files/ui/files-backup-keys.ts', 'utf8')
      .split('\n')
      .filter((line) => line.includes('registerFilesBackupKey('));
    assert.ok(registrations.length > 0);
    for (const line of registrations) {
      assert.doesNotMatch(line, /appLock|APP_LOCK|\bpin|recovery/i, line);
    }
  });
});
