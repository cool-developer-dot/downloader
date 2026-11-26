import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { batchRename, canApplyRename, ILLEGAL_NAME_CHARACTERS, nameProblem, renameOne, splitExtension } from './batch-rename';

const names = (results: { to: string }[]) => results.map((result) => result.to);

describe('Files F5 #793 / #794: batch rename', () => {
  test('Replace text: every match, ignoring case unless asked; the extension is kept', () => {
    assert.deepEqual(names(batchRename(['Trip day.mp4', 'trip night.mov'], { kind: 'replace', find: 'trip', replaceWith: 'Tour' })), [
      'Tour day.mp4',
      'Tour night.mov',
    ]);
    assert.equal(renameOne('a-b-c.mp4', 0, { kind: 'replace', find: '-', replaceWith: ' ' }), 'a b c.mp4');
    assert.equal(renameOne('Trip.mp4', 0, { kind: 'replace', find: 'trip', replaceWith: 'X', matchCase: true }), 'Trip.mp4');
    // The extension is never touched, even when it matches.
    assert.equal(renameOne('mp4 clip.mp4', 0, { kind: 'replace', find: 'mp4', replaceWith: 'video' }), 'video clip.mp4');
  });

  test('Add prefix or suffix', () => {
    assert.equal(renameOne('clip.mp4', 0, { kind: 'affix', prefix: '2026 - ', suffix: ' (final)' }), '2026 - clip (final).mp4');
    assert.equal(renameOne('clip.mp4', 0, { kind: 'affix', prefix: '', suffix: '_v2' }), 'clip_v2.mp4');
  });

  test('Number them: start number, 1–4 digits of padding, before or after; a new name for all', () => {
    const results = batchRename(['a.mp4', 'b.mp4', 'c.mp4'], { kind: 'number', start: 1, digits: 2, position: 'after', text: 'Trip' });
    assert.deepEqual(names(results), ['Trip 01.mp4', 'Trip 02.mp4', 'Trip 03.mp4']);
    assert.equal(renameOne('clip.mp4', 0, { kind: 'number', start: 7, digits: 3, position: 'before' }), '007 clip.mp4');
    assert.equal(renameOne('clip.mp4', 4, { kind: 'number', start: 1, digits: 4, position: 'after' }), 'clip 0005.mp4');
    // Digits are kept within 1–4.
    assert.equal(renameOne('clip.mp4', 0, { kind: 'number', start: 3, digits: 9, position: 'after' }), 'clip 0003.mp4');
    assert.equal(renameOne('clip.mp4', 0, { kind: 'number', start: 3, digits: 0, position: 'after' }), 'clip 3.mp4');
  });

  test('Change case', () => {
    assert.equal(renameOne('my holiday clip.MP4', 0, { kind: 'case', to: 'upper' }), 'MY HOLIDAY CLIP.MP4');
    assert.equal(renameOne('My Holiday.mp4', 0, { kind: 'case', to: 'lower' }), 'my holiday.mp4');
    assert.equal(renameOne('my holiday-trip.mp4', 0, { kind: 'case', to: 'title' }), 'My Holiday-Trip.mp4');
    assert.equal(renameOne('MY HOLIDAY.mp4', 0, { kind: 'case', to: 'sentence' }), 'My holiday.mp4');
  });

  test('Urdu and emoji names keep working; the extension is kept', () => {
    assert.equal(renameOne('سفر.mp4', 0, { kind: 'affix', prefix: '2026 ', suffix: '' }), '2026 سفر.mp4');
    assert.equal(renameOne('سفر.mp4', 1, { kind: 'number', start: 1, digits: 2, position: 'after' }), 'سفر 02.mp4');
    assert.equal(renameOne('🎬 clip 🎉.mp4', 0, { kind: 'replace', find: '🎉', replaceWith: '✨' }), '🎬 clip ✨.mp4');
    assert.equal(renameOne('🎬 clip.mp4', 0, { kind: 'case', to: 'upper' }), '🎬 CLIP.mp4');
    assert.equal(nameProblem('ویڈیو 🎬.mp4'), null);
    assert.deepEqual(splitExtension('a.b.mp4'), ['a.b', '.mp4']);
    assert.deepEqual(splitExtension('.mp4'), ['.mp4', '']);
  });

  test('problems: empty, over 120 characters, every illegal character', () => {
    assert.equal(renameOne('clip.mp4', 0, { kind: 'replace', find: 'clip', replaceWith: '' }), '.mp4');
    assert.equal(batchRename(['clip.mp4'], { kind: 'replace', find: 'clip', replaceWith: '' })[0]!.problem, 'empty');
    assert.equal(nameProblem(`${'a'.repeat(117)}.mp4`), 'too-long');
    assert.equal(nameProblem(`${'a'.repeat(116)}.mp4`), null);
    for (const character of ILLEGAL_NAME_CHARACTERS) {
      assert.equal(nameProblem(`a${character}b.mp4`), 'illegal-characters', character);
    }
    assert.equal(ILLEGAL_NAME_CHARACTERS.length, 9);
  });

  test('duplicates: two new names that are the same (ignoring case) both say so, and nothing can be applied', () => {
    const results = batchRename(['a.mp4', 'b.mp4', 'c.mov'], { kind: 'replace', find: '', replaceWith: '' });
    assert.ok(results.every((result) => result.problem === null));
    assert.equal(canApplyRename(results), false, 'nothing changes');
    const clash = batchRename(['Trip.mp4', 'TRIP.mp4', 'other.mp4'], { kind: 'case', to: 'lower' });
    assert.deepEqual(
      clash.map((result) => result.problem),
      ['duplicate', 'duplicate', null],
    );
    assert.equal(canApplyRename(clash), false);
    assert.equal(canApplyRename(batchRename(['a.mp4', 'b.mp4'], { kind: 'affix', prefix: 'x ', suffix: '' })), true);
  });
});
