import { spacing } from '@/theme/spacing';

export type QuickAccessDensity = 'default' | 'compact' | 'startPage';

const baseTokens = {
  columns: 3,
  screenPaddingX: spacing[16],
  gridGap: spacing[12],
  gridGapTablet: spacing[16],
  sectionGap: spacing[20],
  tileMinHeight: 108,
  tileIconSize: 52,
  faviconSize: 32,
  tileRadius: 20,
  iconContainerRadius: 16,
  tilePaddingY: spacing[12],
  tilePaddingX: spacing[8],
  labelGap: spacing[12],
  minTouchTarget: 48,
  tabletBreakpoint: 720,
} as const;

/** Compact tiles — shared legacy density. */
const compactOverrides = {
  gridGap: spacing[12],
  gridGapTablet: spacing[12],
  sectionGap: spacing[12],
  tileMinHeight: 92,
  tileIconSize: 36,
  faviconSize: 28,
  tileRadius: 16,
  iconContainerRadius: 12,
  tilePaddingY: spacing[8],
  tilePaddingX: spacing[8],
  labelGap: spacing[8],
} as const;

/**
 * Start-page shortcut density — premium compact launch tiles (3×3).
 * Target: ~88–102dp height, 14–16 radius, 34–40 icon, 10–12 gap.
 */
const startPageOverrides = {
  screenPaddingX: spacing[20],
  gridGap: spacing[12],
  gridGapTablet: spacing[12],
  sectionGap: spacing[12],
  tileMinHeight: 96,
  tileIconSize: 36,
  faviconSize: 28,
  tileRadius: 16,
  iconContainerRadius: 12,
  tilePaddingY: spacing[8],
  tilePaddingX: spacing[8],
  labelGap: spacing[8],
} as const;

export type QuickAccessTokenSet = {
  columns: number;
  screenPaddingX: number;
  gridGap: number;
  gridGapTablet: number;
  sectionGap: number;
  tileMinHeight: number;
  tileIconSize: number;
  faviconSize: number;
  tileRadius: number;
  iconContainerRadius: number;
  tilePaddingY: number;
  tilePaddingX: number;
  labelGap: number;
  minTouchTarget: number;
  tabletBreakpoint: number;
};

/** Shared Quick Access layout tokens — used by Browser and Home surfaces. */
export const quickAccessTokens: QuickAccessTokenSet = baseTokens;

export function getQuickAccessTokens(
  density: QuickAccessDensity = 'default',
): QuickAccessTokenSet {
  if (density === 'startPage') {
    return { ...baseTokens, ...startPageOverrides };
  }
  if (density === 'compact') {
    return { ...baseTokens, ...compactOverrides };
  }
  return baseTokens;
}

export type QuickAccessLayoutOptions = {
  windowWidth: number;
  horizontalPadding?: number;
  density?: QuickAccessDensity;
};

export function resolveQuickAccessGap(
  windowWidth: number,
  density: QuickAccessDensity = 'default',
): number {
  const tokens = getQuickAccessTokens(density);
  return windowWidth >= tokens.tabletBreakpoint
    ? tokens.gridGapTablet
    : tokens.gridGap;
}

/** Equal-width tile for a fixed 3-column grid. */
export function resolveQuickAccessTileWidth({
  windowWidth,
  horizontalPadding = quickAccessTokens.screenPaddingX,
  density = 'default',
}: QuickAccessLayoutOptions): number {
  const tokens = getQuickAccessTokens(density);
  const gap = resolveQuickAccessGap(windowWidth, density);
  const columns = tokens.columns;
  const gaps = gap * (columns - 1);
  const available = windowWidth - horizontalPadding * 2 - gaps;
  return Math.floor(available / columns);
}
