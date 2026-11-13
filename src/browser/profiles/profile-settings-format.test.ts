import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { pickBrowserSettingDefaults, profileSettingsText, profileSettingsValues } from './profile-settings-format';

const ALL = {
  searchEngine: 'google',
  safeSearch: 'moderate',
  searchSuggestions: true,
  addressBarPosition: 'top',
  swipeNavigation: true,
  language: 'en',
};

describe('per-profile browser settings', () => {
  const defaults = pickBrowserSettingDefaults(ALL);

  test('only browser settings are picked', () => {
    assert.equal('language' in defaults, false);
    assert.equal(defaults.searchEngine, 'google');
  });

  test('a profile without a saved copy gets the defaults', () => {
    assert.deepEqual(profileSettingsValues(undefined, defaults), defaults);
  });

  test('a saved copy comes back; invalid values fall back to the default', () => {
    const text = profileSettingsText(
      { ...ALL, searchEngine: 'duckduckgo', swipeNavigation: false, addressBarPosition: 'bottom' },
      new Date('2026-11-01T00:00:00Z'),
      defaults,
    );
    const values = profileSettingsValues(text, defaults);
    assert.equal(values.searchEngine, 'duckduckgo');
    assert.equal(values.swipeNavigation, false);
    assert.equal(values.addressBarPosition, 'bottom');

    const damaged = JSON.stringify({
      format: 'vidorax.settings',
      version: 1,
      settings: { searchEngine: 'evil-engine', swipeNavigation: 'yes', addressBarPosition: 'bottom' },
    });
    const repaired = profileSettingsValues(damaged, defaults);
    assert.equal(repaired.searchEngine, 'google');
    assert.equal(repaired.swipeNavigation, true);
    assert.equal(repaired.addressBarPosition, 'bottom');
    assert.deepEqual(profileSettingsValues('{broken', defaults), defaults);
  });
});
