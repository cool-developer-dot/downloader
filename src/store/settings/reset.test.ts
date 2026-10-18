import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { RESET_KEEPS, resetSettingsState, settingsResetEntries } from './reset';

const DEFAULTS = {
  downloadDirectory: null,
  wifiOnly: false,
  autoResume: true,
  notifications: true,
  language: 'en',
  defaultTab: 'browser',
  maxConcurrentDownloads: 2,
  saveToGallery: true,
  debugLogs: false,
};

describe('Reset Settings', () => {
  test('keeps the language (and so the RTL layout) and resets everything else', () => {
    const current = {
      downloadDirectory: '/x',
      wifiOnly: true,
      autoResume: false,
      notifications: false,
      language: 'ur',
      defaultTab: 'downloads',
      maxConcurrentDownloads: 4,
      saveToGallery: false,
      debugLogs: true,
    };
    assert.deepEqual(resetSettingsState(current, DEFAULTS), { ...DEFAULTS, language: 'ur' });
  });

  test('the language is the only key kept', () => {
    assert.deepEqual([...RESET_KEEPS], ['language']);
    const keys = settingsResetEntries(DEFAULTS).map(([key]) => key);
    assert.equal(keys.includes('language'), false);
    assert.deepEqual(keys.sort(), Object.keys(DEFAULTS).filter((key) => key !== 'language').sort());
  });

  test('every other default is written, even when unchanged', () => {
    const entries = new Map(settingsResetEntries(DEFAULTS));
    assert.equal(entries.get('wifiOnly'), false);
    assert.equal(entries.get('maxConcurrentDownloads'), 2);
    assert.equal(entries.get('downloadDirectory'), null);
  });

  test('a reset of English settings stays English', () => {
    assert.equal(resetSettingsState({ ...DEFAULTS, wifiOnly: true }, DEFAULTS).language, 'en');
  });
});
