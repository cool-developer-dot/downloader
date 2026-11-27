import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { mmkvKeys } from '../storage/constants/mmkv-keys.ts';
import { SETTINGS_BACKUP_FORMAT } from '../store/settings/backup.ts';

import {
  APP_BACKUP_FORMAT,
  APP_BACKUP_VERSION,
  appBackupJson,
  backupPreview,
  BROWSER_BACKUP_FORMAT,
  parseAppBackup,
  type AppBackupSections,
} from './backup-format.ts';
import { BACKUP_PREFERENCES, collectPreferences, NEVER_IN_BACKUP } from './backup-preferences.ts';

/**
 * P11 #700 Backup / Restore: the file — export → import gives the same data back; an older Settings Backup file is
 * read; a newer file is refused; App Lock and Private are never in it.
 */

const DEFAULTS = { wifiOnly: false, language: 'en', maxConcurrentDownloads: 2, settingsView: 'simple' };
const NOW = new Date('2026-11-23T10:00:00.000Z');

const LOOP = { id: 'l1', name: 'Chorus', startMs: 10_000, endMs: 20_000, createdAt: 5 };

function fullSections(): AppBackupSections {
  return {
    settings: { wifiOnly: true, language: 'ur', maxConcurrentDownloads: 3, settingsView: 'advanced' },
    preferences: {
      [mmkvKeys.playerSeekStepSeconds]: 30,
      [mmkvKeys.playerAutoPlayNext]: true,
      [mmkvKeys.playerSavedLoops]: [['video-1', [LOOP]]],
      [mmkvKeys.playerVideoFits]: [['video-1', 'crop']],
      [mmkvKeys.libraryExcludedFolders]: ['folder-a', 'unfiled'],
      [mmkvKeys.privacyBlockScreenCapture]: true,
    },
    playlists: [
      {
        id: 'p1',
        name: 'Road trip',
        createdAt: '2026-11-01T10:00:00.000Z',
        updatedAt: '2026-11-02T10:00:00.000Z',
        items: [
          { mediaId: 'video-1', position: 0, title: 'One', fileName: 'one.mp4', durationSeconds: 61, addedAt: '2026-11-01T10:00:00.000Z' },
          { mediaId: 'device:42', position: 1, title: 'اردو', fileName: 'urdu.mp4', durationSeconds: null, addedAt: '2026-11-01T11:00:00.000Z' },
        ],
      },
    ],
    videoBookmarks: [
      { id: 'b1', mediaId: 'video-1', positionMs: 1500, name: 'Start', createdAt: '2026-11-03T10:00:00.000Z' },
      { id: 'b2', mediaId: 'video-1', positionMs: 9000, name: null, createdAt: '2026-11-03T10:01:00.000Z' },
    ],
    playStats: [{ mediaId: 'video-1', playCount: 4, lastPlayedAt: '2026-11-04T10:00:00.000Z' }],
  };
}

describe('P11 backup file: round trip', () => {
  test('export → import gives back exactly the same sections', () => {
    const sections = fullSections();
    const text = appBackupJson(sections, NOW);
    const parsed = parseAppBackup(text, DEFAULTS);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.ignored, []);
    assert.deepEqual(parsed.backup, { source: 'app', fileVersion: APP_BACKUP_VERSION, exportedAt: NOW.toISOString(), sections });
    const raw = JSON.parse(text) as { format: string; version: number };
    assert.equal(raw.format, APP_BACKUP_FORMAT);
    // F17 made it 2 (the File Manager's `files` section); version 1 files still restore (files-section.test.ts).
    assert.equal(raw.version, APP_BACKUP_VERSION);
  });

  test('a byte-order mark and an unknown section are fine (the section is listed as ignored)', () => {
    const text = JSON.stringify({ format: APP_BACKUP_FORMAT, version: 1, sections: { settings: { wifiOnly: true }, extra: [1] } });
    const parsed = parseAppBackup(String.fromCharCode(0xfeff) + text, DEFAULTS);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.backup.sections, { settings: { wifiOnly: true } });
    assert.deepEqual(parsed.ignored, ['extra']);
  });

  test('values are checked, never trusted: bad rows and unknown keys are dropped', () => {
    const text = JSON.stringify({
      format: APP_BACKUP_FORMAT,
      version: 1,
      sections: {
        settings: { wifiOnly: 'yes', maxConcurrentDownloads: 99, unknownSetting: 1 },
        preferences: { [mmkvKeys.playerSeekStepSeconds]: 'fast', 'vidorax.appLockBiometric.v1': { enabled: true } },
        playlists: [{ id: 'p1', name: '   ', createdAt: '2026-11-01T10:00:00.000Z' }, { name: 'No id' }],
        videoBookmarks: [{ id: 'b1', mediaId: '', positionMs: 1, createdAt: '2026-11-01T10:00:00.000Z' }],
        playStats: [{ mediaId: 'v', playCount: 0 }, { mediaId: 'v2', playCount: 2.7, lastPlayedAt: 'not a date' }],
      },
    });
    const parsed = parseAppBackup(text, DEFAULTS);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.backup.sections.settings, { maxConcurrentDownloads: 4 }, 'clamped as Settings Backup does');
    assert.deepEqual(parsed.backup.sections.preferences, {});
    assert.deepEqual(parsed.backup.sections.playlists, []);
    assert.deepEqual(parsed.backup.sections.videoBookmarks, []);
    assert.deepEqual(parsed.backup.sections.playStats, [{ mediaId: 'v2', playCount: 2, lastPlayedAt: null }]);
    assert.ok(parsed.ignored.includes('preferences.vidorax.appLockBiometric.v1'));
    assert.ok(parsed.ignored.includes('settings.unknownSetting'));
  });
});

describe('P11 backup file: versions', () => {
  test('a file from a newer VidoraX is refused (and says so), never half-read', () => {
    const text = JSON.stringify({ format: APP_BACKUP_FORMAT, version: APP_BACKUP_VERSION + 1, sections: { settings: {} } });
    assert.deepEqual(parseAppBackup(text, DEFAULTS), { ok: false, reason: 'newer-version' });
  });

  test('the older Settings Backup file is read as a backup with settings only', () => {
    const text = JSON.stringify({ format: SETTINGS_BACKUP_FORMAT, version: 1, exportedAt: NOW.toISOString(), settings: { wifiOnly: true } });
    const parsed = parseAppBackup(text, DEFAULTS);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.backup, {
      source: 'settings',
      fileVersion: 1,
      exportedAt: NOW.toISOString(),
      sections: { settings: { wifiOnly: true } },
    });
    assert.equal(backupPreview(parsed.backup).settingsOnly, true);
  });

  test('a Settings Backup file from a newer VidoraX is refused too', () => {
    const text = JSON.stringify({ format: SETTINGS_BACKUP_FORMAT, version: 2, settings: { wifiOnly: true } });
    assert.deepEqual(parseAppBackup(text, DEFAULTS), { ok: false, reason: 'newer-version' });
  });

  test('not JSON, another format, a bad version, or the browser’s own backup', () => {
    assert.deepEqual(parseAppBackup('{nope', DEFAULTS), { ok: false, reason: 'not-json' });
    assert.deepEqual(parseAppBackup('[]', DEFAULTS), { ok: false, reason: 'wrong-format' });
    assert.deepEqual(parseAppBackup(JSON.stringify({ format: 'other', version: 1 }), DEFAULTS), { ok: false, reason: 'wrong-format' });
    for (const version of [0, 1.5, '1', null]) {
      assert.deepEqual(
        parseAppBackup(JSON.stringify({ format: APP_BACKUP_FORMAT, version, sections: {} }), DEFAULTS),
        { ok: false, reason: 'wrong-format' },
        String(version),
      );
    }
    assert.deepEqual(parseAppBackup(JSON.stringify({ format: APP_BACKUP_FORMAT, version: 1 }), DEFAULTS), {
      ok: false,
      reason: 'wrong-format',
    });
    assert.deepEqual(parseAppBackup(JSON.stringify({ format: BROWSER_BACKUP_FORMAT, version: 1 }), DEFAULTS), {
      ok: false,
      reason: 'browser-backup',
    });
  });
});

describe('P11 backup file: never App Lock, never Private', () => {
  const SECRET = /appLock|biometric|privateVault|vault|recovery|"pin"/i;

  test('nothing on the never-list is on the allow-list', () => {
    const allowed = new Set(BACKUP_PREFERENCES.map((spec) => spec.key));
    for (const key of NEVER_IN_BACKUP) {
      assert.ok(!allowed.has(key), key);
    }
    for (const key of allowed) {
      assert.ok(!SECRET.test(key), key);
    }
    assert.ok(!allowed.has(mmkvKeys.playerQueue), 'the queue is what plays now, not a choice');
  });

  test('even when the phone holds App Lock and Private data, the file has none of it', () => {
    // Every key the phone could hold, App Lock's and Private's included, each with a value.
    const stored: Record<string, unknown> = {
      'vidorax.appLock.v1': { pinHash: 'abc', recovery: 'XYZ' },
      'vidorax.appLockBiometric.v1': { state: { enabled: true } },
      'vidorax.privateVault.v1': { state: { dataLossAcknowledged: true } },
      [mmkvKeys.playerQueue]: { ids: ['video-1'] },
      [mmkvKeys.playerSeekStepSeconds]: 15,
      [mmkvKeys.playerDisableHistory]: true,
    };
    const preferences = collectPreferences((spec) => stored[spec.key]);
    assert.deepEqual(preferences, { [mmkvKeys.playerSeekStepSeconds]: 15, [mmkvKeys.playerDisableHistory]: true });
    const text = appBackupJson({ ...fullSections(), preferences }, NOW);
    assert.ok(!SECRET.test(text), 'no App Lock or Private key or value in the file');
    assert.ok(!text.includes('abc') && !text.includes('XYZ'));
  });
});

describe('P11 backup file: the preview', () => {
  test('every section with its counts', () => {
    const parsed = parseAppBackup(appBackupJson(fullSections(), NOW), DEFAULTS);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const preview = backupPreview(parsed.backup);
    assert.deepEqual(preview.rows, [
      { section: 'settings', count: 4 },
      { section: 'preferences', count: 4 },
      { section: 'loops', count: 1 },
      { section: 'hiddenFolders', count: 2 },
      { section: 'playlists', count: 1, videos: 2 },
      { section: 'videoBookmarks', count: 2 },
      { section: 'playStats', count: 1 },
    ]);
    assert.equal(preview.exportedAt, NOW.toISOString());
    assert.equal(preview.empty, false);
    assert.equal(preview.settingsOnly, false);
  });

  test('an empty backup says there is nothing to restore', () => {
    const parsed = parseAppBackup(appBackupJson({ settings: {}, playlists: [] }, NOW), DEFAULTS);
    assert.equal(parsed.ok && backupPreview(parsed.backup).empty, true);
  });
});
