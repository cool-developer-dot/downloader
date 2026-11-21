import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  DEFAULT_THEME_PREFERENCE,
  isDarkThemeMode,
  isThemePreference,
  nightModeOf,
  normalizeThemePreference,
  resolveThemeMode,
  THEME_PREFERENCES,
} from './theme-preference';

describe('theme preference', () => {
  test('first run, missing or malformed → Light', () => {
    assert.equal(DEFAULT_THEME_PREFERENCE, 'light');
    for (const raw of [undefined, null, '', 'purple', 42, {}]) {
      assert.equal(normalizeThemePreference(raw), 'light', String(raw));
    }
  });

  test('the six design themes survive a round trip, in the PDF order', () => {
    assert.deepEqual([...THEME_PREFERENCES], ['light', 'dark', 'red', 'cream', 'midnight', 'blush']);
    for (const preference of THEME_PREFERENCES) {
      assert.equal(normalizeThemePreference(preference), preference);
      assert.equal(isThemePreference(preference), true);
      assert.equal(resolveThemeMode(preference), preference);
    }
  });

  test('legacy values: logo → red, System (any case) → light, upper-case names fold', () => {
    assert.equal(normalizeThemePreference('logo'), 'red');
    assert.equal(normalizeThemePreference('LOGO'), 'red');
    assert.equal(normalizeThemePreference('system'), 'light');
    assert.equal(normalizeThemePreference('SYSTEM'), 'light');
    assert.equal(normalizeThemePreference('MIDNIGHT'), 'midnight');
    assert.equal(isThemePreference('system'), false);
    assert.equal(isThemePreference('logo'), false);
  });

  test('Android is told dark for Dark and Midnight only', () => {
    assert.equal(nightModeOf('light'), 'light');
    assert.equal(nightModeOf('red'), 'light');
    assert.equal(nightModeOf('cream'), 'light');
    assert.equal(nightModeOf('blush'), 'light');
    assert.equal(nightModeOf('dark'), 'dark');
    assert.equal(nightModeOf('midnight'), 'dark');
    assert.equal(isDarkThemeMode('midnight'), true);
    assert.equal(isDarkThemeMode('red'), false);
  });
});
