import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { voiceLanguageTag } from './voice-language';

describe('#31 voice search language', () => {
  test('Urdu asks for Pakistani Urdu; everything else keeps the phone default', () => {
    assert.equal(voiceLanguageTag('ur'), 'ur-PK');
    assert.equal(voiceLanguageTag('en'), null);
    assert.equal(voiceLanguageTag(null), null);
    assert.equal(voiceLanguageTag(undefined), null);
  });
});
