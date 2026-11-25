/**
 * Files F3 · #827 Checksum: a pasted SHA-256 against the one computed on the phone. Pure. Case and spaces (and line
 * breaks) don't matter, so "AB12 CD34…" matches "ab12cd34…".
 */

const SHA256_LENGTH = 64;

export type ChecksumMatch =
  /** Nothing pasted yet. */
  | 'empty'
  /** Not 64 hex characters: it can't be a SHA-256. */
  | 'wrong-length'
  | 'match'
  | 'mismatch';

/** Lower case, with every space, tab and line break removed. */
export function normalizeChecksum(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, '').toLowerCase();
}

export function compareChecksum(computed: string | null | undefined, pasted: string | null | undefined): ChecksumMatch {
  const theirs = normalizeChecksum(pasted);
  if (!theirs) {
    return 'empty';
  }
  if (theirs.length !== SHA256_LENGTH || !/^[0-9a-f]+$/.test(theirs)) {
    return 'wrong-length';
  }
  return theirs === normalizeChecksum(computed) ? 'match' : 'mismatch';
}
