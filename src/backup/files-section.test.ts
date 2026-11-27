import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { appBackupJson, APP_BACKUP_VERSION, backupPreview, parseAppBackup } from './backup-format';
import { filesBackupCounts, mergeItemData, orderFolders, readBackupFiles, type BackupFiles } from './files-section';

const folder = (id: string, parentId: string | null = null) => ({ id, name: id.toUpperCase(), parentId, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z' });

const FILES: BackupFiles = readBackupFiles({
  folders: [folder('c', 'b'), folder('a'), folder('b', 'a')],
  folderOf: { v1: 'c', v2: null, v3: 'gone' },
  tags: { v1: ['work', 'Work', ' trip '], v2: [] },
  notes: { v1: 'first cut', v9: '' },
  bin: { enabled: true, keepDays: 14 },
  lowSpace: { enabled: false, thresholdBytes: 524288000 },
  extra: { 'vidorax.files.hidden.v1': { state: { ids: ['v2'] } }, 'vidorax.appLock.v1': { pin: '1234' } },
});

describe('readBackupFiles', () => {
  test('folders come parents first; unknown folder ids in folderOf are dropped', () => {
    assert.deepEqual(FILES.folders.map((f) => f.id), ['a', 'b', 'c']);
    assert.deepEqual(FILES.folderOf, { v1: 'c', v2: null });
  });

  test('tags are trimmed and de-duplicated (exact), empty lists and notes dropped', () => {
    assert.deepEqual(FILES.tags, { v1: ['work', 'Work', 'trip'] });
    assert.deepEqual(FILES.notes, { v1: 'first cut' });
  });

  test('settings kept; only vidorax.files.* extra keys are ever read (never App Lock)', () => {
    assert.deepEqual(FILES.bin, { enabled: true, keepDays: 14 });
    assert.deepEqual(FILES.lowSpace, { enabled: false, thresholdBytes: 524288000 });
    assert.deepEqual(Object.keys(FILES.extra), ['vidorax.files.hidden.v1']);
  });

  test('garbage gives an empty section, never a throw', () => {
    const empty = readBackupFiles('nope');
    assert.deepEqual(empty, { folders: [], folderOf: {}, tags: {}, notes: {}, extra: {} });
    assert.deepEqual(readBackupFiles({ folders: [{ id: '' }, 5, null] }).folders, []);
  });

  test('a parent loop is cut to the root, nothing lost', () => {
    const ordered = orderFolders([folder('x', 'y'), folder('y', 'x')]);
    assert.equal(ordered.length, 2);
    assert.ok(ordered.some((f) => f.parentId === null));
    assert.equal(ordered.find((f) => f.id === 'x')!.parentId, 'y');
  });
});

describe('mergeItemData', () => {
  const phone = { tags: { v1: ['home'], v5: ['keep'] }, notes: { v1: 'phone note' } };
  const existing = new Set(['v1', 'v2', 'v5']);

  test('merge: tags join, the phone keeps its note, folders apply to items on the phone only', () => {
    const out = mergeItemData(phone, FILES, existing, 'merge');
    assert.deepEqual(out.tags.v1, ['home', 'work', 'Work', 'trip']);
    assert.equal(out.notes.v1, 'phone note');
    assert.deepEqual(out.tags.v5, ['keep']);
    assert.deepEqual(out.folderOf, { v1: 'c', v2: null });
  });

  test('replace: the backup wins for the items it names; items not on the phone are skipped', () => {
    const out = mergeItemData(phone, FILES, new Set(['v1']), 'replace');
    assert.deepEqual(out.tags.v1, ['work', 'Work', 'trip']);
    assert.equal(out.notes.v1, 'first cut');
    assert.deepEqual(out.folderOf, { v1: 'c' });
  });
});

describe('backup format v2 with files', () => {
  test('a round trip keeps the files section, and the preview counts it', () => {
    assert.equal(APP_BACKUP_VERSION, 2);
    const text = appBackupJson({ files: FILES }, new Date('2026-11-26T10:00:00Z'));
    const parsed = parseAppBackup(text, {});
    assert.ok(parsed.ok);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.backup.sections.files, FILES);
    const row = backupPreview(parsed.backup).rows.find((r) => r.section === 'files');
    assert.deepEqual(row, { section: 'files', count: 3, items: 2 });
    assert.deepEqual(filesBackupCounts(FILES), { folders: 3, items: 2 });
  });

  test('a version 1 file (1.2.0) still restores, without a files section', () => {
    const v1 = JSON.stringify({ format: 'vidorax.appBackup', version: 1, exportedAt: '2026-11-20T00:00:00Z', sections: { playStats: [] } });
    const parsed = parseAppBackup(v1, {});
    assert.ok(parsed.ok);
    if (parsed.ok) assert.equal(parsed.backup.sections.files, undefined);
  });

  test('a file from a newer VidoraX is refused', () => {
    const v3 = JSON.stringify({ format: 'vidorax.appBackup', version: 3, sections: {} });
    assert.deepEqual(parseAppBackup(v3, {}), { ok: false, reason: 'newer-version' });
  });
});
