/**
 * P8 #692 Customize Controls: which controls the user can show, hide and move, in which groups, and what each screen
 * part draws from the saved layout (the rules are in `src/player/controls-layout.ts`).
 *
 * Groups (a control moves only inside its own group, where it is drawn):
 * - Page (screen 19): the chips (1.0× · Subs · Audio · Rotate · Lock), the tiles, and the Up next card.
 * - Full screen: the top bar's rotation-lock and full-screen buttons; on the video, the ⏪ / ⏩ pair, the ⏮ / ⏭ pair
 *   (shown only with a list) and the lock button; the bottom bar's mute button and speed chip.
 *
 * Never listed, so never hidden: play / pause, Back, the title, ⋮ (the way back to this sheet and its Reset), the
 * timeline, "Save to VidoraX" for a file from another app, and the locked screen's unlock pill.
 *
 * With nothing saved every helper here returns exactly what the Player drew before P8 (tested).
 */

import {
  arrangeControls,
  shownControls,
  type ControlGroupLayout,
  type ControlsLayout,
} from '@/player/controls-layout';

import { PAGE_CHIP_FLAGS, PAGE_TILES, shownPageChips, type PageChip, type PageTile } from './player-page-actions';

export const FULLSCREEN_TOP_BUTTONS = ['orientation', 'fullscreen'] as const;
export type FullscreenTopButton = (typeof FULLSCREEN_TOP_BUTTONS)[number];

export const FULLSCREEN_VIDEO_BUTTONS = ['skipButtons', 'previousNext', 'lock'] as const;
export type FullscreenVideoButton = (typeof FULLSCREEN_VIDEO_BUTTONS)[number];

export const FULLSCREEN_DOCK_BUTTONS = ['mute', 'speed'] as const;
export type FullscreenDockButton = (typeof FULLSCREEN_DOCK_BUTTONS)[number];

export const PAGE_CARDS = ['upNext'] as const;
export type PageCard = (typeof PAGE_CARDS)[number];

export const CONTROL_GROUPS = [
  'pageChips',
  'pageTiles',
  'pageCards',
  'fullscreenTop',
  'fullscreenVideo',
  'fullscreenDock',
] as const;

export type ControlGroupId = (typeof CONTROL_GROUPS)[number];

/** Whether the group's controls can be moved (a group of one, or one whose places are fixed, only shows / hides). */
export const CONTROL_GROUP_REORDERS: Readonly<Record<ControlGroupId, boolean>> = {
  pageChips: true,
  pageTiles: true,
  pageCards: false,
  fullscreenTop: true,
  // ⏪ ⏩ sit either side of play / pause, ⏮ ⏭ outside them, the lock in its corner: places, not an order.
  fullscreenVideo: false,
  fullscreenDock: true,
};

/** The controls a group can draw now, in the default order (the Audio chip only once its flag is on). */
export function availableControls(
  group: ControlGroupId,
  chipFlags: Readonly<Record<PageChip, boolean>> = PAGE_CHIP_FLAGS,
): readonly string[] {
  switch (group) {
    case 'pageChips':
      return shownPageChips(chipFlags);
    case 'pageTiles':
      return PAGE_TILES.map((tile) => tile.id);
    case 'pageCards':
      return PAGE_CARDS;
    case 'fullscreenTop':
      return FULLSCREEN_TOP_BUTTONS;
    case 'fullscreenVideo':
      return FULLSCREEN_VIDEO_BUTTONS;
    case 'fullscreenDock':
    default:
      return FULLSCREEN_DOCK_BUTTONS;
  }
}

function groupLayout(layout: ControlsLayout, group: ControlGroupId): ControlGroupLayout | undefined {
  return layout[group];
}

/** The page's chips to draw, in the user's order. Nothing saved → `shownPageChips()`. */
export function pageChipsToDraw(
  layout: ControlsLayout,
  chipFlags: Readonly<Record<PageChip, boolean>> = PAGE_CHIP_FLAGS,
): PageChip[] {
  return shownControls(shownPageChips(chipFlags), groupLayout(layout, 'pageChips'));
}

/** The page's tiles to draw, in the user's order. Nothing saved → `PAGE_TILES`. */
export function pageTilesToDraw(layout: ControlsLayout): PageTile[] {
  const byId = new Map(PAGE_TILES.map((tile) => [tile.id, tile] as const));
  return shownControls(
    PAGE_TILES.map((tile) => tile.id),
    groupLayout(layout, 'pageTiles'),
  ).map((id) => byId.get(id)!);
}

/** Whether a page card (Up next) is drawn. */
export function pageCardShown(layout: ControlsLayout, card: PageCard): boolean {
  return shownControls(PAGE_CARDS, groupLayout(layout, 'pageCards')).includes(card);
}

/** The full-screen top bar's buttons after the title, in the user's order. Nothing saved → rotation lock, full screen. */
export function fullscreenTopButtons(layout: ControlsLayout): FullscreenTopButton[] {
  return shownControls(FULLSCREEN_TOP_BUTTONS, groupLayout(layout, 'fullscreenTop'));
}

/** Which of the full-screen buttons on the video are drawn. Nothing saved → all of them. */
export function fullscreenVideoButtons(layout: ControlsLayout): Record<FullscreenVideoButton, boolean> {
  const shown = shownControls(FULLSCREEN_VIDEO_BUTTONS, groupLayout(layout, 'fullscreenVideo'));
  return {
    skipButtons: shown.includes('skipButtons'),
    previousNext: shown.includes('previousNext'),
    lock: shown.includes('lock'),
  };
}

/** The full-screen bottom bar's buttons, in the user's order. Nothing saved → mute, then the speed chip. */
export function fullscreenDockButtons(layout: ControlsLayout): FullscreenDockButton[] {
  return shownControls(FULLSCREEN_DOCK_BUTTONS, groupLayout(layout, 'fullscreenDock'));
}

/** The group's controls in the user's order (for the sheet's position announcements). */
export function arrangedGroup(layout: ControlsLayout, group: ControlGroupId): string[] {
  return arrangeControls(availableControls(group), groupLayout(layout, group));
}
