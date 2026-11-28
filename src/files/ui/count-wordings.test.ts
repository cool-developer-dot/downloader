import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { translatePlural } from '@/localization/translate';

import {
  addFilesDoneForms,
  addFilesFailedForms,
  hiddenCountForms,
  movedCountForms,
  moveFailedForms,
  organizeDoneForms,
  renamedCountForms,
  renameTitleForms,
  rowSizeExactForms,
  tagAddedForms,
  undoFailedForms,
  type CountForms,
} from './count-wordings';

/** The wording for `count` in English and in Urdu, through the app's plural helper — the call the screens make. */
function say(count: number, forms: CountForms, params?: Record<string, string | number>): { en: string; ur: string } {
  return { en: translatePlural(count, forms, params, 'en'), ur: translatePlural(count, forms, params, 'ur') };
}

describe('Files: 1 is singular, 0 and 2 or more are plural, in English and Urdu', () => {
  test('F5 · the batch rename header: Rename 1 file, Rename 2 files', () => {
    assert.deepEqual(say(1, renameTitleForms), { en: 'Rename 1 file', ur: '1 فائل کا نام بدلیں' });
    assert.deepEqual(say(2, renameTitleForms), { en: 'Rename 2 files', ur: '2 فائلوں کا نام بدلیں' });
    assert.deepEqual(say(12, renameTitleForms), { en: 'Rename 12 files', ur: '12 فائلوں کا نام بدلیں' });
  });

  test('F7 · the tag toast: “Trip” added to 1 file, to 3 files', () => {
    assert.deepEqual(say(1, tagAddedForms, { tag: 'Trip' }), { en: '“Trip” added to 1 file', ur: '“Trip” 1 فائل میں شامل ہو گیا' });
    assert.deepEqual(say(2, tagAddedForms, { tag: 'Trip' }), { en: '“Trip” added to 2 files', ur: '“Trip” 2 فائلوں میں شامل ہو گیا' });
    assert.deepEqual(say(3, tagAddedForms, { tag: 'Trip' }), { en: '“Trip” added to 3 files', ur: '“Trip” 3 فائلوں میں شامل ہو گیا' });
  });

  test('F7 · the Organize now toast: 1 file organized, 2 files organized (0 stays plural)', () => {
    assert.deepEqual(say(1, organizeDoneForms), { en: '1 file organized', ur: '1 فائل ترتیب دی گئی' });
    assert.deepEqual(say(2, organizeDoneForms), { en: '2 files organized', ur: '2 فائلیں ترتیب دی گئیں' });
    assert.deepEqual(say(25, organizeDoneForms), { en: '25 files organized', ur: '25 فائلیں ترتیب دی گئیں' });
    assert.deepEqual(say(0, organizeDoneForms), { en: '0 files organized', ur: '0 فائلیں ترتیب دی گئیں' });
  });

  test('F3 · File details’ exact size: 1 byte, 2 bytes, 1,024 bytes', () => {
    assert.deepEqual(say(1, rowSizeExactForms, { bytes: '1' }), { en: '1 byte', ur: '1 بائٹ' });
    assert.deepEqual(say(2, rowSizeExactForms, { bytes: '2' }), { en: '2 bytes', ur: '2 بائٹس' });
    assert.deepEqual(say(1024, rowSizeExactForms, { bytes: '1,024' }), { en: '1,024 bytes', ur: '1,024 بائٹس' });
  });
});

describe('Files: for 1 file the Urdu verb is singular; the English stays as it was', () => {
  test('F4 · the Move toast: 1 moved to Trips, 3 moved to Trips', () => {
    assert.deepEqual(say(1, movedCountForms, { folder: 'Trips' }), { en: '1 moved to Trips', ur: '1 Trips میں منتقل ہو گئی' });
    assert.deepEqual(say(3, movedCountForms, { folder: 'Trips' }), { en: '3 moved to Trips', ur: '3 Trips میں منتقل ہو گئیں' });
  });

  test('F4 and F10 · couldn’t be moved: 1, 2', () => {
    assert.deepEqual(say(1, moveFailedForms), { en: '1 couldn’t be moved', ur: '1 منتقل نہیں ہو سکی' });
    assert.deepEqual(say(2, moveFailedForms), { en: '2 couldn’t be moved', ur: '2 منتقل نہیں ہو سکیں' });
  });

  test('F5 · the batch rename result: 1 renamed, 4 renamed', () => {
    assert.deepEqual(say(1, renamedCountForms), { en: '1 renamed', ur: '1 کا نام بدل گیا' });
    assert.deepEqual(say(4, renamedCountForms), { en: '4 renamed', ur: '4 کے نام بدل گئے' });
  });

  test('F7 · the Hide toast: 1 hidden, 2 hidden', () => {
    assert.deepEqual(say(1, hiddenCountForms), {
      en: '1 hidden. To lock files, use Private folder.',
      ur: '1 چھپا دی گئی۔ فائلیں لاک کرنے کے لیے پرائیویٹ فولڈر استعمال کریں۔',
    });
    assert.deepEqual(say(2, hiddenCountForms), {
      en: '2 hidden. To lock files, use Private folder.',
      ur: '2 چھپا دی گئیں۔ فائلیں لاک کرنے کے لیے پرائیویٹ فولڈر استعمال کریں۔',
    });
  });

  test('F10 · Add files to Private, moved: 1, 5', () => {
    assert.deepEqual(say(1, addFilesDoneForms), { en: '1 moved to Private', ur: '1 پرائیویٹ میں منتقل ہو گئی' });
    assert.deepEqual(say(5, addFilesDoneForms), { en: '5 moved to Private', ur: '5 پرائیویٹ میں منتقل ہو گئیں' });
  });

  test('F10 · Add files to Private, not moved: 1, 2', () => {
    assert.deepEqual(say(1, addFilesFailedForms), {
      en: '1 couldn’t be moved and stayed in your library',
      ur: '1 منتقل نہیں ہو سکی اور لائبریری میں ہی رہی',
    });
    assert.deepEqual(say(2, addFilesFailedForms), {
      en: '2 couldn’t be moved and stayed in your library',
      ur: '2 منتقل نہیں ہو سکیں اور لائبریری میں ہی رہیں',
    });
  });

  test('F8 · the Undo bar’s couldn’t be deleted: 1, 3', () => {
    assert.deepEqual(say(1, undoFailedForms), { en: '1 couldn’t be deleted', ur: '1 ڈیلیٹ نہیں ہو سکی' });
    assert.deepEqual(say(3, undoFailedForms), { en: '3 couldn’t be deleted', ur: '3 ڈیلیٹ نہیں ہو سکیں' });
  });
});
