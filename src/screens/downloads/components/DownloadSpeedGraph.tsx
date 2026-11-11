import { memo } from 'react';
import { View } from 'react-native';

import { Box } from '@/components/base/Box';
import { useTheme } from '@/hooks/use-theme';

export type DownloadSpeedGraphProps = {
  /** One speed per second, oldest first (`speedGraphPoints`). */
  points: number[];
  maxBps: number;
  height?: number;
  accessibilityLabel: string;
  testID?: string;
};

/** Speed Graph (#316): the last minute of the engine's speed as plain bars, newest on the trailing edge. */
export const DownloadSpeedGraph = memo(function DownloadSpeedGraph({
  points,
  maxBps,
  height = 48,
  accessibilityLabel,
  testID,
}: DownloadSpeedGraphProps) {
  const theme = useTheme();
  if (points.length === 0 || !Number.isFinite(maxBps) || maxBps <= 0) {
    return null;
  }

  return (
    <Box
      row
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={{
        height,
        alignItems: 'flex-end',
        gap: 1,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
      }}>
      {points.map((bps, index) => {
        const ratio = Number.isFinite(bps) && bps > 0 ? Math.min(1, bps / maxBps) : 0;
        return (
          <View
            // Fixed positions: a bar is always the same second of the window.
            key={index}
            style={{
              flex: 1,
              height: Math.max(ratio > 0 ? 2 : 0, Math.round(ratio * height)),
              borderTopLeftRadius: 1,
              borderTopRightRadius: 1,
              backgroundColor: theme.colors.primary,
              opacity: 0.85,
            }}
          />
        );
      })}
    </Box>
  );
});
