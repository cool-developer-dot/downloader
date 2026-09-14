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

export type DownloadsTokens = ReturnType<typeof createDownloadsTokens>;

export function createDownloadsTokens(theme: Theme) {
  const c = theme.colors;
  const primary = primaryAlphas(c.primary);
  const destructive = errorAlphas(c.error);

  return {
    background: c.background,
    cardBg: c.card,
    cardBorder: c.border,
    rowPressed: primary.pressed,
    thumbnailBg: primary.subtle,
    actionButtonBg: primary.medium,
    actionButtonPressed: primary.emphasis,
    destructiveButtonBg: destructive.medium,
    destructiveButtonPressed: destructive.emphasis,
    divider: c.divider,
    status: {
      QUEUED: {
        bg: withAlpha(c.textSecondary, 0.12),
        fg: c.textSecondary,
      },
      DOWNLOADING: {
        bg: primary.strong,
        fg: c.primary,
      },
      PAUSED: {
        bg: withAlpha(c.warning, 0.14),
        fg: c.warning,
      },
      COMPLETED: {
        bg: withAlpha(c.success, 0.12),
        fg: c.success,
      },
      FAILED: {
        bg: destructive.medium,
        fg: c.error,
      },
      CANCELLED: {
        bg: withAlpha(c.textSecondary, 0.12),
        fg: c.textSecondary,
      },
    },
    spacing: {
      screenX: spacing[16],
      rowY: spacing[12],
      cardGap: spacing[12],
      sectionTop: spacing[16],
      sectionBottom: spacing[8],
      controlsGap: spacing[8],
    },
    radius: {
      card: radius.md,
      thumbnail: radius.sm,
      badge: radius.full,
      action: radius.full,
    },
    typography,
    thumbnailSize: 72,
    heroHeight: 200,
    touchTarget: 44,
    actionButtonSize: 44,
    emptyIconSize: 48,
  } as const;
}

export function useDownloadsTokens(): DownloadsTokens {
  const theme = useTheme();
  return useMemo(() => createDownloadsTokens(theme), [theme]);
}
