import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { filesEn } from '@/localization/catalogs/files.en';
import { filesUr } from '@/localization/catalogs/files.ur';

import { binRowLabels, binSubtitleLabels, deletedAgoLabel, deletesInLabel, keepLabel, type Label } from './bin-labels';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 26, 12, 0, 0);

/** The catalog text for a label, filled in (`fileManager.x` → `filesEn.x`). */
function render(label: Label, catalog: Record<string, string>): string {
  const text = catalog[label.key.replace('fileManager.', '')];
  assert.ok(text, label.key);
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(label.params?.[name] ?? `{${name}}`));
}

/** A mock of one of F13's `listBin()` rows. */
const binItem = (trashedDaysAgo: number, purgeInDays: number | null) => ({
  id: 'x',
  title: 'old_clip.mp4',
  fileType: 'video' as const,
  sizeBytes: 1,
  trashedAt: NOW - trashedDaysAgo * DAY,
  purgeAt: purgeInDays === null ? null : NOW + purgeInDays * DAY,
});

describe('Files F8 · design 58: the bin’s words', () => {
  test('Deleted today, 1 day ago, n days ago (a part day counts as none)', () => {
    assert.equal(render(deletedAgoLabel(NOW - 3_600_000, NOW), filesEn), 'Deleted today');
    assert.equal(render(deletedAgoLabel(NOW - DAY, NOW), filesEn), 'Deleted 1 day ago');
    assert.equal(render(deletedAgoLabel(NOW - DAY * 1.9, NOW), filesEn), 'Deleted 1 day ago');
    assert.equal(render(deletedAgoLabel(NOW - DAY * 5, NOW), filesEn), 'Deleted 5 days ago');
  });

  test('Deletes in: today, 1 day, n days; none when it is kept until the bin is emptied', () => {
    assert.equal(render(deletesInLabel(NOW, NOW)!, filesEn), 'Deletes today');
    assert.equal(render(deletesInLabel(NOW + DAY, NOW)!, filesEn), 'Deletes in 1 day');
    assert.equal(render(deletesInLabel(NOW + DAY * 27.5, NOW)!, filesEn), 'Deletes in 28 days');
    assert.equal(deletesInLabel(null, NOW), null);
    assert.deepEqual(
      binRowLabels(binItem(2, 28), NOW).map((label) => render(label, filesEn)),
      ['Deleted 2 days ago', 'Deletes in 28 days'],
    );
    assert.deepEqual(
      binRowLabels(binItem(2, null), NOW).map((label) => render(label, filesEn)),
      ['Deleted 2 days ago'],
    );
  });

  test('Keep deleted files and the header: "30 days", "Until I empty it", "3 items · 30 days"', () => {
    assert.equal(render(keepLabel(30), filesEn), '30 days');
    assert.equal(render(keepLabel(null), filesEn), 'Until I empty it');
    assert.deepEqual(
      binSubtitleLabels(3, 30).map((label) => render(label, filesEn)),
      ['3 items', '30 days'],
    );
    assert.deepEqual(
      binSubtitleLabels(1, null).map((label) => render(label, filesEn)),
      ['1 item', 'Until I empty it'],
    );
  });

  test('Urdu has every form, with the numbers filled in', () => {
    const labels: Label[] = [
      deletedAgoLabel(NOW, NOW),
      deletedAgoLabel(NOW - DAY, NOW),
      deletedAgoLabel(NOW - DAY * 5, NOW),
      deletesInLabel(NOW, NOW)!,
      deletesInLabel(NOW + DAY, NOW)!,
      deletesInLabel(NOW + DAY * 28, NOW)!,
      keepLabel(7),
      keepLabel(null),
      ...binSubtitleLabels(1, 14),
      ...binSubtitleLabels(3, 60),
    ];
    for (const label of labels) {
      const ur = render(label, filesUr);
      assert.notEqual(ur, render(label, filesEn), label.key);
      assert.ok(!/\{\w+\}/.test(ur), `${label.key}: ${ur}`);
    }
    assert.ok(render(deletedAgoLabel(NOW - DAY * 5, NOW), filesUr).includes('5'));
    assert.ok(render(keepLabel(60), filesUr).includes('60'));
  });
});
