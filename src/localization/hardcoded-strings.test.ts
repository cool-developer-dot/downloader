import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import { v2FailureMessage } from '@/downloads/v2/projection';
import { formatEtaLeft } from '@/screens/downloads/utils/eta-format';

import { en } from './en';
import { bindLanguageReader, getFlattenedCatalog } from './translate';
import { ur } from './ur';

afterEach(() => bindLanguageReader(() => 'en'));

const MOVED_SECTIONS = ['mediaResult.', 'queueScreen.', 'downloadEta.', 'downloadFailures.', 'browser.linkActions.'];

function keysOf(catalog: Record<string, string>): string[] {
  return Object.keys(catalog).filter((key) => MOVED_SECTIONS.some((prefix) => key.startsWith(prefix)));
}

describe('hard-coded English moved into the catalogs (fix/i18n-hardcoded)', () => {
  test('every moved string exists in English and Urdu, with the same placeholders', () => {
    const english = getFlattenedCatalog('en');
    const urdu = getFlattenedCatalog('ur');
    const keys = keysOf(english);
    assert.ok(keys.length >= 45, `found ${keys.length}`);
    assert.deepEqual(keysOf(urdu).sort(), [...keys].sort());
    for (const key of keys) {
      assert.ok(urdu[key]?.trim(), `${key} is empty in Urdu`);
      const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
      assert.deepEqual(placeholders(urdu[key]!), placeholders(english[key]!), key);
    }
    assert.ok(en.queueScreen && ur.queueScreen);
  });

  test('a failed v2 download says why in the app language', () => {
    assert.equal(v2FailureMessage('NO_SPACE'), 'Not enough storage.');
    bindLanguageReader(() => 'ur');
    assert.equal(v2FailureMessage('NO_SPACE'), ur.downloadFailures.NO_SPACE);
    assert.equal(v2FailureMessage(null), ur.downloadFailures.UNKNOWN);
  });

  test('a code without a translation yet keeps its English reason; an unknown one says it failed', () => {
    assert.equal(v2FailureMessage('NOT_A_CODE' as never), 'The download failed.');
    bindLanguageReader(() => 'ur');
    assert.equal(v2FailureMessage('NOT_A_CODE' as never), ur.downloadFailures.UNKNOWN);
  });

  test('every v2 failure reason the catalog knows is the one shown', () => {
    for (const [code, text] of Object.entries(en.downloadFailures)) {
      assert.equal(v2FailureMessage(code as never), text, code);
    }
  });

  test('the time left reads the same in English as before, and in Urdu', () => {
    assert.equal(formatEtaLeft(5.2), '6s left');
    assert.equal(formatEtaLeft(240), '4m left');
    assert.equal(formatEtaLeft(3_900), '1h 5m left');
    assert.equal(formatEtaLeft(7_200), '2h left');
    assert.equal(formatEtaLeft(0), null);
    assert.equal(formatEtaLeft(Number.NaN), null);
    bindLanguageReader(() => 'ur');
    assert.equal(formatEtaLeft(240), '4 منٹ باقی');
    assert.equal(formatEtaLeft(3_900), '1 گھنٹے 5 منٹ باقی');
  });
});
