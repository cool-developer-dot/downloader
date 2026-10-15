import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  backupKeys,
  parseSettingsBackup,
  SETTINGS_BACKUP_FORMAT,
  SETTINGS_BACKUP_VERSION,
  settingsBackupJson,
} from './backup';

const DEFAULTS = {
  downloadDirectory: null,
  wifiOnly: false,
  autoResume: true,
  notifications: true,
  language: 'en',
  maxConcurrentDownloads: 2,
  saveToGallery: true,
  defaultTab: 'browser',
};

function file(settings: Record<string, unknown>, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ format: SETTINGS_BACKUP_FORMAT, version: SETTINGS_BACKUP_VERSION, settings, ...extra });
}

describe('export', () => {
  test('carries every setting except the excluded ones', () => {
    assert.equal(backupKeys(DEFAULTS).includes('downloadDirectory'), false);
    const parsed = JSON.parse(
      settingsBackupJson({ ...DEFAULTS, downloadDirectory: '/sdcard/x', wifiOnly: true, appLockPin: '1234' }, DEFAULTS, new Date(0)),
    );
    assert.equal(parsed.format, SETTINGS_BACKUP_FORMAT);
    assert.equal(parsed.version, SETTINGS_BACKUP_VERSION);
    assert.equal(parsed.settings.wifiOnly, true);
    assert.equal('downloadDirectory' in parsed.settings, false);
    assert.equal('appLockPin' in parsed.settings, false);
  });

  test('round trip', () => {
    const text = settingsBackupJson({ ...DEFAULTS, language: 'ur', maxConcurrentDownloads: 3 }, DEFAULTS, new Date(0));
    const parsed = parseSettingsBackup(text, DEFAULTS);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.values.language, 'ur');
      assert.equal(parsed.values.maxConcurrentDownloads, 3);
      assert.deepEqual(parsed.ignored, []);
    }
  });
});

describe('import', () => {
  test('unknown keys, wrong types and excluded keys are ignored', () => {
    const parsed = parseSettingsBackup(
      file({ wifiOnly: 'yes', autoResume: false, mystery: 1, downloadDirectory: '/x', appLockPin: '0000', language: 5 }),
      DEFAULTS,
    );
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.deepEqual(parsed.values, { autoResume: false });
      assert.deepEqual(parsed.ignored.sort(), ['appLockPin', 'downloadDirectory', 'language', 'mystery', 'wifiOnly']);
    }
  });

  test('numbers are clamped and rounded; long strings are cut', () => {
    const parsed = parseSettingsBackup(file({ maxConcurrentDownloads: 99, defaultTab: 'x'.repeat(2000) }), DEFAULTS);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.values.maxConcurrentDownloads, 4);
      assert.equal(String(parsed.values.defaultTab).length, 500);
    }
    const low = parseSettingsBackup(file({ maxConcurrentDownloads: -3.7 }), DEFAULTS);
    assert.equal(low.ok && low.values.maxConcurrentDownloads, 1);
    const nan = parseSettingsBackup('{"format":"vidorax.settings","version":1,"settings":{"maxConcurrentDownloads":null}}', DEFAULTS);
    assert.equal(nan.ok && 'maxConcurrentDownloads' in nan.values, false);
  });

  test('refuses files that are not a settings backup of a known version', () => {
    assert.deepEqual(parseSettingsBackup('nope', DEFAULTS), { ok: false, reason: 'not-json' });
    assert.deepEqual(parseSettingsBackup('[]', DEFAULTS), { ok: false, reason: 'wrong-format' });
    assert.deepEqual(parseSettingsBackup(JSON.stringify({ format: 'vidorax.downloadQueue', version: 1, settings: {} }), DEFAULTS), {
      ok: false,
      reason: 'wrong-format',
    });
    assert.deepEqual(parseSettingsBackup(file({}, { version: 2 }), DEFAULTS), { ok: false, reason: 'unsupported-version' });
    assert.deepEqual(parseSettingsBackup(file({}, { settings: [] }), DEFAULTS), { ok: false, reason: 'wrong-format' });
  });
});
