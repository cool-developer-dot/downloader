import { useMemo } from 'react';

import { useTheme } from '@/hooks/use-theme';
import {
  colors,
  elevation,
  errorAlphas,
  primaryAlphas,
  radius,
  spacing,
  typography,
  withAlpha,
  type Theme,
} from '@/theme';

/**
 * Settings visual tokens — theme-aware (Light / Dark).
 * Spacing/radius stay shared; colors follow the active app theme.
 */
export type SettingsTokens = ReturnType<typeof createSettingsTokens>;

export function createSettingsTokens(theme: Theme) {
  const isDark = theme.mode === 'dark';
  const c = theme.colors;
  const primary = primaryAlphas(c.primary);
  const destructive = errorAlphas(c.error);

  return {
    background: isDark ? c.background : c.surface,
    card: c.card,
    cardBorder: isDark ? withAlpha(c.textPrimary, 0.08) : withAlpha(colors.dark.background, 0.06),
    sectionIconBg: isDark ? primary.emphasis : primary.subtle,
    actionIconBg: isDark ? primary.emphasis : primary.subtle,
    actionIconBgMuted: withAlpha(c.textSecondary, isDark ? 0.18 : 0.14),
    divider: c.divider,
    comingSoonBg: isDark ? primary.emphasis : primary.subtle,
    comingSoonText: c.primary,
    destructiveBg: isDark ? destructive.strong : destructive.subtle,
    destructiveText: isDark ? withAlpha(c.error, 0.92) : c.error,
    textPrimary: c.textPrimary,
    textSecondary: c.textSecondary,
    textMuted: c.textDisabled,
    white: c.white,
    primary: c.primary,
    radius: {
      card: radius.xl,
      row: radius.md,
      badge: radius.full,
      icon: radius.md,
    },
    spacing: {
      screenX: spacing[20],
      sectionGap: 28,
      cardPadding: spacing[20],
      headerTop: spacing[8],
      headerBottom: spacing[24],
      rowMinHeight: 64,
    },
    elevation: {
      card: elevation.sm,
    },
    typography,
  } as const;
}

export function useSettingsTokens(): SettingsTokens {
  const theme = useTheme();
  return useMemo(() => createSettingsTokens(theme), [theme]);
}
