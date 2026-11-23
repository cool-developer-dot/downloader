/**
 * P8 #692 Customize Controls on the Player: with nothing saved the page and full screen draw exactly what they drew
 * before P8; the Audio chip follows its flag; the 1.0× chip, A–B repeat and Up next are ordinary controls; stored ids
 * from other versions are handled.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { controlsInGroup, moveControl, setControlShown, withGroupLayout, type ControlsLayout } from '../../../player/controls-layout.ts';

import {
  CONTROL_GROUPS,
  CONTROL_GROUP_REORDERS,
  arrangedGroup,
  availableControls,
  fullscreenDockButtons,
  fullscreenTopButtons,
  fullscreenVideoButtons,
  pageCardShown,
  pageChipsToDraw,
  pageTilesToDraw,
} from './player-controls-customize.ts';
import { PAGE_CHIP_FLAGS, PAGE_TILES, shownPageChips } from './player-page-actions.ts';

const NOTHING: ControlsLayout = {};
const AUDIO_ON = { ...PAGE_CHIP_FLAGS, audio: true };

describe('customize controls: nothing saved is today\'s Player', () => {
  it('draws the page\'s chips, tiles and Up next as before', () => {
    assert.deepEqual(pageChipsToDraw(NOTHING), shownPageChips());
    assert.deepEqual(pageChipsToDraw(NOTHING), ['speed', 'subs', 'rotate', 'lock']);
    assert.deepEqual(pageTilesToDraw(NOTHING), [...PAGE_TILES]);
    assert.equal(pageTilesToDraw(NOTHING)[0], PAGE_TILES[0]);
    assert.equal(pageCardShown(NOTHING, 'upNext'), true);
  });

  it('draws the full-screen buttons as before', () => {
    assert.deepEqual(fullscreenTopButtons(NOTHING), ['orientation', 'fullscreen']);
    assert.deepEqual(fullscreenVideoButtons(NOTHING), { skipButtons: true, previousNext: true, lock: true });
    assert.deepEqual(fullscreenDockButtons(NOTHING), ['mute', 'speed']);
  });

  it('lists the groups in the sheet\'s order; the fixed places only show or hide', () => {
    assert.deepEqual([...CONTROL_GROUPS], ['pageChips', 'pageTiles', 'pageCards', 'fullscreenTop', 'fullscreenVideo', 'fullscreenDock']);
    assert.deepEqual(
      CONTROL_GROUPS.filter((group) => !CONTROL_GROUP_REORDERS[group]),
      ['pageCards', 'fullscreenVideo'],
    );
  });
});

describe('customize controls: the page', () => {
  it('hides and moves chips, the 1.0× chip (Faran\'s P16) too', () => {
    const available = availableControls('pageChips');
    let chips = setControlShown(available, undefined, 'speed', false);
    let layout = withGroupLayout(NOTHING, 'pageChips', chips);
    assert.deepEqual(pageChipsToDraw(layout), ['subs', 'rotate', 'lock']);
    chips = setControlShown(available, chips, 'speed', true);
    chips = moveControl(available, chips, 'speed', 1)!;
    chips = moveControl(available, chips, 'speed', 1)!;
    layout = withGroupLayout(layout, 'pageChips', chips);
    assert.deepEqual(pageChipsToDraw(layout), ['subs', 'rotate', 'speed', 'lock']);
  });

  it('keeps the Audio chip out of the list and off the page while its flag is off', () => {
    assert.deepEqual(availableControls('pageChips'), ['speed', 'subs', 'rotate', 'lock']);
    assert.ok(!controlsInGroup(availableControls('pageChips'), undefined).some((entry) => entry.id === 'audio'));
    // A saved order that names it (an older build where it showed) still does not draw it.
    const layout = { pageChips: { order: ['audio', 'lock', 'speed', 'subs', 'rotate'], hidden: [] } };
    assert.deepEqual(pageChipsToDraw(layout), ['lock', 'speed', 'subs', 'rotate']);
  });

  it('shows the Audio chip, in its default place after Subs, once P17 turns its flag on — with nothing more to do', () => {
    assert.deepEqual(availableControls('pageChips', AUDIO_ON), ['speed', 'subs', 'audio', 'rotate', 'lock']);
    assert.deepEqual(pageChipsToDraw(NOTHING, AUDIO_ON), ['speed', 'subs', 'audio', 'rotate', 'lock']);
    // The user reordered while Audio was hidden: Lock first, Subs last.
    const available = availableControls('pageChips');
    let chips = moveControl(available, undefined, 'lock', -1)!;
    chips = moveControl(available, chips, 'lock', -1)!;
    chips = moveControl(available, chips, 'lock', -1)!;
    chips = moveControl(available, chips, 'subs', 1)!;
    assert.equal(moveControl(available, chips, 'subs', 1), null); // already last
    assert.deepEqual(chips.order, ['lock', 'speed', 'rotate', 'subs']);
    const layout = withGroupLayout(NOTHING, 'pageChips', chips);
    assert.deepEqual(pageChipsToDraw(layout), ['lock', 'speed', 'rotate', 'subs']);
    assert.deepEqual(pageChipsToDraw(layout, AUDIO_ON), ['lock', 'speed', 'rotate', 'subs', 'audio']);
    // And it can be hidden or moved like any chip from then on.
    const listed = controlsInGroup(availableControls('pageChips', AUDIO_ON), layout.pageChips).map((entry) => entry.id);
    assert.deepEqual(listed, ['lock', 'speed', 'rotate', 'subs', 'audio']);
  });

  it('treats A–B repeat and Up next (P5 / P6) like any other control', () => {
    const tiles = PAGE_TILES.map((tile) => tile.id);
    assert.ok(tiles.includes('abRepeat'));
    const hidden = setControlShown(availableControls('pageTiles'), undefined, 'abRepeat', false);
    assert.deepEqual(
      pageTilesToDraw(withGroupLayout(NOTHING, 'pageTiles', hidden)).map((tile) => tile.id),
      ['skipBack', 'customSeek', 'frameByFrame', 'aspectRatio', 'mirrorFlip'],
    );
    const moved = moveControl(availableControls('pageTiles'), undefined, 'abRepeat', -1)!;
    assert.deepEqual(
      pageTilesToDraw(withGroupLayout(NOTHING, 'pageTiles', moved)).map((tile) => tile.id),
      ['skipBack', 'customSeek', 'abRepeat', 'frameByFrame', 'aspectRatio', 'mirrorFlip'],
    );
    const noUpNext = withGroupLayout(NOTHING, 'pageCards', setControlShown(availableControls('pageCards'), undefined, 'upNext', false));
    assert.equal(pageCardShown(noUpNext, 'upNext'), false);
  });

  it('drops a stored tile that no longer exists and adds a new one at its default place', () => {
    // Stored by a build that had a "filters" tile and no Mirror / Flip yet.
    const layout = {
      pageTiles: { order: ['aspectRatio', 'filters', 'skipBack', 'customSeek', 'frameByFrame', 'abRepeat'], hidden: ['filters'] },
    };
    assert.deepEqual(
      pageTilesToDraw(layout).map((tile) => tile.id),
      ['aspectRatio', 'mirrorFlip', 'skipBack', 'customSeek', 'frameByFrame', 'abRepeat'],
    );
    assert.deepEqual(arrangedGroup(layout, 'pageTiles'), ['aspectRatio', 'mirrorFlip', 'skipBack', 'customSeek', 'frameByFrame', 'abRepeat']);
  });
});

describe('customize controls: full screen', () => {
  it('reorders and hides the top bar\'s and the bottom bar\'s buttons', () => {
    const top = moveControl(availableControls('fullscreenTop'), undefined, 'fullscreen', -1)!;
    const dock = setControlShown(availableControls('fullscreenDock'), moveControl(availableControls('fullscreenDock'), undefined, 'speed', -1), 'mute', false);
    const layout = withGroupLayout(withGroupLayout(NOTHING, 'fullscreenTop', top), 'fullscreenDock', dock);
    assert.deepEqual(fullscreenTopButtons(layout), ['fullscreen', 'orientation']);
    assert.deepEqual(fullscreenDockButtons(layout), ['speed']);
    assert.deepEqual(arrangedGroup(layout, 'fullscreenDock'), ['speed', 'mute']);
  });

  it('hides the buttons on the video one by one', () => {
    const available = availableControls('fullscreenVideo');
    let group = setControlShown(available, undefined, 'skipButtons', false);
    assert.deepEqual(fullscreenVideoButtons(withGroupLayout(NOTHING, 'fullscreenVideo', group)), {
      skipButtons: false,
      previousNext: true,
      lock: true,
    });
    group = setControlShown(available, group, 'lock', false);
    group = setControlShown(available, group, 'previousNext', false);
    assert.deepEqual(fullscreenVideoButtons(withGroupLayout(NOTHING, 'fullscreenVideo', group)), {
      skipButtons: false,
      previousNext: false,
      lock: false,
    });
  });

  it('is back to today\'s Player after Reset (nothing saved)', () => {
    const layout = withGroupLayout(NOTHING, 'fullscreenTop', setControlShown(availableControls('fullscreenTop'), undefined, 'orientation', false));
    assert.deepEqual(fullscreenTopButtons(layout), ['fullscreen']);
    const reset: ControlsLayout = {};
    assert.deepEqual(fullscreenTopButtons(reset), ['orientation', 'fullscreen']);
    assert.deepEqual(pageChipsToDraw(reset), shownPageChips());
  });
});
