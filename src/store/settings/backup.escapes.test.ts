import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { parseSettingsBackup, SETTINGS_BACKUP_FORMAT } from './backup';

/** The UTF-8 byte-order mark, built from its code point so this file holds no raw invisible character either. */
const BOM = String.fromCharCode(0xfeff);
const DEFAULTS = { wifiOnly: false };
const FILE = JSON.stringify({ format: SETTINGS_BACKUP_FORMAT, version: 1, settings: { wifiOnly: true } });

/** Raw invisible characters (byte-order mark, direction marks, line separators): in source they belong as escapes. */
function rawInvisibleCharacters(file: string): string[] {
  return Array.from(readFileSync(join(process.cwd(), file), 'utf8'))
    .map((character) => character.codePointAt(0) ?? 0)
    .filter(
      (code) =>
        code === 0xfeff ||
        (code >= 0x200b && code <= 0x200f) ||
        (code >= 0x2028 && code <= 0x202e) ||
        (code >= 0x2066 && code <= 0x2069),
    )
    .map((code) => `U+${code.toString(16).toUpperCase()}`);
}

describe('settings import with the escaped byte-order mark', () => {
  test('one leading BOM is ignored, exactly as before', () => {
    assert.deepEqual(parseSettingsBackup(`${BOM}${FILE}`, DEFAULTS), parseSettingsBackup(FILE, DEFAULTS));
    assert.equal(parseSettingsBackup(`${BOM}${FILE}`, DEFAULTS).ok, true);
  });

  test('only a single leading BOM is removed: a second one, or one later in the file, is still not JSON', () => {
    assert.deepEqual(parseSettingsBackup(`${BOM}${BOM}${FILE}`, DEFAULTS), { ok: false, reason: 'not-json' });
    assert.deepEqual(parseSettingsBackup(` ${BOM}${FILE}`, DEFAULTS), { ok: false, reason: 'not-json' });
  });

  test('the source holds no raw invisible characters', () => {
    assert.deepEqual(rawInvisibleCharacters('src/store/settings/backup.ts'), []);
  });
});
