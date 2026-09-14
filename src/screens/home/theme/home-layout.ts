import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';

import { BRAND_LOGO_SIZES } from '@/constants/brand-assets';
import { useTheme } from '@/hooks/use-theme';

/**
 * Home layout composed only from existing theme tokens.
 * No Home-specific color system.
 */
export function useHomeLayout() {
  const theme = useTheme();
  const { width } = useWindowDimensions();

  return useMemo(() => {
    const screenX = theme.spacing[16];
    const itemGap = theme.spacing[12];
    const preferredWidth =
      theme.spacing[64] + theme.spacing[56] + theme.spacing[48];
    const availableWidth = width - screenX * 2 - itemGap;
    const stackedActions = width < theme.spacing[64] * 5;

    return {
      theme,
      screenX,
      itemGap,
      /** Space before first content section below header. */
      actionsTop: theme.spacing[12],
      /** Space between action buttons and Quick Access. */
      quickAccessTop: theme.spacing[24],
      /** Space before Active Downloads and lower sections. */
      sectionTop: theme.spacing[24],
      /** Compact header vertical padding. */
      headerY: theme.spacing[8],
      cardPadding: theme.spacing[12],
      cardWidth: Math.min(
        preferredWidth,
        Math.max(theme.spacing[64] + theme.spacing[48], availableWidth),
      ),
      mediaRadius: theme.radius.md,
      thumbRadius: theme.radius.sm,
      progressHeight: theme.spacing[4],
      logoSize: BRAND_LOGO_SIZES.sm,
      touchTarget: theme.spacing[24] + theme.spacing[20],
      metaGap: theme.spacing[4],
      titleGap: theme.spacing[4],
      scrollBottom: theme.spacing[32],
      storageBottom: theme.spacing[8],
      stackedActions,
      actionsGap: theme.spacing[8],
    };
  }, [theme, width]);
}
