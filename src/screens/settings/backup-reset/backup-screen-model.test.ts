import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { filesEn } from '@/localization/catalogs/files.en';

import { backupSize, lastBackupLabel, utf8Bytes, type Label } from './backup-screen-model';

const render = (label: Label) =>
  filesEn[label.key.replace('fileManager.', '') as keyof typeof filesEn].replace(/\{(\w+)\}/g, (_, name: string) => String(label.params?.[name]));

const NOW = new Date(2026, 10, 26, 15, 30);

describe('Files F11 · design 62: the Last backup card', () => {
  test('Never, Today, and an earlier date, each with its size', () => {
    assert.equal(render(lastBackupLabel(null, NOW, 'en-US')), 'Never');
    assert.equal(render(lastBackupLabel({ at: new Date(2026, 10, 26, 9, 0).toISOString(), bytes: 2 * 1024 * 1024 }, NOW, 'en-US')), 'Today · 2 MB');
    assert.equal(
      render(lastBackupLabel({ at: new Date(2026, 10, 20, 9, 0).toISOString(), bytes: 1.4 * 1024 * 1024 }, NOW, 'en-US')),
      'Nov 20, 2026 · 1.4 MB',
    );
    // Yesterday late at night is not today.
    assert.notEqual(render(lastBackupLabel({ at: new Date(2026, 10, 25, 23, 59).toISOString(), bytes: 10 }, NOW, 'en-US')), 'Today · 10 B');
    assert.equal(render(lastBackupLabel({ at: 'not a date', bytes: 10 }, NOW, 'en-US')), 'Never');
  });

  test('the sizes: B, KB, MB with one decimal at most, GB', () => {
    assert.equal(backupSize(0), '0 B');
    assert.equal(backupSize(512), '512 B');
    assert.equal(backupSize(18 * 1024 + 100), '18 KB');
    assert.equal(backupSize(2 * 1024 * 1024), '2 MB');
    assert.equal(backupSize(1.55 * 1024 * 1024), '1.6 MB');
    assert.equal(backupSize(1.2 * 1024 ** 3), '1.2 GB');
    // A backup's size is its UTF-8 bytes: Urdu letters take two each.
    assert.equal(utf8Bytes('ab'), 2);
    assert.equal(utf8Bytes('اب'), 4);
    assert.equal(utf8Bytes('😀'), 4);
  });
});
