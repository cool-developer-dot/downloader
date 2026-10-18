import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

/**
 * The characters the warning has always removed, listed by code point (this file holds no raw invisible character):
 * C0 controls, DEL, the LRM/RLM marks, the embedding and override controls U+202A-U+202E and the isolates
 * U+2066-U+2069.
 */
const REMOVED = new Set<number>([
  ...Array.from({ length: 0x20 }, (_, index) => index),
  0x7f,
  0x200e,
  0x200f,
  0x202a,
  0x202b,
  0x202c,
  0x202d,
  0x202e,
  0x2066,
  0x2067,
  0x2068,
  0x2069,
]);

function reference(name: string): string {
  return Array.from(name)
    .filter((character) => !REMOVED.has(character.codePointAt(0) ?? 0))
    .join('')
    .trim();
}

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

describe('displayFileName with the escaped character class', () => {
  test('removes exactly the same characters as before, for every code point up to U+2100', async () => {
    const { displayFileName } = await import('./dangerous-download');
    for (let code = 0; code <= 0x2100; code += 1) {
      if (code >= 0xd800 && code <= 0xdfff) {
        continue;
      }
      const name = `a${String.fromCodePoint(code)}b.exe`;
      assert.equal(displayFileName(name), reference(name), `U+${code.toString(16)}`);
    }
  });

  test('every direction control, built from its code point, is removed; its neighbours are kept', async () => {
    const { displayFileName } = await import('./dangerous-download');
    for (const code of [0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]) {
      assert.equal(displayFileName(`photo${String.fromCodePoint(code)}gpj.exe`), 'photogpj.exe');
    }
    for (const code of [0x200d, 0x2029, 0x202f, 0x2065, 0x206a]) {
      const name = `a${String.fromCodePoint(code)}b.exe`;
      assert.equal(displayFileName(name), name, `U+${code.toString(16)}`);
    }
  });

  test('the source holds no raw invisible characters', () => {
    assert.deepEqual(rawInvisibleCharacters('src/media-detection/adapters/dangerous-download.ts'), []);
    assert.deepEqual(rawInvisibleCharacters('src/media-detection/adapters/dangerous-download.audit.test.ts'), []);
  });
});
