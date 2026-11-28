import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { FileType } from '@/files/ui/file-types';

import { planAutoOrganize, siteOf, type OrganizeFile, type OrganizeLabels } from './auto-organize';

const LABELS: OrganizeLabels = {
  type: (type: FileType) => ({ video: 'Videos', audio: 'Audio', image: 'Images', doc: 'Docs', archive: 'Archives', apk: 'APKs', other: 'Other' })[type],
  month: (iso: string) => iso.slice(0, 7),
  other: 'Other',
};

const file = (id: string, extra: Partial<OrganizeFile> = {}): OrganizeFile => ({ id, type: 'video', folderId: null, date: '2026-11-03T10:00:00Z', ...extra });

describe('Files F7 #937: auto organize', () => {
  test('by type: one folder per type', () => {
    const plan = planAutoOrganize([file('1'), file('2', { type: 'audio' }), file('3')], [], 'type', LABELS);
    assert.deepEqual(
      plan.groups.map((group) => [group.name, group.fileIds]),
      [
        ['Videos', ['1', '3']],
        ['Audio', ['2']],
      ],
    );
  });

  test('by site: one folder per site; no known site goes to Other', () => {
    const plan = planAutoOrganize([file('1', { site: 'youtube.com' }), file('2', { site: 'vimeo.com' }), file('3')], [], 'site', LABELS);
    assert.deepEqual(
      plan.groups.map((group) => group.name),
      ['youtube.com', 'vimeo.com', 'Other'],
    );
    assert.equal(siteOf('https://www.example.com/watch?v=1'), 'example.com');
    assert.equal(siteOf('not a url'), null);
  });

  test('by month: 10 files from 3 months go into 3 folders', () => {
    const months = ['2026-09-10', '2026-09-20', '2026-10-01', '2026-10-02', '2026-10-30', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'];
    const plan = planAutoOrganize(months.map((day, index) => file(String(index), { date: `${day}T12:00:00Z` })), [], 'month', LABELS);
    assert.equal(plan.folderCount, 3);
    assert.equal(plan.fileCount, 10);
    assert.deepEqual(
      plan.groups.map((group) => [group.name, group.fileIds.length]),
      [
        ['2026-09', 2],
        ['2026-10', 3],
        ['2026-11', 5],
      ],
    );
  });

  test('files that already have a folder are left alone; an existing folder of that name is reused', () => {
    const plan = planAutoOrganize([file('filed', { folderId: 'F' }), file('loose')], [{ id: 'V', name: 'videos' }], 'type', LABELS);
    assert.deepEqual(plan.groups, [{ name: 'videos', folderId: 'V', fileIds: ['loose'] }]);
    assert.equal(plan.newFolderCount, 0);
  });

  test('the preview counts: "12 files into 3 folders", with how many folders are new', () => {
    const files = [
      ...Array.from({ length: 7 }, (_, index) => file(`v${index}`)),
      ...Array.from({ length: 3 }, (_, index) => file(`a${index}`, { type: 'audio' })),
      ...Array.from({ length: 2 }, (_, index) => file(`d${index}`, { type: 'doc' })),
    ];
    const plan = planAutoOrganize(files, [{ id: 'A', name: 'Audio' }], 'type', LABELS);
    assert.equal(plan.fileCount, 12);
    assert.equal(plan.folderCount, 3);
    assert.equal(plan.newFolderCount, 2);
  });

  test('files the browser handed to Android are never planned: they can’t go into a VidoraX folder', () => {
    const plan = planAutoOrganize(
      [file('1'), file('sysdl:5', { type: 'doc' }), file('sysdl:6', { type: 'apk' })],
      [],
      'type',
      LABELS,
    );
    assert.deepEqual(plan.groups.map((group) => [group.name, group.fileIds]), [['Videos', ['1']]]);
    assert.equal(plan.fileCount, 1);
    assert.equal(plan.newFolderCount, 1);
  });
});
