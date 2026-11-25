import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { compareChecksum, normalizeChecksum } from './checksum-compare';

const HASH = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

describe('Files F3 #827: checking a pasted SHA-256', () => {
  test('upper and lower case both match', () => {
    assert.equal(compareChecksum(HASH, HASH.toUpperCase()), 'match');
    assert.equal(compareChecksum(HASH.toUpperCase(), HASH), 'match');
  });

  test('spaces, tabs and line breaks are ignored', () => {
    const grouped = (HASH.match(/.{8}/g) ?? []).join(' ');
    assert.equal(compareChecksum(HASH, grouped), 'match');
    assert.equal(compareChecksum(HASH, `  ${HASH.slice(0, 32)}\n${HASH.slice(32)}\t`), 'match');
    assert.equal(normalizeChecksum(' AB cd\nEF '), 'abcdef');
  });

  test('one character changed does not match', () => {
    const changed = `${HASH.slice(0, 10)}${HASH[10] === 'a' ? 'b' : 'a'}${HASH.slice(11)}`;
    assert.equal(compareChecksum(HASH, changed), 'mismatch');
  });

  test('a wrong length (or anything not hex) is not a SHA-256', () => {
    assert.equal(compareChecksum(HASH, HASH.slice(1)), 'wrong-length');
    assert.equal(compareChecksum(HASH, `${HASH}0`), 'wrong-length');
    assert.equal(compareChecksum(HASH, `${HASH.slice(1)}z`), 'wrong-length');
  });

  test('empty input', () => {
    assert.equal(compareChecksum(HASH, ''), 'empty');
    assert.equal(compareChecksum(HASH, '   \n '), 'empty');
    assert.equal(compareChecksum(HASH, null), 'empty');
  });
});
