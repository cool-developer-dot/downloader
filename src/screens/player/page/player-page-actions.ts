/**
 * Screen 19 ("Video player") of the design: which chip, tile and menu entry does what. Kept in one list so the
 * design's reading can change in one line (the CEO may read the two seek tiles differently).
 *
 * - "10 s" (⏪) skips back by the chosen seek interval; its label follows the interval.
 * - "Custom seek" (⏩) chooses the seek interval (#527 Custom Seek Interval).
 * - Stop (#520), Jump to time (#532) and the orientation lock are rows of the ⋮ options sheet (src/player/options):
 *   the frame draws no tile for them. The tiles here are shortcuts to the same commands.
 * - "Aspect ratio" opens P2's fit sheet (#564 Aspect ratio, #565 Crop to fill, #566 Stretch).
 * - The design's "Filters" tile is "Mirror / Flip" (#573): Filters (#571, #572) is not planned.
 */

import type { DsIconName } from '@/design';

export type PlayerPageAction =
  | 'speed'
  | 'subs'
  | 'audio'
  | 'rotate'
  | 'lock'
  | 'skipBack'
  | 'seekInterval'
  | 'frameByFrame'
  | 'abRepeat'
  | 'aspectRatio'
  | 'mirrorFlip'
  | 'upNext';

/** The chip row, in the design's order (1.0× · Subs · Audio · Rotate · Lock). */
export const PAGE_CHIPS = ['speed', 'subs', 'audio', 'rotate', 'lock'] as const satisfies readonly PlayerPageAction[];

export type PageChip = (typeof PAGE_CHIPS)[number];

/**
 * Which chips are drawn. A chip whose flag is off is not shown, but its label, handler and place in the design order
 * stay. Audio is Faran's P17 (screen 22): hidden until P17 is merged, which sets `audio: true`. The 1.0× chip is
 * Faran's P16.
 */
export const PAGE_CHIP_FLAGS: Readonly<Record<PageChip, boolean>> = {
  speed: true,
  subs: true,
  audio: false,
  rotate: true,
  lock: true,
};

/** The chips to draw, in the design order, leaving out those whose flag is off. */
export function shownPageChips(flags: Readonly<Record<PageChip, boolean>> = PAGE_CHIP_FLAGS): PageChip[] {
  return PAGE_CHIPS.filter((chip) => flags[chip]);
}

export type PageTile = {
  id: 'skipBack' | 'customSeek' | 'frameByFrame' | 'abRepeat' | 'aspectRatio' | 'mirrorFlip';
  icon: DsIconName;
  action: PlayerPageAction;
};

/** The tile grid, in the design's order, with the design's icons (Mirror / Flip, in Filters' place, has its own). */
export const PAGE_TILES: readonly PageTile[] = [
  { id: 'skipBack', icon: 'rewind', action: 'skipBack' },
  { id: 'customSeek', icon: 'fast-forward', action: 'seekInterval' },
  { id: 'frameByFrame', icon: 'film', action: 'frameByFrame' },
  { id: 'abRepeat', icon: 'repeat', action: 'abRepeat' },
  { id: 'aspectRatio', icon: 'sliders-vertical', action: 'aspectRatio' },
  { id: 'mirrorFlip', icon: 'flip-horizontal-2', action: 'mirrorFlip' },
];

/**
 * Drawn by the design but built by a later package, so they say "Not available yet" for now: Subs (P3), A–B repeat
 * (P5), Up next (P6), Audio (Faran's P17; its chip is also hidden, see `PAGE_CHIP_FLAGS`). The package that builds
 * one removes it from this set.
 */
export const NOT_YET_ACTIONS: ReadonlySet<PlayerPageAction> = new Set<PlayerPageAction>([
  'subs',
  'audio',
  'abRepeat',
  'upNext',
]);
