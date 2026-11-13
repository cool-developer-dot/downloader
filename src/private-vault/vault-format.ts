/**
 * The vault file format's arithmetic (File Encryption #463), mirrored from library/VaultCrypto.kt (`VaultFormat`) so
 * it is specified and tested in one place JavaScript can run. Pure. JavaScript never encrypts or decrypts anything:
 * it only uses this to say how much space a move needs.
 *
 * Each file: a header (format, the file's own AES-256 key sealed by the Keystore master key, an 8-byte random nonce
 * prefix, the plaintext length), then 1 MiB chunks sealed with AES-GCM. Chunk i's nonce is the prefix followed by i
 * (4 bytes, big-endian), so no two chunks of a file share one; its additional data binds the format, the plaintext
 * length, i and whether it is the last chunk, so chunks cannot be reordered, dropped or cut off.
 */

export const VAULT_MAGIC = [0x56, 0x58, 0x56, 0x31] as const; // "VXV1"
export const VAULT_VERSION = 1;
export const VAULT_CHUNK_SIZE = 1024 * 1024;
export const VAULT_NONCE_PREFIX_BYTES = 8;
export const VAULT_NONCE_BYTES = 12;
export const VAULT_TAG_BYTES = 16;
/** The chunk index takes 4 nonce bytes. */
export const VAULT_MAX_CHUNKS = 2 ** 32;
/** Keystore-sealed key: a 12-byte IV and 32 key bytes + a 16-byte tag. */
export const VAULT_TYPICAL_IV_BYTES = 12;
export const VAULT_TYPICAL_WRAPPED_KEY_BYTES = 48;

function assertLength(length: number): void {
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new RangeError('length must be a non-negative safe integer');
  }
}

/** Chunks in a file of `length` plaintext bytes; an empty file is one empty chunk, so it is authenticated too. */
export function vaultChunkCount(length: number, chunkSize = VAULT_CHUNK_SIZE): number {
  assertLength(length);
  return length === 0 ? 1 : Math.ceil(length / chunkSize);
}

/** Plaintext bytes in chunk `index`: a full chunk for every chunk but the last. */
export function vaultChunkLength(index: number, length: number, chunkSize = VAULT_CHUNK_SIZE): number {
  assertLength(length);
  const start = index * chunkSize;
  return start >= length ? 0 : Math.min(chunkSize, length - start);
}

/** Chunk `index`'s 12-byte nonce: the file's 8-byte prefix, then the index big-endian. */
export function vaultChunkNonce(prefix: readonly number[], index: number): number[] {
  if (prefix.length !== VAULT_NONCE_PREFIX_BYTES) {
    throw new RangeError(`nonce prefix must be ${VAULT_NONCE_PREFIX_BYTES} bytes`);
  }
  if (!Number.isInteger(index) || index < 0 || index >= VAULT_MAX_CHUNKS) {
    throw new RangeError('chunk index out of range');
  }
  return [...prefix, (index >>> 24) & 0xff, (index >>> 16) & 0xff, (index >>> 8) & 0xff, index & 0xff];
}

function bigEndian64(value: number): number[] {
  const high = Math.floor(value / 2 ** 32);
  const low = value >>> 0;
  return [
    (high >>> 24) & 0xff,
    (high >>> 16) & 0xff,
    (high >>> 8) & 0xff,
    high & 0xff,
    (low >>> 24) & 0xff,
    (low >>> 16) & 0xff,
    (low >>> 8) & 0xff,
    low & 0xff,
  ];
}

/** What chunk `index` authenticates besides its bytes: magic, version, plaintext length, index, last-chunk flag. */
export function vaultChunkAad(length: number, index: number, isFinal: boolean): number[] {
  assertLength(length);
  return [...VAULT_MAGIC, VAULT_VERSION, ...bigEndian64(length), ...bigEndian64(index), isFinal ? 1 : 0];
}

export function vaultHeaderLength(
  ivBytes = VAULT_TYPICAL_IV_BYTES,
  wrappedKeyBytes = VAULT_TYPICAL_WRAPPED_KEY_BYTES,
): number {
  return VAULT_MAGIC.length + 1 + 4 + 1 + ivBytes + 2 + wrappedKeyBytes + VAULT_NONCE_PREFIX_BYTES + 8;
}

/** The sealed size of a file of `length` bytes: header, the bytes, and one tag per chunk. */
export function vaultSealedLength(length: number, chunkSize = VAULT_CHUNK_SIZE): number {
  return vaultHeaderLength() + length + vaultChunkCount(length, chunkSize) * VAULT_TAG_BYTES;
}
