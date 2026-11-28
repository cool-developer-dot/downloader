import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { libraryFilesOnly } from './library-files';

describe('Files: what only VidoraX’s own files can do (batch rename, checksum)', () => {
  test('files the browser handed to Android are left out, in order', () => {
    const files = [{ id: 'a' }, { id: 'sysdl:1' }, { id: 'b' }, { id: 'sysdl:22' }];
    assert.deepEqual(libraryFilesOnly(files).map((file) => file.id), ['a', 'b']);
    assert.deepEqual(libraryFilesOnly([]), []);
  });
});
