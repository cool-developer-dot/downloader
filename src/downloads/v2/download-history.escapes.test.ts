import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { historyToCsv } from './download-history';

/** The UTF-8 byte-order mark, built from its code point so this file holds no raw invisible character either. */
const BOM = String.fromCharCode(0xfeff);

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

describe('download history CSV with the escaped byte-order mark', () => {
  test('the output is exactly what it was: one BOM, then the header', () => {
    const csv = historyToCsv([]);
    assert.equal(csv, `${BOM}id,title,site,status,quality,sizeBytes,createdAt,finishedAt,errorCode,error,pageUrl\r\n`);
    assert.equal(csv.charCodeAt(0), 0xfeff);
    assert.notEqual(csv.charCodeAt(1), 0xfeff);
    assert.equal(Buffer.from(csv, 'utf8').subarray(0, 3).toString('hex'), 'efbbbf');
  });

  test('the source holds no raw invisible characters', () => {
    assert.deepEqual(rawInvisibleCharacters('src/downloads/v2/download-history.ts'), []);
    assert.deepEqual(rawInvisibleCharacters('src/downloads/v2/download-history.test.ts'), []);
  });
});
