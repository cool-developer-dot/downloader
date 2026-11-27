import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createClashResolver, findClash, keepBothName, type ClashAnswer } from './name-clash';

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

  test('Do this for all: the answer given once is used for every later clash; without it, each clash asks', async () => {
    const asked: number[] = [];
    const answers: ClashAnswer[] = [
      { choice: 'skip', forAll: false },
      { choice: 'keep-both', forAll: true },
    ];
    const next = createClashResolver(async () => {
      asked.push(asked.length);
      return answers[asked.length - 1]!;
    });
    assert.equal(await next(), 'skip');
    assert.equal(await next(), 'keep-both');
    assert.equal(await next(), 'keep-both');
    assert.equal(await next(), 'keep-both');
    assert.equal(asked.length, 2);
  });

  test('" (2)" steps up to " (3)", and on past every number already taken (ignoring case)', () => {
    assert.equal(keepBothName('clip (2).mp4', ['clip (2).mp4']), 'clip (3).mp4');
    assert.equal(keepBothName('clip.mp4', ['clip.mp4', 'CLIP (2).mp4', 'clip (3).mp4']), 'clip (4).mp4');
  });
});
