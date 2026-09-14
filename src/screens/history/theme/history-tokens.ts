import { useMemo } from 'react';

import { useTheme } from '@/hooks/use-theme';
import {
  errorAlphas,
  primaryAlphas,
  radius,
  spacing,
  typography,
  type Theme,
} from '@/theme';

export type HistoryTokens = ReturnType<typeof createHistoryTokens>;

export function createHistoryTokens(theme: Theme) {
  const c = theme.colors;
  const primary = primaryAlphas(c.primary);
  const destructive = errorAlphas(c.error);

  return {
    background: c.background,
    rowPressed: primary.pressed,
    faviconBg: primary.subtle,
    deleteButtonBg: destructive.medium,
    deleteButtonPressed: destructive.emphasis,
    sectionLabel: c.textSecondary,
    divider: c.divider,
    spacing: {
      screenX: spacing[16],
      rowY: spacing[12],
      rowGap: spacing[12],
      sectionTop: spacing[20],
      sectionBottom: spacing[8],
    },
    radius: {
      favicon: radius.md,
      row: radius.md,
      deleteButton: radius.full,
    },
    typography,
    rowMinHeight: 64,
    faviconSize: 36,
    touchTarget: 44,
    deleteButtonSize: 40,
  } as const;
}

export function useHistoryTokens(): HistoryTokens {
  const theme = useTheme();
  return useMemo(() => createHistoryTokens(theme), [theme]);
}
