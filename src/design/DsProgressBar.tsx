import { memo } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { useRtl } from '@/localization';

import { ds } from './tokens';

export type DsProgressBarProps = {
  /** 0 … 1. */
  progress: number;
  height?: number;
  /** A theme colour token; default the accent. */
  color?: 'primary' | 'success' | 'warning' | 'textSecondary';
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** The design's 6 dp bar: a #EDEDF0 track with a red fill, fully rounded. */
export const DsProgressBar = memo(function DsProgressBar({
  progress,
  height = ds.size.progress,
  color = 'primary',
  accessibilityLabel,
  style,
  testID,
}: DsProgressBarProps) {
  const theme = useTheme();
  const rtl = useRtl();
  const clamped = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={[{ height, borderRadius: height / 2, backgroundColor: theme.colors.track, overflow: 'hidden', flexDirection: rtl.rowDirection }, style]}>
      <View style={{ width: `${clamped * 100}%`, height, borderRadius: height / 2, backgroundColor: theme.colors[color] }} />
    </View>
  );
});
