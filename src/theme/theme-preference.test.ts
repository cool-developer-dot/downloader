import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  DEFAULT_THEME_PREFERENCE,
  isThemePreference,
  nightModeOf,
  normalizeThemePreference,
  resolveThemeMode,
  THEME_PREFERENCES,
} from './theme-preference';

describe('theme preference', () => {
  test('first run, missing or malformed → Logo', () => {
    assert.equal(DEFAULT_THEME_PREFERENCE, 'logo');
    for (const raw of [undefined, null, '', 'purple', 42, {}]) {
      assert.equal(normalizeThemePreference(raw), 'logo', String(raw));
    }
  });

  test('the three choices survive a round trip; legacy System (any case) is read as Light', () => {
    assert.deepEqual([...THEME_PREFERENCES], ['light', 'logo', 'dark']);
    for (const preference of THEME_PREFERENCES) {
      assert.equal(normalizeThemePreference(preference), preference);
      assert.equal(isThemePreference(preference), true);
      assert.equal(resolveThemeMode(preference), preference);
    }
    assert.equal(normalizeThemePreference('system'), 'light');
    assert.equal(normalizeThemePreference('SYSTEM'), 'light');
    assert.equal(isThemePreference('system'), false);
  });

  test('Android is told light for Light and Logo, dark for Dark', () => {
    assert.equal(nightModeOf('light'), 'light');
    assert.equal(nightModeOf('logo'), 'light');
    assert.equal(nightModeOf('dark'), 'dark');
  });
});
