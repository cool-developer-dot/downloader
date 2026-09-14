import { memo } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

export type ProgressBarProps = {
  progress: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string;
};

export const ProgressBar = memo(function ProgressBar({
  progress,
  style,
  testID,
  accessibilityLabel = 'Download progress',
}: ProgressBarProps) {
  const theme = useTheme();
  const clampedProgress = Math.max(0, Math.min(progress, 1));

  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clampedProgress * 100) }}
      style={[
        {
          height: theme.spacing[8],
          borderRadius: theme.radius.full,
          backgroundColor: theme.colors.surface,
          overflow: 'hidden',
        },
        style,
      ]}>
      <View
        style={{
          width: `${clampedProgress * 100}%`,
          height: '100%',
          backgroundColor: theme.colors.primary,
        }}
      />
    </View>
  );
});
