import { memo, useMemo } from 'react';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';

import type { DiscoveryBadge } from '../ui';

export type MediaBadgeRowProps = {
  badges: DiscoveryBadge[];
  testID?: string;
};

export const MediaBadgeRow = memo(function MediaBadgeRow({
  badges,
  testID = 'media-badge-row',
}: MediaBadgeRowProps) {
  const theme = useTheme();

  const toneColors = useMemo(
    () => ({
      neutral: {
        bg: theme.colors.surface,
        fg: theme.colors.textSecondary,
        border: theme.colors.border,
      },
      accent: {
        bg: theme.colors.primaryLight,
        fg: theme.colors.primaryDark,
        border: theme.colors.primary,
      },
      warning: {
        bg: theme.colors.warning + '22',
        fg: theme.colors.warning,
        border: theme.colors.warning,
      },
      danger: {
        bg: theme.colors.error + '22',
        fg: theme.colors.error,
        border: theme.colors.error,
      },
      success: {
        bg: theme.colors.success + '22',
        fg: theme.colors.success,
        border: theme.colors.success,
      },
    }),
    [theme],
  );

  if (!badges.length) {
    return null;
  }

  return (
    <Box
      testID={testID}
      row
      style={{ flexWrap: 'wrap', gap: theme.spacing[8] }}>
      {badges.map((badge) => {
        const colors = toneColors[badge.tone];
        return (
          <Box
            key={`${badge.kind}-${badge.label}`}
            accessibilityRole="text"
            accessibilityLabel={badge.label}
            style={{
              paddingHorizontal: theme.spacing[8],
              paddingVertical: theme.spacing[2],
              borderRadius: theme.radius.full,
              backgroundColor: colors.bg,
              borderWidth: 1,
              borderColor: colors.border,
            }}>
            <Text
              variant="caption"
              style={{ color: colors.fg, fontWeight: '600', letterSpacing: 0.3 }}>
              {badge.label}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
});
