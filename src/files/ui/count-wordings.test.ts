import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { translatePlural } from '@/localization/translate';

import { organizeDoneForms, renameTitleForms, rowSizeExactForms, tagAddedForms, type CountForms } from './count-wordings';

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
