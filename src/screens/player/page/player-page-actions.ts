/**
 * Screen 19 ("Video player") of the design: which chip, tile and menu entry does what. Kept in one list so the
 * design's reading can change in one line (the CEO may read the two seek tiles differently).
 *
 * - "10 s" (⏪) skips back by the chosen seek interval; its label follows the interval.
 * - "Custom seek" (⏩) chooses the seek interval (#527 Custom Seek Interval).
 * - Jump to time (#532) and Stop (#520) are in the ⋮ menu: the frame draws no tile for them.
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
  | 'filters'
  | 'upNext'
  | 'stop'
  | 'jumpToTime'
  | 'orientation'
  | 'saveToLibrary';

/** The chip row, in the design's order (1.0× · Subs · Audio · Rotate · Lock). */
export const PAGE_CHIPS = ['speed', 'subs', 'audio', 'rotate', 'lock'] as const satisfies readonly PlayerPageAction[];

export type PageTile = {
  id: 'skipBack' | 'customSeek' | 'frameByFrame' | 'abRepeat' | 'aspectRatio' | 'filters';
  icon: DsIconName;
  action: PlayerPageAction;
};

/** The tile grid, in the design's order, with the design's icons. */
export const PAGE_TILES: readonly PageTile[] = [
  { id: 'skipBack', icon: 'rewind', action: 'skipBack' },
  { id: 'customSeek', icon: 'fast-forward', action: 'seekInterval' },
  { id: 'frameByFrame', icon: 'film', action: 'frameByFrame' },
  { id: 'abRepeat', icon: 'repeat', action: 'abRepeat' },
  { id: 'aspectRatio', icon: 'sliders-vertical', action: 'aspectRatio' },
  { id: 'filters', icon: 'moon', action: 'filters' },
];

/** The ⋮ Video options menu (page header, card, full-screen top bar). "Save to VidoraX" leads it for a file from another app. */
export const OPTIONS_MENU = ['stop', 'jumpToTime', 'frameByFrame', 'seekInterval', 'orientation'] as const satisfies readonly PlayerPageAction[];

/**
 * Drawn by the design but built by a later package, so they say "Not available yet" for now: Subs (P3), Aspect ratio
 * (P2), A–B repeat (P5), Up next (P6), Audio (Faran's sound packages, screen 22). Filters is in no package yet.
 */
export const NOT_YET_ACTIONS: ReadonlySet<PlayerPageAction> = new Set<PlayerPageAction>([
  'subs',
  'audio',
  'abRepeat',
  'aspectRatio',
  'filters',
  'upNext',
]);
