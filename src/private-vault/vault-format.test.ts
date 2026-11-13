import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  VAULT_CHUNK_SIZE,
  VAULT_MAX_CHUNKS,
  VAULT_TAG_BYTES,
  vaultChunkAad,
  vaultChunkCount,
  vaultChunkLength,
  vaultChunkNonce,
  vaultHeaderLength,
  vaultSealedLength,
} from './vault-format';

const MIB = 1024 * 1024;

describe('chunking', () => {
  test('1 MiB chunks; an empty file is one empty chunk', () => {
    assert.equal(VAULT_CHUNK_SIZE, MIB);
    assert.equal(vaultChunkCount(0), 1);
    assert.equal(vaultChunkCount(1), 1);
    assert.equal(vaultChunkCount(MIB), 1);
    assert.equal(vaultChunkCount(MIB + 1), 2);
    assert.equal(vaultChunkCount(10 * MIB), 10);
    // A 4 GB video: well inside the 2^32 chunks the nonce allows.
    assert.equal(vaultChunkCount(4 * 1024 * MIB), 4096);
  });

  test('every chunk is full except the last', () => {
    const length = 2 * MIB + 5;
    assert.equal(vaultChunkLength(0, length), MIB);
    assert.equal(vaultChunkLength(1, length), MIB);
    assert.equal(vaultChunkLength(2, length), 5);
    assert.equal(vaultChunkLength(3, length), 0);
    assert.equal(vaultChunkLength(0, 0), 0);
    let total = 0;
    for (let index = 0; index < vaultChunkCount(length); index += 1) {
      total += vaultChunkLength(index, length);
    }
    assert.equal(total, length);
  });

  test('invalid lengths are refused', () => {
    assert.throws(() => vaultChunkCount(-1), RangeError);
    assert.throws(() => vaultChunkCount(1.5), RangeError);
  });
});

describe('nonces', () => {
  const prefix = [1, 2, 3, 4, 5, 6, 7, 8];

  test('the prefix then the chunk index, big-endian (same vectors as the Kotlin test)', () => {
    assert.deepEqual(vaultChunkNonce(prefix, 0), [1, 2, 3, 4, 5, 6, 7, 8, 0, 0, 0, 0]);
    assert.deepEqual(vaultChunkNonce(prefix, 258), [1, 2, 3, 4, 5, 6, 7, 8, 0, 0, 1, 2]);
    assert.deepEqual(vaultChunkNonce(prefix, VAULT_MAX_CHUNKS - 1), [1, 2, 3, 4, 5, 6, 7, 8, 255, 255, 255, 255]);
  });

  test('unique for every chunk of a file', () => {
    const seen = new Set<string>();
    for (let index = 0; index < 5000; index += 1) {
      seen.add(vaultChunkNonce(prefix, index).join(','));
    }
    assert.equal(seen.size, 5000);
  });

  test('a bad prefix or an index past 2^32 is refused', () => {
    assert.throws(() => vaultChunkNonce([1, 2, 3], 0), RangeError);
    assert.throws(() => vaultChunkNonce(prefix, VAULT_MAX_CHUNKS), RangeError);
    assert.throws(() => vaultChunkNonce(prefix, -1), RangeError);
  });
});

describe('authenticated data', () => {
  test('binds format, version, length, index and the last-chunk flag (same vector as the Kotlin test)', () => {
    assert.deepEqual(
      vaultChunkAad(300, 2, true),
      [0x56, 0x58, 0x56, 0x31, 1, 0, 0, 0, 0, 0, 0, 1, 44, 0, 0, 0, 0, 0, 0, 0, 2, 1],
    );
  });

  test('changing any bound value changes it, so a moved, cut or re-labelled chunk fails', () => {
    const base = vaultChunkAad(5 * MIB, 3, false).join(',');
    assert.notEqual(vaultChunkAad(5 * MIB, 4, false).join(','), base);
    assert.notEqual(vaultChunkAad(5 * MIB, 3, true).join(','), base);
    assert.notEqual(vaultChunkAad(5 * MIB - 1, 3, false).join(','), base);
  });

  test('lengths above 4 GiB are written in full', () => {
    const aad = vaultChunkAad(5 * 1024 * MIB, 0, false);
    assert.deepEqual(aad.slice(5, 13), [0, 0, 0, 1, 64, 0, 0, 0]);
  });
});

describe('sizes', () => {
  test('the sealed file is header + bytes + one tag per chunk', () => {
    assert.equal(vaultHeaderLength(), 4 + 1 + 4 + 1 + 12 + 2 + 48 + 8 + 8);
    assert.equal(vaultSealedLength(0), vaultHeaderLength() + VAULT_TAG_BYTES);
    assert.equal(vaultSealedLength(3 * MIB + 1), vaultHeaderLength() + 3 * MIB + 1 + 4 * VAULT_TAG_BYTES);
  });
});
