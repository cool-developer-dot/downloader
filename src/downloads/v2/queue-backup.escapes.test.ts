import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { parseQueueBackup, QUEUE_FORMAT } from './queue-backup';

/** The UTF-8 byte-order mark, built from its code point so this file holds no raw invisible character either. */
const BOM = String.fromCharCode(0xfeff);
const FILE = JSON.stringify({ format: QUEUE_FORMAT, version: 1, items: [{ pageUrl: 'https://a.com/x' }] });

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

describe('queue backup import with the escaped byte-order mark', () => {
  test('one leading BOM is ignored, exactly as before', () => {
    assert.deepEqual(parseQueueBackup(`${BOM}${FILE}`), parseQueueBackup(FILE));
    assert.equal(parseQueueBackup(`${BOM}${FILE}`).ok, true);
  });

  test('only a single leading BOM is removed: a second one, or one later in the file, is still not JSON', () => {
    assert.deepEqual(parseQueueBackup(`${BOM}${BOM}${FILE}`), { ok: false, reason: 'not-json' });
    assert.deepEqual(parseQueueBackup(` ${BOM}${FILE}`), { ok: false, reason: 'not-json' });
  });

  test('the source holds no raw invisible characters', () => {
    assert.deepEqual(rawInvisibleCharacters('src/downloads/v2/queue-backup.ts'), []);
    assert.deepEqual(rawInvisibleCharacters('src/downloads/v2/queue-backup.test.ts'), []);
  });
});
