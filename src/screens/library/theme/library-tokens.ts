import { useMemo } from 'react';

import { useTheme } from '@/hooks/use-theme';
import { primaryAlphas, radius, spacing, typography, type Theme } from '@/theme';

export type LibraryTokens = ReturnType<typeof createLibraryTokens>;

export function createLibraryTokens(theme: Theme) {
  const c = theme.colors;
  const primary = primaryAlphas(c.primary);

  return {
    spacing: {
      screenX: spacing[16],
      rowY: spacing[12],
      cardGap: spacing[12],
      controlsGap: spacing[8],
      gridGap: spacing[12],
    },
    radius: {
      card: radius.md,
      thumbnail: radius.sm,
      tile: radius.md,
    },
    typography,
    thumbnailSize: 72,
    gridThumbnailHeight: 96,
    touchTarget: 44,
    emptyIconSize: 48,
    listRowHeight: 96,
    favorite: c.error,
    rowPressed: primary.pressed,
    thumbnailBg: primary.subtle,
  } as const;
}

export function useLibraryTokens(): LibraryTokens {
  const theme = useTheme();
  return useMemo(() => createLibraryTokens(theme), [theme]);
}
