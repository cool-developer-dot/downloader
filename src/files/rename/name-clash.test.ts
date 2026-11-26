import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { findClash, keepBothName } from './name-clash';

describe('Files F5 #797: name clashes', () => {
  test('a clash ignores case', () => {
    assert.equal(findClash('Clip.MP4', ['other.mp4', 'clip.mp4']), 'clip.mp4');
    assert.equal(findClash('clip.mov', ['clip.mp4']), null);
    assert.equal(findClash('سفر.mp4', ['سفر.mp4']), 'سفر.mp4');
  });

  test('Keep both adds " (2)" before the extension', () => {
    assert.equal(keepBothName('clip.mp4', ['clip.mp4']), 'clip (2).mp4');
    assert.equal(keepBothName('README', ['README']), 'README (2)');
  });

  test('" (2)" steps up to " (3)", and on past every number already taken (ignoring case)', () => {
    assert.equal(keepBothName('clip (2).mp4', ['clip (2).mp4']), 'clip (3).mp4');
    assert.equal(keepBothName('clip.mp4', ['clip.mp4', 'CLIP (2).mp4', 'clip (3).mp4']), 'clip (4).mp4');
  });
});
