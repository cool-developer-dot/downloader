import { useMemo } from 'react';

import { useTheme } from '@/hooks/use-theme';
import { withAlpha } from '@/theme';

export function usePlatformHubTokens(variant: 'hero' | 'compact' = 'hero') {
  const theme = useTheme();

  return useMemo(() => {
    const sage = theme.colors.primary;
    const oliveCard = theme.colors.card;

    return {
      variant,
      sage,
      oliveCard,
      nodeBg: withAlpha(oliveCard, 0.92),
      nodeBorder: withAlpha(theme.colors.textPrimary, 0.1),
      nodeBorderCapability: withAlpha(sage, 0.28),
      radialGuide: withAlpha(sage, 0.12),
      radialGuideOuter: withAlpha(sage, 0.06),
      beam: withAlpha(sage, 0.22),
      energy: withAlpha(sage, 0.88),
      centerGlowInner: withAlpha(sage, 0.2),
      centerGlowOuter: withAlpha(sage, 0.08),
      centerRing: withAlpha(sage, 0.35),
      capabilityIcon: sage,
      textPrimary: theme.colors.textPrimary,
    };
  }, [theme.colors, variant]);
}

export type PlatformHubTokens = ReturnType<typeof usePlatformHubTokens>;
