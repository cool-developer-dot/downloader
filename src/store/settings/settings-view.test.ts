import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { DEFAULT_SETTINGS_VIEW, isSettingVisible, settingsViewMigration, settingsViewToSave } from './settings-view';
import { initialSettingsState } from './state';
import { backupKeys, STRING_CHOICES } from './backup';

describe('P8 #516/#517 Simple / Advanced settings view', () => {
  test('a new install starts in Simple', () => {
    assert.equal(DEFAULT_SETTINGS_VIEW, 'simple');
    assert.equal(initialSettingsState.settingsView, 'simple');
    assert.equal(settingsViewMigration({}), 'simple');
  });

  test('settings saved before 1.2.0 (no settingsView) are an existing install: Advanced', () => {
    assert.equal(settingsViewMigration({ wifiOnly: true, language: 'en' }), 'advanced');
  });

  test('a saved choice is kept; a broken one falls back by install age', () => {
    assert.equal(settingsViewMigration({ settingsView: 'simple', wifiOnly: false }), 'simple');
    assert.equal(settingsViewMigration({ settingsView: 'advanced' }), 'advanced');
    assert.equal(settingsViewMigration({ settingsView: 'expert', wifiOnly: false }), 'advanced');
  });

  test('Simple hides only rows marked advanced; Advanced shows all', () => {
    assert.equal(isSettingVisible(undefined, 'simple'), true);
    assert.equal(isSettingVisible(false, 'simple'), true);
    assert.equal(isSettingVisible(true, 'simple'), false);
    assert.equal(isSettingVisible(true, 'advanced'), true);
  });

  test('the view travels with a settings backup, as one of its two values', () => {
    assert.ok(backupKeys(initialSettingsState as unknown as Record<string, unknown>).includes('settingsView'));
    assert.deepEqual(STRING_CHOICES.settingsView, ['simple', 'advanced']);
  });
});

test('the view is saved once at startup; an untouched pre-1.2.0 install (nothing saved, intro done) is Advanced', () => {
  // Zustand saves settings only when one changes: a 1.1.0 user who never changed one has nothing stored.
  assert.equal(settingsViewToSave(null, true), 'advanced');
  assert.equal(settingsViewToSave(null, false), 'simple');
  assert.equal(settingsViewToSave(JSON.stringify({ state: { wifiOnly: true }, version: 0 }), false), 'advanced');
  assert.equal(settingsViewToSave(JSON.stringify({ state: { settingsView: 'simple' }, version: 0 }), true), null);
  assert.equal(settingsViewToSave(JSON.stringify({ state: { settingsView: 'advanced' } }), false), null);
  assert.equal(settingsViewToSave('not json', false), 'simple');
});
