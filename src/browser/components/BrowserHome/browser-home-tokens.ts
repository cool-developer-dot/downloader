import { spacing } from '@/theme/spacing';

import { getQuickAccessTokens } from '@/browser/components/QuickAccess/quick-access-tokens';

const startPageAccess = getQuickAccessTokens('startPage');

/**
 * Unified Browser start-page layout tokens — compact premium density.
 */
export const browserHomeTokens = {
  screenPaddingX: startPageAccess.screenPaddingX,
  /** Omnibox → content (target 20–24). */
  contentPaddingTop: spacing[20],
  contentPaddingBottom: spacing[24],
  /** Title → subtitle. */
  introTitleGap: spacing[4],
  /** Subtitle → Quick Access heading. */
  introToQuickAccessGap: spacing[24],
  /** Quick Access heading → grid. */
  quickAccessHeadingGap: spacing[12],
  sectionGap: spacing[24],
  gridGap: startPageAccess.gridGap,
  tileMinHeight: startPageAccess.tileMinHeight,
  tileIconSize: startPageAccess.tileIconSize,
  tileRadius: startPageAccess.tileRadius,
  tilePadding: startPageAccess.tilePaddingY,
  /** Brand title ~24–28sp (uses typography.h3 = 24). */
  brandTitleVariant: 'h3' as const,
  /** Subtitle ~14–15sp. */
  brandSubtitleVariant: 'bodySmall' as const,
  /** Quick Access heading ~18–20sp. */
  quickAccessHeadingVariant: 'subtitle' as const,
  historyRowMinHeight: 56,
  historyFaviconSize: 36,
  tabHeight: 40,
  maxRecentHistory: 8,
  maxBookmarkTiles: 8,
} as const;
