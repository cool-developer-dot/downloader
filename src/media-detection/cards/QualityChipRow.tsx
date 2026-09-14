import { memo } from 'react';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';

import type { ResolvedQuality } from '../quality';
import { formatBitrate } from '../utils';

export type QualityChipRowProps = {
  qualities: ResolvedQuality[];
  compact?: boolean;
  testID?: string;
};

export const QualityChipRow = memo(function QualityChipRow({
  qualities,
  compact = false,
  testID = 'quality-chip-row',
}: QualityChipRowProps) {
  const theme = useTheme();

  if (!qualities.length) {
    return null;
  }

  return (
    <Box testID={testID} gap={compact ? 4 : 8}>
      {!compact ? (
        <Text variant="caption" color="textSecondary">
          Available qualities
        </Text>
      ) : null}
      <Box row style={{ flexWrap: 'wrap', gap: theme.spacing[4] }}>
        {qualities.map((quality) => {
          const bitrate = formatBitrate(quality.bandwidth ?? quality.bitrate);
          return (
            <Box
              key={quality.id}
              accessibilityRole="text"
              accessibilityLabel={`${quality.label}${bitrate ? `, ${bitrate}` : ''}${
                quality.available ? '' : ', unavailable'
              }`}
              style={{
                paddingHorizontal: theme.spacing[8],
                paddingVertical: compact ? theme.spacing[4] : theme.spacing[8],
                borderRadius: theme.radius.sm,
                backgroundColor: quality.available
                  ? theme.colors.primaryLight
                  : theme.colors.surface,
                borderWidth: 1,
                borderColor: quality.available
                  ? theme.colors.primary
                  : theme.colors.border,
                opacity: quality.available ? 1 : 0.55,
              }}>
              <Text
                variant="caption"
                style={{
                  fontWeight: '600',
                  color: quality.available
                    ? theme.colors.primaryDark
                    : theme.colors.textSecondary,
                }}>
                {quality.label}
                {bitrate && !compact ? ` · ${bitrate}` : ''}
              </Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
});
