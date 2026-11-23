/**
 * P8 #692 Customize Controls: the saved order and hidden set of a group of controls — hide, reorder, reset, and ids
 * that no longer exist or did not exist yet.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_CONTROLS_LAYOUT,
  arrangeControls,
  controlsInGroup,
  moveControl,
  normalizeControlsLayout,
  setControlShown,
  shownControls,
  withGroupLayout,
} from './controls-layout.ts';

const DEFAULTS = ['a', 'b', 'c', 'd', 'e'] as const;

describe('controls layout: reading it back', () => {
  it('keeps each group\'s strings once each, and drops what is not a group', () => {
    assert.deepEqual(normalizeControlsLayout(null), DEFAULT_CONTROLS_LAYOUT);
    assert.deepEqual(normalizeControlsLayout('chips'), {});
    assert.deepEqual(normalizeControlsLayout([1, 2]), {});
    assert.deepEqual(
      normalizeControlsLayout({
        chips: { order: ['b', 'a', 'b', 7, null, '', 'z'], hidden: 'a' },
        tiles: ['a'],
        dock: null,
        top: { hidden: ['x', 'x'] },
      }),
      {
        chips: { order: ['b', 'a', 'z'], hidden: [] },
        top: { order: [], hidden: ['x'] },
      },
    );
  });
});

describe('controls layout: order', () => {
  it('is the default order when nothing is saved (and after Reset)', () => {
    assert.deepEqual(arrangeControls(DEFAULTS, undefined), [...DEFAULTS]);
    assert.deepEqual(arrangeControls(DEFAULTS, null), [...DEFAULTS]);
    assert.deepEqual(arrangeControls(DEFAULTS, { order: [], hidden: [] }), [...DEFAULTS]);
    assert.deepEqual(shownControls(DEFAULTS, DEFAULT_CONTROLS_LAYOUT.chips), [...DEFAULTS]);
  });

  it('follows the saved order', () => {
    assert.deepEqual(arrangeControls(DEFAULTS, { order: ['e', 'd', 'c', 'b', 'a'], hidden: [] }), ['e', 'd', 'c', 'b', 'a']);
  });

  it('drops a saved id that no longer exists, and duplicates', () => {
    assert.deepEqual(
      arrangeControls(DEFAULTS, { order: ['gone', 'c', 'a', 'c', 'b', 'old', 'e', 'd'], hidden: [] }),
      ['c', 'a', 'b', 'e', 'd'],
    );
    assert.deepEqual(arrangeControls(DEFAULTS, { order: ['gone', 'older'], hidden: [] }), [...DEFAULTS]);
  });

  it('puts a control the saved order does not know right after its nearest earlier default neighbour', () => {
    // 'c' is new: its default neighbour before it is 'b'.
    assert.deepEqual(arrangeControls(DEFAULTS, { order: ['e', 'b', 'a', 'd'], hidden: [] }), ['e', 'b', 'c', 'a', 'd']);
    // 'a' is new and first by default: it goes to the front.
    assert.deepEqual(arrangeControls(DEFAULTS, { order: ['c', 'b', 'e', 'd'], hidden: [] }), ['a', 'c', 'b', 'e', 'd']);
    // Several new ones: each after its nearest earlier neighbour (b, c after a; e after d).
    assert.deepEqual(arrangeControls(DEFAULTS, { order: ['d', 'a'], hidden: [] }), ['d', 'e', 'a', 'b', 'c']);
    // A control added at the end of the code's list goes right after the one before it there, wherever that is now.
    assert.deepEqual(arrangeControls([...DEFAULTS, 'f'], { order: ['e', 'd', 'c', 'b', 'a'], hidden: [] }), [
      'e',
      'f',
      'd',
      'c',
      'b',
      'a',
    ]);
  });
});

describe('controls layout: show and hide', () => {
  it('hides the saved hidden ids; everything else (a new control too) shows', () => {
    const saved = { order: ['b', 'a', 'c', 'd'], hidden: ['a', 'd', 'gone'] };
    assert.deepEqual(controlsInGroup(DEFAULTS, saved), [
      { id: 'b', shown: true },
      { id: 'a', shown: false },
      { id: 'c', shown: true },
      { id: 'd', shown: false },
      { id: 'e', shown: true },
    ]);
    assert.deepEqual(shownControls(DEFAULTS, saved), ['b', 'c', 'e']);
  });

  it('hides and shows one control, keeping the order the user sees', () => {
    const hidden = setControlShown(DEFAULTS, undefined, 'c', false);
    assert.deepEqual(hidden, { order: [...DEFAULTS], hidden: ['c'] });
    assert.deepEqual(shownControls(DEFAULTS, hidden), ['a', 'b', 'd', 'e']);
    const again = setControlShown(DEFAULTS, hidden, 'c', true);
    assert.deepEqual(again.hidden, []);
    assert.deepEqual(shownControls(DEFAULTS, again), [...DEFAULTS]);
    // Hiding twice keeps one entry; an id the group does not have is not saved.
    assert.deepEqual(setControlShown(DEFAULTS, hidden, 'c', false).hidden, ['c']);
    assert.deepEqual(setControlShown(DEFAULTS, hidden, 'zz' as never, false).hidden, ['c']);
  });

  it('saves only what the user could see (an id that no longer exists is dropped on the next change)', () => {
    const saved = { order: ['gone', 'b', 'a'], hidden: ['gone', 'a'] };
    assert.deepEqual(setControlShown(DEFAULTS, saved, 'e', false), {
      order: ['b', 'c', 'd', 'e', 'a'],
      hidden: ['a', 'e'],
    });
  });
});

describe('controls layout: moving', () => {
  it('swaps a control with its neighbour', () => {
    assert.deepEqual(moveControl(DEFAULTS, undefined, 'c', -1), { order: ['a', 'c', 'b', 'd', 'e'], hidden: [] });
    assert.deepEqual(moveControl(DEFAULTS, undefined, 'c', 1), { order: ['a', 'b', 'd', 'c', 'e'], hidden: [] });
  });

  it('cannot move the first one earlier, the last one later, or a control the group does not have', () => {
    assert.equal(moveControl(DEFAULTS, undefined, 'a', -1), null);
    assert.equal(moveControl(DEFAULTS, undefined, 'e', 1), null);
    assert.equal(moveControl(DEFAULTS, undefined, 'zz' as never, 1), null);
  });

  it('moves among every control of the group, hidden ones included, and keeps them hidden', () => {
    const saved = { order: ['a', 'b', 'c', 'd', 'e'], hidden: ['b'] };
    const moved = moveControl(DEFAULTS, saved, 'c', -1);
    assert.deepEqual(moved, { order: ['a', 'c', 'b', 'd', 'e'], hidden: ['b'] });
    assert.deepEqual(shownControls(DEFAULTS, moved), ['a', 'c', 'd', 'e']);
  });

  it('builds on a saved order with unknown and missing ids', () => {
    const saved = { order: ['e', 'gone', 'a'], hidden: [] };
    // Arranged: e, a, b, c, d (b, c, d new after a). Move d up one.
    assert.deepEqual(moveControl(DEFAULTS, saved, 'd', -1)?.order, ['e', 'a', 'b', 'd', 'c']);
  });

  it('replaces one group and leaves the others', () => {
    const layout = { chips: { order: ['b'], hidden: [] }, tiles: { order: [], hidden: ['x'] } };
    const next = withGroupLayout(layout, 'chips', { order: ['a'], hidden: ['b'] });
    assert.deepEqual(next, { chips: { order: ['a'], hidden: ['b'] }, tiles: { order: [], hidden: ['x'] } });
    assert.deepEqual(layout.chips, { order: ['b'], hidden: [] });
  });
});
