import { memo } from 'react';
import { View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { useRtl } from '@/localization';

export type DownloadSpeedGraphProps = {
  /** One speed per second, oldest first (`speedGraphPoints`). */
  points: number[];
  maxBps: number;
  height?: number;
  /**
   * `line` (default, the details screen): thin 1 dp-gapped bars over a hairline. `bars` (the design's "Total speed"
   * card): wide rounded red bars, 8 dp apart, that fade to a light red at the bottom.
   */
  variant?: 'line' | 'bars';
  accessibilityLabel: string;
  testID?: string;
};

const BAR_GAP = 8;
const BAR_RADIUS = 3;
/** The fade: a solid top, then two softer bands below it (no gradient library). */
const BAR_BANDS: readonly { share: number; opacity: number }[] = [
  { share: 0.42, opacity: 1 },
  { share: 0.3, opacity: 0.62 },
  { share: 0.28, opacity: 0.3 },
];

/**
 * Speed Graph (#316): the engine's speed as plain bars, newest on the trailing edge. A bar is always the same
 * second of the window, so the keys are positions.
 */
export const DownloadSpeedGraph = memo(function DownloadSpeedGraph({
  points,
  maxBps,
  height = 48,
  variant = 'line',
  accessibilityLabel,
  testID,
}: DownloadSpeedGraphProps) {
  const theme = useTheme();
  const rtl = useRtl();
  if (points.length === 0 || !Number.isFinite(maxBps) || maxBps <= 0) {
    return null;
  }

  if (variant === 'bars') {
    return (
      <View
        testID={testID}
        accessible
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel}
        style={{ height, flexDirection: rtl.rowDirection, alignItems: 'flex-end', gap: BAR_GAP }}>
        {points.map((bps, index) => {
          const ratio = Number.isFinite(bps) && bps > 0 ? Math.min(1, bps / maxBps) : 0;
          const barHeight = Math.max(ratio > 0 ? 4 : 0, Math.round(ratio * height));
          return (
            <View
              key={index}
              style={{
                flex: 1,
                height: barHeight,
                borderTopLeftRadius: BAR_RADIUS,
                borderTopRightRadius: BAR_RADIUS,
                overflow: 'hidden',
              }}>
              {BAR_BANDS.map((band, bandIndex) => (
                <View
                  key={bandIndex}
                  style={{ flex: band.share, backgroundColor: theme.colors.primary, opacity: band.opacity }}
                />
              ))}
            </View>
          );
        })}
      </View>
    );
  }

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={{
        height,
        flexDirection: rtl.rowDirection,
        alignItems: 'flex-end',
        gap: 1,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
      }}>
      {points.map((bps, index) => {
        const ratio = Number.isFinite(bps) && bps > 0 ? Math.min(1, bps / maxBps) : 0;
        return (
          <View
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
    </View>
  );
});
