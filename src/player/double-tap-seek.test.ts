import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { doubleTapSeekDelta, resolveDoubleTapAction } from './double-tap-seek.ts';

describe('resolveDoubleTapAction', () => {
  const width = 900; // thirds at 300 and 600

  it('splits the surface in thirds: −10 s, play/pause, +10 s', () => {
    assert.equal(resolveDoubleTapAction(0, width, false), 'seekBack');
    assert.equal(resolveDoubleTapAction(150, width, false), 'seekBack');
    assert.equal(resolveDoubleTapAction(450, width, false), 'togglePlay');
    assert.equal(resolveDoubleTapAction(750, width, false), 'seekForward');
    assert.equal(resolveDoubleTapAction(900, width, false), 'seekForward');
  });

  it('puts exactly 1/3 and exactly 2/3 in the middle (play/pause)', () => {
    assert.equal(resolveDoubleTapAction(299.999, width, false), 'seekBack');
    assert.equal(resolveDoubleTapAction(300, width, false), 'togglePlay');
    assert.equal(resolveDoubleTapAction(600, width, false), 'togglePlay');
    assert.equal(resolveDoubleTapAction(600.001, width, false), 'seekForward');
    // A width that does not divide by 3.
    assert.equal(resolveDoubleTapAction(1000 / 3, 1000, false), 'togglePlay');
    assert.equal(resolveDoubleTapAction(2000 / 3, 1000, false), 'togglePlay');
  });

  it('only resets the zoom while zoomed, wherever the tap lands', () => {
    for (const x of [0, 150, 450, 750, 900]) {
      assert.equal(resolveDoubleTapAction(x, width, true), 'resetZoom', String(x));
    }
    assert.equal(resolveDoubleTapAction(450, 0, true), 'resetZoom');
  });

  it('does nothing with a zero or unknown width (not zoomed)', () => {
    assert.equal(resolveDoubleTapAction(10, 0, false), null);
    assert.equal(resolveDoubleTapAction(10, -5, false), null);
    assert.equal(resolveDoubleTapAction(Number.NaN, width, false), null);
    assert.equal(resolveDoubleTapAction(10, Number.POSITIVE_INFINITY, false), null);
  });

  it('seeks 10 s each way', () => {
    assert.equal(doubleTapSeekDelta('left'), -10);
    assert.equal(doubleTapSeekDelta('right'), 10);
  });
});
