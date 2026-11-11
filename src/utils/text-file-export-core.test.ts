import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  exportFileName,
  exportTextFileWith,
  importTextFileWith,
  isCancelError,
  MAX_IMPORT_BYTES,
  MAX_SHARE_CHARS,
  type TextExportDeps,
} from './text-file-export-core';

const INPUT = { fileName: 'a.json', mimeType: 'application/json', content: '{"x":1}', shareTitle: 'Export' };

function deps(overrides: Partial<TextExportDeps> & { calls?: string[] } = {}): TextExportDeps & { calls: string[] } {
  const calls = overrides.calls ?? [];
  return {
    calls,
    pickDirectory: overrides.pickDirectory ?? (async () => 'dir'),
    writeFile:
      overrides.writeFile ??
      ((dir, name, mime, content) => void calls.push(`write:${String(dir)}:${name}:${mime}:${content}`)),
    share: overrides.share ?? (async (content) => (calls.push(`share:${content}`), true)),
  };
}

describe('exportTextFileWith', () => {
  test('saves into the picked folder', async () => {
    const d = deps();
    assert.equal(await exportTextFileWith(d, INPUT), 'saved');
    assert.deepEqual(d.calls, ['write:dir:a.json:application/json:{"x":1}']);
  });

  test('a cancelled picker is a cancel, never the share sheet', async () => {
    const d = deps({
      pickDirectory: async () => {
        throw Object.assign(new Error('The file picker was cancelled by the user'), { code: 'ERR_PICKER_CANCELLED' });
      },
    });
    assert.equal(await exportTextFileWith(d, INPUT), 'cancelled');
    assert.deepEqual(d.calls, []);
  });

  test('a picker that cannot open falls back to sharing', async () => {
    const d = deps({
      pickDirectory: async () => {
        throw new Error('No activity found');
      },
    });
    assert.equal(await exportTextFileWith(d, INPUT), 'shared');
    assert.deepEqual(d.calls, ['share:{"x":1}']);
  });

  test('a failed write falls back to sharing', async () => {
    const d = deps({
      writeFile: () => {
        throw new Error('EACCES');
      },
    });
    assert.equal(await exportTextFileWith(d, INPUT), 'shared');
  });

  test('a dismissed share sheet is a cancel; a broken one a failure', async () => {
    const noPicker = async () => {
      throw new Error('unavailable');
    };
    assert.equal(await exportTextFileWith(deps({ pickDirectory: noPicker, share: async () => false }), INPUT), 'cancelled');
    assert.equal(
      await exportTextFileWith(
        deps({
          pickDirectory: noPicker,
          share: async () => {
            throw new Error('boom');
          },
        }),
        INPUT,
      ),
      'failed',
    );
  });

  test('text too large for the share sheet fails instead of crashing', async () => {
    const d = deps({
      pickDirectory: async () => {
        throw new Error('unavailable');
      },
    });
    assert.equal(await exportTextFileWith(d, { ...INPUT, content: 'x'.repeat(MAX_SHARE_CHARS + 1) }), 'failed');
    assert.deepEqual(d.calls, []);
  });
});

describe('importTextFileWith', () => {
  test('reads the picked file', async () => {
    assert.deepEqual(await importTextFileWith({ pickFile: async () => ({ size: 5, read: async () => 'hello' }) }), {
      status: 'picked',
      text: 'hello',
    });
  });

  test('cancel, too large and failure', async () => {
    assert.deepEqual(await importTextFileWith({ pickFile: async () => null }), { status: 'cancelled' });
    assert.deepEqual(
      await importTextFileWith({ pickFile: async () => ({ size: MAX_IMPORT_BYTES + 1, read: async () => '' }) }),
      { status: 'too-large' },
    );
    assert.deepEqual(
      await importTextFileWith({
        pickFile: async () => ({ size: null, read: async () => 'x'.repeat(MAX_IMPORT_BYTES + 1) }),
      }),
      { status: 'too-large' },
    );
    assert.deepEqual(
      await importTextFileWith({
        pickFile: async () => {
          throw new Error('io');
        },
      }),
      { status: 'failed' },
    );
  });
});

describe('helpers', () => {
  test('isCancelError reads the code or the message', () => {
    assert.equal(isCancelError({ code: 'ERR_PICKER_CANCELLED' }), true);
    assert.equal(isCancelError(new Error('The file picker was cancelled by the user')), true);
    assert.equal(isCancelError(new Error('No activity')), false);
    assert.equal(isCancelError(null), false);
  });

  test('exportFileName is dated and safe', () => {
    const now = new Date(2026, 9, 5);
    assert.equal(exportFileName('download history', 'csv', now), 'vidorax-download-history-2026-10-05.csv');
    assert.equal(exportFileName('../../etc', 'json', now), 'vidorax-etc-2026-10-05.json');
    assert.equal(exportFileName('', 'json', new Date(Number.NaN)), 'vidorax-export-export.json');
  });
});
