import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { initialSettingsState } from '@/store/settings/state';
import { backupKeys, parseSettingsBackup, SETTINGS_BACKUP_FORMAT, settingsBackupJson } from '@/store/settings/backup';
import { resetSettingsState, settingsResetEntries } from '@/store/settings/reset';

import { BROWSER_SETTING_CHOICES } from './browser-setting-choices.ts';
import { BROWSER_SETTING_KEYS } from './browser-setting-keys.ts';

const defaults = initialSettingsState as unknown as Record<string, unknown>;
const storeSource = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../../store/settings/index.ts'),
  'utf8',
);

describe('browser settings: stored, backed up, reset (audit)', () => {
  test('every browser setting has a primitive default and is in the backup', () => {
    const keys = backupKeys(defaults);
    for (const key of BROWSER_SETTING_KEYS) {
      assert.ok(key in defaults, `${key} has no default`);
      assert.ok(keys.includes(key), `${key} is not in the backup`);
    }
  });

  test('every browser setting is persisted by the settings store (partialize) and normalized on load (merge)', () => {
    for (const key of BROWSER_SETTING_KEYS) {
      assert.ok(storeSource.includes(`${key}: state.${key}`), `${key} missing from partialize`);
      assert.ok(new RegExp(`\\n\\s+${key}:\\s*\\n?\\s*(typeof raw\\.${key}|raw\\.${key})`).test(storeSource), `${key} missing from merge`);
    }
  });

  test('Reset puts every browser setting back to its default', () => {
    const changed: Record<string, unknown> = { ...defaults };
    for (const key of BROWSER_SETTING_KEYS) {
      const value = defaults[key];
      const choices = BROWSER_SETTING_CHOICES[key];
      changed[key] = choices ? choices.find((c) => c !== value) : typeof value === 'boolean' ? !value : typeof value === 'number' ? value + 1 : `${value}x`;
    }
    const reset = resetSettingsState(changed, defaults);
    for (const key of BROWSER_SETTING_KEYS) {
      assert.deepEqual(reset[key], defaults[key], key);
    }
    assert.ok(settingsResetEntries(defaults).some(([key]) => key === BROWSER_SETTING_KEYS[0]));
  });

  test('a backup round-trips the browser settings; an unknown choice is ignored', () => {
    const state = { ...defaults, tabSortOrder: 'lastUsed' };
    const text = settingsBackupJson(state, defaults, new Date(0));
    const parsed = parseSettingsBackup(text, defaults);
    assert.equal(parsed.ok && parsed.values.tabSortOrder, 'lastUsed');
    const bad = parseSettingsBackup(
      JSON.stringify({ format: SETTINGS_BACKUP_FORMAT, version: 1, settings: { tabSortOrder: 'random' } }),
      defaults,
    );
    assert.equal(bad.ok && 'tabSortOrder' in bad.values, false);
    assert.equal(bad.ok && bad.ignored.includes('tabSortOrder'), true);
  });
});
