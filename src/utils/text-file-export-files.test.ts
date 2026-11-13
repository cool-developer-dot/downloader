import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { exportTextFilesWith, importTextFileWith, MAX_IMPORT_BYTES, type TextExportDeps } from './text-file-export-core';

function deps(overrides: Partial<TextExportDeps> = {}) {
  const written: string[] = [];
  const shared: string[] = [];
  const value: TextExportDeps = {
    pickDirectory: async () => ({ dir: true }),
    writeFile: (_dir, fileName) => {
      written.push(fileName);
    },
    share: async (content) => {
      shared.push(content);
      return true;
    },
    ...overrides,
  };
  return { value, written, shared };
}

const files = [
  { fileName: 'a.html', mimeType: 'text/html', content: '<a>' },
  { fileName: 'b.csv', mimeType: 'text/csv', content: 'b' },
];

describe('exportTextFilesWith (B20 #210)', () => {
  test('several files go into the one folder picked', async () => {
    const d = deps();
    assert.equal(await exportTextFilesWith(d.value, files, 'T'), 'saved');
    assert.deepEqual(d.written, ['a.html', 'b.csv']);
  });

  test('cancelling the picker writes nothing', async () => {
    const d = deps({ pickDirectory: async () => Promise.reject(Object.assign(new Error('x'), { code: 'ERR_CANCELED' })) });
    assert.equal(await exportTextFilesWith(d.value, files, 'T'), 'cancelled');
    assert.deepEqual(d.written, []);
  });

  test('no folder for several files fails instead of sharing half', async () => {
    const d = deps({ pickDirectory: async () => null });
    assert.equal(await exportTextFilesWith(d.value, files, 'T'), 'failed');
    assert.deepEqual(d.shared, []);
  });

  test('a single file falls back to sharing as before', async () => {
    const d = deps({ pickDirectory: async () => null });
    assert.equal(await exportTextFilesWith(d.value, files.slice(0, 1), 'T'), 'shared');
    assert.deepEqual(d.shared, ['<a>']);
  });
});

describe('importTextFileWith maxBytes', () => {
  test('a bigger limit lets a larger file in; the default stays', async () => {
    const big = { size: MAX_IMPORT_BYTES + 1, read: async () => 'x' };
    assert.deepEqual(await importTextFileWith({ pickFile: async () => big }), { status: 'too-large' });
    assert.deepEqual(await importTextFileWith({ pickFile: async () => big }, MAX_IMPORT_BYTES * 2), {
      status: 'picked',
      text: 'x',
    });
  });
});
