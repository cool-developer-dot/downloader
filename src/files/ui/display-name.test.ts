import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { displayFileName } from './display-name';

describe('Files F2 #770: Show extensions', () => {
  test('"a.b.mp4" shows "a.b" with extensions off, and itself with them on', () => {
    assert.equal(displayFileName('a.b.mp4', false), 'a.b');
    assert.equal(displayFileName('a.b.mp4', true), 'a.b.mp4');
    assert.equal(displayFileName('clip.mp4', false), 'clip');
  });

  test('a name with no extension stays as it is', () => {
    assert.equal(displayFileName('README', false), 'README');
    assert.equal(displayFileName('trailing.', false), 'trailing.');
    assert.equal(displayFileName('ویڈیو', false), 'ویڈیو');
  });

  test('a name that is only ".mp4" stays ".mp4"', () => {
    assert.equal(displayFileName('.mp4', false), '.mp4');
    assert.equal(displayFileName('.mp4', true), '.mp4');
  });
});
