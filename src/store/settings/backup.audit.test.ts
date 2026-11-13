import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseSettingsBackup, SETTINGS_BACKUP_FORMAT } from './backup';

const DEFAULTS = { wifiOnly: false, language: 'en', maxConcurrentDownloads: 2 };

describe('settings backup (audit)', () => {
  test('prototype keys in a file are ignored, never applied', () => {
    const text = `{"format":"${SETTINGS_BACKUP_FORMAT}","version":1,"settings":{"__proto__":{"wifiOnly":true},"constructor":1,"wifiOnly":true}}`;
    const parsed = parseSettingsBackup(text, DEFAULTS);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.deepEqual(Object.keys(parsed.values), ['wifiOnly']);
      assert.equal(({} as Record<string, unknown>).wifiOnly, undefined);
    }
  });

  test('a fraction for a whole-number setting is rounded, NaN-like strings are ignored', () => {
    const parsed = parseSettingsBackup(
      JSON.stringify({ format: SETTINGS_BACKUP_FORMAT, version: 1, settings: { maxConcurrentDownloads: 2.6, language: 7 } }),
      DEFAULTS,
    );
    assert.equal(parsed.ok && parsed.values.maxConcurrentDownloads, 3);
    assert.equal(parsed.ok && 'language' in parsed.values, false);
  });
});
