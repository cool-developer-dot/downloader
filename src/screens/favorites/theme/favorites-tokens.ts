import { useMemo } from 'react';

import { useTheme } from '@/hooks/use-theme';
import {
  errorAlphas,
  primaryAlphas,
  radius,
  spacing,
  typography,
  withAlpha,
  type Theme,
} from '@/theme';

export type FavoritesTokens = ReturnType<typeof createFavoritesTokens>;

export function createFavoritesTokens(theme: Theme) {
  const c = theme.colors;
  const primary = primaryAlphas(c.primary);
  const destructive = errorAlphas(c.error);

  return {
    background: c.background,
    rowPressed: primary.pressed,
    thumbnailBg: primary.subtle,
    removeButtonBg: destructive.medium,
    removeButtonPressed: destructive.emphasis,
    unavailableBg: withAlpha(c.textSecondary, 0.1),
    divider: c.divider,
    spacing: {
      screenX: spacing[16],
      rowY: spacing[12],
      rowGap: spacing[12],
    },
    radius: {
      thumbnail: radius.sm,
      row: radius.md,
      removeButton: radius.full,
      badge: radius.full,
    },
    typography,
    rowMinHeight: 80,
    thumbnailSize: 64,
    touchTarget: 44,
    removeButtonSize: 40,
  } as const;
}

export function useFavoritesTokens(): FavoritesTokens {
  const theme = useTheme();
  return useMemo(() => createFavoritesTokens(theme), [theme]);
}
