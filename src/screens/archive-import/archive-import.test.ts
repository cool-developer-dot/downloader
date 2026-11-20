import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { en } from '@/localization/en';

import { archiveImportPath, isUnsupportedArchive, MALICIOUS_REFUSALS, REFUSAL_KEYS, refusalKey } from './archive-import';

describe('P8 #407 Extract Archive screen words', () => {
  test('every native refusal has a message in the catalog', () => {
    const catalog = en.archiveImport as Record<string, string>;
    for (const [reason, key] of Object.entries(REFUSAL_KEYS)) {
      assert.ok(catalog[key.replace('archiveImport.', '')], `${reason} → ${key}`);
    }
    assert.equal(refusalKey('something new'), 'archiveImport.refusedDamaged');
    assert.equal(refusalKey('rar'), refusalKey('seven_z'));
  });

  test('zip slip, bombs, too many entries and disguised apps are warnings', () => {
    for (const reason of ['path_escape', 'compression_ratio', 'too_many_entries', 'android_app'] as const) {
      assert.ok(MALICIOUS_REFUSALS.has(reason));
    }
    assert.equal(MALICIOUS_REFUSALS.has('encrypted'), false);
  });

  test('RAR and 7z are refused before any copy, by type or name', () => {
    assert.equal(isUnsupportedArchive({ mimeType: 'application/vnd.rar', displayName: null }), true);
    assert.equal(isUnsupportedArchive({ mimeType: 'application/octet-stream', displayName: 'Movies.7Z' }), true);
    assert.equal(isUnsupportedArchive({ mimeType: 'application/zip', displayName: 'clips.zip' }), false);
    assert.equal(isUnsupportedArchive(null), false);
  });

  test('the route carries only the token', () => {
    assert.equal(archiveImportPath('0123456789abcdef0123456789abcdef'), '/archive-import?token=0123456789abcdef0123456789abcdef');
  });
});
